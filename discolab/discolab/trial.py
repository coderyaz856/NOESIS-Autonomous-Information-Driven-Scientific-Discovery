"""Bounded public trial: lets anyone start a real Muse Code run from the hosted app,
within limits the bridge enforces itself (it is the only process with the Meta key).

Enabled by NOESIS_TRIAL_TOTAL_USD (the total estimated spend the trial may commit).
Once enabled it applies to every run the bridge starts:

- one active run at a time (the bridge already refuses a second one);
- each run: 1 round, a small soft spend guard (NOESIS_TRIAL_RUN_CEILING_USD), and a
  watchdog that stops it after NOESIS_TRIAL_MAX_RUN_SECONDS or once its recorded spend
  passes NOESIS_TRIAL_RUN_RESERVE_USD;
- rate limits: NOESIS_TRIAL_RUNS_PER_HOUR in total, and per visitor
  NOESIS_TRIAL_CLIENT_RUNS_PER_HOUR / NOESIS_TRIAL_CLIENT_RUNS_PER_DAY. The visitor id
  is an opaque hash the web server sends (X-Noesis-Client); only the web server can
  send it, because only it holds the bridge token. The global limits do not depend on it;
- a total spend limit. Every run is charged its recorded cost once it has finished, and
  `reserve` (the most one run is expected to cost) while it runs or when it ended
  without a final cost (interrupted or stopped: in-flight agent calls are never recorded).
  A run starts only if committed spend + reserve <= total.

Durability: the trial's state (runs started, their charge) is a JSON file in
NOESIS_DATA_DIR. If that directory is not a mounted volume, a restart would forget the
spend, so the trial refuses runs (`budget_store_not_durable`) unless
NOESIS_TRIAL_ALLOW_EPHEMERAL=1 is set deliberately. A missing or unreadable state file
on a durable volume is not silently reset either: a corrupt file refuses runs.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

STATE_VERSION = 1
FINISHED = ("completed", "failed")          # the driver finalised: usage is complete
ENDED = ("completed", "failed", "interrupted", "stopped")
CLIENT_HEADER = "X-Noesis-Client"
MAX_CLIENT_ID = 64


@dataclass(frozen=True)
class TrialConfig:
    total_usd: float
    run_ceiling_usd: float
    run_reserve_usd: float
    max_run_seconds: int
    runs_per_hour: int
    client_runs_per_hour: int
    client_runs_per_day: int
    data_dir: Path
    allow_ephemeral: bool

    @property
    def state_file(self) -> Path:
        return self.data_dir / "trial_state.json"


class TrialConfigError(ValueError):
    """The trial settings are invalid; the bridge must not start."""


def _num(env, name: str, default: float, kind=float, minimum: float = 0.0):
    raw = (env.get(name) or "").strip()
    if not raw:
        return kind(default)
    try:
        value = kind(raw)
    except ValueError:
        raise TrialConfigError(f"{name} must be a number") from None
    if value <= minimum:
        raise TrialConfigError(f"{name} must be greater than {minimum}")
    return value


def load_config(default_data_dir: Path, env=None) -> TrialConfig | None:
    env = os.environ if env is None else env
    if not (env.get("NOESIS_TRIAL_TOTAL_USD") or "").strip():
        return None
    total = _num(env, "NOESIS_TRIAL_TOTAL_USD", 0.0)
    ceiling = _num(env, "NOESIS_TRIAL_RUN_CEILING_USD", 0.5)
    reserve = _num(env, "NOESIS_TRIAL_RUN_RESERVE_USD", max(1.0, 3 * ceiling))
    if reserve < ceiling:
        raise TrialConfigError("NOESIS_TRIAL_RUN_RESERVE_USD must be at least the run ceiling")
    if reserve > total:
        raise TrialConfigError("NOESIS_TRIAL_TOTAL_USD must allow at least one run reserve")
    data_dir = Path((env.get("NOESIS_DATA_DIR") or "").strip() or default_data_dir)
    return TrialConfig(
        total_usd=total, run_ceiling_usd=ceiling, run_reserve_usd=reserve,
        max_run_seconds=_num(env, "NOESIS_TRIAL_MAX_RUN_SECONDS", 900, int),
        runs_per_hour=_num(env, "NOESIS_TRIAL_RUNS_PER_HOUR", 4, int),
        client_runs_per_hour=_num(env, "NOESIS_TRIAL_CLIENT_RUNS_PER_HOUR", 1, int),
        client_runs_per_day=_num(env, "NOESIS_TRIAL_CLIENT_RUNS_PER_DAY", 2, int),
        data_dir=data_dir,
        allow_ephemeral=(env.get("NOESIS_TRIAL_ALLOW_EPHEMERAL") or "").strip() == "1")


def client_id(raw: str | None) -> str:
    """The web server's opaque visitor id; anything malformed shares one 'anonymous' bucket."""
    raw = (raw or "").strip()
    if raw and len(raw) <= MAX_CLIENT_ID and all((c.isascii() and c.isalnum()) or c in "-_" for c in raw):
        return raw
    return "anonymous"


