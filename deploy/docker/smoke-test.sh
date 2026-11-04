#!/usr/bin/env bash
# Smoke-test a Noesis lab image without any real secret and without paid calls.
#   deploy/docker/smoke-test.sh <image-reference>
# Test values are generated here, never printed, and never part of the image.
set -euo pipefail

IMAGE="${1:?usage: smoke-test.sh <image>}"
PORT="${SMOKE_PORT:-17860}"
TOKEN="$(openssl rand -hex 32)"
FAKE_KEY="smoke-test-not-a-real-key-$(openssl rand -hex 16)"
if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$TOKEN"; echo "::add-mask::$FAKE_KEY"; fi
fails=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=smoke test::$*"; fails=$((fails + 1)); }
cleanup() { docker rm -f noesis-smoke >/dev/null 2>&1 || true; }
trap cleanup EXIT

expect_refusal() {  # name, then docker run arguments
  local name="$1"; shift
  local out code
  out="$(docker run --rm "$@" "$IMAGE" 2>&1)" && code=0 || code=$?
  if [ "$code" -ne 0 ] && grep -q "startup refused" <<<"$out"; then pass "fails closed: $name (exit $code)"
  else fail "fails closed: $name (exit $code)"; fi
}

status() {  # method path [token]
  local args=(-s -o /dev/null -w '%{http_code}' -X "$1" "http://127.0.0.1:$PORT$2")
  [ -n "${3:-}" ] && args+=(-H "X-Noesis-Bridge-Token: $3")
  curl "${args[@]}" || echo 000
}

start() {  # docker run arguments for a background container
  cleanup
  docker run -d --name noesis-smoke -p "127.0.0.1:$PORT:7860" "$@" "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    [ "$(status GET /lab/capabilities)" = "401" ] && return 0
    sleep 1
  done
  docker logs noesis-smoke 2>&1 | tail -20
  return 1
}

echo "== image contents"
docker run --rm --entrypoint muse "$IMAGE" --version >/dev/null && pass "muse CLI present" || fail "muse CLI present"
docker run --rm --entrypoint /home/user/venv/bin/python "$IMAGE" -I -c "import discolab.bridge, discolab.trial, discolab.mcp_server" \
  && pass "discolab backend imports" || fail "discolab backend imports"
[ "$(docker image inspect -f '{{json .Config.ExposedPorts}}' "$IMAGE")" = '{"7860/tcp":{}}' ] \
  && pass "image exposes 7860/tcp" || fail "image exposes 7860/tcp"
[ "$(docker image inspect -f '{{.Config.User}}' "$IMAGE")" = "user" ] && pass "runs as non-root user" || fail "runs as non-root user"

echo "== fails closed without runtime secrets"
expect_refusal "no secrets at all"
expect_refusal "bridge token without a Meta key" -e "NOESIS_BRIDGE_TOKEN=$TOKEN"
expect_refusal "Meta key without a bridge token" -e "META_API_KEY=$FAKE_KEY"
expect_refusal "bridge token shorter than 32 characters" -e "META_API_KEY=$FAKE_KEY" -e "NOESIS_BRIDGE_TOKEN=short"
expect_refusal "read-only mode without a bridge token" -e "NOESIS_READ_ONLY=1"

echo "== read-only mode (no Meta key): recorded demonstration run"
if start -e "NOESIS_READ_ONLY=1" -e "NOESIS_BRIDGE_TOKEN=$TOKEN"; then
  pass "listens on 7860 (mapped to $PORT)"
  [ "$(status GET /lab/capabilities)" = "401" ] && pass "no token -> 401" || fail "no token -> 401"
  [ "$(status GET /lab/sources wrong-token-wrong-token-wrong-token)" = "401" ] && pass "wrong token -> 401" || fail "wrong token -> 401"
  [ "$(status GET /)" = "401" ] && pass "unknown path without token -> 401" || fail "unknown path without token -> 401"
  [ "$(status POST /lab/runs)" = "401" ] && pass "start run without token -> 401" || fail "start run without token -> 401"
  caps="$(curl -s -H "X-Noesis-Bridge-Token: $TOKEN" "http://127.0.0.1:$PORT/lab/capabilities")"
  grep -q '"runs_enabled": false' <<<"$caps" && pass "right token -> 200, runs disabled" || fail "right token -> 200, runs disabled"
  run="$(curl -s -H "X-Noesis-Bridge-Token: $TOKEN" "http://127.0.0.1:$PORT/lab/run?source=results/recorded-open-question")"
  grep -q '"status": "completed"' <<<"$run" && grep -q '"final_report": "' <<<"$run" \
    && pass "recorded run with final report is served" || fail "recorded run with final report is served"
  [ "$(status POST /lab/runs "$TOKEN")" = "403" ] && pass "starting a run is refused in read-only mode" || fail "starting a run is refused in read-only mode"
