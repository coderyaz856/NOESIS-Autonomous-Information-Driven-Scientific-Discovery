# Verification and reproduction

The verification checks do not read credentials or call model providers.
Dependency installation and container builds may download packages, so perform
those setup steps before an offline run. There is no single verifier script in
this repository; the checks are
the component test suites, the CI workflow that runs all of them, and the
reproduction commands for each recorded result.

## Continuous integration (all suites, every push)

[`.github/workflows/tests.yml`](../.github/workflows/tests.yml) runs on every
push and pull request, with no secrets and no paid calls:

| Job | What it runs |
|---|---|
| Python lab and SDK (discolab) | `python -m pytest -q` in `discolab/` |
| Python backend | `python -m pytest tests -q` in `backend/` |
| Frontend | `npm ci`, `npx tsc --noEmit -p .`, `npm test`, `npm run build` in `frontend/` |
| Rust SDK | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` for `sdk/rust/noesis-discovery` |
| Julia SDK | `Pkg.test()` for `sdk/julia` |
| Lab image | `docker build`, then [`deploy/docker/smoke-test.sh`](../deploy/docker/smoke-test.sh) |

The README's **Tests** badge links to the latest results on `main`.
The frontend job runs from `frontend/`. This checkout also contains a
repository-root web-app tree with its own `package.json` and `src/`; the CI
job above does not establish parity with that tree. Record which source
directory the public host builds when reporting a hosted acceptance test.

## Running the suites locally (PowerShell, from the repository root)

```powershell
$env:OPENBLAS_NUM_THREADS = "1"; $env:OMP_NUM_THREADS = "1"; $env:MKL_NUM_THREADS = "1"

# Discovery lab and Python SDK
Set-Location .\discolab
python -m pip install -e ".[dev]"
python -m pytest -q
Set-Location ..

# Backend control plane
python -m pip install -r .\backend\requirements-dev.txt
Set-Location .\backend
python -m pytest tests -q
Set-Location ..

# Frontend
Set-Location .\frontend
npm ci
npx tsc --noEmit -p .
npm test
npm run build
Set-Location ..

# Rust and Julia SDKs (each starts `python -m discolab.rpc`, so discolab must be installed)
cargo fmt --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml -- --check
cargo clippy --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml
julia --project=.\sdk\julia -e 'using Pkg; Pkg.instantiate(); Pkg.test()'
```

## Python -> Rust -> Julia interoperability proof

```powershell
python -m sdk.interop.demo --root .\.interop-demo\check
```

It creates independent Python, Rust and Julia runs in one evidence store,
checks numerical parity, reproduces the Python source run, and verifies one
content-addressed bundle. The procedure is frozen in
[`sdk/interop/PROTOCOL.md`](../sdk/interop/PROTOCOL.md). Pass `--cargo` and
`--julia` when those tools are not on `PATH`.

## Selective-escalation result (simulation-compute saving)

The recorded study is [`discolab/results/escalation/`](../discolab/results/escalation/README.md);
its `summary.json` holds the five replicates, the mean compute ratio `1.542`,
the `28/35` and `29/35` agreement counts, and the rescue and damage counts.
The raw traces (about 125 MB) are not committed; the frozen harness regenerates
them from seeds. To rerun all five replicates into a new directory:

```powershell
Set-Location .\discolab
python -m discolab.escalation --out ..\.verification\escalation-rerun
```

This is CPU-intensive and makes no provider calls. Compare the regenerated
`summary.json` with `discolab/results/escalation/summary.json`: the frozen
protocol, the per-replicate compute ratios, the agreement arrays, and the gate
rate, rescue and damage counts should match. Never point `--out` at
`discolab/results/escalation/`; the runner refuses to overwrite an existing
evidence directory.

## Sealed entropy early-warning result

This repository carries the study's frozen protocol and machine-readable
summary under `research_prototypes/entropy_early_warning/`. The sealed evidence
bundle (`entropy-early-warning-v1.zip`, about 14 MB) and the study driver
(`run_study.py`) are published in the companion evidence repository,
[`research_prototypes/entropy_early_warning/`](https://github.com/Ismailea4/Agentic-Scientific-Discovery-EigenBrains/tree/main/research_prototypes/entropy_early_warning).
To verify the bundle with this repository's SDK, download it there and run:

```powershell
python -m discolab.sdk_cli verify-bundle <path-to>\entropy-early-warning-v1.zip
```

The [sealed-result report](SEALED_ENTROPY_EARLY_WARNING_RESULT.md) lists the
protocol hash, the bundle's content identity and the rerun procedure.

## Muse-agent benchmark

The retained Meta-only evidence is
`benchmark/muse_agents_baseline_v1/benchmark/artifacts/baseline_v0/baseline_v0_summary.json`,
explained in [`benchmark/reports/MUSE_AGENTS_BASELINE_V1.md`](../benchmark/reports/MUSE_AGENTS_BASELINE_V1.md).
The report separates offline replay estimates from provider-backed verifier
calls and does not claim a statistically resolved quality gain.

## Interpreting a successful verification

Passing checks establish that the implementation and the committed evidence are
internally consistent and reproducible in the current environment. They do not
establish:

- generalization to unseen scientific domains;
- statistical equivalence between 28/35 and 29/35 agreement;
- stable future provider behavior;
- validity of assumptions not tested by the frozen protocols.

Those boundaries are part of the result, not exceptions to verification.
