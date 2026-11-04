"""Noesis dynamic escalation for the discovery agents (agent hand-offs, not experiments;
see escalation.py for the separate experiment-escalation study).

The agent structure is not fixed. Each specialist task runs first on a cheap
Muse Code agent (Spark 1.3). The frozen Noesis gate then decides, from runtime
signals only, whether a second Muse Code agent (Wonder 1.0 verifier) checks
the report before it reaches the principal investigator. This is the
benchmark's S3 policy ("Spark 1.3 then selective Wonder 1.0") applied to
agents.

Signals: the same five the benchmark gate declares (no ground truth is used):
* schema_or_constraint_failure: the agent process failed, ended abnormally,
  or one of its lab tool calls raised;
* explicit_abstention: the agent returned no report, or stopped at its step cap;
* task_risk_level: the task concerns confirmatory / held-out data (high risk);
* historical_task_family_error_ucb: the frozen gate's Wilson upper bound on the
  first model's error for the role's task family is at or above the threshold;
* task_family: the family is listed for unconditional escalation.

Escalation is a safety case: the benchmark measured no rescues on its
held-out set, so it is reported as a guard, not as a measured quality gain.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .muse import MUSE_AGENTS

GATE_FILE = MUSE_AGENTS / "escalation_gate.json"  # frozen Noesis gate (benchmark artifact copy)
HIGH_RISK = re.compile(r"\b(confirmatory|held[- _]?out)\b", re.IGNORECASE)
VERDICT = re.compile(r"^\s*VERDICT:\s*(CONFIRMED|CORRECTED|REJECTED)\b", re.IGNORECASE | re.MULTILINE)


def load_gate(path: Path = GATE_FILE) -> dict[str, Any]:
    raw = path.read_bytes()
    gate = json.loads(raw)
    gate["file_sha256"] = hashlib.sha256(raw).hexdigest()
    return gate


def decide(role: str, title: str, instructions: str, result: dict, tool_errors: int,
           cfg: dict, gate: dict) -> dict[str, Any]:
    """Return {escalate, reasons, family, ucb, threshold}. Pure: no I/O, no ground truth."""
    esc = cfg.get("escalation") or {}
    family = (esc.get("role_task_family") or {}).get(role)
    g = gate["gate"]
    reasons: list[str] = []
    if result.get("exit_code") not in (0, None) or result.get("terminal") not in ("completed", None) or tool_errors:
        reasons.append("schema_or_constraint_failure")
    text = (result.get("text") or "").strip()
    if not text or text.startswith("(agent process failed") or text.startswith("(run ended"):
        reasons.append("explicit_abstention")
    if g.get("escalate_high_risk") and HIGH_RISK.search(f"{title}\n{instructions}"):
        reasons.append("task_risk_level")
    ucb = (g.get("historical_task_family_error_ucb") or {}).get(family) if family else None
    threshold = float(g.get("historical_error_ucb_threshold", 0.5))
    if ucb is not None and float(ucb) >= threshold:
        reasons.append("historical_task_family_error_ucb")
    if family and family in (g.get("escalate_task_families") or []):
        reasons.append("task_family")
    return {"escalate": bool(reasons) and bool(esc.get("enabled", True)), "reasons": reasons,
            "family": family, "ucb": ucb, "threshold": threshold}


def verify_task(role: str, title: str, instructions: str, report: str) -> str:
    return (
        f"A {role} agent was given this task:\n\n### Task: {title}\n{instructions.strip()}\n\n"
        f"### Its report\n{report.strip() or '(no report)'}\n\n"
        "### Your job\nCheck every factual claim in the report against the lab record (use your read-only "
        "tools). Do not repeat the task.\n"
        "Start your answer with exactly one line `VERDICT: CONFIRMED`, `VERDICT: CORRECTED` or "
        "`VERDICT: REJECTED`, then: for CONFIRMED one sentence; for CORRECTED the corrected report; for "
        "REJECTED what is wrong and what the principal investigator should not rely on."
    )


def parse_verdict(text: str) -> str:
    m = VERDICT.search(text or "")
    return m.group(1).upper() if m else "UNPARSED"


def freeze_from(benchmark_gate: Path, out: Path = GATE_FILE, *, source_note: str = "") -> dict:
    """Copy a benchmark's frozen gate (fitted on dev+tuning only) into the app, with provenance."""
    raw = Path(benchmark_gate).read_bytes()
    g = json.loads(raw)
    if g.get("held_out_observations_used") not in (0, None) or "held_out" in g.get("fitted_splits", []):
        raise ValueError("refusing a gate fitted on held-out evidence")
    payload = {
        "source_file": str(benchmark_gate).replace("\\", "/"),
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "source_note": source_note,
        "first_agent_model": "muse-spark-1.3",
        "verifier_agent_model": "muse-wonder-1.0",
        "gate": {k: g[k] for k in ("escalate_high_risk", "escalate_task_families", "historical_task_family_error_ucb",
                                   "historical_error_ucb_threshold", "fitted_splits", "signals")},
    }
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Freeze a benchmark escalation gate into the app")
    ap.add_argument("--from", dest="src", required=True, help="benchmark frozen_gate_configuration.json")
    ap.add_argument("--note", default="")
    a = ap.parse_args()
    p = freeze_from(Path(a.src), source_note=a.note)
    print(json.dumps({"source_sha256": p["source_sha256"], "ucb": p["gate"]["historical_task_family_error_ucb"]}))
