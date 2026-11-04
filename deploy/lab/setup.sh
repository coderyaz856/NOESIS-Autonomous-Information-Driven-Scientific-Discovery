#!/usr/bin/env bash
# Set up the Noesis lab bridge on an Ubuntu host (22.04+). Run as root from a checkout of the
# repository:   sudo bash deploy/lab/setup.sh
#
# It is idempotent and never prints a secret. It does NOT install the Meta key or Muse Code,
# because both need you (see deploy/lab/README.md):
#   - Meta key:   sudo install -m 600 -o noesis -g noesis /dev/stdin /etc/noesis/meta_api_key
#                 (paste the key, then Ctrl-D; it is never echoed)
#   - Muse Code:  install it as the noesis user with Meta's official Linux installer.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP=/opt/noesis
STATE=/var/lib/noesis
CONF=/etc/noesis

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip rsync >/dev/null
python3 - <<'PY'
import sys
if sys.version_info < (3, 12):
    raise SystemExit(f"Python 3.12+ is required, found {sys.version.split()[0]}")
PY

id noesis >/dev/null 2>&1 || useradd --system --home-dir "$STATE/home" --shell /usr/sbin/nologin noesis

# Persistent state: lab runs (ledgers, agent activity, reports) and the noesis user's home.
install -d -m 750 -o noesis -g noesis "$STATE" "$STATE/lab_home" "$STATE/home"
# Secrets directory: readable by the noesis user only.
install -d -m 750 -o root -g noesis "$CONF"

# Application code (read-only for the service); lab_home points at persistent state.
install -d -m 755 "$APP"
rsync -a --delete --exclude 'lab_home' --exclude '.venv' --exclude '__pycache__' "$REPO/discolab/" "$APP/discolab/"
ln -sfn "$STATE/lab_home" "$APP/discolab/lab_home"
[ -x "$APP/venv/bin/python" ] || python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -e "$APP/discolab"

# Bridge token: generated once on the host, never printed. Give the same value to the web
# app as the server-side secret NOESIS_BRIDGE_TOKEN (copy it from the file yourself).
if [ ! -s "$CONF/bridge_token" ]; then
  ( umask 077; tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 64 > "$CONF/bridge_token" )
  chown root:noesis "$CONF/bridge_token"
  chmod 640 "$CONF/bridge_token"
  echo "generated $CONF/bridge_token"
fi

install -m 644 "$REPO/deploy/lab/noesis-bridge.service" /etc/systemd/system/noesis-bridge.service
systemctl daemon-reload
systemctl enable noesis-bridge >/dev/null

missing=0
[ -s "$CONF/meta_api_key" ] || { echo "missing: $CONF/meta_api_key (see README)"; missing=1; }
sudo -u noesis env HOME="$STATE/home" PATH="$STATE/home/.local/bin:/usr/local/bin:/usr/bin:/bin" \
  sh -c 'command -v muse >/dev/null' || { echo "missing: Muse Code for the noesis user (see README)"; missing=1; }
if [ "$missing" -eq 0 ]; then
  systemctl restart noesis-bridge
  systemctl --no-pager --lines=3 status noesis-bridge || true
else
  echo "the bridge is installed but not started until the items above are in place"
fi
