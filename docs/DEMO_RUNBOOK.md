# Evidence-first demo runbook

This is the presentation path for the **implemented** Noesis workspace.
For installation and operator controls, use the
[Meta Muse demo guide](hackathon/DEMO.md). The
[public application](https://noesis-agent.lovable.app/) is the browser entry
point; the [three-minute video](https://www.youtube.com/watch?v=x3rVdGG7zP4)
shows a completed journey without requiring a new paid run.

## Show one question, two honest outcomes

1. Enter a falsifiable question in the single workspace. Keep the question
   visible while the run develops.
2. Point out the scope result. A GA/entropy question enters **lab mode** and
   can execute registered, seeded simulations. Other questions enter
   **open-research mode**: agents retrieve identifiable sources, register
   competing hypotheses, draft protocols, critique them and recommend a
   study. No experiment is executed in open mode.
3. Follow the live `NodeMap` and agent activity. Each handoff, tool call,
   failure, and verifier intervention has a trace; the detailed trace is
   available without crowding the primary view.
4. Open the Decision Console. It shows candidate experiments and the
   deterministic information-gain/cost calculation when the lab has
   produced them. The PI's selected action and reason are distinct from
   the tool-produced score.
5. If a confirmatory experiment is proposed, show the human
   Approve/Decline gate. Approval authorizes the frozen test; no answer
   fails closed. Do not claim that approval changes the result or that
   every development experiment needs manual approval.
6. End at the report. Distinguish `LIVE`, `RECORDED`, provider-backed
   benchmark, and offline replay evidence. Show the actual sample size,
   interval, verdict, provenance, and next decision. An unexecuted
   protocol is not a finding.

A quiet live run is not a failure of the UI: use the activity status and
last known state. Never splice a different question's recording into a live
run without the explicit `RECORDED` label. With no connected lab and no
installed static recording, the workspace displays an empty state; the
committed open-research run is inspectable through a local read-only bridge.

## Three measured results to present separately

| Question | Result | Evidence and boundary |
|---|---|---|
| Does adaptive experiment allocation save simulation work? | Mean fixed/selective compute ratio **1.542** (95% interval **1.280–1.901**); selective and fixed designs agree with a separate reference on **28/35** and **29/35** hypothesis-replicates. | [Development-stage escalation study](../discolab/results/escalation/README.md). About 35% less simulated compute, not a measured wall-clock research speed-up or equal agreement claim. |
| Did entropy improve held-out early-warning prediction? | Development AUROC contrast **+0.1393**; sealed held-out contrast **−0.00588**, 95% paired cluster-bootstrap interval **[−0.01108, −0.00031]**. | [Sealed study](SEALED_ENTROPY_EARLY_WARNING_RESULT.md). Its registered verdict is `no_meaningful_gain`; the negative result is valid evidence within this scope. |
| Did the selective Muse verifier improve quality? | On 12 held-out cases, Spark-only, always-both and selective policies each scored **0.833**. Six provider-backed verifier calls yielded zero rescues and zero damage. | [Muse-agent baseline](../benchmark/reports/MUSE_AGENTS_BASELINE_V1.md). The 38.0% estimated cost and 24.9% latency reductions versus always-both are **offline replay**; no quality gain was resolved. |

These studies measure different things. Do not multiply their savings or
combine their denominators into one “research acceleration” number.

## Operational checklist before showing the app

- Open the public URL in a private browser window; verify that the lab
  connection and write mode are accurately shown.
- If a public trial is active, check the bridge's remaining estimated budget
  and rate-limit status before starting a paid run. A soft per-run guard is
  not a hard provider billing cap.
- Have the video and the committed run as fallback evidence. State plainly
  which one is recorded.
- Keep the [pre-registration](../discolab/prereg.yaml),
  [benchmark protocol](BENCHMARK_METHODOLOGY.md), and
  [reproducibility guide](REPRODUCIBILITY.md) ready for judge questions.
- Do not show credential files, environment values, or private run data.

## Acceptance checks

The question-to-report path must preserve evidence identity and source
labels. The browser must not produce scientific numbers independently.
A held-out approval is recorded before execution. Failed or unavailable
providers remain visible as failures; they are not silently replaced by
fixtures. The final report must separate observation, inference, and
recommended next study.
