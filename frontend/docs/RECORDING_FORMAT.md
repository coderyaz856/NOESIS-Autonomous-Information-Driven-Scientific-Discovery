# Recorded demonstration format

Put a real recorded run at `public/recordings/demo.json`. The website replays it step by step and always labels it **RECORDED DEMONSTRATION**. Without this file, visitors with no lab connected see the empty state. No invented data is ever shown.

```json
{
  "source_id": "results/<run-name>",
  "recorded_at": "2026-11-01T10:00:00Z",
  "state": { "...": "exact response of GET /lab/state?source=results/<run-name>" },
  "activity": [ "...exact `activity` array of GET /lab/activity?source=…" ],
  "experiments": { "<experiment id>": { "...": "GET /lab/experiment?source=…&id=<id>, for every id in state.completed" } }
}
```

## Export with a running lab feed

```bash
SRC=results/<run-name>; LAB=http://127.0.0.1:8765
python3 - "$SRC" "$LAB" <<'PY'
import json, sys, urllib.request, urllib.parse, datetime
src, lab = sys.argv[1], sys.argv[2]
get = lambda p, **q: json.load(urllib.request.urlopen(f"{lab}/lab/{p}?" + urllib.parse.urlencode({"source": src, **q})))
state = get("state")
out = {"source_id": src, "recorded_at": datetime.datetime.utcnow().isoformat() + "Z",
       "state": state, "activity": get("activity")["activity"],
       "experiments": {i: get("experiment", id=i) for i in state["completed"]}}
json.dump(out, open("demo.json", "w"))
PY
```

Then attach `demo.json` in chat so it can be added to the project.
