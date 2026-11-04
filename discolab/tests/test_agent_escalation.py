"""Noesis dynamic escalation of agent hand-offs (no network, no Muse Code)."""

from __future__ import annotations

import json

import pytest

from discolab import agent_escalation as ae
from discolab import lab, muse

GATE = {"gate": {"escalate_high_risk": True, "escalate_task_families": [], "historical_error_ucb_threshold": 0.5,
                 "historical_task_family_error_ucb": {"critique": 0.88, "planning": 0.43,
                                                      "evidence_verification": 0.43},
                 "fitted_splits": ["dev", "tuning"], "signals": []}}
CFG = {"escalation": {"enabled": True, "role_task_family": {"literature": "evidence_verification",
                                                            "designer": "planning", "critic": "critique"}},
       "roles": {"verifier": {"model": "muse-wonder-1.0"}}}
OK = {"exit_code": 0, "terminal": "completed", "text": "E1 scored 0.66 bits."}


def test_clean_low_risk_report_is_accepted():
    d = ae.decide("designer", "design-round-1", "propose two experiments", OK, 0, CFG, GATE)
    assert d == {**d, "escalate": False, "reasons": []}


def test_historical_error_ucb_escalates_critique():
    d = ae.decide("critic", "critique-E1", "interpret E1", OK, 0, CFG, GATE)
    assert d["escalate"] and d["reasons"] == ["historical_task_family_error_ucb"] and d["ucb"] == 0.88


@pytest.mark.parametrize("out,errors,reason", [
    ({"exit_code": 1, "terminal": "failed", "text": "x"}, 0, "schema_or_constraint_failure"),
    (OK, 2, "schema_or_constraint_failure"),
    ({"exit_code": 0, "terminal": "completed", "text": ""}, 0, "explicit_abstention"),
])
def test_runtime_failure_signals_escalate(out, errors, reason):
    d = ae.decide("designer", "design-round-1", "propose", out, errors, CFG, GATE)
    assert d["escalate"] and reason in d["reasons"]


def test_held_out_tasks_are_high_risk():
    d = ae.decide("designer", "design-round-2", "propose a confirmatory run on held-out landscapes", OK, 0, CFG, GATE)
    assert d["reasons"] == ["task_risk_level"]


def test_disabled_escalation_never_fires():
    d = ae.decide("critic", "c", "i", OK, 0, {**CFG, "escalation": {**CFG["escalation"], "enabled": False}}, GATE)
    assert not d["escalate"]


def test_verdict_parsing():
    assert ae.parse_verdict("VERDICT: corrected\nE2 not E1") == "CORRECTED"
    assert ae.parse_verdict("looks fine") == "UNPARSED"


def test_freeze_refuses_held_out_fitted_gates(tmp_path):
    src = tmp_path / "gate.json"
    src.write_text(json.dumps({**GATE["gate"], "fitted_splits": ["dev", "held_out"]}), encoding="utf-8")
    with pytest.raises(ValueError):
        ae.freeze_from(src, tmp_path / "out.json")


def test_shipped_gate_and_verifier_role_load():
    g = ae.load_gate()
    assert "historical_task_family_error_ucb" in g["gate"] and len(g["file_sha256"]) == 64
    assert muse.role_tools("verifier") == list(muse.VERIFIER_TOOLS)
    assert "VERDICT" in muse.role_instructions("verifier")
    cfg = muse.load_config()
    assert cfg["roles"]["verifier"]["model"] == "muse-wonder-1.0" and cfg["escalation"]["enabled"]


def _completed_experiment(home):
    """Minimal ledger path to a completed E1 (no simulation)."""
    from discolab.ledger import Ledger

    led = Ledger(home)
    led.append("experiment_proposed", {"id": "E1", "spec": {"hypotheses": ["H1"], "title": "t", "kind": "prediction"}},
               "designer")
    row = {"id": "E1", "title": "t", "kind": "prediction", "stage": "development", "eig_bits": 0.5, "utility": 0.5,
           "feasible": True, "violations": [], "cost": {"wall_seconds": 1.0}, "hypotheses": ["H1"]}
    led.append("experiments_scored", {"scores": [row], "argmax": "E1"}, "designer")
    led.append("experiment_selected", {"id": "E1", "justification": "argmax"}, "pi")
    led.append("experiment_completed", {"id": "E1", "summary": {}, "artifacts": "x", "runtime_sec": 1.0}, "pi")


