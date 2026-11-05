# Hugging Face Docker Space deployment

This is the shortest supported path for a public, one-week Noesis demo. The
Space runs only the authenticated Python lab bridge and Muse Code. Keep the
browser application on Lovable (or another server-capable host) and let its
server-side `/lab-proxy` route reach this Space.

The separation is intentional:

```text
browser -> HTTPS web app -> server-side /lab-proxy -> HTTPS HF Space -> Muse Code -> Meta Model API
                         adds bridge token          writes ledgers to /data
```

Neither the Meta key nor the bridge token is sent to browser JavaScript.

## 1. Create the Space

1. In Hugging Face, create a new **Docker** Space. A public Space is acceptable
   because the bridge authenticates every request, including reads and SSE.
2. Choose **CPU Upgrade** for a reliable demo. GPU hardware is unnecessary;
   inference happens through the Meta Model API. Pause or delete the Space after
   the judging window to stop compute billing.
3. Mirror the repository at the exact reviewed commit into the Space repository.
   Replace the Space repository's root `README.md` with
   [`SPACE_README.md`](SPACE_README.md), leaving this repository's `Dockerfile`
   at the Space root.
4. In **Settings -> Variables and secrets**, create these as **Secrets**:

   | Secret | Purpose |
   | --- | --- |
   | `META_API_KEY` | Muse Code access to the Meta Model API |
   | `NOESIS_BRIDGE_TOKEN` | random value of at least 32 characters, shared only with the web server |

   Generate the bridge token locally and paste it into both hosts without
   printing it in logs or committing it. Do not use a `VITE_` name.

5. For restart-safe run records, attach a Storage Bucket at `/data`, then add
   the Space **Variable** `NOESIS_DATA_DIR=/data`. Without attached storage the
   service still runs, but `/home/user/data` is ephemeral and can be lost on a
   restart or rebuild.

The container deliberately refuses to start if either secret is absent or if
the bridge token is shorter than 32 characters. The Meta key and bridge token
are moved into mode-600 files in ephemeral `/tmp`; they are never logged.

## 2. Connect the web deployment

Configure these runtime values on the web application's server (not in client
code and not merely as GitHub Actions secrets):

| Name | Value |
| --- | --- |
| `VITE_LAB_URL` | `https://<space-subdomain>.hf.space` |
| `NOESIS_LAB_ORIGINS` | the same exact origin, without a trailing slash |
| `NOESIS_BRIDGE_TOKEN` | the same bridge token as the Space secret |
| `NOESIS_LAB_WRITE_TOKEN` | a different long token used by the demo operator |
| `NOESIS_PUBLIC_ORIGIN` | the exact public origin of the browser application |

`VITE_LAB_URL` is only a destination origin and contains no credential. The
browser calls same-origin `/lab-proxy`; only the server-side proxy adds
`X-Noesis-Bridge-Token` to the upstream request.

## 3. Verify before publishing

Use values from your own secret store; do not paste them into shell history.

1. Open `https://<space-subdomain>.hf.space/lab/capabilities` directly. It must
   answer `401` because a browser has no bridge token.
2. Open the web application while signed out. Recorded/live state may be
   explored through the proxy, but starting a run must be refused.
3. Enter a wrong operator token. It must be rejected.
4. Enter the correct operator token, start one low-budget question, and verify
   live agent events, the usage ledger, and the final report.
5. Select **Lock runs**. A subsequent start attempt must return `401`.
6. Restart the Space and confirm the completed run is still visible. This proves
   `/data` is attached rather than ephemeral.

If an operator-mode check fails, remove `NOESIS_LAB_WRITE_TOKEN` from the web
deployment. If the public trial is enabled, also disable `NOESIS_PUBLIC_TRIAL`
on the web server and `NOESIS_TRIAL_TOTAL_USD` on the bridge. Verify the
resulting read-only behavior; removing the operator token alone does not
disable trial writes.

## 3b. Bounded public trial (optional)

To let any visitor start a real run, the **bridge** enforces the limits, because it is
the only process holding the Meta key (`discolab/discolab/trial.py`):

| Space variable | Default | Meaning |
| --- | --- | --- |
| `NOESIS_TRIAL_TOTAL_USD` | — (trial off) | total estimated spend the trial may commit |
| `NOESIS_TRIAL_RUN_CEILING_USD` | 0.50 | each run's soft spend guard (1 round) |
| `NOESIS_TRIAL_RUN_RESERVE_USD` | 1.50 | charged while a run is live or ended without a final cost; the watchdog stops a run past it |
| `NOESIS_TRIAL_MAX_RUN_SECONDS` | 900 | the watchdog stops longer runs |
| `NOESIS_TRIAL_RUNS_PER_HOUR` | 4 | all visitors together |
| `NOESIS_TRIAL_CLIENT_RUNS_PER_HOUR` / `_PER_DAY` | 1 / 2 | per visitor (an opaque hash from the web server) |

One run at a time is always enforced. The spend record lives in `NOESIS_DATA_DIR`; if
that is not a mounted volume the trial **refuses runs** (`budget_store_not_durable`),
because a restart would forget the spend. `NOESIS_TRIAL_ALLOW_EPHEMERAL=1` overrides
that and should only be set knowingly. On the web server set `NOESIS_PUBLIC_TRIAL=1`.
The budget is an estimate from token counts at list prices; a stopped run is charged
the full reserve because its in-flight calls are not recorded.

## 4. One-week operations

- Keep concurrency at one; the bridge already refuses a second active run.
- Give the operator token only to the demo team. Judges can inspect traces and
  recorded results without receiving paid-run authority.
- Watch Space logs for startup and agent failures, but never add code that logs
  request headers, environment variables, or key files.
- Rotate `NOESIS_BRIDGE_TOKEN` on both hosts if it may have been exposed.
- After the judging window, pause or delete the Space and remove its secrets.
  Export run artifacts first if the Space has no persistent bucket.

The Space hosts real agent execution. A Lovable-only deployment cannot do that:
its frontend/worker layer does not provide the persistent Python process and
Muse Code runtime required by the scientific lab.
