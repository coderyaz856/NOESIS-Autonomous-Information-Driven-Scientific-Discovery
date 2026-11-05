# Lab run endpoint

`POST /lab/runs` is implemented by the Python bridge. The browser sends run
requests through its same-origin `/lab-proxy/runs` relay, which applies the
configured origin and write policies and adds the bridge token server-side.

The authoritative request, response, status-code, trial-limit and approval
contract is [Lab endpoint: start a run](../../docs/LAB_RUNS_ENDPOINT.md).
The [frontend guide](../../docs/FRONTEND_GUIDE.md) describes the browser's
loading, failure, live and recorded states. A recording is never substituted
silently for a failed live run.
