#!/bin/sh
# Start the authenticated Noesis lab bridge in a Hugging Face Docker Space.
# Secret values are copied into mode-600 files in the container's ephemeral /tmp
# and are never printed. Persistent research artifacts live under NOESIS_DATA_DIR.
set -eu

api_key="${META_API_KEY:-${MODEL_API_KEY:-}}"
bridge_token="${NOESIS_BRIDGE_TOKEN:-}"

if [ -z "$api_key" ]; then
  echo "Noesis startup refused: configure the META_API_KEY Space secret." >&2
  exit 2
fi
if [ "${#bridge_token}" -lt 32 ]; then
  echo "Noesis startup refused: NOESIS_BRIDGE_TOKEN must be a Space secret of at least 32 characters." >&2
  exit 2
fi

state_dir="${NOESIS_DATA_DIR:-/home/user/data}"
lab_home="$state_dir/lab_home"
runtime_dir="/tmp/noesis-runtime"
package_lab_home="/home/user/app/discolab/lab_home"

umask 077
mkdir -p "$lab_home" "$runtime_dir"
printf '%s' "$api_key" > "$runtime_dir/meta_api_key"
printf '%s' "$bridge_token" > "$runtime_dir/bridge_token"
unset api_key bridge_token META_API_KEY MODEL_API_KEY NOESIS_BRIDGE_TOKEN

if [ -e "$package_lab_home" ] && [ ! -L "$package_lab_home" ]; then
  echo "Noesis startup refused: $package_lab_home exists and is not the managed persistence link." >&2
  exit 2
fi
ln -sfn "$lab_home" "$package_lab_home"

export MODEL_API_KEY_FILE="$runtime_dir/meta_api_key"
export NOESIS_BRIDGE_TOKEN_FILE="$runtime_dir/bridge_token"

cd /home/user/app/discolab
exec /home/user/venv/bin/python -m discolab.bridge \
  --host 0.0.0.0 \
  --port "${PORT:-7860}" \
  --enable-runs \
  --require-auth
