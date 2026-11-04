"""HTTP/SSE bridge from the lab's files to the EigenBrains UI.

    python -m discolab.bridge --port 8765                 # read-only (default)
    python -m discolab.bridge --port 8765 --enable-runs   # also start Muse Code runs + answer approvals

Serves live labs (lab_home/<name>) and committed records (results/<name>).
Everything returned is read from the ledger, the agent activity log, the
Omnigent event log or the raw trace artifacts; the bridge computes summaries
(means over runs) but never invents values. Without --enable-runs it writes
nothing.

  GET  /lab/sources                      available labs and records
  GET  /lab/state?source=...             state, hypothesis trajectories, scoring rounds, decisions
  GET  /lab/activity?source=...          agent handoffs, tool calls, messages, approvals
  GET  /lab/experiment?source=...&id=E#  compact result + per-generation curves from traces.npz
  GET  /lab/stream?source=...            SSE: new ledger events ("ledger") and agent activity ("agent")
  GET  /lab/run?source=...               Muse Code run record: question, scope, config, status, spend, approvals
  GET  /lab/capabilities                 whether runs can be started here, and the supported domain
  POST /lab/runs        {question, rounds?, ceiling_usd?}     scope-check, then start a run   (--enable-runs)
  POST /lab/approvals   {source, id, decision: approve|decline} answer a pending approval   (--enable-runs)

Authentication. With a bridge token configured (NOESIS_BRIDGE_TOKEN_FILE, or
NOESIS_BRIDGE_TOKEN; at least 32 characters), every request, read or write,
must carry it in the X-Noesis-Bridge-Token header, or it gets 401 before any
work is done. The web app's /lab-proxy adds the header on the server. Without a
token the bridge is unauthenticated: it then listens on loopback only and is
for local development; never publish it. Hosted labs start with --require-auth,
which refuses to start without a token.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import sys
import threading
import time
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np

from .ledger import fold
from .views import result_summary, state_summary

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = ("lab_home", "results")
POLL_SEC = 0.5
UI_KINDS = ("handoff", "tool", "say", "approval", "gate")  # activity kinds the frontend renders
# Server-side limits for runs started from the UI (protects the credit pool).
UI_MAX_ROUNDS = 2
UI_MAX_CEILING_USD = 5.0
ENABLE_RUNS = False
TRIAL = None  # trial.Trial when NOESIS_TRIAL_TOTAL_USD is set: limits every run (see trial.py)
START_LOCK = threading.Lock()  # one admission decision at a time (ThreadingHTTPServer)

# ------------------------------------------------------------------- auth
TOKEN_HEADER = "X-Noesis-Bridge-Token"
CLIENT_HEADER = "X-Noesis-Client"  # opaque visitor id from the web server (trial rate limits)
MIN_TOKEN_LENGTH = 32
LOOPBACK_HOSTS = ("127.0.0.1", "::1", "localhost")
BRIDGE_TOKEN: str | None = None  # set by main(); None = unauthenticated local development


class BridgeAuthError(RuntimeError):
    """The bridge's authentication settings are unsafe or invalid; it must not start."""


def load_bridge_token(env=None) -> str | None:
    """The bridge token from NOESIS_BRIDGE_TOKEN_FILE (preferred) or NOESIS_BRIDGE_TOKEN, or None."""
    env = os.environ if env is None else env
    path = (env.get("NOESIS_BRIDGE_TOKEN_FILE") or "").strip()
    if path:
        try:
            token = Path(path).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise BridgeAuthError(f"cannot read NOESIS_BRIDGE_TOKEN_FILE: {exc.strerror}") from None
    else:
        token = (env.get("NOESIS_BRIDGE_TOKEN") or "").strip()
    if not token:
        return None
    if len(token) < MIN_TOKEN_LENGTH:
        raise BridgeAuthError(f"the bridge token must be at least {MIN_TOKEN_LENGTH} characters")
    return token


def check_startup(host: str, token: str | None, require_auth: bool) -> None:
    """Refuse to start an unauthenticated bridge anywhere but loopback, or at all with --require-auth."""
    if token is None and require_auth:
        raise BridgeAuthError("--require-auth is set but no bridge token is configured "
                              "(NOESIS_BRIDGE_TOKEN_FILE or NOESIS_BRIDGE_TOKEN)")
    if token is None and host not in LOOPBACK_HOSTS:
        raise BridgeAuthError(f"refusing to listen on {host} without a bridge token")


