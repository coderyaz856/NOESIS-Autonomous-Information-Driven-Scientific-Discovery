> **Muse-only rerun** of the frozen pre-challenge Architecture Baseline v0 pipeline (`backend/app/benchmark/baseline_execute.py`, unchanged). Model slots: Qwen → Spark 1.3, GPT-OSS → Wonder 1.0, DeepSeek → Spark 1.2; diagnosis probes all four Muse models. Raw artifacts: `benchmark/muse_baseline_v1/benchmark/artifacts/baseline_v0/`. Deviations from v0 are listed in the frozen manifest.

# Architecture Baseline v0 — FROZEN

This report leads with measured evidence. Offline replay and provider-backed confirmation are reported separately.

## Headline finding

Spark 1.3 only (S1) reached the best held-out quality observed (0.833) at the lowest cost per case; empirical Pareto frontier: S1. Escalating to a second Muse model bought no measured quality on this corpus.

Spark 1.3 → selective Wonder 1.0 escalation (S3) matched always-both (S2) held-out quality (0.833 vs 0.833) with 42.8% less estimated cost and 27.2% less latency in offline replay (negative = more).

Provider-backed confirmation of S3: 6 escalations, 2 rescue opportunities, 0 rescues, 0 damaged answers on the 12-case held-out set. All paired quality differences remain statistically unresolved at 95%.

## Provider diagnosis

| Provider/model | Result | Safe classification | HTTP status |
|---|---|---|---:|
| meta/muse-spark-1.3 | success | available | — |
| meta/muse-spark-1.2 | success | available | — |
| meta/muse-spark-1.1 | success | available | — |
| meta/muse-wonder-1.0 | success | available | — |

## Single-model evidence (72 identical cases each)

| Provider/model | Availability (95% Wilson) | Correct given success (95% Wilson) | Operational correct | Severe operational failure | Mean latency on success (ms) |
|---|---:|---:|---:|---:|---:|
| meta/muse-spark-1.2 | 0.986 [0.925, 0.998] | 0.845 [0.743, 0.911] | 0.833 | 0.167 | 1474.4 |
| meta/muse-spark-1.3 | 1.000 [0.949, 1.000] | 0.875 [0.779, 0.933] | 0.875 | 0.125 | 2306.3 |
| meta/muse-wonder-1.0 | 1.000 [0.949, 1.000] | 0.875 [0.779, 0.933] | 0.875 | 0.125 | 1844.7 |

## Held-out S0–S4 offline replay (12 sealed cases)

These are counterfactual replay estimates from paired cached single-model observations, not executed multi-agent architectures.

| Policy | Quality (95% bootstrap) | Cost/case (USD) | Latency/case (ms) | Failure rate | Tail risk | Empirical Pareto | Robust Pareto |
|---|---:|---:|---:|---:|---:|---|---|
| S0 | 0.833 [0.583, 1.000] | 0.00172167 | 2212.3 | 0.167 | 1.000 | no | yes |
| S1 | 0.833 [0.583, 1.000] | 0.00050898 | 2178.3 | 0.167 | 1.000 | yes | yes |
| S2 | 0.833 [0.583, 1.000] | 0.00223065 | 4390.6 | 0.167 | 1.000 | no | yes |
| S3 | 0.833 [0.583, 1.000] | 0.00127598 | 3197.6 | 0.167 | 1.000 | no | yes |
| S4 | 0.833 [0.583, 1.000] | 0.00198769 | 3306.9 | 0.167 | 1.000 | no | yes |

## Selective-escalation economics (offline replay)

| Policy | Escalation | Rescue | Damage | Δ quality | Δ cost | Δ latency (ms) | Saving vs always-both |
|---|---:|---:|---:|---:|---:|---:|---:|
| S3 vs S1 | 0.500 | 0.000 | 0.000 | 0.000 | 0.00076700 | 1019.3 | 0.00095467 |
| S4 vs S0 | 0.500 | 0.000 | 0.000 | 0.000 | 0.00026602 | 1094.6 | 0.00024296 |
| S2 vs S1 | 1.000 | 0.000 | 0.000 | 0.000 | 0.00172167 | 2212.3 | 0.00000000 |

## Provider-backed verifier confirmation

These rows are actual verifier calls on top of cached first-pass held-out observations. They are not offline replay.

| Policy | n | Quality (95% Wilson) | Escalations | Rescues | Damage |
|---|---:|---:|---:|---:|---:|
| S3_PROVIDER_BACKED | 12 | 0.833 [0.552, 0.953] | 6 | 0 | 0 |
| S4_PROVIDER_BACKED | 12 | 0.833 [0.552, 0.953] | 6 | 0 | 0 |

## Failure diversification

| Pair | Error correlation (95% bootstrap) | Failure Jaccard | P(right succeeds | left fails) |
|---|---:|---:|---:|
| meta/muse-spark-1.2@A0 ↔ meta/muse-spark-1.3@A0 | 0.732 [0.471, 0.919] | 0.615 | 0.333 [0.077, 0.625] |
| meta/muse-spark-1.2@A0 ↔ meta/muse-wonder-1.0@A0 | 0.845 [0.643, 1.000] | 0.750 | 0.250 [0.000, 0.530] |
| meta/muse-spark-1.3@A0 ↔ meta/muse-wonder-1.0@A0 | 0.873 [0.649, 1.000] | 0.800 | 0.111 [0.000, 0.375] |

## What remains unresolved

- S2 versus S1 quality remains unresolved at 95% confidence.
- S3 versus S1 quality remains unresolved at 95% confidence.
- S4 versus S0 quality remains unresolved at 95% confidence.
- Held-out n=12 is deliberately compact; tail-risk and rescue estimates remain wide.

## Frozen weak priors

Prior strength κ=4.0 (maximum 5.0). The challenge data is intentionally able to overturn these generic priors quickly.

## Execution boundary

Actual inference calls: 232 / 250. Provider requests: 232 / 251. Conservative reserved spend (worst-case token caps): $1.07812800 / $3.00; actual token-estimated spend: $0.21667650. Calls per model: muse-spark-1.1 1, muse-spark-1.2 73, muse-spark-1.3 79, muse-wonder-1.0 79.

Meta Model API, Standard mode, temperature 0, `reasoning_effort=minimal`, concurrency 1. Only the approved phases ran (diagnosis, 72-case single-model baseline, S0–S4 offline replay, compact provider-backed verifier confirmation).
