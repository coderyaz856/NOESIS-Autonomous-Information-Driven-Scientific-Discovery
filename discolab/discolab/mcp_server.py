"""MCP tool server exposing the lab to Omnigent agents.

One server module serves every agent; each agent's tools/mcp/lab.yaml
allow-lists the subset it may call and sets DISCOLAB_ACTOR so every ledger
event is attributed. Run with:  python -m discolab.mcp_server
"""

from __future__ import annotations

import functools
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

from . import lab
from .experiments import n_workers
from .features import FEATURE_SETS
from .ledger import Ledger
from .literature import (TITLE_MATCH_MIN, fetch_arxiv, fetch_work, is_arxiv_id, search_arxiv, search_works,
                         title_similarity)
from .prereg import load_prereg
from .views import result_summary, state_summary

mcp = FastMCP("discolab")

EXPERIMENT_TIMEOUT_SEC = 1800
EVIDENCE_RELATIONS = ("supports", "contradicts", "context", "method", "baseline")


def _actor() -> str:
    return os.environ.get("DISCOLAB_ACTOR", "unknown-agent")


def _short(obj, n: int = 200) -> str:
    s = obj if isinstance(obj, str) else json.dumps(obj, default=str)
    return s if len(s) <= n else s[: n - 1] + "…"


def tool(fn):
    """Register a lab tool. Under the Muse Code runtime (DISCOLAB_ACTIVITY_LOG=1)
    every call is also appended to <lab>/activity.jsonl with its actor,
    arguments, outcome and duration, so the live UI shows real tool use."""

    @functools.wraps(fn)
    def logged(*args, **kwargs):
        if os.environ.get("DISCOLAB_ACTIVITY_LOG") != "1":
            return fn(*args, **kwargs)
        from .muse import log_activity

        t0, ok, err = time.time(), True, None
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            ok, err = False, f"{type(exc).__name__}: {exc}"
            raise
        finally:
            if fn.__name__ == "delegate":
                shown = {"tasks": [f"{t.agent}:{t.title}" for t in kwargs.get("tasks", [])]}
            else:
                shown = {k: (v.model_dump() if isinstance(v, BaseModel) else v) for k, v in kwargs.items()}
            log_activity(lab.lab_root(), {"kind": "tool", "agent": _actor(), "name": fn.__name__,
                                          "args": _short(shown), "ok": ok, "error": _short(err, 300) if err else None,
                                          "ms": round((time.time() - t0) * 1000)})

    return mcp.tool()(logged)


@tool
def get_research_state() -> dict:
    """Current research record: question, hypotheses with posteriors, evidence,
    candidate experiments with scores and status, compute budget, last decision."""
    return state_summary(Ledger(lab.lab_root()).state())


@tool
def list_design_space() -> dict:
    """What experiments can be proposed: landscapes (development vs held-out),
    feature sets, controllers, seed limits, and what each hypothesis needs."""
    pr = load_prereg()
    s = Ledger(lab.lab_root()).state()
    return {
        "kinds": {
            "prediction": "Does a feature set predict stagnation onset better than fitness history? "
                          "feature_sets must include 'fitness'. Development stage = leave-one-landscape-out "
                          "over >= 2 development landscapes; confirmatory = held-out landscapes.",
            "control": "Do mutation controllers recover faster after landscape shifts? controllers must "
                       "include 'B0_fixed'; include 'B3_predictive' to test H4.",
        },
        "landscapes": pr["landscapes"],
        "feature_sets": {k: list(v) for k, v in FEATURE_SETS.items()},
        "controllers": pr["control_study"]["controllers"],
        "controller_variants": {
            "B3d_predictive": "predictive controller whose frozen risk model uses fitness+dispersion features",
            "B0_fixed_x<m>": "fixed mutation rate m/d for 0.25 <= m <= 4 (rate-matched controls, e.g. B0_fixed_x0.8)",
        },
        "n_seeds": {"min": 4, "max": 50},
        "hypotheses": {h["id"]: {"family": h["family"], "feature_set": h.get("feature_set"),
                                 "controller": h.get("controller"), "status": h["status"]}
                       for h in s["hypotheses"].values()},
        "rules": pr["planner_policy"]["hard_constraints"],
        "parallel_workers": n_workers(),
    }


