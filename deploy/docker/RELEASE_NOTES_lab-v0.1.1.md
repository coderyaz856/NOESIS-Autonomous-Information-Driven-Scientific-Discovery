# Noesis lab backend image 0.1.1

**Image:** [`ghcr.io/saadqacif/noesis-lab:0.1.1`](https://github.com/SaadQacif/NOESIS-Autonomous-Information-Driven-Scientific-Discovery/pkgs/container/noesis-lab)
**Digest (immutable):** `sha256:47014a2516caec0522da525bf25981be3062397121fcdc84b01ce3275a5759ca`
**Platform:** linux/amd64 · 308 MiB compressed, 859 MiB unpacked · port 7860 · non-root (uid 1000)
**Source:** commit `624d4d0`, built and published by `.github/workflows/release-image.yml` in the
[SaadQacif repository](https://github.com/SaadQacif/NOESIS-Autonomous-Information-Driven-Scientific-Discovery/actions/workflows/release-image.yml)
**License:** PolyForm Noncommercial 1.0.0

```bash
docker pull ghcr.io/saadqacif/noesis-lab@sha256:47014a2516caec0522da525bf25981be3062397121fcdc84b01ce3275a5759ca
```

## What it is

The Noesis **lab backend**: the authenticated `/lab/*` bridge, the discolab lab (ledger,
MCP tools, bounded public trial) and Meta's Muse Code CLI. It does **not** include the
web frontend, and it does **not** include Meta inference credits: live runs use your
own Meta Model API key, passed at runtime.

## Try it without a Meta key (recorded run, labelled RECORDED)

```bash
export NOESIS_BRIDGE_TOKEN="$(openssl rand -hex 32)"
docker run --rm -p 7860:7860 -e NOESIS_READ_ONLY=1 -e NOESIS_BRIDGE_TOKEN \
  ghcr.io/saadqacif/noesis-lab@sha256:47014a2516caec0522da525bf25981be3062397121fcdc84b01ce3275a5759ca
curl -s -H "X-Noesis-Bridge-Token: $NOESIS_BRIDGE_TOKEN" \
  "http://127.0.0.1:7860/lab/run?source=results/recorded-open-question"
```

Live runs, persistent storage (`-v noesis-data:/data`) and expected responses:
[`deploy/docker/README.md`](https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery/blob/release/ghcr-image/deploy/docker/README.md).

## Verified for this release

- Built without secrets; `deploy/docker/smoke-test.sh` passed on the built image and again
  after an **anonymous pull of the digest** on a clean runner.
- Refuses to start without `NOESIS_BRIDGE_TOKEN` (32+ characters) or, outside read-only
  mode, without `META_API_KEY`; every request without the token gets `401`.
- No key, token or `.env` file in the image; secrets are absent from logs and from the
  bridge process environment.