def authorized(headers, token: str | None) -> bool:
    if token is None:
        return True
    given = headers.get(TOKEN_HEADER) or ""
    return hmac.compare_digest(given.encode("utf-8"), token.encode("utf-8"))


SECRET_VALUES: tuple[str, ...] = ()  # set by main(): never sent in any response, even if an agent echoes one


def redact(text: str) -> str:
    for s in SECRET_VALUES:
        if s and s in text:
            text = text.replace(s, "[redacted]")
    return text


def resolve_source(source: str) -> Path:
    parts = Path(source).parts
    if len(parts) != 2 or parts[0] not in ALLOWED or parts[1] in ("..", "."):
        raise ValueError("source must be lab_home/<name> or results/<name>")
    # Contain the run inside its own resolved base, not ROOT: in the container
    # lab_home is a link to persistent storage (/data/lab_home), outside ROOT.
    base = (ROOT / parts[0]).resolve()
    p = (base / parts[1]).resolve()
    if base not in p.parents or not (p / "ledger.jsonl").exists():
        raise ValueError(f"no ledger at {source}")
    return p


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def list_sources() -> list[dict]:
    out = []
    for kind, base in (("live", "lab_home"), ("record", "results")):
        d = ROOT / base
        if not d.is_dir():
            continue
        for p in sorted(d.iterdir()):
            if (p / "ledger.jsonl").exists():
                events = read_jsonl(p / "ledger.jsonl")
                run = _read_json(p / "run.json")
                out.append({"id": f"{base}/{p.name}", "kind": kind, "events": len(events),
                            "experiments": sum(e["type"] == "experiment_completed" for e in events),
                            "prereg_sha256": events[0]["prereg_sha256"] if events else None,
                            "runtime": "muse" if run else ("omnigent" if (p / "omnigent_events.jsonl").exists()
                                                           else None),
                            "run_status": run.get("status") if run else None,
                            "created_at": run.get("created_at") if run else None})
    return out


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    except (OSError, json.JSONDecodeError):
        return None


def source_activity(src: Path) -> list[dict]:
    """Muse Code runs write normalized activity; Omnigent runs are converted from their event log."""
    if (src / "activity.jsonl").exists():
        return [a for a in read_jsonl(src / "activity.jsonl") if a.get("kind") in UI_KINDS]
    acts, _ = activity(read_jsonl(src / "omnigent_events.jsonl"))
    return acts


def _pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        import psutil  # optional
        return psutil.pid_exists(int(pid))
    except ImportError:
        pass
    if sys.platform == "win32":
        import ctypes

        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))  # QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def run_view(src: Path) -> dict:
    """Run record + live spend/tokens per agent + approvals (Muse Code runs only)."""
    from .muse import run_usage

    rec = _read_json(src / "run.json")
    if rec is None:
        return {"runtime": None}
    status = rec.get("status")
    if status == "running" and not _pid_alive(rec.get("pid")):
        status = "interrupted"  # driver process is gone without finalising
    acts = read_jsonl(src / "activity.jsonl")
    per_agent: dict[str, dict] = {}
    for a in acts:
        if a.get("kind") != "usage":
            continue
        row = per_agent.setdefault(a["agent"], {"agent": a["agent"], "model": a.get("model"), "runs": 0, "calls": 0,
                                                "input_tokens": 0, "cached_tokens": 0, "output_tokens": 0,
                                                "cost_usd": 0.0, "seconds": 0.0})
        row["runs"] += 1
        for k in ("calls", "input_tokens", "cached_tokens", "output_tokens"):
            row[k] += int(a.get(k) or 0)
        row["cost_usd"] = round(row["cost_usd"] + float(a.get("cost_usd") or 0), 6)
        row["seconds"] = round(row["seconds"] + float(a.get("seconds") or 0), 2)
    open_count: dict[tuple, int] = {}
    for a in acts:
        if a.get("kind") in ("agent_start", "agent_end"):
            k = (a["agent"], a.get("title"))
            open_count[k] = open_count.get(k, 0) + (1 if a["kind"] == "agent_start" else -1)
    active = [{"agent": k[0], "title": k[1]} for k, n in open_count.items() if n > 0] \
        if status in ("running", "prepared") else []
    approvals = []
    adir = src / "approvals"
    if adir.is_dir():
        for p in sorted(adir.glob("*.json")):
            a = _read_json(p)
            if a:
                approvals.append(a)
    model_calls = sum(1 for a in acts if a.get("kind") == "model_call")
    return {"runtime": "muse", **{k: rec.get(k) for k in (
        "run_id", "mode", "source", "question", "scope", "rounds", "ceiling_usd", "config", "prereg",
        "created_at", "started_at", "finished_at", "wall_seconds", "final_report", "error", "pricing_source")},
            "harness": rec.get("runtime"), "status": status, "usage": run_usage(src), "per_agent": list(per_agent.values()),
            "active_agents": active, "model_calls_started": model_calls, "approvals": approvals}


