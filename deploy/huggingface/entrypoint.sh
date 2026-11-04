#!/bin/sh
# Start the authenticated Noesis lab bridge (Hugging Face Space or `docker run`).
# Secret values are copied into mode-600 files in the container's ephemeral /tmp
# and are never printed. Persistent research artifacts live under NOESIS_DATA_DIR.
#
# Modes:
#   default            live runs: needs META_API_KEY and NOESIS_BRIDGE_TOKEN
#   NOESIS_READ_ONLY=1 recorded runs only: needs NOESIS_BRIDGE_TOKEN, no Meta key,
#                      and starting runs is disabled
set -eu

read_only="${NOESIS_READ_ONLY:-0}"
api_key="${META_API_KEY:-${MODEL_API_KEY:-}}"
bridge_token="${NOESIS_BRIDGE_TOKEN:-}"

if [ "${#bridge_token}" -lt 32 ]; then
  echo "Noesis startup refused: set the NOESIS_BRIDGE_TOKEN runtime secret (at least 32 characters)." >&2
  exit 2
fi
if [ "$read_only" != "1" ] && [ -z "$api_key" ]; then
  echo "Noesis startup refused: set the META_API_KEY runtime secret, or NOESIS_READ_ONLY=1 to serve recorded runs only." >&2
  exit 2
fi

state_dir="${NOESIS_DATA_DIR:-/home/user/data}"
lab_home="$state_dir/lab_home"
runtime_dir="/tmp/noesis-runtime"
package_lab_home="/home/user/app/discolab/lab_home"

umask 077
if ! mkdir -p "$lab_home" "$runtime_dir"; then
  echo "Noesis startup refused: cannot write $state_dir (mount a volume writable by uid 1000)." >&2
  exit 2
fi
printf '%s' "$bridge_token" > "$runtime_dir/bridge_token"
if [ "$read_only" != "1" ]; then
  printf '%s' "$api_key" > "$runtime_dir/meta_api_key"
  export MODEL_API_KEY_FILE="$runtime_dir/meta_api_key"
fi
unset api_key bridge_token META_API_KEY MODEL_API_KEY NOESIS_BRIDGE_TOKEN
export NOESIS_BRIDGE_TOKEN_FILE="$runtime_dir/bridge_token"

if [ -e "$package_lab_home" ] && [ ! -L "$package_lab_home" ]; then
  echo "Noesis startup refused: $package_lab_home exists and is not the managed persistence link." >&2
  exit 2
fi
ln -sfn "$lab_home" "$package_lab_home"

cd /home/user/app/discolab
if [ "$read_only" = "1" ]; then
  echo "Noesis: read-only mode (recorded runs; starting runs is disabled)."
  exec /home/user/venv/bin/python -m discolab.bridge --host 0.0.0.0 --port "${PORT:-7860}" --require-auth
fi
exec /home/user/venv/bin/python -m discolab.bridge \
  --host 0.0.0.0 \
  --port "${PORT:-7860}" \
  --enable-runs \
  --require-auth
