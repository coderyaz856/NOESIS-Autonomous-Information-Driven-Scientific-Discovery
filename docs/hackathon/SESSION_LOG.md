# Meta Global AI Developer Hackathon — working session log

Running log of the Indie-track build session (Muse integration). Newest
entries at the bottom of each section. No secrets are recorded here: the
Model API key lives outside the repository and is only loaded into process
input (`--api-key-stdin` / request headers), never written or printed.

Session start: 2026-11-03 ~18:20 local (ET). Submission deadline:
**2026-11-04 21:00 ET** (Cerebral Valley platform).

---

## 1. Requirements read (official sources)

Read in Chrome on 2026-11-03:
- Event page: https://cerebralvalley.ai/e/meta-ai-developer-hackathon
- Participant guide: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details
- Meta Model API docs: https://dev.meta.ai/docs (overview, agent frameworks,
  SDKs, pricing and rate limits, cookbook, Muse Code extending)

Rules that shape this work:
- Project must use Meta models (Model API and/or open weights). Stage-one
  judging is pass/fail on theme fit and real use of Meta Model API.
- Repository must be **public**; submission needs a **3-minute demo video**.
- **New work only**: the demo may only show what was built during the event
  (Oct 26 – Nov 4) and judges must be able to identify it. This repository's
  last pre-event commit is `0c0850e` (2026-10-19); everything after it is
  hackathon work.
- Indie track rubric: Impact 30%, Use of Meta AI tooling 25%, Technical depth
  & execution 20%, Demo 25%. Bonus: Best Agentic Use-Case ($5K).
- Anti-projects list does not include this project type.

## 2. Decisions (with the user)

| # | Decision | Why |
|---|---|---|
| D1 | Use Meta Model API + the $150 credits only; no Baseten. | User instruction. |
| D2 | Agent harness = **Muse Code** (`muse` CLI 1.4.14), Meta's first-party agent runtime, instead of Omnigent's Claude-SDK harness. | User: "use official harness of meta ai agents". Meta has no agent library; its docs use third-party harnesses (Claude Agent SDK, Codex, Hermes, OpenCode) except Muse Code. |
| D3 | Muse Code installed by the user (antivirus blocked the installer script when run by the agent). | Not bypassing security tooling. |
| D4 | Standard mode only, no Contributor mode. | User: no sharing of prompts/outputs. |
| D5 | Budget: spend what the benchmark and its statistics need (working cap **$25**), keep **≥ $100** of credits for the app/demo. | User answer 2026-11-03. |

## 3. What was built (this session)

### Muse Code runtime for the discovery lab (`discolab/`)
- `discolab/discolab/muse.py` — runs each agent role (PI, literature,
  designer, critic) as one headless `muse exec --json` process on Meta Model
  API. Each role gets a stdio MCP server serving **only its allow-listed lab
  tools** (allow-lists reused from the original agent bundle), with
  `DISCOLAB_ACTOR` attribution. Harness shell / write / web tools disabled.
  Normalized activity (hand-offs, tool calls, messages, token usage, cost) →
  `<lab>/activity.jsonl`; raw Muse event streams → `<lab>/muse/`.
- `discolab/muse_agents/config.yaml` — frozen per-role model / effort /
  step caps; spend ceiling; approval wait. `pi.md` — PI instructions (same
  scientific doctrine as the original bundle; dispatch via `delegate`).
- `discolab/discolab/mcp_server.py`:
  - every tool call logged (actor, args, ok/error, ms) under the Muse runtime;
  - new PI-only tool **`delegate`** — launches specialist Muse Code agents
    (parallel within one call), returns their reports, refuses new work once
    the run's spend ceiling is reached;
  - **human approval gate** moved into the tool layer for this runtime:
    a confirmatory (held-out) `run_experiment` writes
    `<lab>/approvals/<id>.json` = pending and waits for a human decision;
    no answer → declined (fail closed);
  - per-role tool filtering from `DISCOLAB_TOOLS`.
- `discolab/discolab/scope.py` — scope gate: one structured Muse Spark call
  maps a free-text question onto the pre-registered hypotheses or refuses it
  (the lab can only execute its GA / entropy-stagnation domain).
- `discolab/discolab/run.py` — `python -m discolab.run start|drive|status`:
  scope check → fresh lab under `lab_home/<run>` → frozen `run.json`
  (question, scope result, config, Muse version, prereg hash, pricing source,
  ceiling) → PI run → final report, usage and cost recorded.
