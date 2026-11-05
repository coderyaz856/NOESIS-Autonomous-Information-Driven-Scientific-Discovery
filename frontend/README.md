# Noesis browser workspace

This package is the React 19 / TanStack Start frontend for the Noesis research
lab. It presents one question-to-report workspace: ask, follow the agent and
tool trace, inspect the decision, then read the evidence report. It is not the
numerical authority; scientific state and measurements come from `discolab`.

The browser uses the same-origin `/lab-proxy` route. The server-side route
forwards only to allowed lab origins and adds the bridge token; neither the
Meta Model API key nor the bridge token belongs in client code or a `VITE_`
variable. See the [frontend guide](../docs/FRONTEND_GUIDE.md),
[lab API contract](../docs/LAB_RUNS_ENDPOINT.md), and
[system architecture](../docs/SYSTEM_ARCHITECTURE.md).

## Local development

From the repository root, start the read-only lab bridge in one terminal as
shown in the [root README](../README.md#try-it-locally). In another terminal:

```powershell
Set-Location .\frontend
npm ci
npm run dev -- --port 5173
```

Open <http://localhost:5173>. A read-only bridge can serve committed run
records without a model key. Live runs require explicit run enablement,
Muse Code, and a Meta credential kept outside the repository; follow the
[demo guide](../docs/hackathon/DEMO.md) before incurring provider charges.

## Verification

```powershell
npx tsc --noEmit -p .
npm test
npm run build
```

`src/workspace/` owns the ask/run/report presentation and derived display
rules. `src/noesis/` owns typed lab data and streaming. `src/routes/` owns the
root route and server-side relay. Keep API fields synchronized with the
Python bridge and preserve `LIVE`, `RECORDED`, and unexecuted-study labels.
