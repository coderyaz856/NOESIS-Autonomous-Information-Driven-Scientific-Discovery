# Noesis documentation

> **Meta indie-track build:** run it with [`hackathon/DEMO.md`](hackathon/DEMO.md).
> Agents run on Meta Muse Code. Open-research mode proposes studies but
> executes none. The held-out benchmark did not demonstrate an escalation
> quality gain
> ([`../benchmark/reports/MUSE_AGENTS_BASELINE_V1.md`](../benchmark/reports/MUSE_AGENTS_BASELINE_V1.md)).

This directory is the authoritative guide to operating, extending, and
auditing Noesis (built by team EigenBrains). The project has two connected research systems:

1. an evidence-driven model and agent-architecture control plane; and
2. an autonomous computational-science laboratory for hypothesis-driven
   experiments on dynamic optimization.

The common principle is that agents may propose and interpret, while validated
software owns measurements, constraints, state transitions, and statistical
calculations.

## Start here

| If you want to... | Read |
|---|---|
| See what Noesis does and try it (authoritative entry point) | The [project README](../README.md), then the [demo guide](hackathon/DEMO.md) |
| Understand the whole repository | [System architecture](SYSTEM_ARCHITECTURE.md) and [codebase map](CODEBASE.md) |
| Run the application locally | [Getting started](GETTING_STARTED.md) |
| Verify or reproduce a result without Meta credits | [Verification and reproduction](VERIFICATION.md) |
| Design or review an experiment | The pre-registration `discolab/prereg.yaml` and the [discovery lab guide](../discolab/README.md) |
| Operate the API, UI, lab, or agents | [Operations runbook](OPERATIONS_RUNBOOK.md) |
| Extend or verify the interface | [Frontend guide](FRONTEND_GUIDE.md) |
| Add code or documentation safely | [Contributing guide](CONTRIBUTING.md) |
| Diagnose an installation or runtime issue | [Troubleshooting](TROUBLESHOOTING.md) |
| Decode project terminology | [Glossary](GLOSSARY.md) |
| Use the HTTP APIs | Lab bridge `/lab/*`: [System architecture](SYSTEM_ARCHITECTURE.md#lab-bridge); optional FastAPI control plane: [API contracts](API_CONTRACTS.md) |
| Audit model/architecture benchmarks | [Benchmark methodology](BENCHMARK_METHODOLOGY.md) and the [Muse agents baseline report](../benchmark/reports/MUSE_AGENTS_BASELINE_V1.md) |
| Read the recorded acceleration study | [Selective-escalation study report](../discolab/results/escalation/README.md) |
| Run or extend tests | [Testing guide](TESTING.md) |
| Prepare the evidence-first product demo | [Demo integration runbook](DEMO_RUNBOOK.md) |

## Sources of truth

Documentation explains the system, but executable contracts remain
authoritative:

| Concern | Source of truth |
|---|---|
| Backend HTTP shapes | Pydantic models in `backend/app/api/routes/` |
| Frontend API mirror | `frontend/src/noesis/api/types.ts` and `frontend/src/noesis/api/lab-types.ts` |
| Discovery hypotheses and decision rules | `discolab/prereg.yaml` |
| Acceleration study protocol | `discolab/escalation_protocol.yaml` |
| Recorded acceleration evidence | `discolab/results/escalation/summary.json` and its [report](../discolab/results/escalation/README.md) |
| Agent permissions | Muse Code roles in `discolab/muse_agents/` with the MCP allow-lists in `discolab/discolab/muse.py`; the Omnigent bundle in `discolab/omnigent/lab_pi/**/config.yaml` |
| Model benchmark cases and limits | `benchmark/cases/` and `benchmark/configs/` |
| Recorded model observations | `benchmark/muse_agents_baseline_v1/` and `benchmark/muse_baseline_v1/` |
| Recorded discovery events | `ledger.jsonl` in each lab directory (`discolab/lab_home/<run>/`, not committed) |

If prose and an executable contract disagree, stop and reconcile them before
running a new experiment. Never silently reinterpret an old result using a new
protocol.

## Evidence labels

Every numerical claim should be identifiable as one of the following:

| Label | Meaning | Permitted claim |
|---|---|---|
| `SAMPLE` | Interface fixture or demonstration data | Visual behavior only |
| `REPLAY` | Counterfactual policy evaluation over recorded calls | Expected policy behavior under the replay assumptions |
| `BENCHMARK` | Measured execution under a named frozen protocol | Performance within that corpus, split, and environment |
| `PROVIDER_BACKED` | Architecture step actually executed through a provider | Observed end-to-end behavior for those calls |
| `LIVE` | Runtime telemetry from a deployed task | Operational status, not general scientific validity |

Do not merge these categories in a chart, summary statistic, or headline
without preserving the label for every observation.

## Documentation quality rules

Project documentation must:

- distinguish implemented behavior from planned behavior;
- provide commands relative to the repository root unless explicitly noted;
- state the operating system or shell when commands are platform-specific;
- identify frozen protocols and the version used by every reported result;
- keep exploratory, tuning, confirmatory, and post-hoc analyses separate;
- state sample sizes, units, uncertainty, exclusions, and failure handling;
- link a human-readable conclusion to machine-readable evidence;
- never contain credentials, copied environment values, or private paths;
- avoid claims such as “faster,” “safer,” or “better” without a comparator and
  a measured protocol.

## Documentation change checklist

Before merging documentation changes:

1. Run every command that the change claims is supported, or label it as an
   example that has not been executed.
2. Verify relative links from the file containing them.
3. Confirm test counts and result numbers from generated output rather than
   memory.
4. Check that no secret value, local username, or absolute machine path was
   introduced.
5. Check that no `SAMPLE` value is described as empirical evidence.
6. Update both sides of a contract when applicable: backend plus frontend, or
   Python protocol plus Rust and Julia clients.