@tool
def propose_experiment(kind: str, title: str, rationale: str, hypotheses: list[str], landscapes: list[str],
                       n_seeds: int, feature_sets: list[str] | None = None,
                       controllers: list[str] | None = None) -> dict:
    """Propose one candidate experiment (validated against the pre-registration).
    kind: 'prediction' or 'control'. Returns its id, stage and simulated workload."""
    spec = {"kind": kind, "title": title, "rationale": rationale, "hypotheses": hypotheses,
            "landscapes": landscapes, "n_seeds": n_seeds, "feature_sets": feature_sets,
            "controllers": controllers}
    return lab.propose_experiment(spec, _actor())


@tool
def score_experiments() -> dict:
    """Score every open candidate: expected information gain (bits), estimated
    compute cost, held-out penalty, utility, and hard-constraint feasibility.
    Also returns the research portfolio: up to 3 experiments chosen greedily for
    their JOINT information after redundancy (experiments testing the same
    hypothesis overlap), with each step's marginal gain."""
    out = lab.score_experiments(_actor())
    keep = ("id", "title", "kind", "stage", "eig_bits", "cost_penalty_bits", "heldout_penalty_bits",
            "utility", "feasible", "violations", "hypotheses")
    return {"argmax": out["argmax"], "portfolio": out["portfolio"],
            "scores": [{k: r[k] for k in keep} | {"est_wall_seconds": r["cost"]["wall_seconds"]}
                       for r in out["scores"]]}


@tool
def select_experiment(experiment_id: str, justification: str) -> dict:
    """Select the experiment to run from the latest scoring round. If it is not
    the utility argmax, the justification must explain why."""
    return lab.select_experiment(experiment_id, justification, _actor())


@tool
def run_experiment() -> dict:
    """Run the selected experiment for real (GA simulations + pre-registered
    analysis). Returns a compact result; raw artifacts are written to disk."""
    # Experiments run in an isolated worker process with explicit standard
    # handles. Spawning the process pool directly from this stdio server can
    # hang on Windows (children would implicitly inherit the MCP stdin pipe
    # while it has a pending read), and isolation keeps a crashing experiment
    # from taking the tool server down with it.
    selected = Ledger(lab.lab_root()).state()["selected"]
    if os.environ.get("DISCOLAB_APPROVAL_MODE") == "file":
        _await_human_approval(selected)
    proc = subprocess.run([sys.executable, "-m", "discolab.cli", "run-selected", _actor()],
                          stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=EXPERIMENT_TIMEOUT_SEC,
                          env=os.environ.copy())
    if proc.returncode != 0:
        raise RuntimeError(f"experiment {selected} failed: {proc.stderr.strip()[-1500:]}")
    cand = Ledger(lab.lab_root()).state()["candidates"][selected]
    return result_summary(cand)


@tool
def get_experiment_result(experiment_id: str) -> dict:
    """Compact numerical result, verdicts and (if recorded) the critic's analysis."""
    s = Ledger(lab.lab_root()).state()
    if experiment_id not in s["candidates"]:
        raise ValueError(f"unknown experiment {experiment_id}")
    return result_summary(s["candidates"][experiment_id])


