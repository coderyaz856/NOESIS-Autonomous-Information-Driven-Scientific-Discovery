# Noesis Research IDE upgrade

Turn the workspace into a dense two-pane research interface, used identically for live and recorded runs.

## Layout
- Desktop: CSS grid `1fr 400px`. Left = overview (question, orchestration map, insights, report). Right = Traceability Console (toggleable, collapses to a slim rail).
- Mobile: stacks; console becomes a "Trace" tab next to "Overview".
- Pinned question stays at the top as a compact ribbon.
- Replace large buttons with a compact action ribbon (Investigate, Export PDF, Toggle console, Open run).
- Tighter padding throughout; keep Geist + JetBrains Mono and glass tokens.

## Agent Orchestration Map (top of run view)
- Pipeline nodes: Insight → Planner → Runner → Analysis (plus Verifier when a gate escalates).
- Active node comes from the latest `handoff` / `say` / `tool` activity's agent; finished nodes get a check, failed ones an X.
- Animated pulse travels along the edge on each handoff event; respects reduced motion.

## "Why this matters" cards
- Shown beside the entropy/error curves and verdict cards, filled only from lab-reported values (verdict, effect + CI, AUROC, recovery/RMST per controller, compute used vs budget).
- Template sentences are written from those values, e.g. "Entropy-based warning reached AUROC 0.81 (95% CI 0.74–0.88) vs 0.62 for fitness history."
- Claims the lab does not report (e.g. "would have stagnated at generation X", "% compute saved" beyond used/budget) are not generated; the card says what is missing instead.
- Dotted-underline tooltips on AUROC, RMST, CVaR, entropy, EIG, posterior, CI: one plain sentence on hover/tap, with the existing formula dialog on click. Adds AUROC and RMST explainers with documented sources.

## Traceability Console (right pane)
- Dark IDE panel, JetBrains Mono, colour-coded JSON keys (small built-in highlighter, no new dependency).
- Per Insight/Analysis action: `<details>` "[View Meta Model Trace]" containing the agent's reported text (`say`), the tool name + args payload (pretty JSON), result/ms/error, gate reasons and verifier verdict when present, and the critic's interpretation/threats from `analyses`.
- System prompts are not in the lab feed, so the trace block shows "System prompt: not exposed by the lab" rather than inventing one.
- Bottom: auto-scrolling log terminal streaming all activity + ledger events (metrics, decisions, validations), with pause-on-scroll-up and a "jump to latest" control.

## Recorded runs
- Load into the same interface with the RECORDED label; console shows the full trace at once instead of replaying.

## Technical details
- New files in `src/workspace/`: `OrchestrationMap.tsx`, `TraceConsole.tsx`, `JsonView.tsx`, `Insights.tsx`; pure mappers (activity → node state, activity → trace entries, values → insight sentences) added to `model.ts` with tests.
- `Workspace.tsx` regrid; `Report.tsx` gets insight cards and metric tooltips; `explainers.ts` gains AUROC/RMST plus one-line `short` text.
- PDF export unchanged except including insight cards; console excluded from print.
- Verify with Playwright at desktop and mobile on the existing recorded run, and run tests.
