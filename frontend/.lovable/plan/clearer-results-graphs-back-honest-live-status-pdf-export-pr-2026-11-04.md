# Clearer results, graphs back, honest live status, PDF export, proper math

## 1. Results that read clearly

Rework the "Measured findings" part of the report so each experiment becomes one card:

- **One-line answer first** in plain words, e.g. "Entropy did not warn earlier than fitness history" with a status chip (Supported / Not supported / Inconclusive).
- **The key number** below it (e.g. AUROC difference with its 95% range), shown on the existing range bar with the zero line.
- **"What this means"** — 1–2 sentences built only from the lab's own verdict fields (no invented numbers).
- Per-controller results (recovery rate, RMST, CVaR) in a small, aligned table with units and plain column names; raw specs stay folded away.
- A short **summary box at the top of the report**: how many hypotheses supported / rejected / inconclusive, and the next decision.
- Modify the **short summary box at the top of the report** to include a massive, unavoidable "Acceleration Multiplier" stat. It should read something like: *"Compute Saved: 92% | Baseline: 45 hrs vs. Noesis: 3.2 hrs."* Do not bury this in the per-controller table; it needs to be the first number the judges see to satisfy the "10x Faster" grading criteria.

## 2. Graphs restored

- **Error & entropy curves** over generations (the drawn chart from the original app), fed by each experiment's `curves` data, one per controller, with a legend and axis labels.
- **Planner frontier chart** (evidence burden / horizon / uncertainty vs. quality) from the original app, using the planner scores the lab reports.
- Both only appear when the lab sends the data; otherwise a short "no curve data reported" note. Readable on mobile.
- The plan successfully added this back in ("Error & entropy curves over generations"), but for a hackathon demo, a raw curve isn't enough. The judges need to see exactly when Noesis made its decision.

## 3. Live run — honest status

Today: connecting your lab works for **viewing runs that already exist** on it (timeline, experiments, report update as they stream). **Typing a new question cannot start a run yet**, because your lab does not have the start-a-run endpoint; the app falls back to the recording.
In this change:

- A clear note under the question box when the connected lab can't start runs: "Your lab can show its existing runs. Starting new runs from a question needs a lab update." with a link to the spec.
- Existing lab runs listed prominently so a connected lab is immediately useful.
- (Optional, separate task) add the `POST /lab/runs` handler to `discolab/bridge.py` as a ready-to-paste Python file in docs — the team runs it on their machine.
- Ensure every step in the timeline explicitly badges the specific agent responsible. Use distinct color-coded chips for **[Insight Agent]**, **[Experiment Planner]**, **[Experiment Runner]**, and **[Analysis Agent]**. The UI must scream that this is a multi-agent workflow, not a standard python script.

## 4. Download as PDF

- A **"Download PDF"** button on the report.
- Produces a structured document: cover (question, source LIVE/RECORDED, date, run id), summary, hypotheses, design, findings with the charts, uncertainty, limitations, next decision, and an appendix with metric definitions and formulas.
- Uses a dedicated print layout (light background, page breaks between sections, no cards split across pages) and the browser's "Save as PDF", so charts and formulas stay sharp. Recorded runs are stamped "RECORDED DEMONSTRATION" on every page.
- Add a dynamically generated (or static) QR code to the header or footer of the PDF print layout that links directly to your public GitHub repository (**[NOESIS-Autonomous-Information-Driven-Scientific-Discovery](https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery)**). When a judge prints or saves this PDF, they have a one-click path back to your code.

## 5. Mathematical notation

- Render formulas properly (fractions, subscripts, Greek letters, sums) in the metric explainers, the report, and the PDF — e.g. H(X) = -\sum_i p_i \log_2 p_i, \mathrm{CVaR}_{0.9}, P(h \mid D) \propto P(D \mid h)P(h).
- Variables and units written consistently (bits, generations, AUROC ∈ [0,1]).

## Technical details

- Add `katex` and a small `<Math tex>` component; convert explainer formulas in `explainers.ts` to TeX strings.
- New `src/workspace/charts.tsx`: port `DrawnChart` (CurveSet) and `FrontierChart` as SVG using design tokens.
- New `src/workspace/findings.ts` (pure, tested in `model.test.ts` style): maps `LabVerdict` + CI to headline/meaning text; verdict downgrade rule stays in `model.ts`.
- PDF: `/report/print` style — a print stylesheet (`@media print`, `@page A4`, `print-color-adjust: exact`) and `window.print()`; no html2canvas (oklch incompatible).
- Live status: use the existing `unsupported` relay response to remember "lab can't start runs" in `useRun` and show the note.
- Verify with Playwright at desktop and 394px wide, axe check, and the print preview rendered to PDF.