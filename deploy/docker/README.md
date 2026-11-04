# Noesis lab backend image (`ghcr.io/saadqacif/noesis-lab`)

This image runs the **Noesis lab backend**: the authenticated `/lab/*` bridge, the
discolab lab (ledger, MCP tools, recorded runs) and Meta's Muse Code CLI. It is the
same image the Hugging Face Space runs.

It does **not** include the Noesis web frontend, which is developed and deployed
separately, and it does **not** include Meta inference credits. Live research runs
call the Meta Model API with **your own** Meta key and are billed to it.

| | |
| --- | --- |
| Image | `ghcr.io/saadqacif/noesis-lab` |
| Release | see [Releases](#releases) for the version tag and its immutable digest |
| Architecture | `linux/amd64` only (arm64 hosts need emulation, e.g. Docker Desktop on Apple silicon) |
| Port | `7860` (HTTP; put HTTPS in front of it for anything public) |
| User | non-root `user` (uid 1000) |
| Persistent data | `/data` (`NOESIS_DATA_DIR`): run ledgers, agent activity, reports, trial spend record |
| License | PolyForm Noncommercial 1.0.0 (noncommercial use only) |

## Runtime secrets (never build arguments)

| Variable | Required | Meaning |
| --- | --- | --- |
| `NOESIS_BRIDGE_TOKEN` | always | shared secret, at least 32 characters; every request must send it as `X-Noesis-Bridge-Token` |
| `META_API_KEY` | live runs | your Meta Model API key; not needed with `NOESIS_READ_ONLY=1` |
| `NOESIS_READ_ONLY` | optional | `1` serves recorded runs only; starting runs is disabled |
| `NOESIS_TRIAL_TOTAL_USD` | optional | enables the bounded public trial (see `deploy/huggingface/README.md`) |

The container **refuses to start** (exit code 2, `Noesis startup refused: ...`) when the
bridge token is missing or shorter than 32 characters, when `META_API_KEY` is missing
outside read-only mode, or when `/data` is not writable. Secrets are moved into mode-600
files in the container's `/tmp`, removed from the bridge's environment, and never logged.

## Run it

Pin the release by digest (shown in [Releases](#releases)); a version tag works too.

```bash
IMAGE=ghcr.io/saadqacif/noesis-lab@sha256:47014a2516caec0522da525bf25981be3062397121fcdc84b01ce3275a5759ca  # 0.1.1
docker pull "$IMAGE"

# A fresh bridge token; keep it out of shell history and files you share.
export NOESIS_BRIDGE_TOKEN="$(openssl rand -hex 32)"
```

### A. Without a Meta key: recorded demonstration (labelled RECORDED)

```bash
docker run --rm -p 7860:7860 \
  -e NOESIS_READ_ONLY=1 \
  -e NOESIS_BRIDGE_TOKEN \
  "$IMAGE"
```

The image ships a completed run recorded on 2026-11-03 (open research mode, Muse Code
on the Meta Model API, $0.41 recorded spend). It is a recording, not a live run.

```bash
H="X-Noesis-Bridge-Token: $NOESIS_BRIDGE_TOKEN"
curl -s -H "$H" http://127.0.0.1:7860/lab/sources
curl -s -H "$H" "http://127.0.0.1:7860/lab/run?source=results/recorded-open-question"      # question, agents, spend, final report
curl -s -H "$H" "http://127.0.0.1:7860/lab/activity?source=results/recorded-open-question" # agent hand-offs and tool calls
curl -s -H "$H" "http://127.0.0.1:7860/lab/state?source=results/recorded-open-question"    # ledger: hypotheses, evidence, protocols
```

### B. With your Meta key: live runs, persistent storage

```bash
export META_API_KEY="<your Meta Model API key>"   # placeholder: use your own; never commit it
docker volume create noesis-data
docker run -d --name noesis-lab -p 127.0.0.1:7860:7860 \
  -e META_API_KEY -e NOESIS_BRIDGE_TOKEN \
  -v noesis-data:/data \
  "$IMAGE"
```

`-e META_API_KEY` without a value passes the variable from your shell, so the key does
not appear in the command line. Start a run (this spends from your Meta account; the
lab caps each UI run with a soft spend guard):

```bash
curl -s -X POST -H "$H" -H 'Content-Type: application/json' \
  -d '{"question": "Does intermittent fasting improve insulin sensitivity in adults with prediabetes?", "rounds": 1, "ceiling_usd": 0.5}' \
  http://127.0.0.1:7860/lab/runs
# -> 201 {"source": "lab_home/muse-...", ...}; then poll /lab/run?source=<source>
# or stream /lab/stream?source=<source> (server-sent events)
```

Runs are kept in the `noesis-data` volume across container restarts.

## Expected responses (health and auth check)

| Request | Expected |
| --- | --- |
| any path without `X-Noesis-Bridge-Token` (including `/`) | `401` `{"error": {"code": "unauthorized", ...}}` |
| a wrong token | `401` |
| `GET /lab/capabilities` with the token | `200`, `"runs_enabled": false` (read-only) or `true` (live) |
| `POST /lab/runs` with the token in read-only mode | `403` `runs_disabled` |
| container without required secrets | exits with code 2 and `Noesis startup refused` |

There is no unauthenticated health endpoint by design; use the authenticated
`/lab/capabilities` call above as the health check.

## Releases

Releases are built and published only by `.github/workflows/release-image.yml`, from a
pushed tag `lab-vX.Y.Z` or a manual run on `main`. The workflow builds without secrets,
runs `deploy/docker/smoke-test.sh` on the built image, refuses to overwrite an existing
version, pushes the version tag and `sha-<commit>`, then pulls the digest anonymously on a
clean runner and repeats the smoke test.

| Version | Digest | Source |
| --- | --- | --- |
| `0.1.1` | `sha256:47014a2516caec0522da525bf25981be3062397121fcdc84b01ce3275a5759ca` | `624d4d0`, linux/amd64, 308 MiB compressed (859 MiB unpacked) |

Run the same smoke test yourself: `bash deploy/docker/smoke-test.sh "$IMAGE"`.