def capabilities() -> dict:
    from .scope import design_space

    trial = TRIAL.status() if TRIAL else None
    return {"runs_enabled": ENABLE_RUNS, "harness": "Muse Code (Meta Model API)",
            "max_rounds": 1 if TRIAL else UI_MAX_ROUNDS,
            "max_ceiling_usd": TRIAL.cfg.run_ceiling_usd if TRIAL else UI_MAX_CEILING_USD,
            "trial": trial, "active_run": _active_run(), "supported_domain": design_space(),
            "modes": {"lab": "questions in the pre-registered GA/entropy domain: experiments are executed",
                      "open": "any other research question: verified literature, falsifiable hypotheses, "
                              "proposed study protocols and critique; nothing is executed"}}


def _active_run() -> str | None:
    base = ROOT / "lab_home"
    if not base.is_dir():
        return None
    for p in base.iterdir():
        rec = _read_json(p / "run.json")
        if not rec:
            continue
        if rec.get("status") == "running" and _pid_alive(rec.get("pid")):
            return f"lab_home/{p.name}"
        if rec.get("status") == "prepared" and time.time() - (p / "run.json").stat().st_mtime < 60:
            return f"lab_home/{p.name}"  # just launched; the driver has not reported yet
    return None


def start_run(body: dict, client: str | None = None) -> tuple[int, dict]:
    question = " ".join(str(body.get("question") or "").split())
    if not 8 <= len(question) <= 600:
        return 400, {"error": {"code": "bad_question", "message": "ask a question of 8-600 characters"}}
    with START_LOCK:  # busy check, trial admission and launch are one decision
        busy = _active_run()
        if busy:
            return 409, {"error": {"code": "run_in_progress", "message": f"a run is already in progress ({busy})",
                                   "source": busy}}
        if TRIAL is None:
            rounds = max(1, min(UI_MAX_ROUNDS, int(body.get("rounds") or 1)))
            ceiling = max(0.25, min(UI_MAX_CEILING_USD, float(body.get("ceiling_usd") or 2.0)))
            return _launch(question, rounds, ceiling)
        from .trial import client_id

        who = client_id(client)
        with TRIAL.lock:
            refused = TRIAL.admit(who)
            if refused:
                return refused
            status, out = _launch(question, 1, TRIAL.cfg.run_ceiling_usd)
            if status == 201:
                TRIAL.record_start(out["source"], who)
            return status, out


def _launch(question: str, rounds: int, ceiling: float) -> tuple[int, dict]:
    from . import run as runmod
    from . import scope

    try:
        sc = scope.check(question)
    except Exception as exc:
        return 502, {"error": {"code": "scope_check_failed", "message": f"{type(exc).__name__}: {exc}"}}
    # Every question is accepted. The scope check only decides the mode: 'lab' runs the
    # pre-registered experiments, 'open' researches the question without executing anything.
    mode = "lab" if sc.get("in_scope") else "open"
    home = runmod.prepare(question, rounds, ceiling, scope_result=sc, mode=mode)
    runmod.start_detached(home)  # the driver records its own pid in run.json
    rec = runmod.read_run(home)
    return 201, {"source": rec["source"], "run_id": rec["run_id"], "scope": sc, "mode": mode, "rounds": rounds,
                 "ceiling_usd": ceiling}


