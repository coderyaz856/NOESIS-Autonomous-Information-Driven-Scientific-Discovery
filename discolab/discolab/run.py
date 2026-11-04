"""Start and drive one Muse Code discovery run.

  python -m discolab.run start --question "..." [--rounds 1] [--ceiling-usd 3] [--name my-run]
  python -m discolab.run status --home lab_home/<name>

`start` accepts any question. The scope check picks the mode: 'lab' for the
pre-registered GA/entropy domain (experiments executed), 'open' for anything
else (literature, hypotheses, protocols, critique; nothing executed). It creates a fresh lab under
lab_home/<name> (new ledger, pre-registration hash recorded), freezes the
agent configuration into run.json, then runs the PI agent on Muse Code until
it finishes. The PI delegates to specialists through the `delegate` lab tool.
`--detach` returns immediately and leaves the run going in the background
(used by the bridge's POST /lab/runs).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import lab, scope
from .muse import PKG_ROOT, PRICING_SOURCE, load_config, log_activity, muse_version, run_agent, run_usage
from .prereg import load_prereg

LAB_HOMES = PKG_ROOT / "lab_home"
MAX_ROUNDS = 3


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _write(home: Path, rec: dict) -> None:
    tmp = home / "run.json.tmp"
    tmp.write_text(json.dumps(rec, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, home / "run.json")


def read_run(home: Path) -> dict | None:
    p = Path(home) / "run.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _gate_provenance(cfg: dict) -> dict | None:
    """Which frozen Noesis gate this run escalates with (file hash + benchmark source)."""
    esc = cfg.get("escalation") or {}
    if not esc.get("enabled"):
        return None
    from .agent_escalation import load_gate
    from .muse import MUSE_AGENTS

    g = load_gate(MUSE_AGENTS / esc.get("gate_file", "escalation_gate.json"))
    return {"file_sha256": g["file_sha256"], "source_file": g.get("source_file"),
            "source_sha256": g.get("source_sha256"), "source_note": g.get("source_note")}


def prepare(question: str, rounds: int, ceiling_usd: float | None, name: str | None = None,
            scope_result: dict | None = None, config_overrides: dict | None = None, mode: str = "lab") -> Path:
    """Create the lab and its frozen run record. Does not contact the agents.
    mode 'lab': the pre-registered GA/entropy study (experiments executed).
    mode 'open': any other question (research, hypotheses, protocols; nothing executed)."""
    if mode not in ("lab", "open"):
        raise ValueError("mode must be 'lab' or 'open'")
    rounds = max(1, min(MAX_ROUNDS, int(rounds)))
    cfg = load_config(config_overrides)
    _gate_provenance(cfg)  # fail before creating a lab if escalation is on but its gate is missing
    name = name or f"muse-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"
    home = LAB_HOMES / name
    if (home / "ledger.jsonl").exists():
        raise FileExistsError(f"{home} already has a ledger")
    home.mkdir(parents=True, exist_ok=True)
    lab.init_lab(home, actor="operator", mode=mode, question=question)
    pr = load_prereg()
    rec = {
        "run_id": name, "source": f"lab_home/{name}", "status": "prepared", "created_at": _now(), "mode": mode,
        "question": " ".join(question.split()), "scope": scope_result, "rounds": rounds,
        "ceiling_usd": float(ceiling_usd if ceiling_usd is not None else cfg["default_ceiling_usd"]),
        "config": cfg, "runtime": {"harness": "Muse Code", "muse_version": muse_version(),
                                   "python": sys.version.split()[0], "platform": sys.platform},
        "prereg": {"version": pr["version"], "sha256": pr["_sha256"]},
        "escalation_gate": _gate_provenance(cfg),
        "pricing_source": PRICING_SOURCE,
        "seeds": "experiment seeds are allocated deterministically by discolab.experiments from the "
                 "experiment ordinal and the pre-registration; model sampling is not seeded",
    }
    _write(home, rec)
    log_activity(home, {"kind": "say", "agent": "operator", "text": rec["question"]})
    return home


def pi_task(rec: dict) -> str:
    sc = rec.get("scope") or {}
    if rec.get("mode") == "open":
        return (f"The human operator asked: \"{rec['question']}\"\n"
                f"Mode: OPEN. This question is outside the lab's executable simulation domain "
                f"({sc.get('reason') or 'no pre-registered hypothesis applies'}). Research it, register "
                f"hypotheses, propose study protocols and critique them; execute nothing.\n\n"
                f"Run {rec['rounds']} research round(s), then give the final report. "
                f"The run's soft spend guard (estimated) is ${rec['ceiling_usd']:.2f}.")
    focus = sc.get("focus") or rec["question"]
    hyps = ", ".join(sc.get("hypotheses") or []) or "all open hypotheses"
    return (f"The human operator asked: \"{rec['question']}\"\n"
            f"Scope check (automated): maps to {hyps}; focus: {focus}\n\n"
            f"Run {rec['rounds']} complete discovery round(s) aimed at that focus, then give the final report. "
            f"The run's soft spend guard (estimated) is ${rec['ceiling_usd']:.2f}.")


def drive(home: Path) -> dict:
    """Run the PI to completion and finalise run.json."""
    home = Path(home).resolve()
    rec = read_run(home)
    rec.update(status="running", started_at=_now(), pid=os.getpid())
    _write(home, rec)
    log_activity(home, {"kind": "run", "state": "running", "agent": "operator", "text": rec["run_id"]})
    t0 = time.time()
    try:
        out = run_agent("pi", pi_task(rec), home, title="discovery-run", config=rec["config"])
        status = "completed" if out["exit_code"] == 0 and out["terminal"] == "completed" else "failed"
        rec.update(final_report=out["text"], pi_exit_code=out["exit_code"], pi_terminal=out["terminal"])
    except Exception as exc:  # recorded, never hidden
        status = "failed"
        rec["error"] = f"{type(exc).__name__}: {exc}"
    rec.update(status=status, finished_at=_now(), wall_seconds=round(time.time() - t0, 1), usage=run_usage(home))
    _write(home, rec)
    log_activity(home, {"kind": "run", "state": status, "agent": "operator", "text": rec["run_id"]})
    return rec


def start_detached(home: Path) -> int:
    """Launch `drive` in a background process that outlives the caller."""
    log = (Path(home) / "driver.log").open("a", encoding="utf-8")
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0)
    proc = subprocess.Popen([sys.executable, "-m", "discolab.run", "drive", "--home", str(home)],
                            cwd=PKG_ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                            creationflags=flags, start_new_session=sys.platform != "win32")
    return proc.pid


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m discolab.run")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("start")
    s.add_argument("--question", required=True)
    s.add_argument("--rounds", type=int, default=1)
    s.add_argument("--ceiling-usd", type=float, default=None)
    s.add_argument("--name")
    s.add_argument("--skip-scope-check", action="store_true", help="only for the pre-registered question itself")
    s.add_argument("--detach", action="store_true")
    d = sub.add_parser("drive")
    d.add_argument("--home", required=True)
    st = sub.add_parser("status")
    st.add_argument("--home", required=True)
    args = ap.parse_args(argv)

    if args.cmd == "start":
        sc = None if args.skip_scope_check else scope.check(args.question)
        mode = "lab" if sc is None or sc["in_scope"] else "open"
        home = prepare(args.question, args.rounds, args.ceiling_usd, args.name, sc, mode=mode)
        print(f"mode: {mode}", flush=True)
        print(f"lab: {home}", flush=True)
        if args.detach:
            print(json.dumps({"pid": start_detached(home), "source": read_run(home)["source"]}))
            return 0
        rec = drive(home)
        print(json.dumps({k: rec.get(k) for k in ("run_id", "status", "wall_seconds", "usage")}, indent=2))
        return 0 if rec["status"] == "completed" else 1
    if args.cmd == "drive":
        return 0 if drive(Path(args.home))["status"] == "completed" else 1
    if args.cmd == "status":
        print(json.dumps(read_run(Path(args.home)), indent=2))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
