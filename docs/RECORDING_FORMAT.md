# Recorded demonstration format

The workspace optionally fetches `/recordings/demo.json` from
`frontend/public/recordings/demo.json`. **No static recording is shipped in
this checkout.** If neither a lab nor this file is available, the UI shows an
explicit empty state. A local read-only bridge can independently serve the
committed `discolab/results/recorded-open-question/` source; it does not
require a model key.

A static recording must come from a real run and retain its original
question. If the visitor typed a different question, the UI labels the
substitution and the evidence remains `RECORDED`, never `LIVE`.

## JSON contract

The `Recording` type is defined in
`frontend/src/workspace/useRun.ts`; `LabState`, `LabActivity`, and
`LabExperiment` are in `frontend/src/noesis/api/lab-types.ts`.

```json
{
  "source_id": "results/<run-name>",
  "recorded_at": "<UTC ISO-8601 timestamp>",
  "state": { "question": "<original question>", "...": "GET /lab/state response" },
  "activity": ["the activity array from GET /lab/activity"],
  "experiments": { "E1": { "...": "GET /lab/experiment response for E1" } }
}
```

`experiments` contains the results of every completed experiment referenced
by `state.completed`. Open-research runs may have none. Do not fabricate
missing experiment entries or rewrite the original question.

## Creating a recording

1. Start the bridge in read-only mode from `discolab/`:
   `python -m discolab.bridge --port 8765`.
2. Pick an ID returned by `GET /lab/sources`; retrieve
   `/lab/state?source=...`, `/lab/activity?source=...`, and each required
   `/lab/experiment?source=...&id=...` from that same source.
3. Assemble the JSON contract above and place it at
   `frontend/public/recordings/demo.json`. Record the export time and source
   ID. Review it for private prompts, credentials, and personal data before
   committing or publishing.
4. Open the app without a connected lab. Verify that the recording label,
   original question, experiment count, and report all agree with the source.
   Check that the static file never triggers paid calls.

A hosted bridge with authentication requires its token at the server boundary;
do not put that token into a static export command, browser file, or Git
artifact. Prefer exporting from an unauthenticated loopback-only read-only
bridge over committed public evidence.
