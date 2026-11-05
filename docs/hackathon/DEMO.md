# Noesis on Meta Muse — setup and demo

Hackathon build (Meta Global AI Developer Hackathon, Indie track). The discovery
lab's agents run on **Muse Code** (Meta's agent harness) against the **Meta Model
API**. Everything below was run on Windows 11; paths use forward slashes.

## What the demo does — and what it cannot do

You type **any research question**. Muse Spark classifies it into one of two
modes, and the run panel and story view say which one ran:

- **Lab mode (experiments executed).** The question falls in the lab's
  simulation domain: *does population entropy give early warning of
  genetic-algorithm stagnation beyond fitness history, and can it drive a
  mutation controller?* (pre-registered hypotheses H1–H8). Agents design,
  score and run real GA experiments, and posteriors update.
- **Open mode (any other question; nothing executed).**
  - The literature agent records verified OpenAlex/arXiv evidence.
  - The designer registers competing falsifiable hypotheses (`Q1…`,
    untested) and writes study protocols (`P1…`): design, comparator,
    falsifier, sample size, cost and risks.
  - The critic critiques them, and the PI records the recommended next study.
  - Experiment tools are not available to any agent in this mode, and the
    ledger rejects executable experiments, so no result can be simulated or
    implied.

In both modes the run is real. A principal-investigator agent (one
`muse exec` process) delegates to literature, designer and critic agents (their
own Muse Code processes). Each agent sees only its allow-listed lab tools over
MCP, and every action is written to an append-only ledger with the acting agent.
Experiments are deterministic GA simulations. The UI shows handoffs, tool calls,
experiment results with uncertainty, posterior updates and the decision as they
happen, plus estimated spend against a soft spend guard (new agent hand-offs stop once it is reached; agents already running can exceed it — it is not a hard cap).

Runs on held-out ("confirmatory") landscapes stop and wait for a human to
**Approve** or **Decline** in the UI. If nobody answers, the run is declined
(fail closed).

**Dynamic escalation (Noesis gate).**
- Specialists run on Muse Spark 1.3. After each one reports, the frozen Noesis
  gate decides whether a **Wonder 1.0 verifier agent** must check the report
  against the lab record.
- It escalates on:
  - agent or tool failure;
  - no usable report;
  - held-out or confirmatory work;
  - a measured task-family error UCB at or above 0.5. That threshold comes
    from the agent-harness benchmark; critique tasks exceed it.
- The verifier answers CONFIRMED, CORRECTED or REJECTED. The decision and the
  verdict appear live in the activity feed.
- This is the S3 policy (Spark → selective Wonder) from the benchmark. Its
  rescue value is a **theoretical safety case**: the benchmark observed
  0 rescues and 0 damage.

## Prerequisites

| Need | Version used |
|---|---|
| Python | 3.12 |
| Node.js / npm | 22 / 11 |
| Muse Code CLI | 1.4.14 (`irm https://dev.meta.ai/install.ps1 \| iex`, or see dev.meta.ai/docs/muse-code) |
| Meta Model API key | Standard mode (not Contributor mode) |

Put the key in a file **outside the repository**, either as the raw key or as
`key="..."`, and point to it:

```powershell
$env:MODEL_API_KEY_FILE = "F:\path\outside\repo\meta_api_key.txt"
```

The key is only passed to Muse Code on stdin (`--api-key-stdin`) and in request
headers. It is never written into run records or logs.

## Install

```powershell
# lab (agents, MCP tools, ledger, bridge)
cd discolab
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"

# web app
cd ..\frontend
npm ci
```

