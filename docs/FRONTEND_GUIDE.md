# Frontend guide

Noesis is a React 19 / TanStack Start application built with Vite. Its public
route is one workspace at `/`: ask a question, follow the agents, inspect the
decision, and read the report without navigating through separate chapters.
The code of record is `frontend/src/routes/index.tsx`,
`frontend/src/workspace/`, and `frontend/src/noesis/`.
The frontend CI job and local commands in this guide run in `frontend/`.
There is also a separate root `src/` web-app tree; check the host's configured
source directory before assuming its deployed build matches this tested tree.

## Researcher journey

1. **Ask:** `Workspace.tsx` shows the question form, examples, connection
   status, and runs available from the connected lab. The submit button
   requires at least 10 trimmed characters.
2. **Follow:** `useRun.ts` owns idle, starting, running, complete, and failed
   phases. The running stage keeps the question visible and shows a live
   `NodeMap`, activity timeline, and `DecisionConsole`. The trace drawer
   exposes lower-level events without filling the main stage.
3. **Inspect:** completion opens `Report` and `Insights`. The user can revisit
   the agent map, decision and trace, or print the report to PDF. Narrow screens
   expose these surfaces as tabs in the same workspace.

`LabContext.tsx` discovers run sources, loads state and activity, follows
server-sent events, and refreshes the run record. The lab owns measurements and
state transitions; the browser presents them. `workspace/model.ts` owns
evidence labels, verdict display rules (including interval-crossing-zero
downgrades), and shared budget formatting, with tests in `model.test.ts`.
Open-research hypotheses remain untested; only the registered GA/entropy lab
mode can show executed experiments.

## Data and trust boundary

```text
Browser workspace → same-origin /lab-proxy → authenticated Python bridge /lab/*
                  → Muse agents, ledger and numerical artifacts
```

| Path | Purpose |
|---|---|
| `src/routes/index.tsx` | Root route and page metadata. |
| `src/workspace/Workspace.tsx` | Ask/run/report composition and visible status. |
| `src/workspace/useRun.ts` | Run phases, start/failure handling, optional replay. |
| `src/workspace/DecisionConsole.tsx`, `NodeMap.tsx`, `TraceConsole.tsx`, `Report.tsx` | Decisions, agent map, trace and report. |
| `src/noesis/lab/LabContext.tsx` | Source discovery, snapshots, SSE and run-record refresh. |
| `src/noesis/api/lab.ts`, `lab-types.ts`, `sse.ts` | Typed lab requests and stream parsing. |
| `src/routes/lab-proxy.$.ts`, `src/noesis/api/lab-proxy-policy.ts` | Server-side relay, origin allow-list, write policy and bridge authentication. |

The browser never receives the Meta key or bridge token. The server-side relay
accepts only its named paths and upstream origins in `NOESIS_LAB_ORIGINS`,
and rejects upstream redirects. With no configured origins, development
permits only the local bridge on port 8765; production permits none.
`VITE_LAB_URL` is a public destination hint, not a credential.

Production writes use one of three modes: `NOESIS_PUBLIC_TRIAL=1` for
bridge-limited visitor runs, an operator token for signed-in operator writes,
or read-only. The operator token is exchanged at `/lab-proxy/session` for a
signed, HttpOnly, SameSite=Strict cookie. “Lock” clears it in this browser;
because sessions are stateless, a copied cookie remains valid until its
eight-hour expiry or token rotation. Development permits writes to a local
bridge. See [Lab endpoint](LAB_RUNS_ENDPOINT.md) and
[System architecture](SYSTEM_ARCHITECTURE.md).

## Recording and unavailable states

`useRun.ts` can replay a real static recording from
`frontend/public/recordings/demo.json` when one is installed. **This file is
not shipped in the current checkout.** Without a connected lab or a static
recording, the UI shows an honest empty state. A connected bridge can still
serve the committed run under `discolab/results/recorded-open-question/`.
Never replace unavailable evidence with invented fixture results. The format
and export procedure are in [Recorded demonstration format](RECORDING_FORMAT.md).

## Extending and verifying

Keep new lab fields synchronized across the Python bridge, `lab-types.ts`,
`lab.ts`, and tests. Put derived presentation rules in `model.ts`; leave
scientific computation in the lab. Make loading, failure, live, recorded,
open-research, and lab-mode states explicit. Check keyboard focus, labels,
reduced motion, mobile layout, and textual chart summaries.

From the repository root:

```powershell
Set-Location .\frontend
npm ci
npx tsc --noEmit -p .
npm test
npm run build
npm run dev -- --port 5173
```

There is no committed automated screenshot capture script. The screenshots in
`docs/walkthrough/` document a fixture-based usability walkthrough, not a
hosted end-to-end test. Use the [demo guide](hackathon/DEMO.md) for a manual
question-to-report check.
