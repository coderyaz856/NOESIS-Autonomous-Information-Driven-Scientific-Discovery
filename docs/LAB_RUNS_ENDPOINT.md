# Lab endpoint: start a run

`POST /lab/runs` on the lab bridge (`discolab/discolab/bridge.py`) starts a new
Muse Code run. The browser never calls the bridge directly: it posts to the
app's same-origin `/lab-proxy/runs?target=<allowed-lab-origin>`, which adds
the bridge token (see the
[frontend guide](FRONTEND_GUIDE.md)).

The endpoint exists only when the bridge is started with `--enable-runs`. When a
bridge token is configured, every request needs the `X-Noesis-Bridge-Token`
header (otherwise `401`, before any work is done).

## Request

```json
{ "question": "Does population entropy warn of stagnation earlier than fitness history?",
  "rounds": 1, "ceiling_usd": 2.0 }
```

- `question`: 8–600 characters after whitespace is collapsed. Required.
  The current browser form requires at least 10 trimmed characters before
  enabling **Investigate**; the bridge's 8-character rule is authoritative
  for direct API callers.
- `rounds` (optional, default 1) and `ceiling_usd` (optional, default 2.0) are
  clamped to 1–2 rounds and $0.25–$5.00. `ceiling_usd` is a soft guard on the
  estimated spend, not a billing cap.
- With the bounded public trial enabled (`NOESIS_TRIAL_TOTAL_USD`, see
  `discolab/discolab/trial.py`), every run gets 1 round and the trial's per-run
  guard instead, and the trial's spend and rate limits apply.

Every question is accepted. A scope check decides the mode: questions about the
pre-registered genetic-algorithm/entropy study run in **lab** mode (seeded
experiments), all others in **open-research** mode, which proposes studies but
executes none.

## Responses

| Status | Body | Meaning |
|---|---|---|
| `201` | `{ "source": "lab_home/<run>", "run_id", "scope", "mode", "rounds", "ceiling_usd" }` | Run started in the background; follow it with `/lab/run`, `/lab/activity` and `/lab/stream?source=…` |
| `400` | `{ "error": { "code": "bad_question" or "bad_request", "message" } }` | Question length or request body invalid |
| `401` | `{ "error": { "code": "unauthorized", … } }` | Missing or wrong bridge token |
| `403` | `{ "error": { "code": "runs_disabled", … } }` | Bridge started without `--enable-runs` |
| `403` | `{ "error": { "code": "budget_exhausted", … } }` | Public trial only: its total budget is spent |
| `409` | `{ "error": { "code": "run_in_progress", "message", "source" } }` | One live run at a time; `source` names the active run |
| `429` | `{ "error": { "code": "rate_limited", … } }` | Public trial only: a rate limit was reached |
| `502` | `{ "error": { "code": "scope_check_failed", … } }` | The scope check could not run |
| `503` | `{ "error": { "code": "budget_store_not_durable" or "budget_store_unreadable", … } }` | Public trial only: its spend record is not on durable storage, or is unreadable |

The returned `source` is also listed by `/lab/sources` as a live lab, so
`/lab/state`, `/lab/activity`, `/lab/experiment` and `/lab/stream` work on it
unchanged.

## Related endpoint

`POST /lab/approvals` with `{ "source", "id": "E#", "decision": "approve" | "decline" }`
answers a pending human-approval request for a confirmatory experiment
(`404` if there is none, `409` if it was already decided). It also requires
`--enable-runs`. The browser sends it through `/lab-proxy/approvals`; the
same server-side write policy and origin allow-list apply. Approval authorizes
the frozen experiment and is recorded before execution; an unanswered
request is declined when its wait expires.
