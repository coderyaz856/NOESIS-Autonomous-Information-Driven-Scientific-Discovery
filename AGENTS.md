## Noesis app architecture
- The UI is one workspace in `src/workspace/` (ask → run timeline → report); keep it one page, not a tour, so the question stays visible throughout.
- Display rules (verdict downgrade when a CI crosses zero, LIVE vs RECORDED labels) live in `src/workspace/model.ts` with tests; change them there only.
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
