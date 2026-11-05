# System architecture

Noesis turns a research question into recorded, inspectable evidence. The main
path is a browser workspace, a server-side relay, and a Python lab bridge that
runs Muse Code agents against an append-only ledger:

```text
Research question
  -> browser workspace (frontend/)
  -> server-side /lab-proxy relay (adds the bridge token; browser never sees it)
  -> Python lab bridge (discolab/discolab/bridge.py, authenticated /lab/*)
  -> scope check (discolab/discolab/scope.py): lab mode or open-research mode
  -> Muse Code PI + specialists (discolab/discolab/muse.py, discolab/muse_agents/)
  -> allow-listed MCP lab tools (discolab/discolab/mcp_server.py)
  -> deterministic planner, seeded simulations, statistics  [lab mode only]
  -> append-only ledger (discolab/discolab/ledger.py) + activity log
  -> bridge feeds (JSON + SSE) -> workspace trace and report
```

The root [README](../README.md) shows the same flow as a diagram, including the
frozen Spark -> Wonder escalation gate.

## Components

| Path | Role | Authoritative data |
|---|---|---|
| `frontend/` | Browser workspace and the server-side `/lab-proxy` relay | None; it renders what the bridge reports |
| `discolab/` | Lab bridge, Muse Code runtime, MCP tools, planner, simulations, statistics, ledger, evidence runtime | Preregistration, ledgers, run artifacts |
| `sdk/` | Rust and Julia clients, protocol v1 fixtures, interoperability demo | Cross-language wire contract |
| `deploy/` | Hugging Face Space, Docker image and Linux host setups for the bridge | Deployment configuration only |
| `backend/` | Optional FastAPI policy/optimization and benchmark control plane | Benchmark observations and analysis |
| `benchmark/` | Frozen Muse-agent benchmark inputs, observations and reports | Retained benchmark evidence |

## Browser to bridge

The browser app lives in [`frontend/`](../frontend/). It calls the bridge only
through its own server-side `/lab-proxy` route, which relays to configured lab
origins and adds the bridge token on the server, so the browser never holds it.
Frontend details are documented with the `frontend/` folder.

## Lab bridge

`python -m discolab.bridge --port 8765` serves live labs (`lab_home/<name>`) and
committed records (`results/<name>`). It is **read-only by default**; only
`--enable-runs` lets it start Muse Code runs and accept approval decisions.

| Endpoint | Purpose |
|---|---|
| `GET /lab/sources` | Available labs and records |
| `GET /lab/state`, `/lab/activity`, `/lab/experiment`, `/lab/run` | Research state, agent activity, one experiment's result and curves, the run record |
| `GET /lab/stream` | SSE of new ledger events and agent activity |
| `GET /lab/capabilities` | Whether runs can start here, and the supported domain |
| `POST /lab/runs` | Scope-check a question, then start a run (`--enable-runs`) |
| `POST /lab/approvals` | Approve or decline a pending confirmatory run (`--enable-runs`) |

With a bridge token configured (`NOESIS_BRIDGE_TOKEN_FILE` or
`NOESIS_BRIDGE_TOKEN`), every request must carry `X-Noesis-Bridge-Token` or it
gets 401. Without a token the bridge listens on loopback only; hosted bridges
start with `--require-auth`. The bridge reads values from ledgers, activity
logs and trace artifacts; it summarizes but does not invent values.

`discolab/discolab/trial.py` adds an optional bounded public trial (enabled by
`NOESIS_TRIAL_TOTAL_USD`): one active run, per-run spend guard and watchdog,
global and per-visitor rate limits, and a durable total spend limit stored in
`NOESIS_DATA_DIR`. The bridge enforces it because it is the only process with
the Meta key.

## Scope gate and the two modes

`discolab/discolab/scope.py` makes one Muse Spark call with a JSON schema that
maps the question onto the pre-registered hypotheses (`discolab/prereg.yaml`).
`discolab/discolab/run.py` then creates a fresh lab under `lab_home/<name>`:

- **lab mode** (GA/entropy domain): agents propose, score, select and run seeded
  experiments; numbers come from the deterministic tools.
- **open mode** (any other question): agents get a research-only tool set
  (`OPEN_MODE_TOOLS` in `muse.py`) and the prompts in `discolab/muse_agents/open/`.
  They can search literature, register hypotheses and propose protocols, but have
  no run tool. Nothing is executed or simulated.

