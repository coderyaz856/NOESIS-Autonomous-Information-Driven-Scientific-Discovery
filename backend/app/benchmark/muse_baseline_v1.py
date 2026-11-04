"""Rerun the pre-challenge Architecture Baseline v0 pipeline on Meta Muse models only.

This does NOT reimplement the benchmark. It runs the frozen pipeline in
``baseline_execute.execute`` unchanged (corpus, SCORING_V1, prompt, 256/1024
token caps, gate fitting on dev+tuning, sealed held-out, S0-S4 offline replay,
provider-backed verifier confirmation, reliability, error covariance /
complementarity with bootstrap intervals and shrinkage, confidence bounds,
dominance, robust Pareto frontier, tail risk, escalation economics, weak
priors, report). Only the model-specific bindings are swapped:

    v0 slot            Muse model                 role in the pipeline
    groq qwen          meta/muse-spark-1.3        S1, cheap first model of S3
    groq gpt-oss       meta/muse-wonder-1.0       S0, verifier of S3
    openrouter dsv4    meta/muse-spark-1.2        third core model (covariance, priors)
    claude/gemini dx   one probe per Muse model   provider diagnosis

Two deviations, both recorded in the manifest:
* limits: v0 approved $0.20 / 245 calls for its cheap models; this rerun uses
  a $3.00 hard ceiling (expected ~$0.40) and 250 calls;
* the plan step (budget table) is priced with Muse list prices.

Outputs go to ``benchmark/muse_baseline_v1/`` (its own root, so the frozen v0
artifacts are never touched); the report is copied to
``benchmark/reports/MUSE_BASELINE_V1.md`` with Muse model names.

Usage (from backend/):  python -m app.benchmark.muse_baseline_v1 --root ..
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
from pathlib import Path
from typing import Any

from ..instrumentation.pricing import PricingTable
from . import baseline_execute as bx
from . import baseline_plan
from .controls import BenchmarkLimits
from .corpus import build_generic_prior_v0
from .pilot import PilotModelSpec, build_provider
from .policies import RECONCILIATION_V1, EscalationPolicy

DIAGNOSIS = ("muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1", "muse-wonder-1.0")

# Two harnesses, same frozen pipeline:
#   api   - one Meta Model API chat completion per slot (control);
#   agent - one headless Muse Code agent (Meta's agent harness, no tools) per slot.
HARNESSES: dict[str, dict[str, Any]] = {
    "api": {
        "provider": "meta",
        "root": "muse_baseline_v1",
        "report": "MUSE_BASELINE_V1.md",
        "ceiling_usd": 3.00,
        "title": "Muse-only rerun (Meta Model API calls)",
        "protocol": "Meta Model API chat completions, Standard mode, temperature 0, `reasoning_effort=minimal`, "
                    "256 output tokens, concurrency 1.",
        "deviations": [
            "models: Meta Muse only (see module docstring for the slot mapping)",
            "limits: $3.00 / 250 calls instead of $0.20 / 245 (Muse list prices are higher than v0's models)",
            "reasoning_effort=minimal sent on every call (Model API reasoning tokens count against the 256-token cap)",
        ],
    },
    "agent": {
        "provider": "muse_agent",
        "root": "muse_agents_baseline_v1",
        "report": "MUSE_AGENTS_BASELINE_V1.md",
        "ceiling_usd": 12.00,
        "title": "Muse Code agents in every slot",
        "protocol": "each slot is one headless Muse Code 1.4 agent (`muse exec`, preset `empty`, shell/write/web/"
                    "MCP tools disabled, `reasoning_effort=minimal`, at most 2 model steps), Meta Model API Standard "
                    "mode, concurrency 1. Muse Code exposes no temperature or max-token control.",
        "deviations": [
            "solver/verifier slots are Muse Code agents, not single chat completions",
            "temperature and the 256-token output cap are not settable through Muse Code; harness defaults apply",
            "each agent call carries ~15.5k harness input tokens (measured), so the controller's 1024/256-token "
            "projection understates cost; an actual-spend guard (cached-aware) enforces the $12.00 ceiling",
            "limits: $12.00 / 250 calls",
        ],
    },
}
CFG: dict[str, Any] = HARNESSES["api"]
SPARK13 = "meta/muse-spark-1.3"
WONDER = "meta/muse-wonder-1.0"
CORE: tuple[PilotModelSpec, ...] = ()
LIMITS: BenchmarkLimits | None = None


def configure(harness: str) -> None:
    """Point every model-specific name at one harness."""
    global CFG, SPARK13, WONDER, CORE, LIMITS
    CFG = HARNESSES[harness]
    prov = CFG["provider"]
    SPARK13 = f"{prov}/muse-spark-1.3"
    WONDER = f"{prov}/muse-wonder-1.0"
    CORE = (PilotModelSpec(prov, "muse-wonder-1.0"), PilotModelSpec(prov, "muse-spark-1.3"),
            PilotModelSpec(prov, "muse-spark-1.2"))
    LIMITS = BenchmarkLimits(max_benchmark_spend_usd=CFG["ceiling_usd"], max_total_calls=250,
                             max_calls_per_model=None, max_concurrency=1, max_provider_requests=251)
    if harness == "agent":
        from ..providers.muse_agent import SPEND_GUARD

        SPEND_GUARD.ceiling_usd = CFG["ceiling_usd"]


configure("api")
SIGNALS = ("schema_or_constraint_failure", "explicit_abstention", "task_risk_level",
           "historical_task_family_error_ucb", "task_family")
RENAME = (("Qwen → selective GPT-OSS", "Spark 1.3 → selective Wonder 1.0"),
          ("GPT-OSS → selective Qwen", "Wonder 1.0 → selective Spark 1.3"),
          ("GPT-OSS", "Wonder 1.0"), ("Qwen", "Spark 1.3"))


def muse_policies() -> tuple[EscalationPolicy, ...]:
    """baseline_policies_v0 with the Muse models in the same slots and ids."""
    return (
        EscalationPolicy("S0", "Wonder 1.0 only", WONDER, None, "never", (), "first_answer"),
        EscalationPolicy("S1", "Spark 1.3 only", SPARK13, None, "never", (), "first_answer"),
        EscalationPolicy("S2", "Always Wonder 1.0 + Spark 1.3", SPARK13, WONDER, "always", (), RECONCILIATION_V1),
        EscalationPolicy("S3", "Spark 1.3 then selective Wonder 1.0", SPARK13, WONDER, "conditional", SIGNALS, RECONCILIATION_V1),
        EscalationPolicy("S4", "Wonder 1.0 then selective Spark 1.3", WONDER, SPARK13, "conditional", SIGNALS, RECONCILIATION_V1),
    )


async def muse_diagnosis(pricing: PricingTable, controller, path: Path) -> list[dict[str, Any]]:
    """Same `_diagnostic_call` as v0 (64-token cap), one probe per Muse model."""
    rows = []
    for model in DIAGNOSIS:
        row = await bx._diagnostic_call(PilotModelSpec(CFG["provider"], model), "Return only OK.", pricing, controller)
        rows.append(row)
        bx._append_jsonl(path, row)
    return rows


def muse_budget(pricing: PricingTable) -> dict[str, Any]:
    cost = lambda m, n, i, o: pricing.estimate_cost(m, i, o) * n  # noqa: E731
    diagnosis = sum(cost(m, 1, 256, 64) for m in DIAGNOSIS)
    core = sum(cost(s.model, 72, 1024, 256) for s in CORE)
    confirm = cost("muse-wonder-1.0", 12, 1024, 256) + cost("muse-spark-1.3", 12, 1024, 256)
    return {"version": "muse-baseline-v1-budget", "pricing_source": "benchmark/configs/pricing_meta_v1.json",
            "phases": {"provider_diagnosis": {"inference_calls": len(DIAGNOSIS), "dollar_ceiling": diagnosis},
                       "core_72_case_single_model_baseline": {"inference_calls": 216, "dollar_ceiling": core},
                       "compact_provider_backed_verifier_confirmation": {"inference_calls": 24, "dollar_ceiling": confirm}},
            "worst_case_total_usd": diagnosis + core + confirm,
            "hard_ceiling_usd": LIMITS.max_benchmark_spend_usd}


def muse_freeze_manifest(root: Path, protocol: dict[str, Any], pricing: PricingTable) -> Path:
    """v0 `_freeze_manifest` with the Muse budget; same manifest structure and corpus."""
    bench = root / "benchmark"
    cases = build_generic_prior_v0()
    budget = muse_budget(pricing)
    manifest = baseline_plan.build_protocol_manifest(cases, protocol, budget)
    manifest["status"] = "APPROVED_FROZEN"
    manifest["execution_authorization"] = {
        "approved_at": bx._utc_now(),
        "approved_by": "project owner (session instruction: rerun the pre-hackathon benchmark on Muse models only)",
        "approved_phases": ["provider_diagnosis", "core_72_case_single_model_baseline",
                            "s0_to_s4_offline_replay", "compact_provider_backed_verifier_confirmation"],
        "max_benchmark_spend_usd": LIMITS.max_benchmark_spend_usd,
        "max_total_inference_calls": LIMITS.max_total_calls,
        "max_provider_requests": LIMITS.max_provider_requests,
        "max_concurrency": 1,
        "harness": CFG["title"],
        "deviations_from_v0": list(CFG["deviations"]),
    }
    manifest.setdefault("observations", {})["status"] = "NOT_RUN"
    path = bench / "cases" / "pre_challenge_baseline_v0_manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")
    (bench / "configs" / "prechallenge_budget_v0.json").write_text(json.dumps(budget, indent=2) + "\n", encoding="utf-8")
    return path


def _preflight_build(spec: PilotModelSpec):
    """execute() pre-constructs the v0 diagnosis providers (Claude/Gemini). They are
    never called in this rerun (diagnosis is replaced), so only Meta providers are built."""
    return build_provider(spec) if spec.provider in ("meta", "muse_agent") else None


def prepare_root(repo: Path) -> Path:
    root = repo / "benchmark" / CFG["root"]
    configs = root / "benchmark" / "configs"
    if (root / "benchmark" / "artifacts").exists():
        raise RuntimeError(f"{root} already has artifacts; refusing to rerun over them")
    configs.mkdir(parents=True, exist_ok=True)
    (root / "benchmark" / "reports").mkdir(parents=True, exist_ok=True)  # execute() writes its report here
    protocol = json.loads((repo / "benchmark" / "configs" / "prechallenge_baseline_v0.json").read_text(encoding="utf-8"))
    protocol["version"] = f"pre-challenge-baseline-v0-protocol ({CFG['title']})"
    protocol["harness"] = CFG["protocol"]
    protocol["core_models"] = [{"provider": s.provider, "model": s.model} for s in CORE]
    protocol["conditional_models"] = []
    protocol["provider_diagnosis"] = {"models": list(DIAGNOSIS), "input_token_cap": 256, "output_token_cap": 64,
                                      "prompt": "Return only OK."}
    (configs / "prechallenge_baseline_v0.json").write_text(json.dumps(protocol, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(repo / "benchmark" / "configs" / "pricing_meta_v1.json", configs / "pricing_v0.json")
    return root


def bind() -> None:
    """Swap only the model-specific names the frozen pipeline looks up at call time."""
    bx.CORE_SPECS = CORE
    bx.QWEN = SPARK13
    bx.GPT_OSS = WONDER
    bx.APPROVED_LIMITS = LIMITS
    bx.baseline_policies_v0 = muse_policies
    baseline_plan.baseline_policies_v0 = muse_policies
    bx._run_provider_diagnosis = muse_diagnosis
    bx._freeze_manifest = muse_freeze_manifest
    bx.build_provider = _preflight_build


def computed_headline(summary: dict[str, Any]) -> list[str]:
    """The v0 renderer's headline is fixed prose describing v0's outcome; this states
    the Muse outcome from the summary numbers instead."""
    results = {r["architecture_id"]: r for r in summary["offline_replay"]["architecture_results"]}
    econ = {r["policy_id"]: r for r in summary["offline_replay"]["economics"]}
    s2, s3, e3 = results["S2"], results["S3"], econ["S3"]
    q2, q3 = float(s2["expected_quality"]), float(s3["expected_quality"])
    relation = "matched" if abs(q3 - q2) < 1e-9 else ("exceeded" if q3 > q2 else "fell below")
    cost_rate = (float(e3["cost_saving_vs_always_both_usd"]) / float(s2["cost"])
                 if e3.get("cost_saving_vs_always_both_usd") is not None and s2.get("cost") else None)
    lat_rate = float(e3["latency_saving_vs_always_both_ms"]) / float(s2["latency"]) if s2.get("latency") else None
    pct = lambda x: "n/a" if x is None else f"{100 * x:.1f}%"  # noqa: E731
    backed = {r["architecture_id"]: r for r in summary["provider_backed_confirmation"]}
    b3 = backed.get("S3_PROVIDER_BACKED", {})
    unresolved = all(c["statistically_unresolved_at_95_percent"]
                     for c in summary["offline_replay"]["paired_quality_comparisons"])
    frontier = list(summary["offline_replay"]["empirical_pareto_frontier"])
    best_q = max(float(r["expected_quality"]) for r in results.values())
    cheapest = min((r for r in results.values() if r.get("cost") is not None), key=lambda r: float(r["cost"]))
    names = {p.id: p.name for p in muse_policies()}
    lead = []
    if float(cheapest["expected_quality"]) >= best_q - 1e-9:
        lead = [f"{names.get(cheapest['architecture_id'], cheapest['architecture_id'])} "
                f"({cheapest['architecture_id']}) reached the best held-out quality observed ({best_q:.3f}) at the "
                f"lowest cost per case; empirical Pareto frontier: {', '.join(frontier)}. Escalating to a second "
                "Muse model bought no measured quality on this corpus.", ""]
    return lead + [
        f"Spark 1.3 → selective Wonder 1.0 escalation (S3) {relation} always-both (S2) held-out quality "
        f"({q3:.3f} vs {q2:.3f}) with {pct(cost_rate)} less estimated cost and {pct(lat_rate)} less latency "
        "in offline replay (negative = more).",
        "",
        f"Provider-backed confirmation of S3: {b3.get('escalations', 'n/a')} escalations, "
        f"{b3.get('rescue_opportunities', 'n/a')} rescue opportunities, {b3.get('rescues', 'n/a')} rescues, "
        f"{b3.get('damage', 'n/a')} damaged answers on the 12-case held-out set. "
        + ("All paired quality differences remain statistically unresolved at 95%."
           if unresolved else "At least one paired quality difference is resolved at 95%; see the comparisons below."),
        "",
    ]


def execution_boundary(summary: dict[str, Any]) -> str:
    """The v0 renderer prints v0's limits ($0.20 / 245) as fixed text; state this run's."""
    ex = summary["execution"]
    lim = ex["limits"]
    per_model = ", ".join(f"{m} {n}" for m, n in sorted(ex["calls_per_model"].items()))
    return (
        "## Execution boundary\n\n"
        f"Actual inference calls: {ex['inference_calls']} / {lim['max_total_calls']}. "
        f"Provider requests: {ex['provider_requests']} / {lim['max_provider_requests']}. "
        f"Conservative reserved spend (worst-case token caps): ${ex['reserved_spend_usd']:.8f} / "
        f"${lim['max_benchmark_spend_usd']:.2f}; actual token-estimated spend: ${ex['actual_estimated_spend_usd']:.8f}. "
        f"Calls per model: {per_model}.\n\n"
        f"{CFG['protocol']} "
        "Only the approved phases ran (diagnosis, 72-case single-model baseline, S0–S4 offline replay, "
        "compact provider-backed verifier confirmation).\n"
    )


def replace_headline(report: str, summary: dict[str, Any]) -> str:
    start = report.index("## Headline finding")
    end = report.index("## Provider diagnosis")
    return report[:start] + "## Headline finding\n\n" + "\n".join(computed_headline(summary)) + "\n" + report[end:]


def finish_existing(root: Path) -> None:
    """Zero-call completion of execute()'s final steps (report, checkpoint, manifest
    hashes), mirroring baseline_execute.execute line for line. Used when every
    provider phase finished and only the report write failed."""
    art = root / "benchmark" / "artifacts" / "baseline_v0"
    summary = json.loads((art / "baseline_v0_summary.json").read_text(encoding="utf-8"))
    reports = root / "benchmark" / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "PRECHALLENGE_BASELINE_V0.md").write_text(bx._report_markdown(summary), encoding="utf-8")
    checkpoint = json.loads((art / "execution_checkpoint.json").read_text(encoding="utf-8"))
    checkpoint["phase"] = "frozen_complete"
    bx._write_json(art / "execution_checkpoint.json", checkpoint)
    manifest_path = root / "benchmark" / "cases" / "pre_challenge_baseline_v0_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["status"] = "FROZEN_COMPLETE"
    manifest["observations"] = {
        "status": "FROZEN_COMPLETE",
        "completed_at": bx._utc_now(),
        "raw_observation_hashes": [
            {"path": str(path.relative_to(root)).replace("\\", "/"), "sha256": bx._file_hash(path)}
            for path in (art / name for name in (
                "provider_diagnosis.jsonl", "raw_single_model_runs.jsonl", "offline_replay_dev_tuning.jsonl",
                "offline_replay_held_out.jsonl", "provider_backed_verifier_held_out.jsonl",
                "frozen_gate_configuration.json", "baseline_v0_summary.json", "weak_priors.json"))
        ],
        "execution": summary["execution"],
        "note": "Frozen after the approved phases; no automatic continuation is permitted.",
    }
    bx._write_json(manifest_path, manifest)


def publish_report(repo: Path, root: Path) -> None:
    report = (root / "benchmark" / "reports" / "PRECHALLENGE_BASELINE_V0.md").read_text(encoding="utf-8")
    summary = json.loads((root / "benchmark" / "artifacts" / "baseline_v0" / "baseline_v0_summary.json")
                         .read_text(encoding="utf-8"))
    report = replace_headline(report, summary)
    report = report[:report.index("## Execution boundary")] + execution_boundary(summary)
    for old, new in RENAME:
        report = report.replace(old, new)
    header = (f"> **{CFG['title']}**: rerun of the frozen pre-challenge Architecture Baseline v0 pipeline "
              "(`backend/app/benchmark/baseline_execute.py`, unchanged). Slots: Qwen → Spark 1.3, "
              "GPT-OSS → Wonder 1.0, DeepSeek → Spark 1.2; diagnosis probes all four Muse models. "
              f"Protocol: {CFG['protocol']} "
              f"Raw artifacts: `benchmark/{CFG['root']}/benchmark/artifacts/baseline_v0/`. "
              "Deviations from v0 are listed in the frozen manifest.\n\n")
    (repo / "benchmark" / "reports" / CFG["report"]).write_text(header + report, encoding="utf-8")
    print(f"complete; report: benchmark/reports/{CFG['report']}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", required=True, help="repository root")
    ap.add_argument("--finish-existing", action="store_true",
                    help="zero provider calls: write the report and freeze the manifest of a completed collection")
    ap.add_argument("--harness", choices=sorted(HARNESSES), default="api",
                    help="api: one Model API call per slot; agent: one Muse Code agent per slot")
    args = ap.parse_args()
    configure(args.harness)
    repo = Path(args.root).resolve()
    root = repo / "benchmark" / CFG["root"]
    bind()
    if args.finish_existing:
        finish_existing(root)
    else:
        prepare_root(repo)
        asyncio.run(bx.execute(root))
    publish_report(repo, root)


if __name__ == "__main__":
    main()
