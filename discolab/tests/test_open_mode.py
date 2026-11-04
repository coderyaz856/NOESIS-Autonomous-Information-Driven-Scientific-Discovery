"""Open mode: any research question, nothing executed (no network, no Muse Code)."""

from __future__ import annotations

import json

import pytest

from discolab import lab, muse
from discolab.ledger import Ledger, LedgerError
from discolab.views import state_summary

Q = "Does intermittent fasting improve insulin sensitivity in adults with prediabetes?"
PROTO = {"title": "RCT of 16:8 fasting", "hypotheses": ["Q1"], "design": "12-week parallel RCT, 2 arms",
         "measurements": "HOMA-IR change", "comparator": "isocaloric usual eating",
         "falsifier": "95% CI excludes a 10% HOMA-IR reduction", "sample_size": "n=120 (assumption: SD 0.8)",
         "cost_estimate": "~6 months", "risks": "adherence, dropout"}


@pytest.fixture()
def home(tmp_path):
    h = tmp_path / "lab"
    lab.init_lab(h, mode="open", question=Q)
    return h


def test_open_lab_records_the_operators_question_and_no_prereg_hypotheses(home):
    s = Ledger(home).state()
    assert s["mode"] == "open" and s["question"] == Q and s["hypotheses"] == {}


def test_open_hypotheses_and_protocols_are_recorded_as_untested_and_unexecuted(home):
    lab.register_hypothesis("Q1", "16:8 fasting lowers HOMA-IR", "no difference", "open", None, None,
                            "designer", root=home)
    out = lab.propose_protocol(PROTO, "designer", root=home)
    assert out["id"] == "P1" and out["executed"] is False
    summ = state_summary(Ledger(home).state())
    assert summ["mode"] == "open" and summ["hypotheses"][0]["status"] == "untested"
    assert summ["protocols"][0]["executed"] is False and summ["protocols"][0]["proposed_by"] == "designer"


def test_protocols_need_every_field_and_a_known_hypothesis(home):
    with pytest.raises(ValueError):
        lab.propose_protocol({**PROTO, "falsifier": " "}, "designer", root=home)
    with pytest.raises(LedgerError):
        lab.propose_protocol(PROTO, "designer", root=home)  # Q1 not registered


def test_open_labs_cannot_propose_executable_experiments(home):
    lab.register_hypothesis("Q1", "s", "h0", "open", None, None, "designer", root=home)
    with pytest.raises(LedgerError):
        Ledger(home).append("experiment_proposed", {"id": "E1", "spec": {"hypotheses": ["Q1"]}}, "designer")


def test_lab_mode_refuses_protocols(tmp_path):
    h = tmp_path / "lab"
    lab.init_lab(h)
    with pytest.raises(ValueError):
        lab.propose_protocol(PROTO, "designer", root=h)


def test_open_mode_roles_get_no_experiment_tools_and_open_instructions(tmp_path):
    for role in ("pi", "literature", "designer", "critic", "verifier"):
        tools = muse.role_tools(role, "open")
        assert not {"run_experiment", "select_experiment", "propose_experiment"} & set(tools)
        assert "execute" in muse.role_instructions(role, "open").lower() or role in ("literature", "verifier")
    assert "propose_protocol" in muse.role_tools("designer", "open")
    (tmp_path / "run.json").write_text(json.dumps({"mode": "open"}), encoding="utf-8")
    assert muse.run_mode(tmp_path) == "open"