@tool
def analyze_failure_dependence(experiment_id: str) -> dict:
    """For a completed CONTROL experiment: do controllers fail on the same runs?
    Uses the EigenBrains econometrics layer (covariance, Jaccard failure similarity,
    conditional failure, paired run-level bootstrap, complementary-pair selection).
    Low overlap between two controllers means they are complementary (a combined
    policy may beat both); high overlap means one adds nothing beyond the other."""
    from .portfolio import analyze

    s = Ledger(lab.lab_root()).state()
    cand = s["candidates"].get(experiment_id)
    if cand is None or cand["spec"]["kind"] != "control" or cand["status"] not in ("completed", "analyzed"):
        raise ValueError(f"{experiment_id} is not a completed control experiment")
    path = lab.lab_root() / cand["artifacts"] / "outcomes.jsonl"
    r = analyze(path, horizon=load_prereg()["control_study"]["period_generations"])
    keep = ("jaccard_failure_similarity", "p_right_fails_given_left_fails", "correlation")
    return {
        "n_runs": r["n_runs"], "mean_run_recovery": {k: round(v, 3) for k, v in r["mean_run_recovery"].items()},
        "pairs": [{"left": b["left"], "right": b["right"],
                   **{m: {"estimate": round(b["metrics"][m]["estimate"], 3),
                          "ci95": [round(b["metrics"][m]["lower"], 3), round(b["metrics"][m]["upper"], 3)]}
                      for m in keep if b["metrics"][m]["estimate"] is not None}}
                  for b in r["run_level_bootstrap"]],
        "complementary_pair": r["complementary_pair"]["pair"],
        "note": "run-level cases (independent units); a run fails when >= 3 of its 5 shifts are not recovered",
    }


@tool
def record_analysis(experiment_id: str, interpretation: str, threats_to_validity: list[str]) -> dict:
    """Record the critic's interpretation of a completed experiment. This triggers
    the pre-registered Bayesian update of the tested hypotheses."""
    return lab.record_analysis(experiment_id, interpretation, threats_to_validity, _actor())


@tool
def record_decision(decision: str, rationale: str, next_experiment: str | None = None) -> dict:
    """Record the next scientific decision and why (cite experiment ids and posteriors)."""
    return lab.record_decision(decision, rationale, next_experiment, _actor())


@tool
def register_hypothesis(hypothesis_id: str, statement: str, h0: str, family: str,
                        feature_set: str | None = None, baseline_feature_set: str | None = None,
                        controller: str | None = None, comparator: str | None = None) -> dict:
    """Register a new agent-generated hypothesis (labelled origin=agent, prior 0.5). It must be
    testable as written. family 'prediction': feature_set is compared with baseline_feature_set
    (default 'fitness'); both must exist in list_design_space. family 'control': controller is
    compared with comparator ('best_baseline' by default, or a specific controller such as a
    rate-matched 'B0_fixed_x0.8')."""
    return lab.register_hypothesis(hypothesis_id, statement, h0, family, feature_set, controller, _actor(),
                                   baseline_feature_set=baseline_feature_set, comparator=comparator)


@tool
def propose_protocol(title: str, hypotheses: list[str], design: str, measurements: str, comparator: str,
                     falsifier: str, sample_size: str, cost_estimate: str, risks: str) -> dict:
    """Open mode only: record a concrete study protocol that would test registered
    hypotheses (family 'open'). This lab cannot execute it; it is recorded as
    PROPOSED, never as a result. design: units, arms, randomisation/blinding or
    identification strategy. measurements: primary outcome and how it is measured.
    comparator: the control or baseline. falsifier: the result that would refute the
    hypothesis and the smallest effect that matters. sample_size: size and its
    justification (power or precision). cost_estimate: rough time/money/compute.
    risks: main threats to validity and ethics/safety constraints."""
    return lab.propose_protocol({"title": title, "hypotheses": hypotheses, "design": design,
                                 "measurements": measurements, "comparator": comparator, "falsifier": falsifier,
                                 "sample_size": sample_size, "cost_estimate": cost_estimate, "risks": risks},
                                _actor())


@tool
def search_literature(query: str, max_results: int = 6, mode: str = "relevance") -> list[dict]:
    """Search OpenAlex (peer-reviewed literature across disciplines). mode 'relevance' ranks
    by match; mode 'most_cited' returns title/abstract matches most-cited first, to find
    the canonical work on a topic (judge topical relevance yourself). Each work carries
    credibility facts: peer-review status, citations, venue type, retraction."""
    return search_works(query, max_results, mode)


