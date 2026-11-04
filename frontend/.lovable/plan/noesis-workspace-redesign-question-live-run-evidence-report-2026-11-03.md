# Noesis workspace redesign — question → live run → evidence report

## Goal
A first-time visitor understands Noesis in seconds: ask a falsifiable question, watch agents and experiments work, then read a clear, evidence-backed report. Everything happens in one stable workspace that works on desktop and mobile. No slideshow-style tutorial screens.

## Experience

```text
Desktop                                         Mobile
+------------------------------------------+   +----------------------+
| [Noesis]  Pinned question bar  [LIVE/REC]|   | Pinned question      |
+------------+-----------------------------+   | [Run|Report|Detail]  |
| Run        |  Main panel                 |   | single column,       |
| timeline   |  (Ask / Live run / Report)  |   | timeline as list     |
| (agents,   |                             |   +----------------------+
|  steps)    |  Detail drawer (traces,     |
|            |  formulas, raw JSON)        |
+------------+-----------------------------+
```

1. **Ask (start screen)**: a welcoming headline in one sentence, a large question box, 3–4 example questions taken from the lab's pre-registration, and a short note on what "falsifiable" means. A badge shows the lab connection status (connected / not connected / recording).
2. **Submit**:
   - If the lab is connected and can start runs, it starts a real run (LIVE badge).
   - Otherwise it opens the bundled real recording, clearly badged RECORDED DEMONSTRATION, with a banner saying it is not a new run.
3. **Live run**: the question stays pinned at the top. A step-by-step timeline grows as the run progresses. Each step shows the agent, its action (decision, tool call, experiment, approval), a one-line plain summary, and a status chip: running / succeeded / failed / uncertain. The current step is highlighted, and a compact strip shows hypotheses with their current likelihood bars.
4. **Report**: one page you can scan, in this order:
   - question and hypotheses
   - experimental design
   - measured findings (effect sizes with 95% confidence intervals)
   - uncertainty
   - limitations / threats to validity
   - next decision

   Raw traces, scoring tables and spec JSON open in expandable panels.
5. **Metric explainers**: entropy, expected information gain (bits), Bayesian posterior updates and portfolio downside risk (CVaR) each get an info button. It shows a one-paragraph plain-language explanation and links to the formula in the project docs. The app shows only values the lab actually reports and never computes its own.

## States
- **Empty**: no lab connected and no recording → example questions, plus how to connect a lab.
- **Loading**: skeleton timeline and pinned question.
- **Long-running**: elapsed time, compute budget used vs. budget, "still working" note after a quiet period, and a reassurance that you can leave and come back.
- **Failure**: lab unreachable, run error or experiment failure. Each shows a plain message, what it means, and a retry or "open recording" action. Failed experiments appear in the timeline as data, not hidden.
- **Uncertain**: results whose confidence interval crosses zero are labelled "inconclusive", never "success".

## Visual system
Keep the existing dark scientific look, organised as tokens:
- colour roles: surface layers, the accent, and status colours for success / fail / uncertain / running
- type scale: display, body, monospace for numbers
- spacing, radii and motion: quiet motion that respects the reduce-motion setting
- one component set: question bar, timeline step, status chip, metric card with interval bar, expandable panel, source badge

The existing multi-page navigation (Home, Discovery Loop, Hypotheses, Approval, Record) is folded into this single workspace. The old pages are removed, and the team panel stays reachable from the header.

## Accessibility
Keyboard-operable throughout, visible focus, live updates announced politely. Status is never shown by colour alone (icon + text). AA contrast, touch targets of 44px or more, one main region, labelled icon buttons. Verified with automated axe checks on desktop and mobile.

## Deliverables
1. The redesigned workspace in the app.
2. A short usability walkthrough file under `docs/` covering 5 tasks, expected outcomes and observed issues, run against the preview with screenshots.
3. A specification for the lab's new "start a run" endpoint, for your team to implement in the Python lab.

## Needed from you
- A real recorded run exported from the lab, to bundle as the demonstration. Until it arrives, the demo slot shows the empty state, not invented data.
- Your team implements the start-a-run endpoint from the specification. Until then, submitting always uses the recording.

## Technical details
- Data comes only from the existing feed contracts: `/lab/sources`, `/state`, `/activity`, `/experiment`, `/stream` (SSE), via the existing `/lab-proxy` relay.
- New proposed contract: `POST /lab/runs {question}` → `{source}`. The relay allows this one POST path with a size limit. The app detects support by trying it and falls back to the recording on 404/405.
- Recording: the exported JSONL / state+activity+experiment snapshot is bundled as a static asset, then replayed through the same view code with timing so the progressive reveal works. It is always labelled `record`.
- Mapping: `LabActivity` (handoff / tool / approval / say) → timeline steps. `LabExperiment.verdicts`, `auroc` and `per_controller` → findings. `analysis.threats_to_validity` → limitations. `next_decision` → next decision. `trajectories` → posterior updates.
- Formula links point to `docs/GLOSSARY.md`, `docs/SCIENTIFIC_RIGOR.md` and `docs/FINANCIAL_MATH_AND_META_AGENT.md` (sections 6 and 10), hosted on the project repository.
- Remove the hand-made `SAMPLE_STORY` and `dev/fixtures` from production paths.
- Add vitest tests for status rules: a confidence interval crossing 0 → inconclusive; a failed experiment → failed chip; a recording always labelled RECORDED.