def answer_approval(body: dict) -> tuple[int, dict]:
    src = resolve_source(str(body.get("source") or ""))
    eid = str(body.get("id") or "")
    decision = body.get("decision")
    if decision not in ("approve", "decline") or not eid.startswith("E") or not eid[1:].isdigit():
        return 400, {"error": {"code": "bad_request", "message": "need id=E# and decision approve|decline"}}
    path = src / "approvals" / f"{eid}.json"
    rec = _read_json(path)
    if rec is None:
        return 404, {"error": {"code": "not_found", "message": f"no approval request for {eid}"}}
    if rec.get("status") != "pending":
        return 409, {"error": {"code": "already_decided", "message": f"{eid} is already {rec.get('status')}"}}
    rec.update(status="approved" if decision == "approve" else "declined", decided_by="human (UI)",
               decided_at=time.time())
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec), encoding="utf-8")
    os.replace(tmp, path)
    return 200, {"id": eid, "status": rec["status"]}


def lab_state(path: Path) -> dict:
    events = read_jsonl(path / "ledger.jsonl")
    s = fold(events)
    summary = state_summary(s)
    trajectories = {}
    for hid, h in s["hypotheses"].items():
        pts = [{"seq": 0, "posterior": float(h.get("prior", 0.5)), "label": "prior"}]
        for e in h["history"]:
            pts.append({"seq": e["seq"], "posterior": float(e["posterior"]), "verdict": e.get("verdict"),
                        "experiment": e.get("experiment"),
                        "label": e.get("experiment") or e.get("reason", "coupling")})
        trajectories[hid] = pts
    rounds = []
    selections = {d["seq"]: d for d in s["decisions"] if d["kind"] == "selection"}
    for r in s["scoring_rounds"]:
        chosen = next((d for seq, d in sorted(selections.items()) if seq > r["seq"]), None)
        rounds.append({"round": r["round"], "seq": r["seq"], "argmax": r["argmax"],
                       "selected": chosen["id"] if chosen else None,
                       "followed_argmax": chosen.get("followed_argmax") if chosen else None,
                       "justification": chosen.get("justification") if chosen else None,
                       "rows": [{"id": x["id"], "title": x["title"], "kind": x["kind"], "stage": x["stage"],
                                 "eig_bits": x["eig_bits"], "utility": x["utility"], "feasible": x["feasible"],
                                 "violations": x["violations"], "est_wall_seconds": x["cost"]["wall_seconds"],
                                 "hypotheses": list(x["hypotheses"])} for x in r["scores"]]})
    decisions = [{"seq": d["seq"], "by": d["by"], "decision": d.get("decision"), "rationale": d.get("rationale"),
                  "next_experiment": d.get("next_experiment")} for d in s["decisions"] if d["kind"] == "next_step"]
    analyses = {eid: {"by": c["analysis"]["by"], "interpretation": c["analysis"]["interpretation"],
                      "threats_to_validity": c["analysis"]["threats_to_validity"],
                      "verification": c["analysis"].get("verification") or {"status": "unverified"}}
                for eid, c in s["candidates"].items() if c.get("analysis")}
    return {**summary, "events": len(events), "prereg_sha256": s["prereg_sha256"],
            "trajectories": trajectories, "rounds": rounds, "decisions": decisions, "analyses": analyses,
            "completed": s["completed"]}


# ----------------------------------------------------------------- activity
def _short(x, n=160) -> str:
    s = x if isinstance(x, str) else json.dumps(x, default=str)
    return s if len(s) <= n else s[: n - 1] + "…"


def activity(rows: list[dict], names: dict | None = None) -> tuple[list[dict], dict]:
    """Compact agent activity from Omnigent stream events (handoffs, tool calls, messages)."""
    names = dict(names or {})
    seen = set()
    out = []
    for r in rows:
        t, sid = r.get("type"), r.get("session")
        if t == "driver.session_created":
            names[sid] = "pi"
            continue
        if t == "session.child_session.updated":
            ch = r.get("child") or {}
            cid = r.get("child_session_id")
            if ch.get("tool"):
                names[cid] = ch["tool"]
            if ch.get("title") and ch.get("busy") is not None:
                key = (cid, bool(ch["busy"]))
                # a child reports busy=false while launching; only "finished" after "running" counts
                if key in seen or (not ch["busy"] and (cid, True) not in seen):
                    continue
                seen.add(key)
                out.append({"t": r["t"], "kind": "handoff", "from": names.get(sid, "pi"), "to": ch.get("tool"),
                            "title": ch["title"], "state": "running" if ch["busy"] else "finished"})
            continue
        if t == "response.elicitation_request":
            out.append({"t": r["t"], "kind": "approval", "agent": names.get(sid, "?"),
                        "text": _short((r.get("params") or {}).get("message", ""), 240)})
            continue
        if t != "response.output_item.done":
            continue
        item = r.get("item") or {}
        if item.get("type") == "function_call" and item.get("status") == "completed":
            cid = item.get("call_id")
            # the harness reports each call twice under different call ids: dedupe on content too
            sig = (sid, item.get("name"), item.get("arguments"), round(r["t"]))
            if cid in seen or sig in seen or item.get("name") == "ToolSearch":
                continue
            seen.update((cid, sig))
            out.append({"t": r["t"], "kind": "tool", "agent": names.get(sid, "?"),
                        "name": item.get("name", "").removeprefix("lab__"),
                        "args": _short(item.get("arguments", ""), 200)})
        elif item.get("type") == "message" and item.get("role") == "assistant":
            text = " ".join(c.get("text", "") for c in item.get("content", []) if isinstance(c, dict)).strip()
            if text:
                out.append({"t": r["t"], "kind": "say", "agent": names.get(sid, "?"), "text": _short(text, 600)})
    return out, names