@tool
def search_arxiv_papers(query: str, max_results: int = 6) -> list[dict]:
    """Search arXiv (preprints in AI, optimisation, evolutionary computation). Returns
    arxiv_id, title, year, authors, abstract. Throttled to arXiv's 1 request / 3 s."""
    return search_arxiv(query, max_results)


@tool
def record_evidence(source_id: str, cited_title: str, claim: str, relation: str, limitation: str,
                    hypothesis_id: str | None = None) -> dict:
    """Record literature evidence from OpenAlex (source_id 'W...') or arXiv (e.g.
    '2101.00001'). The record is re-fetched from its source and its title must match
    cited_title (the title you read in the search results), so a mistyped id that points
    at a different paper is rejected. Retracted works are refused. What is verified is the
    SOURCE (identity and metadata); the claim is stored as YOUR summary and is not checked
    against the paper, so write only what the abstract you read actually supports.
    limitation: the source's main limitation for this claim (design, system studied,
    comparator, size) — required, as in an evidence map.
    relation: supports | contradicts | context | method | baseline."""
    if not limitation.strip():
        raise ValueError("state the source's main limitation for this claim")
    if relation not in EVIDENCE_RELATIONS:
        raise ValueError(f"relation must be one of {EVIDENCE_RELATIONS}")
    if is_arxiv_id(source_id):
        w = fetch_arxiv(source_id)
        ids = {"arxiv_id": w["arxiv_id"], "url": w["url"]}
    else:
        w = fetch_work(source_id)
        ids = {"openalex_id": w["openalex_id"], "doi": w["doi"], "venue": w["venue"]}
    if title_similarity(cited_title, w["title"] or "") < TITLE_MATCH_MIN:
        raise ValueError(f"{source_id} is titled {w['title']!r}, which does not match the cited title "
                         f"{cited_title!r}; check the id")
    if w["credibility"]["retracted"]:
        raise ValueError(f"{source_id} is retracted and cannot be used as evidence")
    payload = {**ids, "title": w["title"], "year": w["year"], "authors": w["authors"], "claim": claim,
               "claim_origin": "agent summary", "relation": relation, "hypothesis_id": hypothesis_id,
               "limitation": limitation, "credibility": w["credibility"],
               "source_excerpt": (w["abstract"] or "")[:600]}
    Ledger(lab.lab_root()).append("evidence_recorded", payload, _actor())
    return {"recorded": ids.get("openalex_id") or ids.get("arxiv_id"), "title": w["title"], "year": w["year"],
            "credibility": w["credibility"]["label"], "source_verified": True, "claim_verified": False,
            "note": "source identity and metadata verified; the claim is recorded as an agent summary"}


def _await_human_approval(eid: str | None) -> None:
    """Human approval gate for the Muse Code runtime (the Omnigent bundle uses
    its ASK policy instead). A confirmatory run on held-out landscapes writes
    <lab>/approvals/<id>.json as `pending` and waits for a human decision made
    in the UI (bridge POST /lab/approvals). No answer within the wait = declined."""
    from .muse import log_activity, run_config
    from .policies import approve_confirmatory_runs

    verdict = approve_confirmatory_runs({"type": "tool_call", "data": {"name": "run_experiment"}})
    if verdict.get("result") != "ASK":
        return
    root = lab.lab_root()
    wait = float(run_config(root).get("approval_wait_sec", 600))
    path = root / "approvals" / f"{eid}.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({"id": eid, "status": "pending", "reason": verdict["reason"],
                                "requested_by": _actor(), "requested_at": time.time()}), encoding="utf-8")
    log_activity(root, {"kind": "approval", "agent": _actor(), "id": eid, "state": "pending",
                        "text": verdict["reason"]})
    deadline = time.time() + wait
    status = "pending"
    while time.time() < deadline:
        status = json.loads(path.read_text(encoding="utf-8")).get("status", "pending")
        if status != "pending":
            break
        time.sleep(1.0)
    if status == "pending":
        rec = json.loads(path.read_text(encoding="utf-8"))
        rec.update(status="declined", decided_by="timeout (fail closed)", decided_at=time.time())
        path.write_text(json.dumps(rec), encoding="utf-8")
        status = "declined"
    log_activity(root, {"kind": "approval", "agent": "human", "id": eid, "state": status,
                        "text": f"{eid}: {status}"})
    if status != "approved":
        raise PermissionError(f"{eid} was not approved by a human ({status}); held-out data was not used")