The classifier only chooses the mode; it never produces results.

## Muse Code agents

Each role (PI, literature, designer, critic, and a verifier) is a headless
`muse exec --json` process. Its only lab access is a stdio MCP server
(`python -m discolab.mcp_server`) serving exactly that role's allow-listed tools
and attributing every ledger event to it (`DISCOLAB_ACTOR`). Harness shell,
file-write and web tools are disabled. Role models, effort and the soft spend
guard are in `discolab/muse_agents/config.yaml`; the PI instructions are in
`discolab/muse_agents/pi.md`.

- The PI delegates through its `delegate` tool, which launches the specialist's
  own Muse Code process and returns its report.
- Only the PI selects and runs experiments; specialists cannot spend compute.
- A frozen gate (`discolab/muse_agents/escalation_gate.json`,
  `discolab/discolab/agent_escalation.py`) decides whether a Wonder verifier,
  with read-only tools, checks a specialist report.
- A confirmatory (held-out) experiment waits for a human decision through
  `POST /lab/approvals`; no answer within the configured wait means declined.

The Model API key is read from the environment or `MODEL_API_KEY_FILE`, passed
to Muse Code on stdin; `muse.py` never writes it to disk or logs it. Agent processes do
not inherit the bridge's `NOESIS_*` server settings.

## Ledger and evidence

- `discolab/discolab/ledger.py`: every scientific transition is one validated
  JSON line in `ledger.jsonl`; research state is a pure fold over those events.
  Invalid transitions raise and append nothing.
- `discolab/discolab/lab.py`: the only code paths that write the ledger.
- `discolab/discolab/planner.py`: constrained utility
  `U(E) = EIG(E) - eta*wall_seconds(E) - lambda*heldout_landscapes(E)` after hard
  constraints, and the Bayesian belief update.
- `discolab/discolab/evidence.py`: domain-independent evidence runtime with a
  hash-chained `events.jsonl` per run; `bundle.py` packages runs as
  content-addressed, tamper-evident bundles.

A run directory holds `run.json`, `activity.jsonl`, `muse/` (raw event streams),
`ledger.jsonl` and, when an experiment ran, `runs/E#/`.

## Research SDK

`discolab/discolab/sdk.py` is a thin Python facade over the same lab code.
`python -m discolab.rpc` is a closed JSON-lines method table used by the Rust
crate (`sdk/rust/noesis-discovery`) and the Julia package `NoesisDiscovery`
(`sdk/julia`); both start it as a sidecar. The contract is versioned under
`sdk/protocol/v1/`. See [Research SDK](RESEARCH_SDK.md) and
[SDK contracts](SDK_CONTRACTS.md).

## Deployment

The bridge and the browser app are deployed separately.

- `Dockerfile` builds the lab backend image (bridge, discolab, Muse Code CLI);
  `deploy/huggingface/entrypoint.sh` starts it. Secrets are runtime-only.
- `deploy/huggingface/`: Hugging Face Docker Space guide.
- `deploy/docker/`: the published image and `smoke-test.sh`.
- `deploy/lab/`: Linux host with Caddy and a systemd unit.

## Optional and earlier paths

- **FastAPI control plane (optional).** `backend/` exposes `/api` routes for
  capability policy, fallback, Pareto selection and SSE, plus the benchmark
  analysis code. It is not needed to run the lab. See [Codebase](CODEBASE.md)
  and [API contracts](API_CONTRACTS.md).
- **Omnigent lab (earlier runtime).** `discolab/omnigent/lab_pi/` and
  `discolab/scripts/start_lab.sh` run the same MCP tools under Omnigent. The
  Muse runtime reuses its prompts and tool allow-lists.

## Trust boundaries

1. **Model providers are untrusted dependencies.** Responses may fail or drift.
2. **Agents are decision aids.** They supply text, not measurements, and act on
   the lab only through allow-listed tools.
3. **The numerical core is the measurement authority.** Seeded tools produce
   scientific quantities; the ledger guards every transition.
4. **The browser is not an evidence store** and never holds the Meta key, the
   bridge token or the operator token.
5. **Content hashes are tamper-evident, not signatures.**

Never repair raw evidence in place. If a protocol or parser is wrong, keep the
original, version the fix, and rerun or run a labeled sensitivity analysis.