@pytest.mark.parametrize("verdict,status", [("CORRECTED", "corrected"), ("CONFIRMED", "confirmed"),
                                            ("REJECTED", "rejected")])
def test_critic_analysis_is_unverified_until_the_verifier_rules(tmp_path, monkeypatch, verdict, status):
    """The critic writes its analysis BEFORE the verifier runs: that analysis must read as
    unverified meanwhile, and carry the verdict (and any correction) afterwards."""
    from discolab import mcp_server
    from discolab.ledger import Ledger

    home = tmp_path / "lab"
    lab.init_lab(home)
    _completed_experiment(home)
    (home / "run.json").write_text(json.dumps({"config": muse.load_config(), "ceiling_usd": 5.0}), encoding="utf-8")
    monkeypatch.setenv("DISCOLAB_HOME", str(home))
    seen_during_verification = []

    def fake_run_agent(role, task, h, *, title=None, config=None, timeout_sec=None):
        if role == "critic":
            Ledger(h).append("analysis_recorded", {"id": "E1", "interpretation": "H1 supported",
                                                   "threats_to_validity": []}, "critic")
            text = "H1 supported."
        else:
            seen_during_verification.append(
                Ledger(h).state()["candidates"]["E1"]["analysis"]["verification"]["status"])
            text = f"VERDICT: {verdict}\nOnly development-stage support."
        return {"role": role, "title": title, "text": text, "terminal": "completed", "exit_code": 0,
                "usage": [], "cost_usd": 0.01, "seconds": 1.0, "events_file": ""}

    monkeypatch.setattr(muse, "run_agent", fake_run_agent)
    fn = getattr(mcp_server.delegate, "fn", mcp_server.delegate)
    fn(tasks=[mcp_server.DelegateTask(agent="critic", title="critique-E1", instructions="interpret E1")])
    assert seen_during_verification == ["unverified"]
    v = Ledger(home).state()["candidates"]["E1"]["analysis"]["verification"]
    assert v["status"] == status and v["verifier_model"] == "muse-wonder-1.0"
    assert "development-stage" in v["verifier_report"]
    from discolab.bridge import lab_state
    assert lab_state(home)["analyses"]["E1"]["verification"]["status"] == status


def test_verification_needs_a_recorded_analysis(tmp_path):
    from discolab.ledger import Ledger, LedgerError

    home = tmp_path / "lab"
    lab.init_lab(home)
    with pytest.raises(LedgerError):
        Ledger(home).append("analysis_verification", {"id": "E1", "status": "confirmed"}, "noesis.gate")


def test_delegate_escalates_critic_to_verifier(tmp_path, monkeypatch):
    from discolab import mcp_server

    home = tmp_path / "lab"
    lab.init_lab(home)
    (home / "run.json").write_text(json.dumps({"config": muse.load_config(), "ceiling_usd": 5.0}), encoding="utf-8")
    monkeypatch.setenv("DISCOLAB_HOME", str(home))
    calls = []

    def fake_run_agent(role, task, h, *, title=None, config=None, timeout_sec=None):
        calls.append(role)
        text = "VERDICT: CORRECTED\nE1, not E2." if role == "verifier" else "E2 supports H1."
        return {"role": role, "title": title, "text": text, "terminal": "completed", "exit_code": 0,
                "usage": [], "cost_usd": 0.01, "seconds": 1.0, "events_file": ""}

    monkeypatch.setattr(muse, "run_agent", fake_run_agent)
    fn = getattr(mcp_server.delegate, "fn", mcp_server.delegate)
    out = fn(tasks=[mcp_server.DelegateTask(agent="critic", title="critique-E1", instructions="interpret E1"),
                    mcp_server.DelegateTask(agent="designer", title="design-round-1", instructions="propose")])
    by = {r["agent"]: r for r in out["reports"]}
    assert by["critic"]["escalation"]["verdict"] == "CORRECTED"
    assert by["designer"]["escalation"]["escalate"] is False
    assert sorted(calls) == ["critic", "designer", "verifier"]
    gates = [a for a in muse.read_jsonl(home / "activity.jsonl") if a["kind"] == "gate"]
    assert {(g["agent"], g["decision"]) for g in gates} == {("critic", "escalate"), ("designer", "accept"),
                                                           ("verifier", "verdict")}