# ------------------------------------------------------------------- curves
@lru_cache(maxsize=32)
def _curves(path_str: str, mtime: float) -> dict:
    path = Path(path_str)
    z = np.load(path)
    groups: dict[tuple[str, str], dict[str, list]] = {}
    for key in z.files:
        tag, land, seed, ctrl, col = key.split("|")
        if tag != "eval" or col not in ("best_err", "H", "p_mut", "epoch"):
            continue
        groups.setdefault((land, ctrl), {}).setdefault(col, []).append(z[key])
    out: dict[str, dict] = {}
    for (land, ctrl), cols in sorted(groups.items()):
        err = np.log10(np.vstack(cols["best_err"]) + 1e-12)
        epoch = cols["epoch"][0]
        shifts = [int(i) for i in np.flatnonzero(np.diff(epoch)) + 1]
        out.setdefault(land, {"shifts": shifts, "controllers": {}})["controllers"][ctrl] = {
            "n_runs": int(err.shape[0]),
            "log10_best_err_mean": np.round(err.mean(axis=0), 4).tolist(),
            "entropy_mean": np.round(np.vstack(cols["H"]).mean(axis=0), 4).tolist(),
            "p_mut_mean": np.round(np.vstack(cols["p_mut"]).mean(axis=0), 5).tolist(),
        }
    return out


def experiment(path: Path, eid: str) -> dict:
    s = fold(read_jsonl(path / "ledger.jsonl"))
    if eid not in s["candidates"]:
        raise ValueError(f"unknown experiment {eid}")
    cand = s["candidates"][eid]
    res = result_summary(cand)
    traces = path / "runs" / eid / "traces.npz"
    res["curves"] = _curves(str(traces), traces.stat().st_mtime) if traces.exists() else None
    res["spec"] = cand["spec"]
    res["score"] = {k: (cand.get("score") or {}).get(k) for k in ("eig_bits", "utility", "cost")}
    return res