- `discolab/pyproject.toml` — explicit package (editable install was broken
  by flat-layout discovery); Omnigent moved to an optional extra; `mcp<2`
  pinned (the server uses the v1 FastMCP API).
- Tests: `discolab/tests/test_muse_runtime.py` (allow-lists per role, key-file
  formats, cost maths, spend ceiling, approval gate fail-closed / approve).
  `discolab/tests/test_bridge_runs.py` (run launcher, approvals, scope refusal).
  Full lab suite: **127 passed**.

### Run launcher + live UI
- `discolab/discolab/bridge.py --enable-runs`: `POST /lab/runs` (scope check →
  detached Muse Code run; 422 `out_of_scope` with the supported domain; 409 if
  a run is active; rounds ≤ 2, ceiling ≤ $5), `POST /lab/approvals`
  (approve/decline once), `GET /lab/run` (status, spend vs ceiling, tokens and
  cost per agent, active agents, approvals, final report),
  `GET /lab/capabilities`. Writes are refused (403) without `--enable-runs`.
- Frontend: the question box (`CommandSurface.tsx`) now starts a real run
  (it previously only said "staged"); shows the out-of-scope reason plus the
  supported domain; visible on home immediately. New `lab/RunPanel.tsx` (run
  status, models, spend meter, per-agent table, approve/decline buttons, PI
  report). `/lab-proxy` relays the two POST paths (JSON ≤ 4 KB).
- Portability fix: the root `.gitignore` rule `lib/` (Python template) hid
  `frontend/src/lib/`, so a fresh clone could not build the frontend. Rule
  anchored to `/lib/`; the four missing modules recreated (`utils.ts` `cn`,
  error capture/page, console-only error hook). `package-lock.json` re-synced
  (`npm ci` failed on two missing `@emnapi` entries).
- Frontend tests: `src/test/command-surface.test.tsx` (starts a run, out-of-scope
  refusal, read-only feed) — 4 passed; `tsc` clean; `vite build` OK.