If Muse Code is not on `PATH`, set `MUSE_BIN` to the `muse-bin-*.exe` under
`%LOCALAPPDATA%\Programs\muse\`.

## Run the demo

Terminal 1 — the lab bridge with run launching enabled:

```powershell
cd discolab
.venv\Scripts\python -m discolab.bridge --enable-runs --port 8765
```

Terminal 2 — the web app:

```powershell
cd frontend
npx vite dev --port 5173
```

Open http://localhost:5173. Use an example question or write one of your own,
then click **Investigate** (or press Ctrl/Cmd+Enter in the question box).
The question remains visible in the same workspace while the agent map,
activity and decision console update; completion opens the report. A recorded
one-round lab run took 195 s and an estimated $0.29 before the escalation
gate; a later gate-enabled lab run took 237 s and an estimated $0.46.
These are examples, not timing or price guarantees. The soft spend guard
does not cap an already-running provider call.

Without `--enable-runs` the bridge is read-only: you can browse recorded runs,
and the question box explains that launching is disabled.

Headless alternative:

```powershell
cd discolab
.venv\Scripts\python -m discolab.run start --question "Does population entropy give early warning of GA stagnation beyond fitness history?" --rounds 1
.venv\Scripts\python -m discolab.run status --home lab_home\<run-id>
```

## Where the evidence is

| Artifact | Path |
|---|---|
| Run record (question, scope result, models, Muse version, prereg hash, soft spend guard, usage, final report) | `discolab/lab_home/<run>/run.json` |
| Append-only ledger (agent-attributed) | `discolab/lab_home/<run>/ledger.jsonl` |
| Handoffs, tool calls, token usage, cost per agent | `discolab/lab_home/<run>/activity.jsonl` |
| Raw Muse Code event streams and prompts | `discolab/lab_home/<run>/muse/` |
| Approval requests and decisions | `discolab/lab_home/<run>/approvals/` |
| Escalation gate in use (file hash plus source benchmark hash) | `run.json` → `escalation_gate`; `discolab/muse_agents/escalation_gate.json` |
| Benchmark, Muse Code agents in every slot | `benchmark/reports/MUSE_AGENTS_BASELINE_V1.md`, `benchmark/muse_agents_baseline_v1/` |
| Benchmark, direct Model API (same pipeline) | `benchmark/reports/MUSE_BASELINE_V1.md`, `benchmark/muse_baseline_v1/` |

## Rerun the benchmark (paid)

Both commands run the frozen Baseline v0 pipeline (S0–S4,
covariance and complementarity, bounds, Pareto, economics):

```powershell
cd backend
.venv\Scripts\python -m app.benchmark.muse_baseline_v1 --root .. --harness agent   # ~$8; estimated pre-call guard $12 (not a hard cap)
.venv\Scripts\python -m app.benchmark.muse_baseline_v1 --root .. --harness api     # ~$0.22; estimated pre-call guard $3
```

The CVaR exporter is `python -m app.benchmark.baseline_cli`, run with
`--seed 0 --severe-failure-threshold 0.2 --failure-threshold 0.5 --prior-strength 4.0 --maximum-prior-strength 5.0`.
Its outputs are under `downside_{held_out,dev}/` for each run.

To freeze a new gate into the app (dev and tuning fit only; held-out-fitted
gates are refused):
`cd discolab; .venv\Scripts\python -m discolab.agent_escalation --from <frozen_gate_configuration.json> --note "..."`.

## Tests

```powershell
cd discolab;  .venv\Scripts\python -m pytest -q
cd frontend;  npx vitest run; npx tsc --noEmit -p .
```

## Limitations

- **One executable domain.**
  - The scientific engine only runs the pre-registered GA/entropy experiments.
  - Every other question is accepted in open mode, which produces evidence,
    hypotheses, protocols and critique, but no executed results.
  - Open-mode hypotheses stay `untested`.
- **Model sampling is not seeded.** Muse Code exposes no seed, so agent decisions
  can differ between runs. Simulations are seeded and reproducible, and every run
  records its configuration, Muse version and prereg hash.
- **Costs are estimates.** They come from token counts × Model API list prices.
  The Meta billing page is authoritative.
- **One run at a time** per bridge, with at most 2 rounds and a soft spend guard of at most $5 from the UI (estimated; not a hard cap).
- **No measured quality gain from escalation.**
  - On the 72-case corpus, Spark 1.3, Spark 1.2 and Wonder 1.0 all score
    0.875 and fail nearly the same cases (error correlation 0.873).
  - Every paired difference is unresolved at 95%.
  - Escalation is a safety mechanism, not a demonstrated improvement.
- **The agent harness costs more than the bare API** (about 15.5k input tokens
  of harness prompt per call) for the same measured quality.
- **Escalation was exercised live once in lab mode** (run
  `muse-20261103-215618-b620`, $0.46, 237 s).
  - The gate accepted the designer and literature reports.
  - It escalated the critique (held-out risk, plus error UCB 0.88 ≥ 0.5).
  - The Wonder verifier returned CORRECTED: the critic had proposed a held-out
    test of H5 before any development-stage test, which the lab's rules
    forbid.
  - This is one qualitative observation, not a measured rescue rate.
- **The critic's analysis is recorded before verification.**
  - Posterior updates come from the experiment's numbers via the
    pre-registered rule, never from the critic's text.
  - The interpretation is shown as unverified until the gate rules. It then
    shows one of: not escalated, confirmed, corrected (with the verifier's
    correction) or rejected.
  - In the live run above, the analysis was recorded first and corrected
    afterwards. That run does not include this explicit tracking field.
- **Evidence.** `record_evidence` verifies the source (re-fetched by id, title
  matched, not retracted). The claim is an agent's summary and is not checked
  against the paper.
- **Proxy and deployment.**
  - The web app's `/lab-proxy` relays only to `NOESIS_LAB_ORIGINS`
    (comma-separated; in development it defaults to `http://127.0.0.1:8765`
    and `http://localhost:8765`).
  - It refuses redirects.
  - Starting runs and answering approvals depend on the app server's mode:
    - **Development:** open, for the local bridge on your machine.
    - **Production without `NOESIS_LAB_WRITE_TOKEN`:** read-only. The UI says
      so and new runs start from a local lab.
    - **Production with `NOESIS_LAB_WRITE_TOKEN`:** an operator types the token
      once in the app (Unlock runs). The server checks it and sets a signed
      HttpOnly, SameSite=Strict, Secure session cookie (8 h, `Path=/lab-proxy`).
      Writes then need that cookie and must come from the app's own origin
      (`NOESIS_PUBLIC_ORIGIN` names it behind a reverse proxy).
  - Development and production come from the build (`vite dev` vs
    `vite build`), not from `NODE_ENV`. Cloudflare Workers set no `NODE_ENV`,
    and a deployed build must never fall back to open writes.
  - Settings are read from Cloudflare variables and secrets, or from
    `process.env` on Node.
  - The token is never placed in frontend code or browser storage. Rotating
    it ends every session. Scripts may send it in the `x-noesis-lab-token`
    header instead.
  - Sessions are stateless (signed expiry, no server-side store). "Lock runs"
    clears the browser's cookie, but a copied cookie value stays valid until
    it expires (8 h) or the token is rotated.
  - There is no sign-in rate limiting, so use a long random token.
  - Smoke-tested on the built Cloudflare Worker running locally (`wrangler
    dev`), not yet on a real deployment.
  - The proxy authenticates to the bridge with the server-side secret
    `NOESIS_BRIDGE_TOKEN` (`X-Noesis-Bridge-Token` header). A production build
    without it refuses to relay.
- **The bridge authenticates every request when hosted.** Started with
  `--require-auth` and a token file, it answers any request without the token
  with 401. Without a token it is local-only (loopback) and must never be
  published. Agents never receive the token. See `deploy/lab/README.md` for
  the Linux host (HTTPS via Caddy, persistent state, server-side Meta key).
- **The MCP tool server fails closed.** If `DISCOLAB_TOOLS` is missing, empty
  or names an unknown tool, it serves no tools and exits.
- **Muse Code is required on the machine running the lab.** The browser only talks
  to the bridge.
