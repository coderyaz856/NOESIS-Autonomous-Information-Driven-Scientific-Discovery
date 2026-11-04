# Bring the updated GitHub version into the app so live runs work

Note: Lovable can't link an existing GitHub repository (connecting always makes a new one). I downloaded the public repo and compared it with the app instead. The updated lab now really starts runs from a typed question, asks for human approvals, and requires a secret access token. The app's current relay doesn't speak that yet, which is why "live" can't work today.

## What changes for visitors
- Typing a question starts a real run on your hosted lab (no more silent fall-back to a recording when the lab is reachable).
- The ask screen shows whether live runs are available, the trial/budget limits the lab reports, and if a run is already in progress (with a button to watch it).
- Questions outside the lab's pre-registered domain run in "open" research mode; the report labels this clearly ("nothing was executed: literature, hypotheses and proposed protocols only").
- When the lab pauses for an approval before an experiment, the timeline shows an Approve / Decline card (only for whoever is allowed to write).
- Live progress shows spend vs. budget and run status from the lab's run record.
- Clear messages for: run already in progress, trial limit reached, lab refused access, lab not configured.
- Recording fallback stays only for when no lab is configured/reachable, still labelled RECORDED.

## Security (from the updated repo)
- The relay only forwards to lab addresses you configure on the server, not any address typed in the browser.
- The lab's access token is added on the server; it never reaches the browser.
- Write access mode: public trial (anyone can start a run; the lab enforces limits) or operator-only (sign in once with a password-like token, kept in a secure cookie).

## What you need to do
1. Host the lab (the repo's Hugging Face Space / Docker setup in `deploy/`) started with `--enable-runs --require-auth`, with your Meta key and a bridge token.
2. Give me, through the secure secrets form: the lab address, the bridge token, and choose trial vs. operator mode (operator also needs a write token).

## Technical details
- Port `frontend/src/noesis/api/lab-proxy-policy.ts` (origin allow-list `NOESIS_LAB_ORIGINS`, no redirects, write modes, signed session cookie, `X-Noesis-Client` visitor id) plus its tests into the project; rewrite `src/routes/lab-proxy.$.ts` on top of it, keeping the soft "offline"/"unavailable" responses that prevent blank screens. Add `capabilities`, `run`, `approvals`, `session` paths; send `X-Noesis-Bridge-Token` from `process.env`.
- Update `lab-types.ts` and `lab.ts` to the repo's versions (LabCapabilities, LabRun, LabStartRunResponse, LabSession, new SSE `run` event).
- `LabContext`: default lab address from server config instead of 127.0.0.1; load capabilities; handle `run` events.
- `useRun.ts`: handle 201 `{source, mode}`, 409 run_in_progress (offer to open it), 401/403, 429 trial limits; only fall back to the recording when offline/unconfigured. Expose `mode`, run record and approvals.
- Workspace/Report: capabilities note on Ask, approval cards in timeline, spend/status chip, open-mode banner and report sections. Display rules (mode label) go in `model.ts` with tests.
- Secrets: `NOESIS_LAB_ORIGINS`, `NOESIS_BRIDGE_TOKEN`, `NOESIS_PUBLIC_TRIAL` or `NOESIS_LAB_WRITE_TOKEN` + session signing secret.
- Update docs/LAB_RUNS_ENDPOINT.md, AGENTS.md, roadmap, migration ledger. Verify relay with tests and Playwright; live run end-to-end only once the hosted lab address and token exist.
