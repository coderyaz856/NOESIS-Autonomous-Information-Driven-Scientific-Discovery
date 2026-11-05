# Noesis codebase guide

A map of the repository for contributors. For how the parts fit together at
runtime, start with [System architecture](SYSTEM_ARCHITECTURE.md).

The main path is: browser workspace -> server-side `/lab-proxy` -> Python lab
bridge -> Muse Code agents -> append-only ledger. The `backend/` FastAPI service
is an optional control plane and is not needed to run the lab.

## Top-level layout

| Path | Responsibility |
|---|---|
| `discolab/` | Lab bridge, Muse Code runtime, MCP lab tools, planner, simulations, statistics, ledger, evidence runtime, Python SDK |
| `frontend/` | Browser workspace and its server-side `/lab-proxy` relay (documented with that folder) |
| `backend/` | Optional FastAPI policy, optimization and benchmark control plane |
| `benchmark/` | Frozen Muse-agent benchmark artifacts and reports |
| `sdk/` | Rust crate, Julia package, protocol v1 fixtures, interoperability demo |
| `deploy/` | Hugging Face Space, Docker image and Linux host setups for the bridge |
| `Dockerfile` | Lab backend image (bridge, discolab, Muse Code CLI); no frontend |
| `.github/workflows/` | CI (`tests.yml`) and release workflows |
| `docs/` | Operating guides, contracts, scientific method and limitations |

## `discolab/` (the lab)

| Module (`discolab/discolab/`) | Role |
|---|---|
| `bridge.py` | HTTP/SSE `/lab/*` bridge; read-only unless `--enable-runs`; token auth via `X-Noesis-Bridge-Token` |
| `trial.py` | Optional bounded public trial: run, rate and total-spend limits enforced by the bridge |
| `run.py` | Starts and drives one Muse Code run (`python -m discolab.run start --question ...`) |
| `scope.py` | One Muse Spark call that picks lab mode or open-research mode |
| `muse.py` | Launches each role as a headless `muse exec` process; per-mode tool allow-lists; activity log and cost estimates |
| `agent_escalation.py` | Frozen Spark -> Wonder verifier gate for specialist reports |
| `mcp_server.py` | MCP tool server; each agent gets only its allow-listed tools; human approval for confirmatory runs |
| `lab.py` | The only code paths that write the research ledger |
| `ledger.py` | Append-only `ledger.jsonl`; state is a pure fold over validated events |
| `planner.py` | Deterministic experiment scoring (EIG minus costs, after hard constraints) and belief update |
| `experiments.py` | Experiment specs, seeded execution, raw artifacts, pre-registered verdicts |
| `ga.py`, `landscapes.py`, `controllers.py`, `features.py`, `telemetry.py`, `metrics.py`, `predict.py` | GA simulation, benchmark landscapes, mutation controllers and measurements |
| `stats.py`, `portfolio.py` | Inference utilities and failure-dependence analysis |
| `literature.py` | OpenAlex and arXiv lookups; evidence only for identifiers that resolve |
| `escalation.py`, `acceleration.py` | Offline (no LLM) studies of experiment-escalation and planner policies |
| `prereg.py`, `views.py`, `cli.py` | Pre-registration loading, compact views, lab command line |
| `evidence.py`, `bundle.py` | Domain-independent evidence runtime (hash-chained run logs) and content-addressed bundles |
| `sdk.py`, `sdk_cli.py`, `rpc.py` | Python SDK facade, `noesis-discovery` CLI, JSON-lines RPC sidecar for Rust and Julia |

Other `discolab/` content:

- `muse_agents/`: `config.yaml` (role models, effort, soft spend guard, approval
  wait), `escalation_gate.json`, lab-mode `pi.md`/`verifier.md`, and open-mode
  prompts in `muse_agents/open/`.
- `omnigent/lab_pi/`: the earlier Omnigent agent bundle; its specialist prompts
  and `tools/mcp/lab.yaml` allow-lists are reused by the Muse runtime.
- `prereg.yaml`, `escalation_protocol.yaml`, `acceleration_protocol.yaml`: frozen protocols.
- `results/`: committed records, including `results/escalation/` and
  `results/recorded-open-question/`.