class DelegateTask(BaseModel):
    agent: Literal["literature", "designer", "critic"]
    title: str = Field(description="short task title, e.g. lit-review, design-round-1, critique-E2")
    instructions: str = Field(description="self-contained instructions; the specialist does not see your conversation")


@tool
def delegate(tasks: list[DelegateTask]) -> dict:
    """Hand tasks to specialist agents (literature, designer, critic). Tasks in one
    call run in parallel, each as its own Muse Code agent with its own lab tools;
    returns each specialist's final report plus the run's spend so far. Each
    report passes the Noesis escalation gate; when it fires, a verifier agent
    (stronger model) checks the report against the lab record and `escalation`
    carries its verdict (CONFIRMED / CORRECTED / REJECTED) and report.

    Soft spend guard: refuses NEW hand-offs once the run's recorded, estimated
    spend reaches `ceiling_usd`. It is not a hard cap: costs are only counted
    when an agent finishes, so specialists started together in one call (and
    the PI's own calls) can take the final spend past the guard."""
    from .muse import log_activity, run_agent, run_config, run_usage

    root = lab.lab_root()
    rec_path = root / "run.json"
    ceiling = json.loads(rec_path.read_text(encoding="utf-8")).get("ceiling_usd") if rec_path.exists() else None
    spent = run_usage(root)["cost_usd"]
    if ceiling is not None and spent >= float(ceiling):
        return {"refused": True, "reason": f"soft spend guard reached (estimated ${spent:.4f} of ${float(ceiling):.2f}); "
                                           "write the final report from what is recorded", "spent_usd": spent}
    cfg = run_config(root)
    gate = _load_escalation_gate(cfg)

    def one(task: DelegateTask) -> dict:
        log_activity(root, {"kind": "handoff", "from": _actor(), "to": task.agent, "title": task.title,
                            "state": "running"})
        t0 = time.time()
        seq0 = len(Ledger(root).events())
        try:
            out = run_agent(task.agent, task.instructions, root, title=task.title, config=cfg)
        finally:
            log_activity(root, {"kind": "handoff", "from": _actor(), "to": task.agent, "title": task.title,
                                "state": "finished"})
        result = {"agent": task.agent, "title": task.title, "terminal": out["terminal"],
                  "exit_code": out["exit_code"], "report": out["text"], "cost_usd": out["cost_usd"]}
        if gate is not None and "verifier" in cfg.get("roles", {}):
            result["escalation"] = _escalate(task, out, t0, cfg, gate)
            _record_analysis_verification(root, task.agent, seq0, result["escalation"], cfg)
        return result

    with ThreadPoolExecutor(max_workers=max(1, len(tasks))) as pool:
        reports = list(pool.map(one, tasks))
    return {"reports": reports, "spent_usd": run_usage(root)["cost_usd"], "ceiling_usd": ceiling}


def _load_escalation_gate(cfg: dict) -> dict | None:
    from .agent_escalation import load_gate
    from .muse import MUSE_AGENTS

    esc = cfg.get("escalation") or {}
    if not esc.get("enabled"):
        return None
    return load_gate(MUSE_AGENTS / esc.get("gate_file", "escalation_gate.json"))


