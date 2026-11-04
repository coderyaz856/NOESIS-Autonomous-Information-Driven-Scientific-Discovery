"""The public trial: one run at a time, rate limits, a durable total spend limit, a watchdog."""

import json
from pathlib import Path

import pytest

from discolab import bridge, trial


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def cfg(tmp_path, **kw):
    env = {"NOESIS_TRIAL_TOTAL_USD": "3", "NOESIS_TRIAL_RUN_CEILING_USD": "0.5", "NOESIS_TRIAL_RUN_RESERVE_USD": "1",
           "NOESIS_DATA_DIR": str(tmp_path / "data"), "NOESIS_TRIAL_RUNS_PER_HOUR": "10",
           "NOESIS_TRIAL_CLIENT_RUNS_PER_HOUR": "5", "NOESIS_TRIAL_CLIENT_RUNS_PER_DAY": "9"}
    env.update({k: str(v) for k, v in kw.items()})
    return trial.load_config(tmp_path / "default", env)


def make_run(root: Path, name: str, status: str, cost: float = 0.0, pid=None):
    home = root / "lab_home" / name
    home.mkdir(parents=True, exist_ok=True)
    (home / "run.json").write_text(json.dumps({"status": status, "pid": pid}), encoding="utf-8")
    rows = [{"kind": "usage", "agent": "pi", "cost_usd": cost}] if cost else []
    (home / "activity.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return f"lab_home/{name}"


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(trial, "_pid_alive", lambda pid: pid == 4242)
    clock = Clock()
    killed = []
    t = trial.Trial(cfg(tmp_path), tmp_path, clock=clock, is_mount=lambda p: True, terminate=killed.append)
    return t, tmp_path, clock, killed


def test_disabled_without_a_total(tmp_path):
    assert trial.load_config(tmp_path, {}) is None


@pytest.mark.parametrize("env,match", [
    ({"NOESIS_TRIAL_TOTAL_USD": "abc"}, "number"),
    ({"NOESIS_TRIAL_TOTAL_USD": "0"}, "greater"),
    ({"NOESIS_TRIAL_TOTAL_USD": "5", "NOESIS_TRIAL_RUN_CEILING_USD": "2", "NOESIS_TRIAL_RUN_RESERVE_USD": "1"}, "at least"),
    ({"NOESIS_TRIAL_TOTAL_USD": "0.5", "NOESIS_TRIAL_RUN_RESERVE_USD": "1"}, "one run reserve"),
])
def test_invalid_settings_refuse_to_start(tmp_path, env, match):
    with pytest.raises(trial.TrialConfigError, match=match):
        trial.load_config(tmp_path, env)


def test_client_ids_are_sanitised():
    assert trial.client_id("abc_DEF-123") == "abc_DEF-123"
    for bad in (None, "", "a b", "x" * 65, "../../etc", "ä"):
        assert trial.client_id(bad) == "anonymous"


def test_ephemeral_storage_refuses_runs_unless_deliberately_allowed(tmp_path):
    t = trial.Trial(cfg(tmp_path), tmp_path, is_mount=lambda p: False)
    status, body = t.admit("c1")
    assert (status, body["error"]["code"]) == (503, "budget_store_not_durable")
    assert t.status()["accepting"] is False
    t2 = trial.Trial(cfg(tmp_path, NOESIS_TRIAL_ALLOW_EPHEMERAL=1), tmp_path, is_mount=lambda p: False)
    assert t2.admit("c1") is None


def test_corrupt_state_fails_closed(setup):
    t, *_ = setup
    t.cfg.data_dir.mkdir(parents=True)
    t.cfg.state_file.write_text("{not json", encoding="utf-8")
    status, body = t.admit("c1")
    assert (status, body["error"]["code"]) == (503, "budget_store_unreadable")


def test_total_budget_counts_reserve_for_unfinished_runs_and_recorded_cost_for_finished(setup):
    t, root, clock, _ = setup
    a = make_run(root, "a", "completed", cost=0.4)
    t.record_start(a, "c1")
    b = make_run(root, "b", "running", cost=0.1, pid=4242)  # live: charged the 1.00 reserve
    t.record_start(b, "c2")
    s = t.status()
    assert s["committed_usd"] == pytest.approx(1.4)
    assert t.admit("c3") is None                   # 1.4 + 1.0 <= 3
    c = make_run(root, "c", "interrupted", cost=0.05)  # ended without a final cost: reserve
    t.record_start(c, "c3")
    status, body = t.admit("c4")                   # 2.4 + 1.0 > 3
    assert (status, body["error"]["code"]) == (403, "budget_exhausted")
    assert t.status()["reason"] == "budget_exhausted"


def test_dead_driver_is_charged_the_reserve(setup):
    t, root, _, _ = setup
    src = make_run(root, "d", "running", cost=0.02, pid=999)  # pid not alive
    t.record_start(src, "c1")
    assert t.status()["committed_usd"] == pytest.approx(1.0)


def test_spend_survives_a_restart(setup, tmp_path):
    t, root, _, _ = setup
    t.record_start(make_run(root, "a", "completed", cost=0.9), "c1")
    again = trial.Trial(cfg(tmp_path), tmp_path, is_mount=lambda p: True)
    assert again.status()["committed_usd"] == pytest.approx(0.9)


def test_lost_run_record_is_charged_the_reserve(setup):
    t, root, _, _ = setup
    t.record_start("lab_home/gone", "c1")
    assert t.status()["committed_usd"] == pytest.approx(1.0)


def test_rate_limits(tmp_path, monkeypatch):
    monkeypatch.setattr(trial, "_pid_alive", lambda pid: False)
    clock = Clock()
    t = trial.Trial(cfg(tmp_path, NOESIS_TRIAL_TOTAL_USD=100, NOESIS_TRIAL_RUNS_PER_HOUR=3,
                        NOESIS_TRIAL_CLIENT_RUNS_PER_HOUR=1, NOESIS_TRIAL_CLIENT_RUNS_PER_DAY=2),
                    tmp_path, clock=clock, is_mount=lambda p: True)
    t.record_start(make_run(tmp_path, "r1", "completed", 0.1), "alice")
    status, body = t.admit("alice")
    assert (status, body["error"]["code"]) == (429, "rate_limited")
    assert 0 < body["error"]["details"]["retry_after_s"] <= 3601
    assert t.admit("bob") is None
    t.record_start(make_run(tmp_path, "r2", "completed", 0.1), "bob")
    t.record_start(make_run(tmp_path, "r3", "completed", 0.1), "carol")
    status, body = t.admit("dave")                 # global: 3 in the last hour
    assert status == 429 and "per hour" in body["error"]["message"]
    clock.t += 3601
    t.record_start(make_run(tmp_path, "r4", "completed", 0.1), "alice")
    clock.t += 3601
    status, _ = t.admit("alice")                   # 2 today
    assert status == 429
    clock.t += 86400
    assert t.admit("alice") is None


def test_watchdog_stops_overlong_runs_and_charges_the_reserve(setup):
    t, root, clock, killed = setup
    src = make_run(root, "slow", "running", cost=0.1, pid=4242)
    t.record_start(src, "c1")
    assert t.watchdog_tick() == []
    clock.t += t.cfg.max_run_seconds + 1
    assert t.watchdog_tick() == [src]
    assert killed == [4242]
    rec = json.loads((root / src / "run.json").read_text(encoding="utf-8"))
    assert rec["status"] == "stopped" and "time limit" in rec["error"]
    assert t.status()["committed_usd"] == pytest.approx(1.0)


def test_watchdog_stops_runs_that_spend_past_the_reserve(setup):
    t, root, _, killed = setup
    src = make_run(root, "costly", "running", cost=1.2, pid=4242)
    t.record_start(src, "c1")
    assert t.watchdog_tick() == [src]
    assert killed == [4242]
    assert t.status()["committed_usd"] == pytest.approx(1.2)


def test_bridge_applies_trial_limits_to_every_run(tmp_path, monkeypatch):
    monkeypatch.setattr(trial, "_pid_alive", lambda pid: False)
    t = trial.Trial(cfg(tmp_path), tmp_path, is_mount=lambda p: True)
    monkeypatch.setattr(bridge, "TRIAL", t)
    monkeypatch.setattr(bridge, "_active_run", lambda: None)
    launched = []

    def fake_launch(question, rounds, ceiling):
        launched.append((rounds, ceiling))
        src = make_run(tmp_path, f"run{len(launched)}", "prepared")
        return 201, {"source": src, "run_id": src.split("/")[1], "rounds": rounds, "ceiling_usd": ceiling}

    monkeypatch.setattr(bridge, "_launch", fake_launch)
    status, out = bridge.start_run({"question": "Does entropy predict stagnation?", "rounds": 9, "ceiling_usd": 50},
                                   "visitor1")
    assert status == 201 and launched == [(1, 0.5)]   # body limits ignored: 1 round, trial guard
    state = json.loads(t.cfg.state_file.read_text(encoding="utf-8"))
    assert state["runs"][0]["client"] == "visitor1"


def test_bridge_reports_a_busy_lab(monkeypatch):
    monkeypatch.setattr(bridge, "_active_run", lambda: "lab_home/x")
    status, out = bridge.start_run({"question": "Does entropy predict stagnation?"}, "v")
    assert status == 409 and out["error"]["source"] == "lab_home/x"


def test_responses_never_contain_configured_secrets(monkeypatch):
    secret = "k" * 40
    monkeypatch.setattr(bridge, "SECRET_VALUES", (secret,))
    assert bridge.redact(f'{{"final_report": "the key is {secret}"}}') == '{"final_report": "the key is [redacted]"}'
