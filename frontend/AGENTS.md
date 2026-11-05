## Noesis app architecture
- The UI is one workspace in `src/workspace/` (ask → run timeline → report); keep it one page, not a tour, so the question stays visible throughout.
- Display rules (verdict downgrade when a CI crosses zero, LIVE vs RECORDED labels) live in `src/workspace/model.ts` with tests; change them there only.
- All compute-budget percentage text uses the shared model formatter, including accessibility and print views, to keep precision consistent.
- Lab data comes only through the `/lab-proxy` relay to the discolab feed; the app never computes or invents metrics.

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- The `/lab-proxy` relay only forwards to origins in `NOESIS_LAB_ORIGINS` and adds the bridge token server-side (`src/noesis/api/lab-proxy-policy.ts`, ported from the upstream repo); never accept arbitrary browser-supplied lab targets or ship tokens to the client.
- Production write mode comes from server settings (`NOESIS_PUBLIC_TRIAL=1` trial, `NOESIS_LAB_WRITE_TOKEN` operator, else read-only); preview (dev build) is always open so the team can test.
- Run view is Decision Console (left: routing, top-3 scored experiments, math behind toggles) + main stage (live NodeMap from activity, then report); the Traceability Console is a drawer/tab. Narrative helpers (honesty badge, routing, candidates, negative results, node map) live in model.ts so nothing exceeds lab-reported values.
