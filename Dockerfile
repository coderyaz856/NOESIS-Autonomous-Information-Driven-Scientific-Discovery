# Noesis live scientific-lab backend for a Hugging Face Docker Space.
# The browser UI is deployed separately; this image exposes only the authenticated
# /lab/* bridge used by the UI's server-side proxy.
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/user \
    PATH=/home/user/.local/bin:/home/user/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git passwd tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /bin/sh user

WORKDIR /home/user/app
COPY --chown=user:user discolab/ ./discolab/
COPY --chown=user:user deploy/huggingface/entrypoint.sh ./entrypoint.sh

USER user
RUN python -m venv /home/user/venv \
    && /home/user/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /home/user/venv/bin/pip install --no-cache-dir -e ./discolab \
    && curl -fsSL https://dev.meta.ai/install.sh | sh \
    && command -v muse >/dev/null \
    && muse --version \
    && chmod 700 ./entrypoint.sh

EXPOSE 7860
ENTRYPOINT ["/usr/bin/tini", "--", "/home/user/app/entrypoint.sh"]