# ------------------------------------------------------------------- server
class Handler(BaseHTTPRequestHandler):
    server_version = "discolab-bridge/0.1"

    def log_message(self, fmt, *args):  # quiet: no request logging
        return

    def _json(self, obj, status=200):
        body = redact(json.dumps(obj, default=str)).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _refuse_unauthorized(self) -> bool:
        """Answer 401 and return True unless the request carries the bridge token."""
        if authorized(self.headers, BRIDGE_TOKEN):
            return False
        self.close_connection = True
        self._json({"error": {"code": "unauthorized", "message": "a valid bridge token is required"}}, 401)
        return True

    def do_GET(self):
        if self._refuse_unauthorized():
            return
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/lab/sources":
                return self._json({"sources": list_sources()})
            if url.path == "/lab/capabilities":
                return self._json(capabilities())
            src = resolve_source(q.get("source", ""))
            if url.path == "/lab/state":
                return self._json(lab_state(src))
            if url.path == "/lab/activity":
                return self._json({"activity": source_activity(src)})
            if url.path == "/lab/run":
                return self._json(run_view(src))
            if url.path == "/lab/experiment":
                return self._json(experiment(src, q.get("id", "")))
            if url.path == "/lab/stream":
                return self._stream(src)
            return self._json({"error": {"code": "not_found", "message": url.path}}, 404)
        except ValueError as exc:
            return self._json({"error": {"code": "bad_request", "message": str(exc)}}, 400)

    def do_POST(self):
        if self._refuse_unauthorized():
            return
        url = urlparse(self.path)
        if not ENABLE_RUNS:
            return self._json({"error": {"code": "runs_disabled",
                                         "message": "start the bridge with --enable-runs to launch runs"}}, 403)
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 16_384)
            body = json.loads(self.rfile.read(length) or b"{}")
            if url.path == "/lab/runs":
                status, out = start_run(body, self.headers.get(CLIENT_HEADER))
            elif url.path == "/lab/approvals":
                status, out = answer_approval(body)
            else:
                status, out = 404, {"error": {"code": "not_found", "message": url.path}}
            return self._json(out, status)
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json({"error": {"code": "bad_request", "message": str(exc)}}, 400)

    def _stream(self, src: Path):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        ledger, events, muse_acts = src / "ledger.jsonl", src / "omnigent_events.jsonl", src / "activity.jsonl"
        n_ledger = len(read_jsonl(ledger))
        n_events = len(read_jsonl(events))
        n_muse = len(read_jsonl(muse_acts))
        _, names = activity(read_jsonl(events))
        last_beat = 0.0
        try:
            while True:
                rows = read_jsonl(ledger)
                for e in rows[n_ledger:]:
                    self._sse("ledger", {"seq": e["seq"], "ts": e["ts"], "type": e["type"], "actor": e["actor"],
                                         "id": e["payload"].get("id")})
                n_ledger = len(rows)
                m_rows = read_jsonl(muse_acts)
                for a in m_rows[n_muse:]:
                    if a.get("kind") in UI_KINDS:
                        self._sse("agent", a)
                    else:
                        self._sse("run", a)  # usage, model calls, agent start/end, run state
                n_muse = len(m_rows)
                ev_rows = read_jsonl(events)
                acts, names = activity(ev_rows[n_events:], names)
                for a in acts:
                    self._sse("agent", a)
                n_events = len(ev_rows)
                if time.time() - last_beat > 5:
                    self._sse("heartbeat", {"t": time.time()})
                    last_beat = time.time()
                time.sleep(POLL_SEC)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

    def _sse(self, name: str, data: dict):
        self.wfile.write(f"event: {name}\ndata: {redact(json.dumps(data, default=str))}\n\n".encode("utf-8"))
        self.wfile.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--enable-runs", action="store_true",
                    help="allow POST /lab/runs and /lab/approvals (starts paid Muse Code runs)")
    ap.add_argument("--host", default="127.0.0.1",
                    help="address to listen on (default loopback); anything else needs a bridge token")
    ap.add_argument("--require-auth", action="store_true",
                    help="refuse to start without a bridge token (use for every hosted lab)")
    args = ap.parse_args()
    global ENABLE_RUNS, BRIDGE_TOKEN, TRIAL, SECRET_VALUES
    from . import trial as trialmod

    try:
        token = load_bridge_token()
        check_startup(args.host, token, args.require_auth)
        cfg = trialmod.load_config(ROOT / "lab_home")
    except (BridgeAuthError, trialmod.TrialConfigError) as exc:
        print(f"discolab bridge: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(2) from None
    ENABLE_RUNS, BRIDGE_TOKEN = args.enable_runs, token
    secrets =[token] if token else []
    try:
        from .muse import load_api_key

        secrets.append(load_api_key())
    except Exception:  # no key configured: read-only bridge; nothing to redact
        pass
    SECRET_VALUES = tuple(s for s in secrets if s and len(s) >= 16)
    if cfg is not None:
        TRIAL = trialmod.Trial(cfg, ROOT)
        TRIAL.start_watchdog()
        s = TRIAL.status()
        print(f"public trial: total ${cfg.total_usd:.2f}, committed ${s.get('committed_usd', 0):.2f}, "
              f"per run ${cfg.run_ceiling_usd:.2f} guard / ${cfg.run_reserve_usd:.2f} reserve, "
              f"{cfg.max_run_seconds}s max; durable storage: {s['durable']}", flush=True)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    auth = ("every request needs the bridge token" if token
            else "UNAUTHENTICATED: loopback-only local development; never publish this bridge")
    print(f"discolab bridge on http://{args.host}:{args.port}/lab/sources "
          f"({'runs ENABLED' if ENABLE_RUNS else 'read-only'}; {auth})", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
