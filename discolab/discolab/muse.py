"""Run discolab's agents on Muse Code, Meta's official agent harness.

Each agent role (PI, literature, designer, critic) is one headless
``muse exec --json`` process on Meta Model API. The role's only lab access is
a stdio MCP server (``python -m discolab.mcp_server``) that serves exactly the
role's allow-listed tools and attributes every ledger event to the role
(``DISCOLAB_ACTOR``). Shell, file-write and web tools of the harness are
disabled, so agents can act on the lab only through the deterministic tools.

The PI delegates to specialists through its ``delegate`` lab tool, which
launches the specialist's own Muse Code process (see ``run_agent``) and
returns the specialist's report. Every hand-off, tool call, final message,
token count and estimated cost is appended to ``<lab>/activity.jsonl``; the
raw Muse event stream of each agent process is kept under ``<lab>/muse/``.

Secrets: the Model API key is read from ``MODEL_API_KEY`` / ``META_API_KEY``
or from the file named by ``MODEL_API_KEY_FILE`` and handed to Muse Code on
stdin (``--api-key-stdin``). It is never written to disk or logged.
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import yaml

PKG_ROOT = Path(__file__).resolve().parent.parent  # the discolab project directory
BUNDLE = PKG_ROOT / "omnigent" / "lab_pi"           # original agent definitions (prompts, tool allow-lists)
MUSE_AGENTS = PKG_ROOT / "muse_agents"              # Muse Code-specific role config and PI instructions

# Meta Model API list prices (USD per 1M tokens), Standard mode, from
# https://dev.meta.ai/docs/pricing-rate-limits (checked 2026-11-03). Estimates,
# not an invoice: the billing page is authoritative.
PRICES = {
    "muse-wonder-1.0": {"input": 4.00, "cached": 0.20, "output": 20.00},
    "muse-spark-1.3": {"input": 1.25, "cached": 0.15, "output": 4.25},
    "muse-spark-1.2": {"input": 1.25, "cached": 0.15, "output": 4.25},
    "muse-spark-1.1": {"input": 1.25, "cached": 0.15, "output": 4.25},
    "muse-spark-1.3-contributor": {"input": 0.10, "cached": 0.002, "output": 0.20},
    "muse-spark-1.2-contributor": {"input": 0.10, "cached": 0.002, "output": 0.20},
}
PRICING_SOURCE = "https://dev.meta.ai/docs/pricing-rate-limits (checked 2026-11-03)"

SPECIALISTS = ("literature", "designer", "critic")
# The escalation verifier only reads the lab record; it cannot write to the ledger.
VERIFIER_TOOLS = ("get_research_state", "get_experiment_result", "list_design_space")
# Open mode (questions outside the executable domain): research, hypotheses and protocols only.
OPEN_MODE_TOOLS = {
    "pi": ("get_research_state", "record_decision", "delegate"),
    "literature": ("get_research_state", "search_literature", "search_arxiv_papers", "record_evidence"),
    "designer": ("get_research_state", "register_hypothesis", "propose_protocol"),
    "critic": ("get_research_state",),
    "verifier": ("get_research_state",),
}

# OS variables a nested Muse Code process needs (config, session logs, temp files, TLS).
PASSTHROUGH_ENV = ("USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "HOMEDRIVE", "HOMEPATH",
                   "COMSPEC", "PATHEXT", "PROGRAMDATA", "XDG_CONFIG_HOME", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE")


# Server credentials that agent processes must never inherit (the bridge's own token).
def agent_base_env(environ=None) -> dict:
    """Environment for Muse Code, excluding every Noesis server setting.

    Model credentials remain available because Muse and its MCP specialists need
    them. The ``NOESIS_*`` namespace is reserved for the hosting boundary (bridge
    authentication, operator authentication, trial limits, allowed origins), so no
    variable in that namespace reaches an agent process. Filtering by prefix keeps
    server settings added later fail-closed without updating a list.
    """
    environ = os.environ if environ is None else environ
    return {k: v for k, v in environ.items() if not k.upper().startswith("NOESIS_")}


# ---------------------------------------------------------------- secrets / binary
def load_api_key() -> str:
    """Model API key from the environment or a key file. Accepts a bare key or
    a ``name="value"`` line. Raises if none is configured; never logs it."""
    for var in ("MODEL_API_KEY", "META_API_KEY"):
        if os.environ.get(var, "").strip():
            return os.environ[var].strip()
    path = os.environ.get("MODEL_API_KEY_FILE", "").strip()
    if not path:
        raise RuntimeError("set MODEL_API_KEY, META_API_KEY or MODEL_API_KEY_FILE (path to a key file)")
    lines = [ln.strip() for ln in Path(path).read_text(encoding="utf-8-sig").splitlines() if ln.strip()]
    if not lines:
        raise RuntimeError(f"key file {path} is empty")
    raw = lines[0]
    if "=" in raw:
        raw = raw.split("=", 1)[1].strip()
    key = raw.strip().strip("'\"")
    if not key:
        raise RuntimeError(f"key file {path} has no key value")
    return key


def find_muse() -> str:
    """Path of the Muse Code binary: $MUSE_BIN, `muse` on PATH, or the default
    Windows install location (%LOCALAPPDATA%/Programs/muse)."""
    if os.environ.get("MUSE_BIN"):
        return os.environ["MUSE_BIN"]
    local = os.environ.get("LOCALAPPDATA")
    if local:
        # prefer the real executable over the .cmd shim so stdin/exit codes pass through cleanly
        exes = sorted(glob.glob(os.path.join(local, "Programs", "muse", "muse-bin-*.exe")))
        if exes:
            return exes[-1]
    found = shutil.which("muse")
    if found:
        return found
    raise RuntimeError("Muse Code is not installed (https://dev.meta.ai/docs/muse-code); or set MUSE_BIN")


def muse_version(binary: str | None = None) -> str:
    try:
        out = subprocess.run([binary or find_muse(), "--version"], capture_output=True, text=True, timeout=30)
        return out.stdout.strip() or out.stderr.strip()
    except Exception as exc:  # recorded, not fatal for read-only uses
        return f"unknown ({type(exc).__name__})"


# ---------------------------------------------------------------- configuration
def load_config(overrides: dict | None = None) -> dict:
    cfg = yaml.safe_load((MUSE_AGENTS / "config.yaml").read_text(encoding="utf-8"))
    for role, over in (overrides or {}).items():
        cfg["roles"].setdefault(role, {}).update({k: v for k, v in over.items() if v is not None})
    return cfg


def run_config(home: Path) -> dict:
    """The frozen agent configuration of a run (written to run.json at start)."""
    rec = Path(home) / "run.json"
    if rec.exists():
        return json.loads(rec.read_text(encoding="utf-8"))["config"]
    return load_config()


def run_mode(home: Path) -> str:
    """'lab' (pre-registered, executable GA/entropy study) or 'open' (any other question)."""
    rec = Path(home) / "run.json"
    if rec.exists():
        return json.loads(rec.read_text(encoding="utf-8")).get("mode", "lab")
    return "lab"


def role_tools(role: str, mode: str = "lab") -> list[str]:
    """The role's lab tools: the original bundle allow-list, plus `delegate` for the PI.
    Open mode has no executable experiments, so no role gets the experiment tools."""
    if mode == "open":
        return list(OPEN_MODE_TOOLS[role])
    if role == "verifier":
        return list(VERIFIER_TOOLS)
    path = BUNDLE / "tools" / "mcp" / "lab.yaml" if role == "pi" else BUNDLE / "agents" / role / "tools" / "mcp" / "lab.yaml"
    tools = list(yaml.safe_load(path.read_text(encoding="utf-8"))["tools"])
    return tools + ["delegate"] if role == "pi" else tools


def role_instructions(role: str, mode: str = "lab") -> str:
    if mode == "open":
        return (MUSE_AGENTS / "open" / f"{role}.md").read_text(encoding="utf-8")
    if role in ("pi", "verifier"):
        return (MUSE_AGENTS / f"{role}.md").read_text(encoding="utf-8")
    spec = yaml.safe_load((BUNDLE / "agents" / role / "config.yaml").read_text(encoding="utf-8"))
    return spec["prompt"]


def estimate_cost(model: str, input_tokens: int, cached_tokens: int, output_tokens: int) -> float | None:
    p = PRICES.get(model)
    if p is None:
        return None
    fresh = max(0, input_tokens - cached_tokens)
    return (fresh * p["input"] + cached_tokens * p["cached"] + output_tokens * p["output"]) / 1e6


# ---------------------------------------------------------------- activity log
@contextmanager
def _lock(path: Path, timeout: float = 30.0):
    deadline = time.monotonic() + timeout
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            if time.monotonic() > deadline:
                raise RuntimeError(f"could not acquire {path}")
            time.sleep(0.02)
    try:
        yield
    finally:
        os.close(fd)
        os.unlink(path)


def log_activity(home: Path, entry: dict) -> None:
    """Append one normalized activity entry (shape: frontend LabActivity)."""
    home = Path(home)
    line = json.dumps({"t": time.time(), **entry}, default=str)
    with _lock(home / ".activity.lock"):
        with (home / "activity.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")


def read_jsonl(path: Path) -> list[dict]:
    if not Path(path).exists():
        return []
    with Path(path).open(encoding="utf-8") as fh:
        return [json.loads(x) for x in fh if x.strip()]


def run_usage(home: Path) -> dict:
    """Total tokens and estimated cost over all finished agent processes of a lab."""
    tot = {"input_tokens": 0, "cached_tokens": 0, "output_tokens": 0, "reasoning_tokens": 0, "calls": 0,
           "failed_calls": 0, "cost_usd": 0.0, "unpriced_models": []}
    for a in read_jsonl(Path(home) / "activity.jsonl"):
        if a.get("kind") != "usage":
            continue
        for k in ("input_tokens", "cached_tokens", "output_tokens", "reasoning_tokens", "calls", "failed_calls"):
            tot[k] += int(a.get(k) or 0)
        if a.get("cost_usd") is None:
            tot["unpriced_models"].append(a.get("model"))
        else:
            tot["cost_usd"] += float(a["cost_usd"])
    tot["cost_usd"] = round(tot["cost_usd"], 6)
    return tot


# ---------------------------------------------------------------- one agent process
def _mcp_server_config(env: dict) -> dict:
    """stdio MCP server for one role. Muse Code requires every env value to be a
    whole ${VAR} reference; the values are set on the muse process itself."""
    env_refs = {v: "${" + v + "}" for v in ("DISCOLAB_HOME", "DISCOLAB_ACTOR", "DISCOLAB_TOOLS",
                                            "DISCOLAB_ACTIVITY_LOG", "DISCOLAB_APPROVAL_MODE",
                                            "PYTHONUTF8", "SYSTEMROOT", "PATH")}
    # Muse Code starts MCP servers with only the variables declared here. The
    # PI's server launches specialist Muse Code processes, which need the user
    # profile/temp locations and the resolved binary, so pass those through.
    for opt in ("MODEL_API_KEY_FILE", "MODEL_API_KEY", "META_API_KEY", "OPENALEX_API_KEY", "MUSE_BIN",
                *PASSTHROUGH_ENV):
        if env.get(opt):
            env_refs[opt] = "${" + opt + "}"
    import sys
    return {"transport": "stdio", "command": sys.executable, "args": ["-m", "discolab.mcp_server"], "env": env_refs}


def _summarize_event(ev: dict) -> tuple[str | None, dict]:
    pt = ev.get("payload_type", "")
    return pt, ev.get("payload") or {}


def run_agent(role: str, task: str, home: Path, *, title: str | None = None, config: dict | None = None,
              timeout_sec: int | None = None) -> dict:
    """Run one agent role to completion on Muse Code and return its report.

    The agent's prompt is the role instructions followed by the task. Returns
    {role, title, text, terminal, exit_code, usage, cost_usd, seconds, events_file}.
    """
    home = Path(home).resolve()
    cfg = config or run_config(home)
    rc = cfg["roles"][role]
    binary = find_muse()
    out_dir = home / "muse"
    out_dir.mkdir(parents=True, exist_ok=True)
    seq = len(list(out_dir.glob(f"{role}-*.jsonl"))) + 1
    events_file = out_dir / f"{role}-{seq:02d}.jsonl"
    prompt_file = out_dir / f"{role}-{seq:02d}.prompt.md"
    mode = run_mode(home)
    prompt_file.write_text(f"{role_instructions(role, mode).strip()}\n\n## Your task now\n{task.strip()}\n",
                           encoding="utf-8")

    env = {**agent_base_env(), "DISCOLAB_HOME": str(home), "DISCOLAB_ACTOR": role,
           "DISCOLAB_TOOLS": ",".join(role_tools(role, mode)), "PYTHONUTF8": "1",
           "DISCOLAB_ACTIVITY_LOG": "1", "DISCOLAB_APPROVAL_MODE": "file", "MUSE_BIN": binary,
           "SYSTEMROOT": os.environ.get("SYSTEMROOT", r"C:\Windows")}
    cmd = [binary, "exec", "--json", "--api-key-stdin", "--preset", cfg.get("preset", "empty"),
           "--model", rc["model"], "--reasoning-effort", rc.get("effort", "medium"),
           "--max-model-steps", str(rc.get("max_model_steps", 20)),
           "--disable-shell", "--disable-write", "--disable-web-tools", "--disable-reminders",
           "--disable-request-user-input", "--disable-approval", "--no-foreign-personal-context",
           "--workspace", str(home), "-c", "mcp_servers.lab=" + json.dumps(_mcp_server_config(env)),
           "--prompt-file", str(prompt_file)]
    log_activity(home, {"kind": "agent_start", "agent": role, "title": title or role, "model": rc["model"],
                        "effort": rc.get("effort", "medium")})
    t0 = time.time()
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace", cwd=home, env=env)
    assert proc.stdin and proc.stdout and proc.stderr
    proc.stdin.write(load_api_key() + "\n")
    proc.stdin.close()
    stderr_chunks: list[str] = []
    err_thread = threading.Thread(target=lambda: stderr_chunks.append(proc.stderr.read()), daemon=True)
    err_thread.start()
    killer = None
    if timeout_sec:
        killer = threading.Timer(timeout_sec, proc.kill)
        killer.start()

    text, terminal, usage_models, usage_meta = "", None, [], {}
    with events_file.open("w", encoding="utf-8") as raw:
        for line in proc.stdout:
            raw.write(line)
            raw.flush()
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            pt, pl = _summarize_event(ev)
            if pt == "task.lifecycle.proposed":
                kind = (pl.get("event") or {}).get("task_kind", "")
                if kind.startswith("model."):
                    log_activity(home, {"kind": "model_call", "agent": role, "model": rc["model"]})
            elif pt == "run.usage":
                usage_models = pl.get("models") or []
                usage_meta = {k: pl.get(k) for k in ("calls", "completed_calls", "failed_calls", "cancelled_calls")}
            elif pt and pt.startswith("run.terminal"):
                terminal = pl.get("terminal")
                text = pl.get("text") or ""
                if pl.get("reason"):
                    text = text or f"(run ended: {pl.get('reason')})"
    exit_code = proc.wait()
    if killer:
        killer.cancel()
    err_thread.join(timeout=5)
    seconds = time.time() - t0
    stderr = "".join(stderr_chunks)
    (out_dir / f"{role}-{seq:02d}.stderr.txt").write_text(stderr, encoding="utf-8")

    total_cost, priced = 0.0, True
    for m in usage_models:
        cost = estimate_cost(m.get("model", ""), int(m.get("input_tokens") or 0), int(m.get("cached_tokens") or 0),
                             int(m.get("output_tokens") or 0))
        priced = priced and cost is not None
        total_cost += cost or 0.0
        log_activity(home, {"kind": "usage", "agent": role, "title": title or role, "model": m.get("model"),
                            "input_tokens": m.get("input_tokens"), "cached_tokens": m.get("cached_tokens"),
                            "output_tokens": m.get("output_tokens"), "reasoning_tokens": m.get("reasoning_tokens"),
                            "calls": m.get("calls"), "failed_calls": usage_meta.get("failed_calls"),
                            "cost_usd": None if cost is None else round(cost, 6), "seconds": round(seconds, 2)})
    if not text and exit_code != 0:
        text = f"(agent process failed with exit code {exit_code}: {stderr.strip()[-400:]})"
    if text:
        log_activity(home, {"kind": "say", "agent": role, "text": text})
    log_activity(home, {"kind": "agent_end", "agent": role, "title": title or role, "terminal": terminal,
                        "exit_code": exit_code, "seconds": round(seconds, 2)})
    return {"role": role, "title": title or role, "text": text, "terminal": terminal, "exit_code": exit_code,
            "usage": usage_models, "cost_usd": round(total_cost, 6) if priced else None,
            "seconds": round(seconds, 2), "events_file": str(events_file.relative_to(home))}