else
  fail "read-only container did not start"
fi

echo "== live mode (placeholder key; no run is started, so no model call)"
if start -e "META_API_KEY=$FAKE_KEY" -e "NOESIS_BRIDGE_TOKEN=$TOKEN"; then
  caps="$(curl -s -H "X-Noesis-Bridge-Token: $TOKEN" "http://127.0.0.1:$PORT/lab/capabilities")"
  grep -q '"runs_enabled": true' <<<"$caps" && pass "live mode enables runs behind the token" || fail "live mode enables runs behind the token"
  [ "$(status GET /lab/capabilities)" = "401" ] && pass "live mode: no token -> 401" || fail "live mode: no token -> 401"
  if docker logs noesis-smoke 2>&1 | grep -qF -e "$TOKEN" -e "$FAKE_KEY"; then fail "secrets absent from logs"; else pass "secrets absent from logs"; fi
  # tini (pid 1) and any `docker exec` shell receive the container environment, secrets
  # included; the bridge process the entrypoint started must not hold them.
  # Match the start of the command line so this checking shell (whose own command line
  # mentions discolab.bridge) is never mistaken for the bridge.
  bridge_env="$(docker exec noesis-smoke sh -c 'for p in /proc/[0-9]*; do
      cmd="$(tr "\0" " " < "$p/cmdline" 2>/dev/null)"
      case "$cmd" in "/home/user/venv/bin/python -m discolab.bridge "*) ;; *) continue ;; esac
      echo "BRIDGE ${p#/proc/}"; tr "\0" "\n" < "$p/environ"; done' 2>/dev/null || true)"
  if ! grep -q "^BRIDGE " <<<"$bridge_env"; then fail "bridge process found"
  elif grep -qF -e "$TOKEN" -e "$FAKE_KEY" <<<"$bridge_env"; then fail "secrets removed from the bridge environment"
  else pass "secrets removed from the bridge environment"; fi
else
  fail "live-mode container did not start"
fi
cleanup

echo "== no secret in the image"
if docker history --no-trunc "$IMAGE" | grep -qiE "META_API_KEY=|NOESIS_BRIDGE_TOKEN=|MODEL_API_KEY=|hf_[A-Za-z0-9]{20}"; then
  fail "no secret in image history"; else pass "no secret in image history"; fi
env_json="$(docker image inspect -f '{{json .Config.Env}}' "$IMAGE")"
if grep -qiE "API_KEY|TOKEN" <<<"$env_json"; then fail "no secret in image environment"; else pass "no secret in image environment"; fi
found="$(docker run --rm --entrypoint sh "$IMAGE" -c \
  'find / -xdev \( -name ".env" -o -name ".env.*" -o -name "*api_key*" -o -name "*bridge_token*" -o -name "*.pem" \) \
     -not -path "/proc/*" -not -path "/usr/lib/*" -not -path "/usr/share/*" -not -path "/etc/ssl/*" -not -path "/usr/local/lib/*" \
     -not -path "/home/user/venv/lib/*" 2>/dev/null' || true)"
if [ -n "$found" ]; then fail "no key, token or .env files in the image: $found"; else pass "no key, token or .env files in the image"; fi

echo "== $fails failure(s)"
[ "$fails" -eq 0 ]