def _escalate(task: "DelegateTask", out: dict, t0: float, cfg: dict, gate: dict) -> dict:
    """Noesis gate on one specialist report; runs the Wonder verifier agent if it fires."""
    from .agent_escalation import decide, parse_verdict, verify_task
    from .muse import log_activity, read_jsonl, run_agent

    root = lab.lab_root()
    tool_errors = sum(1 for a in read_jsonl(root / "activity.jsonl")
                      if a.get("kind") == "tool" and a.get("agent") == task.agent and a.get("ok") is False
                      and float(a.get("t") or 0) >= t0)
    d = decide(task.agent, task.title, task.instructions, out, tool_errors, cfg, gate)
    log_activity(root, {"kind": "gate", "agent": task.agent, "title": task.title,
                        "decision": "escalate" if d["escalate"] else "accept", "reasons": d["reasons"],
                        "family": d["family"], "ucb": d["ucb"], "threshold": d["threshold"],
                        "verifier_model": cfg["roles"]["verifier"]["model"] if d["escalate"] else None})
    if not d["escalate"]:
        return {**d, "verdict": None}
    vtitle = f"verify: {task.title}"
    log_activity(root, {"kind": "handoff", "from": task.agent, "to": "verifier", "title": vtitle, "state": "running"})
    try:
        v = run_agent("verifier", verify_task(task.agent, task.title, task.instructions, out["text"]), root,
                      title=vtitle, config=cfg)
    finally:
        log_activity(root, {"kind": "handoff", "from": task.agent, "to": "verifier", "title": vtitle,
                            "state": "finished"})
    verdict = parse_verdict(v["text"])
    log_activity(root, {"kind": "gate", "agent": "verifier", "title": vtitle, "decision": "verdict",
                        "verdict": verdict, "reasons": d["reasons"], "family": d["family"]})
    return {**d, "verdict": verdict, "verifier_report": v["text"], "verifier_cost_usd": v["cost_usd"]}


def _record_analysis_verification(root, agent: str, seq0: int, esc: dict, cfg: dict) -> None:
    """Attach the gate/verifier outcome to every analysis this agent recorded during its task.

    Ordering: the critic's record_analysis is written (and the deterministic posterior
    update applied) while the critic runs; the gate and the Wonder verifier only see the
    finished report. This event makes the verification state of that analysis explicit:
    not_escalated (gate accepted it unverified), confirmed, corrected (with the
    verifier's correction), rejected or unparsed. Until it lands, an analysis is
    'unverified'."""
    led = Ledger(root)
    mine = [e for e in led.events() if e["seq"] > seq0 and e["type"] == "analysis_recorded" and e["actor"] == agent]
    if not mine:
        return
    if not esc.get("escalate"):
        status, note = "not_escalated", None
    else:
        status = (esc.get("verdict") or "UNPARSED").lower()
        note = (esc.get("verifier_report") or "")[:4000] or None
    for e in mine:
        led.append("analysis_verification", {
            "id": e["payload"]["id"], "status": status, "reasons": esc.get("reasons", []),
            "verifier_model": cfg["roles"]["verifier"]["model"] if esc.get("escalate") else None,
            "verifier_report": note,
        }, "noesis.gate")


class ToolAllowListError(ValueError):
    pass


def _restrict_to_allow_list() -> None:
    """Serve only the role's allow-listed tools (DISCOLAB_TOOLS, comma-separated).

    Fails closed: if DISCOLAB_TOOLS is missing, empty, or names a tool that does not
    exist, every tool is removed and ToolAllowListError is raised. The server never
    falls back to exposing all tools."""
    raw = os.environ.get("DISCOLAB_TOOLS")
    allowed = {t.strip() for t in (raw or "").split(",") if t.strip()}
    names = [t.name for t in mcp._tool_manager.list_tools()]
    unknown = sorted(allowed - set(names))
    problem = ("DISCOLAB_TOOLS is not set" if raw is None else "DISCOLAB_TOOLS is empty" if not allowed
               else f"DISCOLAB_TOOLS names unknown tools: {', '.join(unknown)}" if unknown else None)
    for name in names:
        if problem or name not in allowed:
            mcp.remove_tool(name)
    if problem:
        raise ToolAllowListError(f"{problem}; refusing to serve any lab tool")


if __name__ == "__main__":
    try:
        _restrict_to_allow_list()
    except ToolAllowListError as exc:
        print(f"discolab.mcp_server: {exc}", file=sys.stderr)
        sys.exit(2)
    mcp.run()
