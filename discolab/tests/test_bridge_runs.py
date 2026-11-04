"""Bridge: Muse activity/run views, approval answers, and run-start guards (no network)."""

from __future__ import annotations

import json

import pytest

from discolab import bridge, lab, muse


@pytest.fixture()
def src(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge, "ROOT", tmp_path)
    home = tmp_path / "lab_home" / "r1"
    lab.init_lab(home)
    (home / "run.json").write_text(json.dumps({"run_id": "r1", "source": "lab_home/r1", "status": "completed",
                                               "question": "q?", "config": muse.load_config(), "ceiling_usd": 1.0}),
                                   encoding="utf-8")
    for a in ({"kind": "handoff", "from": "pi", "to": "designer", "title": "d1", "state": "running"},
              {"kind": "agent_start", "agent": "designer", "title": "d1"},
              {"kind": "tool", "agent": "designer", "name": "score_experiments", "args": "{}", "ok": True},
              {"kind": "usage", "agent": "designer", "model": "muse-spark-1.3", "input_tokens": 100,
               "cached_tokens": 50, "output_tokens": 10, "calls": 2, "cost_usd": 0.01, "seconds": 3},
              {"kind": "agent_end", "agent": "designer", "title": "d1"},
              {"kind": "say", "agent": "designer", "text": "done"}):
        muse.log_activity(home, a)
    return home


def test_activity_exposes_only_ui_kinds(src):
    kinds = [a["kind"] for a in bridge.source_activity(src)]
    assert kinds == ["handoff", "tool", "say"]


def test_run_view_reports_spend_per_agent(src):
    v = bridge.run_view(src)
    assert v["runtime"] == "muse" and v["status"] == "completed"
    assert v["usage"]["cost_usd"] == pytest.approx(0.01)
    assert v["per_agent"][0]["agent"] == "designer" and v["per_agent"][0]["calls"] == 2
    assert v["active_agents"] == []


def test_sources_mark_muse_runs(src):
    s = bridge.list_sources()
    assert s[0]["id"] == "lab_home/r1" and s[0]["runtime"] == "muse" and s[0]["run_status"] == "completed"


def test_answer_approval_only_once(src):
    (src / "approvals").mkdir()
    (src / "approvals" / "E3.json").write_text(json.dumps({"id": "E3", "status": "pending"}), encoding="utf-8")
    assert bridge.answer_approval({"source": "lab_home/r1", "id": "E3", "decision": "approve"})[0] == 200
    assert json.loads((src / "approvals" / "E3.json").read_text())["status"] == "approved"
    assert bridge.answer_approval({"source": "lab_home/r1", "id": "E3", "decision": "decline"})[0] == 409
    assert bridge.answer_approval({"source": "lab_home/r1", "id": "../x", "decision": "approve"})[0] == 400


def test_start_run_rejects_bad_questions_before_any_model_call(src, monkeypatch):
    from discolab import scope

    monkeypatch.setattr(scope, "check", lambda q: pytest.fail("scope check must not run"))
    assert bridge.start_run({"question": "hi"})[0] == 400


@pytest.mark.parametrize("in_scope,mode", [(False, "open"), (True, "lab")])
def test_every_question_starts_a_run_in_the_right_mode(src, monkeypatch, in_scope, mode):
    from discolab import run as runmod
    from discolab import scope

    monkeypatch.setattr(runmod, "LAB_HOMES", src.parent)
    launched = []
    monkeypatch.setattr(runmod, "start_detached", lambda home: launched.append(home) or 0)
    monkeypatch.setattr(scope, "check", lambda q: {"in_scope": in_scope, "reason": "biology",
                                                   "hypotheses": ["H1"] if in_scope else []})
    q = "Does gut microbiome diversity predict response to immunotherapy?"
    status, body = bridge.start_run({"question": q})
    assert status == 201 and body["mode"] == mode and len(launched) == 1
    rec = json.loads((launched[0] / "run.json").read_text(encoding="utf-8"))
    st = bridge.lab_state(launched[0])
    assert rec["mode"] == mode and st["mode"] == mode
    if mode == "open":
        assert st["question"] == q and st["hypotheses"] == []
    else:
        assert st["question"] != q and st["hypotheses"]  # the pre-registered study
