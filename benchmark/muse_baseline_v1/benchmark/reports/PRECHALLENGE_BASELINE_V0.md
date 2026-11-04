# Architecture Baseline v0 — FROZEN

This report leads with measured evidence. Offline replay and provider-backed confirmation are reported separately.

## Headline finding

Qwen → selective GPT-OSS escalation matched always-both held-out quality (0.833) while using 42.8% less estimated cost and 27.2% less latency in offline replay.

This is an efficiency result, not evidence of a quality gain: the provider-backed confirmation produced zero rescues and zero damage on this 12-case held-out set, and the paired quality differences remain statistically unresolved.

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

Actual inference calls: 232 / 245. Provider requests: 232 / 246. Conservative reserved spend: $1.07812800 / $0.20; actual token-estimated spend: $0.21667650.

Baseline v0 is frozen. No sequential racing, full Claude/Gemini baseline, exhaustive A0–A6 run, extra ablation, UI work, commit, or push was performed.
