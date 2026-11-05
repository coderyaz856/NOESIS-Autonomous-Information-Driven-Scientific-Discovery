# Test strategy and commands

The default verification suites are offline and deterministic. Test counts
evolve with the implementation and should be read from the current pytest
collection output rather than copied into durable claims. Live provider calls
are never part of the default unit suite.

## Repository-level verification

The [`tests` workflow](../.github/workflows/tests.yml) runs every suite on each
push and pull request: both Python suites, the frontend checks and build, the
Rust and Julia SDK suites, and a Docker build with the lab-image smoke test. It
uses no secrets and makes no provider calls. The same commands for a local run,
and the reproduction steps for the recorded results, are in
[VERIFICATION.md](VERIFICATION.md).

## Standard verification

```powershell
# Backend, from the repository root
cd .\backend
$env:PYTHONPATH='.'
$testRoot = Join-Path $PWD ('.tmp-pytest-' + [guid]::NewGuid())
python -m pytest tests -q --basetemp $testRoot

# Frontend
cd ..\frontend
npm ci
npx tsc --noEmit -p .
npm test
npm run build

# Discovery lab and Python SDK
cd ..\discolab
$env:OPENBLAS_NUM_THREADS='1'
$env:OMP_NUM_THREADS='1'
$env:MKL_NUM_THREADS='1'
$testRoot = Join-Path $PWD ('.tmp-pytest-' + [guid]::NewGuid())
python -m pytest -q --basetemp $testRoot

# Rust SDK
cd ..
cargo fmt --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml -- --check
cargo clippy --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml

# Julia SDK
julia --project=.\sdk\julia -e 'using Pkg; Pkg.instantiate(); Pkg.test()'
```

The explicit `--basetemp` keeps pytest temporary files inside the workspace and avoids machine-specific temp-directory permissions.

## Test map

| Test module | Contract protected |
|---|---|
| `test_health.py` | Root and API-prefixed health routes. |
| `test_system_api.py` | Empty registries, registry round-trips, Pareto request/response behavior, policy evaluation, fallback, and validation errors. |
| `test_stream.py` | SSE content type, named heartbeat event, and JSON payload. |
| `test_errors.py` | Structured error envelope and status mapping. |
| `test_logging.py` | Secret redaction, request IDs, safe structured logs, error events, optimizer/fallback audit events. |
| `test_ai_interfaces.py` | Provider and agent abstraction behavior. |
| `test_instrumentation.py` | Token, latency, cost, recorder, and model-call observations. |
| `test_trace.py` | Execution trace construction and sanitization. |
| `test_capabilities.py` | Capability implication, leases, scope, expiry, denials, and mandatory requirements. |
| `test_fallback.py` | Ordered fallback eligibility and rejection reasons. |
| `test_experiment_systems.py` | Multi-objective decisions, confidence bounds, covariance, priors, routing, racing, stress, and experimental controls. |
| `test_eval.py` | Caller-supplied evaluation and artifact persistence. |
| `test_benchmark_lab.py` | Corpus, runner, aggregation, calibration, tail risk, ablations, artifacts, and publishing. |
| `test_pilot.py` | Paired case selection, cost projections, hard limits, and pilot-report sensitivity. |
| `test_baseline_v0.py` | Frozen scoring, split discipline, selective replay, reliability decomposition, and baseline artifact integrity. |

## Important invariants under test

- Catalogues start empty; production routes do not inject sample data.
- All application errors share the same JSON envelope.
- Capability and privacy checks happen before optimization.
- Fallback selection is deterministic and records rejection reasons.
- Logs omit prompts, documents, credentials, headers, and cookies.
- Unknown model price remains unknown.
- Benchmark calls require explicit spend, call, and concurrency limits.
- Paired statistics require identical case coverage.
- Held-out data cannot fit routing thresholds.
- Offline replay is labeled as replay and makes no provider calls.
- Provider availability is not conflated with correctness conditional on a successful call.

## Writing a backend test

Use the shared `client` fixture from `tests/conftest.py` for API tests. Prefer exact assertions for stable contracts:

```python
def test_catalogue_contract(client):
    response = client.get("/api/system/capabilities")
    assert response.status_code == 200
    assert response.json() == {"capabilities": []}
```