- `scripts/`: Omnigent launch helpers (`start_lab.sh`, `stop_lab.sh`, `run_session.py`).
- `tests/`: offline pytest suite (bridge auth, runs, trial, open mode, ledger, planner, SDK, and more).

Live runs are written to `discolab/lab_home/<run-id>/` (`run.json`,
`activity.jsonl`, `muse/`, `ledger.jsonl`, `runs/E#/`).

## `backend/` (optional control plane)

| Path | Responsibility |
|---|---|
| `backend/app/main.py` | App factory, middleware, error handlers, router mounting |
| `backend/app/api/` | `/api` routes: health, SSE stream, system (capabilities, architectures, policy, fallback, Pareto) |
| `backend/app/capabilities/`, `backend/app/fallback/` | Hard capability/privacy policy and deterministic fallback |
| `backend/app/optimization/` | Pareto selection, utility, covariance, portfolio, robust routing, Bayesian updates, tail risk |
| `backend/app/ai/`, `backend/app/providers/` | Provider-neutral agent interface and adapters (Anthropic, Gemini, Meta, Muse agent, OpenAI-compatible) |
| `backend/app/instrumentation/` | Pricing, normalized call metrics, traces |
| `backend/app/benchmark/` | Corpus, runner, scoring, replay policies, statistics and report generation behind `benchmark/` |
| `backend/tests/` | Offline unit and contract tests |

Rules that still apply here: hard constraints precede utility; unknown prices
stay `null`, never zero; provider failures, model correctness and end-to-end
quality are separate measurements; offline replay is labeled separately from
provider-backed execution. Wire contracts are in [API_CONTRACTS.md](API_CONTRACTS.md).

## `sdk/`

- `sdk/rust/noesis-discovery/`: Rust crate (typed client, entropy/risk kernels, `.npy` reader).
- `sdk/julia/`: Julia package `NoesisDiscovery` (typed client, decision helpers, clustered ROC).
- `sdk/protocol/v1/`: JSON schema plus contract and parity fixtures (mirrored in the crate).
- `sdk/interop/`: offline cross-language proof (`python -m sdk.interop.demo`).
- `sdk/examples/research_evidence.py`: minimal Python evidence run.

Rust and Julia both start `python -m discolab.rpc` as a sidecar. See
[RESEARCH_SDK.md](RESEARCH_SDK.md) and [SDK_CONTRACTS.md](SDK_CONTRACTS.md).

## `deploy/`

- `deploy/huggingface/`: Hugging Face Docker Space guide and `entrypoint.sh`
  (needs `NOESIS_BRIDGE_TOKEN`; `META_API_KEY` unless `NOESIS_READ_ONLY=1`).
- `deploy/docker/`: published lab image notes and `smoke-test.sh`.
- `deploy/lab/`: Linux host setup with Caddy and a systemd unit.

## CI

`.github/workflows/tests.yml` runs offline on every push and pull request, with
no provider calls: discolab pytest, backend pytest, frontend type check (`npx tsc --noEmit -p .`), vitest and build,
Rust fmt/clippy/test, Julia `Pkg.test`, and a local Docker build plus smoke test.
`release-image.yml` and `release-sdk.yml` run only for deliberate release tags
or manual dispatch.

## Local development

```powershell
# Lab bridge (read-only; add --enable-runs and MODEL_API_KEY_FILE for live runs)
Set-Location .\discolab
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m discolab.bridge --port 8765
.\.venv\Scripts\python.exe -m pytest -q

# Optional FastAPI control plane
Set-Location ..\backend
python -m pip install -r requirements-dev.txt
python -m uvicorn app.main:app --reload --port 8000
python -m pytest tests -q
```

The browser app is started from `frontend/` (see the root [README](../README.md)).
The full test map is in [TESTING.md](TESTING.md).

## Security invariants

- Do not read or commit `.env` files, API-key files, tokens or credentials.
- The Meta key lives only with the bridge host; `muse.py` passes it to Muse Code
  on stdin and never logs it, and it is never sent to the browser.
- Agent processes do not inherit the bridge's `NOESIS_*` server settings.
- Agents never supply measured numbers; only tools write measurements to the ledger.
- Held-out observations cannot tune gates, thresholds, model choice or rules.
- Never repair raw evidence in place; version the fix and rerun.
