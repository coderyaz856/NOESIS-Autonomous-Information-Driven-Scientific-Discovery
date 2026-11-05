# Getting started

> **Meta indie-track run path:** see [`hackathon/DEMO.md`](hackathon/DEMO.md).
> It starts the lab bridge with `--enable-runs` and the web app; agents run on
> Muse Code with a `MODEL_API_KEY_FILE` kept outside the repository.
> - Out-of-domain questions run in open-research mode, which proposes studies
>   but executes none.
> - The held-out benchmark did not show an escalation quality gain.
> - The Omnigent steps below are the earlier orchestration, kept for its
>   recorded runs.

This guide takes a clean checkout to a verified local installation. The API/UI,
the discovery laboratory, and the language SDKs can be used independently.
Install only the components you need.

All commands below start at the repository root. PowerShell examples are shown
because the project is verified on Windows; Git Bash is only needed for the
earlier Omnigent start/stop scripts.

## Fastest offline acceptance check

Every component suite runs on each push in the
[`tests` workflow](../.github/workflows/tests.yml) (no secrets, no paid calls);
the README's **Tests** badge links to the latest result. To run the same checks
locally, use the commands in [Verification and reproduction](VERIFICATION.md),
which also covers reproducing the recorded results and interpretation limits.

## Prerequisites

Required for the API and scientific core:

- Git;
- Python 3.12 or newer;
- PowerShell 7 or Windows PowerShell 5.1.

Required by component:

