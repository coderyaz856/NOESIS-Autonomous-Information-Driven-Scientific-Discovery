# Noesis "Judge's Narrative" + Luminous Node Map

Both briefs merged into one layout. Fonts, frosted glass, neon accents and Meta badges stay. Every number still comes from the lab.

## Layout (desktop)

```text
+----------------------+-----------------------------------------+
| Decision Console     | Header: question + honesty badge        |
| (slim, fixed left)   +-----------------------------------------+
|  - Agent routing     | Main stage                              |
|  - 3 experiment cards|  running -> Luminous node map           |
|  - "How was this     |  finished -> fades into Evidence Report |
|     decided?"        |                                         |
+----------------------+-----------------------------------------+
```
The Trace console becomes a toggle drawer (it no longer takes a fixed column). On phones the panels stack: header, then stage, then the Decision Console as a tab.

## 1. Quiet start and honesty badge
- The empty screen is dark and quiet, with one central prompt: "Enter a research question." Example questions sit underneath in smaller text.
- Once a run starts, the header shows a badge. **Executable lab study** appears when the lab's mode is `lab`. **Research protocol — not executed** appears for `open`.

## 2. Luminous node map (main stage while running)
- The Lead agent (PI) is a glowing point in the centre. A frosted card next to it shows its latest action in plain words.
- Other agents appear only when a real handoff or say event names them. Lines draw only for real handoffs, built from the existing `traceGraph`, so no steps are invented.
- No scrolling log in the centre. Clicking a point opens its details in the Trace drawer.
- When the run finishes, the map fades out (or stays still if reduced motion is on) and the Evidence Report takes its place. A "Show agent map" button brings it back.

## 3. Decision Console (left)
- **Agent routing:** one row per agent, showing its role and the model the lab reports for it (from the run's per-agent usage), with a "Spark" or "Wonder" tag when the model name matches. The "Why?" popover shows cost, calls and seconds as the lab reports them. Failure overlap and rescue chance are not part of the run data, so the popover gives their documented formulas (linked to the docs) and says no per-run values were reported.
- **Experiment selection:** the top 3 candidates from the latest scoring round, with the selected one highlighted. Each card shows EIG bits, estimated compute, and feasibility. It then states the consequence: "Selected because it teaches us more for the available compute." This line only appears when the lab says the selection followed the best-scoring option. Otherwise the lab's own justification is shown.
- **Falsifier on each card:** open-mode protocols show their reported falsifier. Lab candidates show the falsifier of the pre-registered hypothesis they test, labelled as such.
- **"How was this decided?"** reveals the EIG vs compute frontier chart, the utility formula, posterior and CVaR explainers.

## 4. Report changes
- **Negative result:** when a held-out or confirmation-stage verdict is refuted or inconclusive while a development-stage result for the same hypothesis was positive, a bold headline appears: **"Noesis was willing to change its mind."** Below it, a split shows the development signal (green) against the held-out result (neutral/red), using the lab's own numbers. The figures +0.139 and -0.006 appear only if the lab reports them; they are never hard-coded.
- **"Verify this result"** toggle: the prereg hash, ledger and source IDs, the raw tables and the CIs move here. The top level shows consequences only.
- Covariance, Bayesian equations, CVaR and hash details are removed from the default view and placed behind the two toggles.
- **"One evidence contract. Three ways to do science."** Python, Rust and Julia tabs, each showing a short snippet that loads the current run ID and evidence bundle. A note explains that Rust and Julia use the Python sidecar for the run lifecycle but do the numerical calculations independently. The snippets use the upstream repo's SDK names. If an SDK isn't in the repo, its tab says "planned" rather than claiming parity.
- The PDF gets the badge, the negative-result block and the evidence contract. Collapsible sections print expanded.

## Technical details
- New: `DecisionConsole.tsx`, `NodeMap.tsx`, `EvidenceContract.tsx`, `NegativeResult.tsx`. `Workspace.tsx` moves to a `grid-cols-[300px_1fr]` grid, and `TraceConsole` becomes a Sheet drawer.
- Tested pure helpers in `model.ts`: `honestyBadge(mode)`, `routingRows(run)`, `topCandidates(scoring, 3)`, `selectionConsequence(round)`, `negativeResults(state, experiments)` (dev vs held-out pairing by stage), `nodeMapState(activity)`.
- Update AGENTS.md: the run view is Decision Console + stage, and the Trace console is a drawer.
- Verify with Playwright on the real 16:42 run at desktop and mobile sizes, and regenerate the PDF.
