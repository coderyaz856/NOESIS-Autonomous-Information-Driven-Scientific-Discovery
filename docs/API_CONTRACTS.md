# HTTP and streaming API contracts

> **Scope:** this page documents the optional FastAPI control plane in
> `backend/`. It is not the lab path the Muse demo uses. The lab bridge
> (`discolab/discolab/bridge.py`) serves the `/lab/*` endpoints listed in the
> module's docstring and the [lab-run contract](LAB_RUNS_ENDPOINT.md). When a
> bridge token is configured
> (`NOESIS_BRIDGE_TOKEN_FILE` or `NOESIS_BRIDGE_TOKEN`, at least 32 characters;
> hosted bridges start with `--require-auth`, which refuses to start without
> one), every request must carry the `X-Noesis-Bridge-Token` header or it is
> answered `401`. Without a token the bridge listens on loopback only;
> starting runs additionally needs `--enable-runs` (otherwise `403`).
> The deployed bridge, its token handling
> and its optional public-trial limits are described in
> [`deploy/huggingface/README.md`](../deploy/huggingface/README.md).

The optional backend is a FastAPI application. In local development its
direct origin is `http://localhost:8000`. The current browser workspace uses
the **separate** `/lab-proxy` → `/lab/*` path; do not assume the TanStack Start
server forwards these FastAPI `/api/*` routes.

FastAPI also exposes generated interactive documentation at `/docs` and the OpenAPI schema at `/openapi.json`.

## Contract conventions

- JSON requests use `Content-Type: application/json`.
- Timestamps are ISO-8601 strings in UTC unless a request explicitly supplies an offset.
- Catalogue endpoints return empty arrays until application code registers entries.
- `quality` is maximized; `cost`, `latency`, and `risk` are minimized.
- Unknown values are not synthesized. API architecture candidates currently require numeric metrics.
- The FastAPI control plane itself has no authentication layer; run it only on
  a trusted local interface. (The lab bridge is authenticated; see the scope
  note above.)

### Error envelope

Every handled non-2xx response uses:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Human-readable explanation.",
    "details": {}
  }
}
```

Defined application errors are `404 not_found`, `422 validation_error`, and
`502 provider_error`. FastAPI request-shape failures use
`422 request_validation_error`; unexpected failures use `500 internal_error`.
The TypeScript client models errors as `ApiError` in
`frontend/src/noesis/api/client.ts`.

## Endpoint summary

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Root health check for operators and load balancers. |
| `GET` | `/api/health` | API-prefixed form of the same health check. |
| `GET` | `/api/system/capabilities` | Read the in-memory capability catalogue. |
| `GET` | `/api/system/architectures` | Read measured architecture candidates in the registry. |
| `POST` | `/api/system/pareto-frontier` | Classify caller-supplied candidates as frontier or dominated. |
| `POST` | `/api/system/evaluate-policy` | Evaluate capability requirements against denials and leases. |
| `POST` | `/api/system/resolve-fallback` | Select the first eligible fallback in explicit preference order. |
| `GET` | `/api/stream/heartbeat` | Finite five-event SSE heartbeat used to verify streaming. |

## Health

`GET /health` and `GET /api/health`

```json
{
  "status": "ok",
  "version": "0.1.0",
  "time": "2026-10-03T12:00:00+00:00"
}
```

## Capability catalogue

`GET /api/system/capabilities`

```json
{
  "capabilities": [
    {
      "name": "draft",
      "description": "Create a draft response",
      "implies": ["read"]
    }
  ]
}
```

`name` is the stable capability identifier. `implies` is a directed implication list expanded by the policy engine.

## Architecture catalogue

`GET /api/system/architectures`

```json
{
  "architectures": [
    {
      "id": "selective-verifier-v0",
      "name": "Selective verifier",
      "quality": 0.83,
      "cost": 0.00005,
      "latency": 1378.0,
      "risk": 0.17,
      "metadata": {"evidence_state": "BENCHMARK"}
    }
  ]
}
```

The registry starts empty. Only complete, measured candidates should be published.

## Pareto classification

`POST /api/system/pareto-frontier`

Request:

```json
{
  "candidates": [
    {"id": "lean", "quality": 0.75, "cost": 1.0, "latency": 10.0, "risk": 0.25},
    {"id": "careful", "quality": 0.90, "cost": 2.0, "latency": 20.0, "risk": 0.10}
  ]
}
```

Response:

```json
{
  "frontier": ["careful", "lean"],
  "dominated": []
}
```

A candidate dominates another only when it is no worse on all four objectives and strictly better on at least one. Candidate IDs must be unique.

## Capability policy evaluation

`POST /api/system/evaluate-policy`

Request:

```json
{
  "capabilities": [
    {"name": "read", "description": null, "implies": []},
    {"name": "draft", "description": null, "implies": ["read"]}
  ],
  "requirements": [
    {"capability": "read", "mandatory": true},
    {"capability": "export", "mandatory": false}
  ],
  "denied": ["export"],
  "leases": [
    {
      "capability": "draft",
      "allowed": true,
      "task_scope": "alpha",
      "expires_at": null,
      "max_calls": null,
      "calls_used": 0,
      "source": "profile"
    }
  ],
  "task_scope": "alpha"
}
```

Response:

```json
{
  "allowed": true,
  "granted": ["draft", "read"],
  "denied": ["export"],
  "missing_mandatory": [],
  "missing_optional": ["export"],
  "reasons": [
    "all mandatory capabilities are satisfied",
    "missing optional capability 'export'"
  ]
}
```

`expires_at` must be ISO-8601. A lease is usable only when it is allowed, in scope, unexpired, and below `max_calls`. Missing mandatory requirements make `allowed` false; missing optional requirements do not.

## Fallback resolution

`POST /api/system/resolve-fallback`

Request:

```json
{
  "candidates": [
    {
      "id": "primary",
      "available": false,
      "capabilities": ["read"],
      "privacy_class": "restricted",
      "allowed_tasks": ["review"]
    },
    {
      "id": "local",
      "available": true,
      "capabilities": ["read"],
      "privacy_class": "restricted",
      "allowed_tasks": ["review"]
    }
  ],
  "mandatory_capabilities": ["read"],
  "accepted_privacy_classes": ["restricted"],
  "task": "review",
  "preference_order": ["primary", "local"],
  "capabilities": []
}
```

Response:

```json
{
  "selected_id": "local",
  "considered": ["local", "primary"],
  "rejected": [{"id": "primary", "reason": "unavailable"}],
  "reason": "selected 'local' as the first preference-order candidate that satisfied every constraint"
}
```

Resolution is deterministic and order-sensitive. A candidate can be rejected for availability, capability, privacy-class, or task-scope failure. A higher model score cannot override these checks.

## Server-Sent Events

`GET /api/stream/heartbeat` returns `text/event-stream` with `Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no`.

Each of the five frames has this shape:

```text
event: heartbeat
data: {"tick": 0, "time": "2026-10-03T12:00:00+00:00"}

```

The frontend subscribes with `subscribeSSE(path, handlers)` and must explicitly listen for the named `heartbeat` event.

## Keeping frontend and backend synchronized

When an endpoint changes:

1. Update its Pydantic request/response model in `backend/app/api/routes/`.
2. Update the matching TypeScript interface in `frontend/src/noesis/api/types.ts`.
3. Update or add the wrapper in `frontend/src/noesis/api/system.ts`.
4. Add a backend contract test that asserts status and exact response shape.
5. Run backend tests, frontend type checking, and the production build.

