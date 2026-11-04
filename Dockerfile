# Noesis lab backend: the authenticated /lab/* bridge, discolab and Muse Code.
# Used by the Hugging Face Space and published as ghcr.io/saadqacif/noesis-lab.
# The browser UI is deployed separately. No secret is ever passed at build time:
# META_API_KEY and NOESIS_BRIDGE_TOKEN are runtime environment variables only.
FROM python:3.12-slim

ARG NOESIS_VERSION=dev
LABEL org.opencontainers.image.title="noesis-lab" \
      org.opencontainers.image.description="Noesis lab backend: authenticated discovery-lab bridge with Muse Code agents (Meta Model API). Bring your own Meta key." \
      org.opencontainers.image.source="https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0" \
      org.opencontainers.image.version="${NOESIS_VERSION}"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/user \
    PATH=/home/user/.local/bin:/home/user/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git passwd tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /bin/sh user \
    && mkdir -p /data \
    && chown user:user /data

WORKDIR /home/user/app
COPY --chown=user:user discolab/ ./discolab/
COPY --chown=user:user deploy/huggingface/entrypoint.sh ./entrypoint.sh

USER user
RUN python -m venv /home/user/venv \
    && /home/user/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /home/user/venv/bin/pip install --no-cache-dir -e ./discolab \
    && curl -fsSL https://dev.meta.ai/install.sh | MUSE_NO_MODIFY_PATH=1 bash \
    && command -v muse >/dev/null \
    && muse --version \
    && chmod 700 ./entrypoint.sh

# Mount persistent storage at /data (`-v noesis-data:/data`): a new named volume
# copies this directory's uid-1000 ownership. Without a mount, runs are lost with
# the container, and the public trial (if configured) refuses runs.
ENV NOESIS_DATA_DIR=/data
EXPOSE 7860
ENTRYPOINT ["/usr/bin/tini", "--", "/home/user/app/entrypoint.sh"]