### Benchmark
- `backend/app/providers/meta.py` — Meta Model API provider (chat completions;
  optional default `reasoning_effort`). `pilot.build_provider` gained a `meta`
  branch using `reasoning_effort=minimal` (reasoning tokens count against the
  protocol's 256-token cap).
- First pass (`muse_v1.py` collector + `muse_v1_analysis.py`): 480 dev+tuning
  observations, $0.69 — arms A (4 models, Baseline protocol), R (repeat), B
  (4096 tokens, medium effort). **Superseded as the headline benchmark**: the
  analysis was a partial re-implementation (it did not run the pre-hackathon
  pipeline itself; CVaR was applied per model instead of per policy). Kept
  only as supplementary data (run-to-run agreement, budget arm).
- **Muse-only rerun of the pre-hackathon Architecture Baseline v0**
  (`backend/app/benchmark/muse_baseline_v1.py`): runs the unchanged
  `baseline_execute.execute()` pipeline with Muse models in the v0 slots
  (Qwen → Spark 1.3, GPT-OSS → Wonder 1.0, DeepSeek → Spark 1.2; diagnosis
  probes all four Muse models). Output root `benchmark/muse_baseline_v1/`;
  report `benchmark/reports/MUSE_BASELINE_V1.md`. The v0 report's headline is
  fixed prose about v0's outcome, so the rerun replaces it with a headline
  computed from the Muse summary (validated: on the v0 summary it reproduces
  v0's 16.0% cost / 35.2% latency / 0 rescues). Limits $3.00 / 250 calls.

## 4. Measured results so far (live, Meta Model API)

| Check | Result |
|---|---|
| Key + endpoints | `/v1/models` lists muse-wonder-1.0, muse-spark-1.3/1.2/1.1 (+contributor variants), muse-image-1.0, sam-3.1, muse-voice-transcribe-1.0. Messages API accepts Bearer and x-api-key. |
| Reasoning vs `max_tokens` | Reasoning tokens count against `max_tokens`: with 64 tokens chat-completions returned no text (62 reasoning tokens, finish=length). Relevant to the 256-token benchmark cap. |
| Muse Code + lab MCP (1 tool) | Works. `--preset empty` 38,009 input tokens vs `native-basic` 54,323 for the same probe; prompt caching works across runs. |
| **Real delegation smoke test** (`lab_home/smoke-delegation-2`) | PI → `delegate` → designer (own Muse Code process) → `get_research_state`, `list_design_space`, `propose_experiment`×2, `score_experiments` → PI reports the scoring table copied from the tool (E1 EIG 0.663 bits, U 0.659; E2 0.334 bits; argmax E1). 9 model calls, 182,288 input tokens (138,007 cached), 3,130 output, **$0.089**, 36 s. Ledger: 2 proposals + 1 scoring round, attributed to `designer`. |
| First attempt (`smoke-delegation-1`) | Failed: nested Muse process could not find the binary (MCP servers only get declared env vars) and a logging bug masked the error. Fixed; recorded, not hidden. |

| **Browser → agents → ledger → UI** (`lab_home/muse-20261103-191935-6a56`) | Question submitted in Chrome at `localhost:5173`; scope check in scope (H1); run completed in 195 s, 26 model calls, **$0.29** of a $2 ceiling. PI delegated to literature (9 calls, $0.12), designer (5, $0.05), critic (3, $0.04). Ledger: 19 events attributed to pi/literature/designer/critic/operator — proposals, scoring, selection, 1 completed development experiment, analysis, decision. H1 posterior 0.5 → 0.973 (development stage only, not confirmed on held-out). UI showed handoffs, tool calls, spend, per-agent table and the PI report live. |
| Out-of-scope refusal (UI) | "Does gut microbiome diversity predict response to cancer immunotherapy?" → refused with reason and the supported domain; no lab created. |

### Muse-only rerun of the pre-hackathon Architecture Baseline v0 (completed)

Pipeline: unchanged `baseline_execute.execute()` via `muse_baseline_v1.py`;
232 calls (spark-1.3 79, wonder-1.0 79, spark-1.2 73, spark-1.1 1),
**$0.217** estimated (ceiling $3.00). Report: `benchmark/reports/MUSE_BASELINE_V1.md`.
The run crashed after all calls, when writing its report (reports dir missing in the new root). It was completed with
`--finish-existing` (zero calls: report + manifest hashes, same code as execute's tail).

| Result | Value |
|---|---|
| Availability | 100% Spark 1.3 / Wonder 1.0, 98.6% Spark 1.2 (1 failure / 72) |
| Correct given success (72 cases, Wilson 95%) | Spark 1.3 0.875 [0.779, 0.933]; Wonder 1.0 0.875 [0.779, 0.933]; Spark 1.2 0.845 [0.743, 0.911] |
| Held-out S0–S4 quality (12 cases) | all 0.833 [0.583, 1.000]; empirical Pareto frontier **S1 (Spark 1.3 only)** |
| S3 (Spark → selective Wonder) vs S2 (always both) | same quality; 42.8% less cost, 27.2% less latency (offline replay) |
| Provider-backed verifier | S3 and S4: 6 escalations each, 0 rescues, 0 damage |
| Complementarity (72 cases) | Spark 1.3 ↔ Wonder error correlation 0.873 [0.649, 1.000], failure Jaccard 0.80, P(Wonder right / Spark wrong) 0.111 [0.000, 0.375] — largely redundant |
| Tail risk / CVaR (`baseline_cli` exporter, offline) | held-out: all policies loss 0.167, CVaR90/95 = 1.0, flagged **unstable** (tail < 5 obs). dev (48): all policies loss 0.104, CVaR95 1.0 [0.02, 1.0]; CVaR90 equals the mean (0.104) because the frozen estimator includes every loss ≥ VaR and VaR90 = 0 on binary scores |
| Statistical resolution | every paired quality difference unresolved at 95% |

Interpretation: on this corpus the two app models fail on nearly the same cases,
so escalating Spark → Wonder buys no measured quality. Spark 1.3 alone is the
measured cost-quality choice. This supports the app's all-Spark-1.3 agent configuration.
It is not evidence of a quality improvement over v0's models: different
models, same corpus, both unresolved.

Note: the frozen v0 run never executed the `baseline_cli` CVaR exporter
(its artifact folder has no tail_risk.csv); v0's report only carries a
"Tail risk" column. The exporter outputs for Muse are under
`benchmark/muse_baseline_v1/downside_{held_out,dev}/`.

Spend so far (estimated from token usage): smoke tests ≈ $0.27, first-pass
benchmark $0.69, UI run $0.29, Muse baseline rerun $0.22, scope checks < $0.01 → **≈ $1.48**.

## 4b. Meta agents inside Noesis: dynamic escalation (S3-style) in the app

The user asked that both the benchmark and the app run on Meta agents, using
the S0–S4 dynamic-escalation structure. A0–A6 was skipped for time. Rescue is
framed as a theoretical safety case, not a measured gain.

- **Benchmark:** `python -m app.benchmark.muse_baseline_v1 --harness agent`
  reruns the unchanged Baseline v0 pipeline. Every model call is a headless
  Muse Code agent (`muse exec`, preset `empty`, tools disabled, effort
  `minimal`, max 2 model steps), with a $12 `SpendGuard` (an estimated, pre-call check at concurrency 1 that leaves room for one more call — not a provider-enforced cap). Output goes to
  `benchmark/muse_agents_baseline_v1/` and `benchmark/reports/MUSE_AGENTS_BASELINE_V1.md`.
- **App:**
  - `discolab/discolab/agent_escalation.py` contains the gate. It uses the
    same signals as the frozen benchmark gate: failure, abstention, high-risk
    (held-out or confirmatory), and the historical task-family error UCB at or
    above the threshold.
  - `delegate` runs each specialist on Spark 1.3. When the gate escalates, it
    hands the report to a Wonder 1.0 `verifier` agent, which has read-only lab
    tools and answers with a `VERDICT: CONFIRMED|CORRECTED|REJECTED` first line.
  - Every decision is logged as a `gate` activity. The PI is told how to use
    each verdict.
  - Gate provenance is frozen into each run's `run.json`: the file sha256 plus
    the source benchmark file and its hash.
  - The gate file is `discolab/muse_agents/escalation_gate.json`, frozen from
    the dev and tuning fit only. Held-out-fitted gates are refused.
- **UI:**
  - The live activity feed shows gate decisions with reasons and UCB, and the
    verifier's verdict.
  - The story terminal shows escalations and verdicts.
  - The Verifier appears as an agent card.
- **Tests:** discolab 138 passed (including `tests/test_agent_escalation.py`);
  frontend `tsc` clean, vitest 4/4.
### Agent-harness benchmark results (measured, 2026-11-03)

Report: `benchmark/reports/MUSE_AGENTS_BASELINE_V1.md`. It used 232 Muse Code
agent calls and **$8.02** of spend, estimated from tokens, under a $12 guard.

| Measure | Agent harness | API harness (same corpus) |
|---|---|---|
| Availability | 100% for all three models | 100% / 100% / 98.6% |
| Correct given success | Spark 1.3 0.875, Wonder 0.875, Spark 1.2 0.875 | 0.875 / 0.875 / 0.845 |
| Mean latency on success | about 2.8–3.0 s per agent call | lower (direct API) |
| Cost per case | Spark 1.3 $0.0197, Wonder $0.063 (about 15.5k input tokens per agent call) | about 30× cheaper |
| Held-out S0–S4 | all 0.833 [0.583, 1.000]; Pareto frontier S1 | same |
| S3 vs S2 (offline replay) | same quality, 38.0% less cost, 24.9% less latency | 42.8% / 27.2% |
| Provider-backed S3/S4 | 6 escalations each, 2 rescue opportunities, 0 rescues, 0 damage | 6 escalations each, 0 rescues, 0 damage |
| Error correlation (every pair) | 0.873 [0.649, 1.000], Jaccard 0.80 | same for Spark 1.3 ↔ Wonder |
| CVaR (`baseline_cli`, `downside_{held_out,dev}/`) | identical to the API run: held-out unstable at 1.0; dev CVaR95 1.0, CVaR90 equal to the mean 0.104 | same |
| Frozen gate (dev+tuning) | critique UCB 0.882 and tool_use_reasoning 0.964 escalate (≥ 0.5); all other families 0.434 | identical |

**Reading:**
- Spark 1.3 fails the same 9 cases under both harnesses. These are genuine
  wrong answers, not parse failures.
- Running the models through the Muse Code agent harness changed neither
  quality nor the gate. It added cost and latency through the agent system
  prompt, at about 15.5k input tokens per call.
- No quality improvement was measured. Rescue stays a theoretical safety case:
  the gate escalates the families with a high measured error rate (critique,
  tool-use reasoning), but no rescue was observed.
- The app now ships this gate. `discolab/muse_agents/escalation_gate.json`
  points to source sha `fd396c22…`, the agent run's
  `frozen_gate_configuration.json`.
- **Caveat:** raw run records still carry v0's `model_configuration`
  (`temperature 0`, `max_tokens 256`). Muse Code does not apply these; the
  deviation is listed in the frozen manifest.

Running spend total (token estimate): about $1.48 before, plus $8.02, comes
to **about $9.50 of the $150 credit**.

- **Incident:** a new file briefly overwrote the tracked
  `discolab/discolab/escalation.py` (the pre-registered experiment-escalation
  study). It was restored with `git checkout`, and the new module was renamed
  to `agent_escalation.py`.

## 4c. Any research question (open mode) and live verification

The user's direction: Noesis is a research assistant and must accept any
research question. The previous behaviour, refusing out-of-domain questions,
was removed.

**How it works now:**
- The Muse Spark scope check now only picks the mode:
  - **lab**: the pre-registered GA/entropy study, with experiments executed;
  - **open**: every other question.
- **What open mode does:**
  - The literature agent records verified OpenAlex/arXiv evidence.
  - The designer registers `open` hypotheses (status `untested`) and
    proposes protocols (ledger event `protocol_proposed`). Each protocol has a
    design, measurements, comparator, falsifier, sample size, cost and risks,
    and is `executed: false`.
  - The critic critiques them, with gate escalation to Wonder.
  - The PI records a decision.
- **Enforcement:**
  - Open-mode agents get no experiment tools (`OPEN_MODE_TOOLS` in
    `muse.py`).
  - The ledger refuses `experiment_proposed` in open labs.
  - Open-mode instructions live in `discolab/muse_agents/open/*.md`.
- **UI:**
  - The command box accepts any question, with lab and open sample chips.
  - The run panel shows the mode and the scope line.
  - Open runs get their own story: evidence → untested hypotheses →
    proposed studies (not executed) → agents at work → critique and
    verification → decision.
- **Tests:** discolab 145 passed (new `tests/test_open_mode.py`; the bridge
  test now checks both modes); frontend `tsc` clean, vitest 4/4.

**Live runs from the browser (2026-11-03):**

| Run | Mode | Cost | Time | What happened |
|---|---|---|---|---|
| `muse-20261103-215618-b620` | lab (GA/entropy) | $0.46 | 237 s | Experiment E2 executed. Gate accepted designer and literature, escalated the critic (held-out risk; UCB 0.88). Wonder verifier: **CORRECTED** (a held-out H5 test was proposed before any development-stage test). |
| `muse-20261103-220857-492b` | open (intermittent fasting and insulin sensitivity) | $0.41 | 193 s | 5 verified sources, 3 hypotheses (untested), 3 protocols (not executed), 1 decision. Critic escalated to Wonder: **CONFIRMED**. 0 tool errors. |

**Test incident:** the old bridge test called the real `start_run`, which
spawned a detached run. It failed at once because no key was set, so it
spent $0.00. It left `discolab/lab_home/muse-20261103-220340-c50e`
(gitignored). The test now stubs `LAB_HOMES` and `start_detached`.

**Spend total (token estimate): about $10.37 of the $150 credit.**

## 4d. Pre-transfer fixes (no paid calls)

1. **Lab proxy.** It only relays to `NOESIS_LAB_ORIGINS` (dev default: the
   local bridge), refuses redirects, and needs `NOESIS_LAB_WRITE_TOKEN` for
   production writes. Code: `frontend/src/noesis/api/lab-proxy-policy.ts`.
2. **Spend wording.** The spend check is relabelled as a soft, estimated
   guard throughout the UI, prompts and docs. It is not a hard cap.
3. **Evidence wording.** Sources are marked verified (identity and metadata);
   claims are marked as agent summaries (`claim_verified: false`).
4. **MCP tool allow-list fails closed.** If `DISCOLAB_TOOLS` is missing,
   empty or unknown, no tools are served and the server exits with code 2.
   The Omnigent bundle configs now pass explicit lists.
5. **Verifier ordering confirmed.** The critic's `record_analysis` (and the
   deterministic posterior update) lands before the gate runs. A new ledger
   event, `analysis_verification`, now records not_escalated, confirmed,
   corrected (with the correction), rejected or unparsed. Analyses read
   `unverified` until then.
6. **Status capsules.** The lab bridge and the optional core API now have
   separate status capsules.
7. **Entry docs.** README, discolab README, docs/README and GETTING_STARTED
   point to the Meta run path and state the open-mode and benchmark
   limitations.

**Tests:** discolab 160 passed, backend 120 passed, frontend `tsc` clean,
vitest 22 passed.

## 4e. Transfer to the Noesis `agentic-setup` branch (no paid calls)

The work above was applied to the Noesis repository's `agentic-setup` branch,
which carried only part of the lab and backend. To make it run there, the
transfer also brought:
- the experiment doctrine (`discolab/prereg.yaml` v5 with per-lab seed blocks);
- the selective-escalation protocol and its recorded evidence
  (`discolab/escalation_protocol.yaml`, `discolab/results/escalation/`);
- the backend `app/optimization` package;
- the v0 benchmark inputs and records that the Muse v1 rerun is compared
  against.

**Hosted runs.** Production proxy writes used to need a token header that the
browser could never legitimately hold. Hosted writes now work as follows:
- An operator types the token once in the app.
- The server checks it and sets a signed HttpOnly, SameSite=Strict, Secure
  session cookie.
- Writes then need that cookie and the app's own origin.
- Without `NOESIS_LAB_WRITE_TOKEN`, a hosted app is read-only, and the UI and
  docs say so.
- No token is placed in frontend code or browser storage.

**Docs.** On `agentic-setup`, `docs/README.md` and two other docs were
trimmed to link only to documents present there. The merge into `main`
restores the links to `main`'s research docs (rigor, reproducibility, sealed
study, SDK) alongside the new Meta entries.

## 4f. Clean install and hosted sign-in smoke test (2026-11-04)

- **Clean install.** `npm ci` from the committed lockfile, then `tsc` clean
  and vitest 33 passed; `vite build` succeeded (Cloudflare Worker target).
- **Fail-open bug fixed.** The proxy chose development or production from
  `NODE_ENV` at runtime, and Cloudflare Workers set none. A deployed app would
  have run as development, with writes open to anyone, even with a token
  configured. The build mode now decides; settings are read from Cloudflare
  variables and `process.env`. Three regression tests were added (vitest 36).
- **Smoke test.** The built Worker ran locally with `wrangler dev` and a
  generated test token, against a Noesis bridge with runs enabled.
  - No token configured: the app is read-only and sign-in is refused.
  - With a token:
    - no session → 401;
    - wrong token → 401;
    - cross-site sign-in → 403;
    - correct token → 200, with an HttpOnly, SameSite=Strict, Secure, 8 h
      cookie that does not contain the token;
    - cross-site or origin-less writes → 403;
    - a non-allow-listed bridge → 403;
    - sign-out clears the cookie.
  - One live run started through the session (open mode, 1 round, $0.25 soft
    guard). It was stopped as soon as its first agent call began.
  - Recorded spend: $0.0031 (classification). Two interrupted agent calls are
    unrecorded; the worst case is about $0.07 at the benchmark's average
    per-call cost.
  - A copied cookie stays valid after sign-out until expiry or token rotation
    (stateless sessions).
  - Not yet tested on a real Cloudflare deployment.

## 5. Open items / needs the user's decision

1. **`actual_api_keys.txt`** is tracked in the separate Agentic repository
   (commit `71565c2`), not in Noesis. It was not opened by the agent. If it
   holds real keys, rotate them before that repository is made public.
2. **New-work rule**: the lab, Omnigent bundle, frontend and benchmark predate
   the event. The submission must clearly separate the hackathon work (Muse
   Code runtime, delegation, scope gate, live run launcher/UI, Muse
   benchmark). Decide how to present the prior code in the video/README.
3. Commit / push: the transfer is committed locally on Noesis `agentic-setup`
   in small commits; pushing waits for the user's approval.
4. **Resolved.** The earlier suspicion was wrong. "35.15%" is not the
   35.2% latency figure: it is the simulation-compute saving from the tracked
   selective-escalation study (`discolab/results/escalation/summary.json`,
   commit 383a36b). The mean full-size/selective ratio is 1.542, and
   1 − 1/1.542 = 35.15%. The number is unchanged. Only the label was made
   precise: it now reads vs. always-full-size designs, with the CI, the
   development-stage caveat, the agreement figures and the source path.
5. **Resolved for Noesis.** The superseded first-pass `muse_v1_analysis.py` /
   `MUSE_BENCHMARK_V1.md` were not transferred; the agent-harness baseline
   (`MUSE_AGENTS_BASELINE_V1.md`) is the reported benchmark.
