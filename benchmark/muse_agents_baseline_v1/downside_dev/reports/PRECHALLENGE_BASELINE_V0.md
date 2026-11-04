# Architecture Baseline v0

This report is a prior over architecture behavior, not evidence about the future challenge.

## Provenance

- Benchmark version: muse-agents-baseline-v1
- Benchmark date: 2026-11-03
- Split: dev
- Confidence level: 95%
- Raw execution observations: 240
- Models observed: 5
- Architectures observed: 5

## Efficient sets

- Empirical frontier: S0, S1
- Robust frontier: S0, S1, S2, S3, S4
- Statistically unresolved candidates: S0, S1, S2, S3, S4

A point-estimate difference is not described as significant unless its paired/bounded evidence supports it.

## Marginal agent economics

- Components justified by measured baseline: none measured
- Components not justified by measured baseline: none measured

## Diversification diagnostics

- Pair-selection strategies compared: 4
- Joint-failure figures are complementarity diagnostics, not synthesized architecture scores.

## Conditional verification and stress

- Routing scenarios recorded: 0
- Stress scenarios recorded: 0

## Bayesian-update-ready priors

- Prior records exported: 65
- Effective generic prior strength: 4.0
- Challenge-specific evidence is expected to dominate these deliberately weak priors quickly.

## Limitations

- Conclusions are conditional on the measured cases, models, prompts, and runtime conditions.
- CVaR entries with insufficient tail observations are explicitly labeled unstable.
- Fractional allocation weights represent routing probabilities, never partially executed agents.
- Security, privacy, and capability constraints remain hard constraints outside every utility tradeoff.

# Architecture Baseline Cards

## Architecture S0

- Mean quality: 0.8958333333333334
- Quality interval: [0.8125, 0.9792] at 95%
- Cost/request: 0.06302308333333333
- Latency p50 / p95: 2818.67 / 3341.21 ms
- Severe failure rate: 0.1042
- CVaR90 loss: 0.10416666666666667
- Empirical Pareto status: efficient
- Robust Pareto status: robust_frontier
- Best measured task types: classification, code_understanding_debugging, evidence_verification
- Weak measured task types: uncertainty_abstention, critique, tool_use_reasoning
- Primary failure modes: unknown
- Correlation comparisons: 9
- Marginal component evaluations: 0

## Architecture S1

- Mean quality: 0.8958333333333334
- Quality interval: [0.7917, 0.9792] at 95%
- Cost/request: 0.019737406250000002
- Latency p50 / p95: 2901.34 / 4629.79 ms
- Severe failure rate: 0.1042
- CVaR90 loss: 0.10416666666666667
- Empirical Pareto status: efficient
- Robust Pareto status: robust_frontier
- Best measured task types: classification, code_understanding_debugging, evidence_verification
- Weak measured task types: uncertainty_abstention, critique, tool_use_reasoning
- Primary failure modes: unknown
- Correlation comparisons: 9
- Marginal component evaluations: 0

## Architecture S2

- Mean quality: 0.8958333333333334
- Quality interval: [0.7917, 0.9792] at 95%
- Cost/request: 0.08276048958333333
- Latency p50 / p95: 5702.72 / 7809.71 ms
- Severe failure rate: 0.1042
- CVaR90 loss: 0.10416666666666667
- Empirical Pareto status: dominated
- Robust Pareto status: robust_frontier
- Best measured task types: classification, code_understanding_debugging, evidence_verification
- Weak measured task types: uncertainty_abstention, critique, tool_use_reasoning
- Primary failure modes: unknown
- Correlation comparisons: 9
- Marginal component evaluations: 0

## Architecture S3

- Mean quality: 0.8958333333333334
- Quality interval: [0.7917, 0.9792] at 95%
- Cost/request: 0.05127948958333334
- Latency p50 / p95: 4113.13 / 7809.71 ms
- Severe failure rate: 0.1042
- CVaR90 loss: 0.10416666666666667
- Empirical Pareto status: dominated
- Robust Pareto status: robust_frontier
- Best measured task types: classification, code_understanding_debugging, evidence_verification
- Weak measured task types: uncertainty_abstention, critique, tool_use_reasoning
- Primary failure modes: unknown
- Correlation comparisons: 9
- Marginal component evaluations: 0

## Architecture S4

- Mean quality: 0.8958333333333334
- Quality interval: [0.8125, 0.9792] at 95%
- Cost/request: 0.07290480208333333
- Latency p50 / p95: 3880.59 / 7809.71 ms
- Severe failure rate: 0.1042
- CVaR90 loss: 0.10416666666666667
- Empirical Pareto status: dominated
- Robust Pareto status: robust_frontier
- Best measured task types: classification, code_understanding_debugging, evidence_verification
- Weak measured task types: uncertainty_abstention, critique, tool_use_reasoning
- Primary failure modes: unknown
- Correlation comparisons: 9
- Marginal component evaluations: 0