| Component | Additional requirement |
|---|---|
| Frontend | Node.js and npm compatible with the committed lockfile |
| Live Muse lab | The [Muse Code CLI](https://dev.meta.ai/docs/muse-code) and a Meta Model API key in a file outside the repository (`MODEL_API_KEY_FILE`); see [`hackathon/DEMO.md`](hackathon/DEMO.md) |
| Earlier Omnigent lab (optional) | Git Bash, Omnigent 0.16.0, an Anthropic credential in the process environment |
| Rust SDK | Stable Rust toolchain with Cargo, rustfmt, and Clippy |
| Julia SDK | Julia 1.10 or newer; the verified local toolchain may be newer |

The repository never needs credential values in committed files. Provider
credentials are read from process environment variables only.

## Clone and inspect

```powershell
git clone https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery.git
Set-Location NOESIS-Autonomous-Information-Driven-Scientific-Discovery
git status --short
git rev-parse HEAD
```

Record the commit hash in any experimental report. A clean `git status` is the
preferred starting point for a reproducible run. If the tree is intentionally
dirty, preserve the diff and record `git.dirty=true` in provenance.

## Backend API

Create an isolated environment and install development dependencies:

```powershell
python -m venv .venv-backend
& .\.venv-backend\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r .\backend\requirements-dev.txt
```

Run the offline suite:

```powershell
Set-Location .\backend
$env:PYTHONPATH = "."
$testRoot = Join-Path $PWD (".tmp-pytest-" + [guid]::NewGuid())
python -m pytest tests -q --basetemp $testRoot
Set-Location ..
```

Start the API:

```powershell
Set-Location .\backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Verify from another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Start-Process http://127.0.0.1:8000/docs
```

Expected health status is `ok`. The capability and architecture registries are
empty until application code registers entries; empty catalogues are not an
installation failure.

## Frontend

Use `npm ci`, not `npm install`, for a lockfile-exact installation:

```powershell
Set-Location .\frontend
npm ci
npm run typecheck
npm run build
npm run dev
```

Open `http://localhost:5173`. The Vite development server proxies `/api` and
`/health` to `http://localhost:8000`; keep the backend running for live
catalogue and health views. Some cinematic narrative surfaces intentionally use
clearly marked fixtures.

## Scientific laboratory and Python SDK

The `discolab` package requires Python 3.12+:

```powershell
Set-Location .\discolab
python -m venv .venv
& .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
$env:OPENBLAS_NUM_THREADS = "1"
$env:OMP_NUM_THREADS = "1"
$env:MKL_NUM_THREADS = "1"
$testRoot = Join-Path $PWD (".tmp-pytest-" + [guid]::NewGuid())
python -m pytest -q --basetemp $testRoot
Set-Location ..
```

The thread limits reduce oversubscription and improve repeatability of timing
measurements. They do not guarantee identical wall time across machines.

Run the generic Python SDK example:

```powershell
python .\sdk\examples\research_evidence.py
```

It creates a local `study/research-runs/` evidence tree. Inspect the returned
run identifier with:

```powershell
noesis-discovery --root .\study inspect RUN-XXXXXXXXXXXX
noesis-discovery --root .\study validate RUN-XXXXXXXXXXXX
```

Use the actual identifier printed by the example.

## Rust SDK

```powershell
cargo fmt --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml -- --check
cargo clippy --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml
cargo run --manifest-path .\sdk\rust\noesis-discovery\Cargo.toml --example evidence -- .\study-rust
```

The Rust client launches the Python bridge. Ensure `discolab` is installed in
the Python selected by the client or use its explicit Python-path constructor
in source-checkout integrations.

## Julia SDK

```powershell
julia --project=.\sdk\julia -e 'using Pkg; Pkg.instantiate(); Pkg.test()'
julia --project=.\sdk\julia .\sdk\julia\examples\evidence.jl .\study-julia
```

Set `PYTHON` if the desired interpreter is not named `python`:

```powershell
$env:PYTHON = (Resolve-Path .\discolab\.venv\Scripts\python.exe)
```

## Verify Python, Rust, and Julia together

After the three component checks pass, run the shared interoperability proof:

```powershell
python -m sdk.interop.demo
```

This command uses the source checkout directly, starts the Python sidecar for
both native clients, and leaves a complete evidence store under
`.interop-demo/`. A pass requires exact numerical parity within `1e-12`, a
byte-identical Python reproduction, five valid runs, an accepted verification
run, and a verified bundle. It does not contact model providers.

## Earlier Omnigent discovery loop (optional)

The live Muse lab is started as described in [`hackathon/DEMO.md`](hackathon/DEMO.md).
The Omnigent loop below is the earlier orchestration, kept so its recorded runs
stay reproducible. Only proceed after the deterministic scientific core passes.
Its launcher is a Bash script and is best run from Git Bash:

```bash
cd discolab
export ANTHROPIC_API_KEY='set this in the shell; never commit it'
bash scripts/start_lab.sh main 6810
export DISCOLAB_HOME="$PWD/lab_home/main"
.venv/Scripts/python scripts/run_session.py \
  --port 6810 \
  --prompt "Run one development-stage discovery round and report all limitations."
.venv/Scripts/python -m discolab.cli trace
bash scripts/stop_lab.sh main
```

The human-approval gate fails closed: a confirmatory held-out run is declined
when nobody approves it. Do not bypass this protection for convenience.

## Configuration without secrets

Set these names directly in the shell (the repository ships no `.env` template).
Supported non-secret settings for the optional backend include:

- `APP_HOST`, `APP_PORT`, `CORS_ORIGINS`;
- `LOG_LEVEL`, `LOG_FORMAT`, `LOG_FILE_ENABLED`, `LOG_FILE_PATH`;
- `METRICS_OUTPUT_DIR`, `EVAL_OUTPUT_DIR`;
- provider model and base-URL selectors.

The Muse lab reads the Meta key from `MODEL_API_KEY` or `META_API_KEY`, or from
the file named by `MODEL_API_KEY_FILE` (preferred locally: keep that file
outside the repository). The optional backend's other provider
adapters read `OPENAI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, and `OPENROUTER_API_KEY`. Never print these values, include
them in commands captured by provenance, or store them in research artifacts.

## First-run acceptance checklist

- The component checks in [Verification and reproduction](VERIFICATION.md)
  pass for every installed component.
- Backend tests pass offline.
- `/health` returns `status: ok`.
- Frontend typecheck and production build succeed.
- The browser loads the seven narrative chapters.
- `discolab` tests pass with deterministic seeds.
- A Python evidence run validates.
- Any installed Rust or Julia SDK passes its live bridge test.
- `git status --short` contains only changes you intentionally created.
