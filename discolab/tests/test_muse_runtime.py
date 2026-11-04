"""Muse Code runtime: per-role tool allow-lists, key loading, cost accounting,
spend ceiling, the file-based human approval gate and the scope gate's
post-processing. No network or Muse Code process is used."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from discolab import muse

ROOT = Path(__file__).resolve().parent.parent


def _served_tools(env_tools: str) -> set[str]:
    code = ("import asyncio, os; from discolab import mcp_server as m; m._restrict_to_allow_list(); "
            "print(','.join(sorted(t.name for t in asyncio.run(m.mcp.list_tools()))))")
    env = {**os.environ, "DISCOLAB_TOOLS": env_tools}
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=ROOT, env=env, timeout=60)
    assert out.returncode == 0, out.stderr[-800:]
    return set(out.stdout.strip().split(","))


@pytest.mark.parametrize("env_tools,reason", [
    (None, "not set"),
    ("", "empty"),
    (" , ", "empty"),
    ("get_research_state,run_experiment_everywhere", "unknown tools"),
])
def test_tool_allow_list_fails_closed(env_tools, reason):
    """A missing or invalid DISCOLAB_TOOLS must never expose every tool."""
    code = ("import asyncio; from discolab import mcp_server as m\n"
            "try:\n    m._restrict_to_allow_list()\nexcept m.ToolAllowListError as e:\n    print('ERR', e)\n"
            "print('TOOLS', len(asyncio.run(m.mcp.list_tools())))")
    env = {k: v for k, v in os.environ.items() if k != "DISCOLAB_TOOLS"}
    if env_tools is not None:
        env["DISCOLAB_TOOLS"] = env_tools
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=ROOT, env=env, timeout=60)
    assert out.returncode == 0, out.stderr[-800:]
    assert f"ERR DISCOLAB_TOOLS" in out.stdout and reason in out.stdout
    assert "TOOLS 0" in out.stdout


@pytest.mark.parametrize("role", ["pi", "literature", "designer", "critic", "verifier"])
def test_open_mode_roles_are_served_exactly_their_allow_list(role):
    tools = muse.role_tools(role, "open")
    assert _served_tools(",".join(tools)) == set(tools)


def test_omnigent_bundle_configs_pass_an_explicit_allow_list():
    import yaml

    paths = [ROOT / "omnigent/lab_pi/tools/mcp/lab.yaml",
             *[ROOT / f"omnigent/lab_pi/agents/{r}/tools/mcp/lab.yaml" for r in muse.SPECIALISTS]]
    for p in paths:
        spec = yaml.safe_load(p.read_text(encoding="utf-8"))
        assert spec["env"]["DISCOLAB_TOOLS"].split(",") == spec["tools"], p


def test_server_exits_nonzero_without_an_allow_list():
    env = {k: v for k, v in os.environ.items() if k != "DISCOLAB_TOOLS"}
    out = subprocess.run([sys.executable, "-m", "discolab.mcp_server"], capture_output=True, text=True, cwd=ROOT,
                         env=env, stdin=subprocess.DEVNULL, timeout=60)
    assert out.returncode == 2 and "refusing to serve any lab tool" in out.stderr


@pytest.mark.parametrize("role", ["pi", "literature", "designer", "critic"])
def test_each_role_is_served_exactly_its_allow_list(role):
    tools = muse.role_tools(role)
    assert _served_tools(",".join(tools)) == set(tools)


def test_only_the_pi_can_delegate_or_spend_compute():
    for role in muse.SPECIALISTS:
        assert "delegate" not in muse.role_tools(role)
        assert "run_experiment" not in muse.role_tools(role)
        assert "select_experiment" not in muse.role_tools(role)
    assert {"delegate", "run_experiment", "select_experiment"} <= set(muse.role_tools("pi"))


def test_role_instructions_exist():
    for role in ("pi", *muse.SPECIALISTS):
        assert len(muse.role_instructions(role)) > 200


@pytest.mark.parametrize("content", ['key="abc123"', "abc123", "KEY = 'abc123'\n", '﻿key="abc123"\nother'])
def test_key_file_formats(tmp_path, monkeypatch, content):
    p = tmp_path / "k.txt"
    p.write_text(content, encoding="utf-8")
    for v in ("MODEL_API_KEY", "META_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("MODEL_API_KEY_FILE", str(p))
    assert muse.load_api_key() == "abc123"


def test_cost_estimate_uses_cached_rate():
    # 1M fresh input + 1M cached + 1M output on Spark: 1.25 + 0.15 + 4.25
    assert muse.estimate_cost("muse-spark-1.3", 2_000_000, 1_000_000, 1_000_000) == pytest.approx(5.65)
    assert muse.estimate_cost("unknown-model", 1, 0, 1) is None


def _lab(tmp_path, monkeypatch, ceiling=1.0):
    from discolab import lab

    home = tmp_path / "lab"
    monkeypatch.setenv("DISCOLAB_HOME", str(home))
    lab.init_lab(home)
    cfg = muse.load_config()
    cfg["approval_wait_sec"] = 2
    (home / "run.json").write_text(json.dumps({"config": cfg, "ceiling_usd": ceiling}), encoding="utf-8")
    return home


def test_delegate_refuses_after_the_spend_ceiling(tmp_path, monkeypatch):
    from discolab import mcp_server

    home = _lab(tmp_path, monkeypatch, ceiling=0.5)
    muse.log_activity(home, {"kind": "usage", "agent": "literature", "model": "muse-spark-1.3", "input_tokens": 10,
                             "cached_tokens": 0, "output_tokens": 1, "calls": 1, "cost_usd": 0.6})
    out = mcp_server.delegate([mcp_server.DelegateTask(agent="critic", title="t", instructions="x")])
    assert out["refused"] is True and out["spent_usd"] == pytest.approx(0.6)
    assert not (home / "muse").exists()  # no agent process was launched


def test_approval_gate_fails_closed_without_a_human(tmp_path, monkeypatch):
    from discolab import mcp_server, policies

    home = _lab(tmp_path, monkeypatch)
    monkeypatch.setattr(policies, "approve_confirmatory_runs", lambda e: {"result": "ASK", "reason": "held-out"})
    with pytest.raises(PermissionError, match="declined"):
        mcp_server._await_human_approval("E1")
    rec = json.loads((home / "approvals" / "E1.json").read_text(encoding="utf-8"))
    assert rec["status"] == "declined" and rec["decided_by"].startswith("timeout")
    states = [a.get("state") for a in muse.read_jsonl(home / "activity.jsonl") if a["kind"] == "approval"]
    assert states == ["pending", "declined"]


def test_approval_gate_proceeds_when_a_human_approves(tmp_path, monkeypatch):
    import threading
    import time

    from discolab import mcp_server, policies

    home = _lab(tmp_path, monkeypatch)
    monkeypatch.setattr(policies, "approve_confirmatory_runs", lambda e: {"result": "ASK", "reason": "held-out"})

    def approve():
        p = home / "approvals" / "E2.json"
        for _ in range(100):
            if p.exists():
                rec = json.loads(p.read_text(encoding="utf-8"))
                rec["status"] = "approved"
                p.write_text(json.dumps(rec), encoding="utf-8")
                return
            time.sleep(0.02)

    t = threading.Thread(target=approve)
    t.start()
    mcp_server._await_human_approval("E2")  # returns without raising
    t.join()


def test_development_runs_need_no_approval(tmp_path, monkeypatch):
    from discolab import mcp_server

    home = _lab(tmp_path, monkeypatch)
    mcp_server._await_human_approval(None)  # nothing selected -> not confirmatory -> ALLOW
    assert not (home / "approvals").exists()