For pure policy or optimizer behavior, instantiate domain objects directly. Avoid network calls, wall-clock assumptions, random data without a fixed seed, or assertions against implementation-private fields.

For artifact tests, use pytest's `tmp_path` and verify both human-readable and machine-readable outputs. Never use a real credential in fixtures.

## Adding an API contract

A route change is complete only when the following agree:

- Pydantic model and route behavior;
- TypeScript interface and client wrapper;
- success response test;
- validation/error response test;
- [API_CONTRACTS.md](API_CONTRACTS.md).

## Frontend verification

The frontend has three layers of checks, all run in CI:

- `npm test` runs the vitest suites (`frontend/vitest.config.ts`):
  `frontend/src/workspace/model.test.ts` (verdict, experiment-status and
  source-label rules, e.g. an interval crossing zero is never shown as
  supported), `frontend/src/test/lab-proxy-policy.test.ts` (allowed lab
  origins, write modes, operator sessions, and that only the server's bridge
  token is relayed), and `frontend/src/test/app-routing.test.tsx` (the root
  route resolves);
- `npx tsc --noEmit -p .` type-checks the app, including the lab bridge
  response types in `frontend/src/noesis/api/lab-types.ts`;
- `npm run build` protects module resolution, asset imports, and production
  bundling.

There is no screenshot or visual-regression script in the repository.

## Discovery-lab test map

| Test module | Contract protected |
|---|---|
| `test_ga.py` | Determinism, common random numbers, elitism, controller visibility, invalid actions. |
| `test_controllers_features.py` | Mutation bounds, intervention behavior, labels, feature causality, model serialization. |
| `test_landscapes.py` | Known optima, seeded shifts, domain safety, recovery calibration. |
| `test_telemetry.py` | Entropy and diversity telemetry invariants. |
| `test_predict.py` | Logistic fitting, informative/null feature behavior, AUROC inference. |
| `test_metrics.py` | Censoring-aware recovery outcomes and rescue/damage counts. |
| `test_stats.py` | AUROC, Wilson, clustered bootstrap, multiplicity, McNemar, effect sizes, CVaR. |
| `test_planner.py` | Likelihood model, information gain, posterior direction, SESOI, status consistency. |
| `test_ledger.py` | Initialization, append-only guards, pure replay, preregistration hashing. |
| `test_lab_flow.py` | Full state machine, held-out feasibility, failure/abort behavior, belief coupling. |
| `test_literature.py` | Identifier/title evidence validation. |
| `test_portfolio.py` | Failure dependence and complementarity. |
| `test_sdk.py` | Python/RPC contract, schema parity, and cross-language numerical fixtures. |
| `test_evidence_sdk.py` | Generic evidence runs, deterministic reproduction, budget and tamper failures. |
| `test_evidence_lifecycle.py` | Checkpoint/resume, lineage, listing, and bundle integrity. |
| `test_muse_runtime.py`, `test_mcp_bundle.py` | Muse role execution and tool isolation. |
| `test_open_mode.py`, `test_agent_escalation.py` | Open-research restrictions and frozen verifier gate. |
| `test_bridge_runs.py`, `test_bridge_auth.py`, `test_trial.py` | Run admission, bridge authentication, and bounded public-trial behavior. |

Test names and counts may change; the files in `backend/tests/`,
`discolab/tests/`, and `frontend/src/test/` are the executable specification.

## Test taxonomy

- **Unit:** one deterministic function or state transition; no network.
- **Contract:** agreement between API/model/client or RPC/language bindings.
- **Invariant:** property that must hold across generated or adversarial inputs.
- **Integration:** real local components, such as a Rust client plus Python bridge.
- **Scientific regression:** frozen numerical output or verdict under a named protocol.
- **Provider-backed experiment:** paid/time-sensitive empirical run; never part of default CI.

Tests prove implementation behavior, not the scientific truth of a hypothesis.
A passing statistical test suite shows that the estimator behaves as specified;
it does not validate the assumptions of a particular study.

## Provider-backed experiments

Provider-backed runs are controlled experiments, not unit tests. They must have explicit authorization, known price ceilings, fixed prompts/configuration, bounded concurrency, immutable raw observations, and a stop condition. Their methodology is described in [BENCHMARK_METHODOLOGY.md](BENCHMARK_METHODOLOGY.md).

