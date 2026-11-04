# Proposed lab endpoint: start a run

The website can start a new discovery run when the lab supports this endpoint. Until then, it falls back to the bundled recorded demonstration and labels it as a recording.

## Request

`POST /lab/runs`

```json
{ "question": "Does population entropy warn of stagnation earlier than fitness history?" }
```

- `question` is a string of 10–1000 characters. The website relay rejects anything else and caps the body at 4 KB.
- The lab decides whether the question fits a pre-registration. It must not invent hypotheses outside it unless they are labelled agent-generated, as the claims policy requires.

## Responses

| Status | Body | Website behaviour |
|---|---|---|
| 201 / 200 | `{ "source": "lab_home/<run-name>" }` | Opens the run as LIVE and follows `/lab/stream?source=…` |
| 400 | `{ "error": { "code", "message", "details" } }` | Shows "The lab did not accept this question" with the message |
| 404 / 405 / 501 | any | Treated as "lab can't start runs yet"; opens the recording, clearly labelled |
| unreachable | relay replies `{ "offline": true }` | Opens the recording, clearly labelled |
| other errors | any | Shows "Could not reach the lab", with Try again and Open recording |

`source` must be a value that `/lab/sources` also lists, with `kind: "live"`, so `/lab/state`, `/lab/activity`, `/lab/experiment` and `/lab/stream` work unchanged.

## Notes for `discolab/discolab/bridge.py`

- Add `do_POST` that handles only `/lab/runs`. Validate the length, create `lab_home/<slug>/`, start the Omnigent run in the background, and return immediately.
- Rate-limit or require a shared token if the lab is exposed publicly. The website relay doesn't authenticate callers.
