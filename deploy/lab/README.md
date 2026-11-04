# Hosted lab bridge (Linux)

The web app never runs agents itself. Live runs happen on a Linux host that runs the
discolab bridge and Muse Code, with the Meta key on that host only. The web app's
server-side proxy (`/lab-proxy`) relays signed-in operators to it over HTTPS.

```
browser ──HTTPS──▶ web app (/lab-proxy, server route)
                     │ adds X-Noesis-Bridge-Token from a server-side secret
                     ▼
                  Caddy (HTTPS, only /lab/*) ──▶ bridge 127.0.0.1:8765 ──▶ Muse Code ──▶ Meta Model API
                                                   │
                                                   └─ /var/lib/noesis/lab_home (ledgers, events, reports)
```

## What protects what

| Secret | Lives in | Never in |
| --- | --- | --- |
| Meta key | `/etc/noesis/meta_api_key` (mode 600, user `noesis`), read by Muse through `MODEL_API_KEY_FILE` | the repo, the web app, browser code, logs |
| Bridge token | `/etc/noesis/bridge_token` on the host, and the web app's server-side secret `NOESIS_BRIDGE_TOKEN` | `VITE_` variables, agent processes (stripped from their environment), logs |
| Operator token | the web app's server-side secret `NOESIS_LAB_WRITE_TOKEN` | the bridge host, browser storage (the browser gets only an HttpOnly session cookie) |

- With `--require-auth` (set in the systemd unit) the bridge refuses to start without its
  token, and answers every request without the exact token with `401`, before doing any work.
- The bridge listens on loopback; only Caddy faces the network, and it serves only `/lab/*`.
- A production build of the web app refuses to relay (`503 bridge_token_missing`) when
  `NOESIS_BRIDGE_TOKEN` is not set, and refuses writes entirely (read-only) when
  `NOESIS_LAB_WRITE_TOKEN` is not set.
- Without a token the bridge is for local development only: it must stay on 127.0.0.1, and
  it refuses to bind elsewhere.

## Set up the host

Ubuntu 22.04+ with Python 3.12+, a DNS name pointing at it, and ports 80/443 open.

1. Check out Noesis `main` on the host, then run `sudo bash deploy/lab/setup.sh`. It creates
   the `noesis` user, the venv, persistent state in `/var/lib/noesis`, a fresh bridge token,
   and the systemd unit. It prints no secret.
2. Install the Meta key without echoing it (paste, then Ctrl-D):
   `sudo install -m 600 -o noesis -g noesis /dev/stdin /etc/noesis/meta_api_key`
3. Install Muse Code for the `noesis` user with Meta's official Linux installer
   (`installer.sh`), following Meta's instructions, so that `muse` is on the PATH in
   `noesis-bridge.service` (default `~/.local/bin` of `/var/lib/noesis/home`; adjust the unit
   if the installer puts it elsewhere).
4. Run `sudo bash deploy/lab/setup.sh` again; it starts the bridge once both are in place.
5. Install Caddy, copy `deploy/lab/Caddyfile` to `/etc/caddy/Caddyfile`, replace
   `lab.example.org` with your DNS name, and `sudo systemctl reload caddy`.

Check from anywhere: `curl -i https://<lab-host>/lab/capabilities` must answer `401`.

## Connect the web app

Set these as **server-side secrets** of the deployed web app (never `VITE_` variables,
never CI secrets, which are not available at runtime):

| Name | Value |
| --- | --- |
| `NOESIS_LAB_ORIGINS` | `https://<lab-host>` |
| `NOESIS_BRIDGE_TOKEN` | the contents of `/etc/noesis/bridge_token` (copy it yourself) |
| `NOESIS_LAB_WRITE_TOKEN` | a separate long random operator token |
| `NOESIS_PUBLIC_ORIGIN` | the published app's origin, e.g. `https://<app-host>` |

Then verify on the published URL:

1. Without signing in, the lab shows runs read-only, and `POST /lab-proxy/session` with a
   wrong token answers `401`.
2. After signing in with the operator token, ask one question and watch it through agent
   events, the cost ledger, and the final report.
3. Sign out; writes are refused again.

If any step fails, remove `NOESIS_LAB_WRITE_TOKEN` so the public app stays read-only.

## Rotate or revoke

- Bridge token: replace `/etc/noesis/bridge_token`, `sudo systemctl restart noesis-bridge`,
  update `NOESIS_BRIDGE_TOKEN` in the web app.
- Operator token: change `NOESIS_LAB_WRITE_TOKEN`; every existing session cookie stops working
  (sessions are signed with it).
- Stop all live runs: `sudo systemctl stop noesis-bridge`.