def _refusal(status: int, code: str, message: str, **details) -> tuple[int, dict]:
    return status, {"error": {"code": code, "message": message, "details": details}}


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _usage_cost(home: Path) -> float:
    from .muse import run_usage

    return float(run_usage(home)["cost_usd"])


def _pid_alive(pid) -> bool:
    from .bridge import _pid_alive as alive

    return alive(pid)


def terminate_tree(pid: int) -> None:
    """Stop a run's driver and the agent processes it started."""
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(int(pid)), "/T", "/F"], capture_output=True, check=False)
        return
    try:
        os.killpg(int(pid), signal.SIGTERM)  # start_detached puts the driver in its own session
    except OSError:
        try:
            os.kill(int(pid), signal.SIGTERM)
        except OSError:
            pass


class Trial:
    def __init__(self, cfg: TrialConfig, root: Path, clock=time.time, is_mount=os.path.ismount,
                 terminate=terminate_tree):
        self.cfg = cfg
        self.root = Path(root)
        self.clock = clock
        self.is_mount = is_mount
        self.terminate = terminate
        self.lock = threading.RLock()

    # ------------------------------------------------------------- state file
    def durable(self) -> bool:
        return self.cfg.allow_ephemeral or bool(self.is_mount(str(self.cfg.data_dir)))

    def _load(self) -> dict:
        path = self.cfg.state_file
        if not path.exists():
            return {"version": STATE_VERSION, "runs": []}
        state = _read_json(path)
        if not isinstance(state, dict) or state.get("version") != STATE_VERSION or not isinstance(state.get("runs"), list):
            raise ValueError("trial state file is unreadable")
        return state

    def _save(self, state: dict) -> None:
        self.cfg.data_dir.mkdir(parents=True, exist_ok=True)
        data = json.dumps(state, indent=1)
        tmp = self.cfg.state_file.with_suffix(".tmp")
        try:
            tmp.write_text(data, encoding="utf-8")
            os.replace(tmp, self.cfg.state_file)
        except OSError:  # some mounted volumes do not support rename; write in place
            self.cfg.state_file.write_text(data, encoding="utf-8")

    # -------------------------------------------------------------- accounting
    def _refresh(self, state: dict) -> None:
        """Bring each unfinished run's charge up to date from its record on disk."""
        for r in state["runs"]:
            if r.get("final"):
                continue
            home = self.root / r["source"]
            rec = _read_json(home / "run.json")
            if rec is None:  # the record is gone: charge the full reserve
                r.update(final=True, status="lost", cost_usd=max(r.get("cost_usd", 0.0), self.cfg.run_reserve_usd))
                continue
            cost = _usage_cost(home)
            status = rec.get("status")
            if status == "running" and not _pid_alive(rec.get("pid")):
                status = "interrupted"
            if status == "prepared" and self.clock() - r["started_at"] > 120 and not _pid_alive(rec.get("pid")):
                status = "interrupted"
            r["status"] = status
            if status in FINISHED:
                r.update(final=True, cost_usd=cost)
            elif status in ENDED:  # stopped mid-call: unrecorded calls may have cost up to the reserve
                r.update(final=True, cost_usd=max(cost, self.cfg.run_reserve_usd))
            else:
                r["cost_usd"] = cost

    def _charge(self, r: dict) -> float:
        return float(r.get("cost_usd") or 0.0) if r.get("final") else max(float(r.get("cost_usd") or 0.0),
                                                                           self.cfg.run_reserve_usd)

    def _summary(self, state: dict) -> dict:
        committed = round(sum(self._charge(r) for r in state["runs"]), 6)
        recorded = round(sum(float(r.get("cost_usd") or 0.0) for r in state["runs"]
                             if r.get("status") in FINISHED), 6)
        return {"committed_usd": committed, "recorded_usd": recorded,
                "remaining_usd": round(max(0.0, self.cfg.total_usd - committed), 6), "runs": len(state["runs"])}

    # ---------------------------------------------------------------- admission
    def admit(self, client: str) -> tuple[int, dict] | None:
        """None if a run may start now; otherwise the refusal. Call with self.lock held."""
        if not self.durable():
            return _refusal(503, "budget_store_not_durable",
                            "The public trial is paused: its spend record is not on persistent storage, "
                            "so a restart could reset the budget. Explore the recorded run instead.")
        try:
            state = self._load()
        except ValueError:
            return _refusal(503, "budget_store_unreadable",
                            "The public trial is paused: its spend record cannot be read.")
        self._refresh(state)
        self._save(state)
        now = self.clock()
        s = self._summary(state)
        if s["committed_usd"] + self.cfg.run_reserve_usd > self.cfg.total_usd + 1e-9:
            return _refusal(403, "budget_exhausted",
                            "The public trial budget is used up. Explore the recorded runs instead.",
                            total_usd=self.cfg.total_usd, committed_usd=s["committed_usd"])
        recent = [r for r in state["runs"] if now - r["started_at"] < 3600]
        if len(recent) >= self.cfg.runs_per_hour:
            wait = int(3600 - (now - min(r["started_at"] for r in recent))) + 1
            return _refusal(429, "rate_limited", f"The public trial allows {self.cfg.runs_per_hour} runs per hour. "
                            f"Try again in about {max(1, wait // 60)} min, or explore the recorded runs.",
                            retry_after_s=wait)
        mine = [r for r in state["runs"] if r.get("client") == client]
        hour = [r for r in mine if now - r["started_at"] < 3600]
        day = [r for r in mine if now - r["started_at"] < 86400]
        if len(hour) >= self.cfg.client_runs_per_hour or len(day) >= self.cfg.client_runs_per_day:
            window = hour if len(hour) >= self.cfg.client_runs_per_hour else day
            span = 3600 if window is hour else 86400
            wait = int(span - (now - min(r["started_at"] for r in window))) + 1
            return _refusal(429, "rate_limited", "You have used this visitor's share of the public trial. "
                            "Explore the recorded runs, or try again later.", retry_after_s=wait)
        return None

    def record_start(self, source: str, client: str) -> None:
        """Call with self.lock held, right after the run was launched."""
        state = self._load()
        state["runs"].append({"source": source, "client": client, "started_at": self.clock(),
                              "status": "prepared", "cost_usd": 0.0, "final": False})
        self._save(state)

    # ------------------------------------------------------------------ status
    def status(self) -> dict:
        with self.lock:
            out = {"enabled": True, "total_usd": self.cfg.total_usd, "run_ceiling_usd": self.cfg.run_ceiling_usd,
                   "run_reserve_usd": self.cfg.run_reserve_usd, "max_run_seconds": self.cfg.max_run_seconds,
                   "runs_per_hour": self.cfg.runs_per_hour, "client_runs_per_hour": self.cfg.client_runs_per_hour,
                   "client_runs_per_day": self.cfg.client_runs_per_day, "durable": self.durable()}
            try:
                state = self._load()
            except ValueError:
                return {**out, "accepting": False, "reason": "budget_store_unreadable"}
            self._refresh(state)
            s = self._summary(state)
            out.update(s)
            if not out["durable"]:
                out.update(accepting=False, reason="budget_store_not_durable")
            elif s["committed_usd"] + self.cfg.run_reserve_usd > self.cfg.total_usd + 1e-9:
                out.update(accepting=False, reason="budget_exhausted")
            else:
                out.update(accepting=True, reason=None)
            return out

    # ---------------------------------------------------------------- watchdog
    def watchdog_tick(self) -> list[str]:
        """Stop trial runs that ran too long or spent past the reserve. Returns stopped sources."""
        from .muse import log_activity

        stopped = []
        with self.lock:
            try:
                state = self._load()
            except ValueError:
                return stopped
            self._refresh(state)
            now = self.clock()
            for r in state["runs"]:
                if r.get("final"):
                    continue
                home = self.root / r["source"]
                rec = _read_json(home / "run.json") or {}
                too_long = now - r["started_at"] > self.cfg.max_run_seconds
                too_costly = float(r.get("cost_usd") or 0.0) > self.cfg.run_reserve_usd
                if not (too_long or too_costly):
                    continue
                why = (f"time limit ({self.cfg.max_run_seconds // 60} min)" if too_long
                       else f"spend limit (${self.cfg.run_reserve_usd:.2f})")
                if rec.get("pid"):
                    self.terminate(int(rec["pid"]))
                rec.update(status="stopped", error=f"Stopped by the public-trial {why}.",
                           finished_at=time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now)))
                tmp = home / "run.json.tmp"
                tmp.write_text(json.dumps(rec, indent=2, default=str), encoding="utf-8")
                os.replace(tmp, home / "run.json")
                log_activity(home, {"kind": "say", "agent": "operator", "text": f"Run stopped by the public-trial {why}."})
                r.update(final=True, status="stopped", cost_usd=max(_usage_cost(home), self.cfg.run_reserve_usd))
                stopped.append(r["source"])
            self._save(state)
        return stopped

    def start_watchdog(self, interval: float = 10.0) -> threading.Thread:
        def loop():
            while True:
                time.sleep(interval)
                try:
                    self.watchdog_tick()
                except Exception as exc:  # keep watching; never crash the bridge
                    print(f"trial watchdog: {type(exc).__name__}: {exc}", file=sys.stderr)

        t = threading.Thread(target=loop, name="trial-watchdog", daemon=True)
        t.start()
        return t
