# discolab — the Noesis scientific lab

> **Meta indie-track build: start here.** Agents run on Meta's Muse Code
> (`discolab/muse.py`, `muse_agents/`), started by
> `python -m discolab.bridge --enable-runs` or `python -m discolab.run start`.
> See [`docs/hackathon/DEMO.md`](../docs/hackathon/DEMO.md).
> - Any question is accepted. Out-of-domain questions run in **open-research
>   mode**, which proposes studies but executes none.
> - The held-out benchmark did not show an escalation quality gain.
> - The Omnigent bundle is an optional orchestration path. The Muse bridge is
>   the question-to-report path used by the Meta application.

**Question (pre-registered in [`prereg.yaml`](prereg.yaml)).** Do the dynamics of
population entropy give early warning of evolutionary-search stagnation beyond
what the fitness history already shows — and can that signal drive a mutation
intervention that recovers faster when the landscape changes?

The lab is a closed discovery loop. Muse Code agents decide; deterministic tools
compute; an append-only ledger records every transition:

```
Question → Evidence → Hypothesis → ≥2 competing experiments → scored selection
        → real GA simulations → pre-registered statistics → Bayesian update
        → recorded decision → next round's candidates (re-scored on the new beliefs)
```

## Primary architecture

```
browser workspace → server-side /lab-proxy → authenticated bridge.py
                                                │
                                       scope.py: lab or open mode
                                                │
                                    Muse Code PI → specialists
                                                │
                              per-role stdio MCP allow-lists
                                                │
      lab.py → ledger.jsonl → planner.py → experiments.py [lab mode]
                                                │
                      lab_home/<run>/runs/E#/ artifacts
```

Agents never produce numbers. Seeds, costs, simulations, statistics, verdicts and
posterior updates all come from `discolab` code; agents contribute choices and
attributed text (rationales, interpretations, decisions).

Lab mode may execute the registered GA/entropy experiments. Open-research
mode accepts other questions but only retrieves evidence and proposes studies;
it does not run an experiment. The [system architecture](../docs/SYSTEM_ARCHITECTURE.md)
specifies the scope gate, bridge endpoints, trust boundary and run artifacts.

## Agent roles and permissions

The Muse PI delegates to literature, designer and critic specialists. A
frozen escalation gate can invoke the read-only Wonder verifier. Each role
receives only its allow-listed MCP tools. The PI may select and run a
development experiment; confirmatory held-out execution requires an explicit
human approval. The open-research tool set has no experiment-execution tool.
See [`muse_agents/`](muse_agents/) and
[the demo guide](../docs/hackathon/DEMO.md) for the exact role prompts,
configuration and approval behavior.

The following table describes the optional
[Omnigent bundle](omnigent/lab_pi), which uses the same scientific core:

| Agent | Scientific decision it owns | Inputs | Outputs | Tools (allow-list) |
|---|---|---|---|---|
| `discolab-pi` (supervisor) | Which experiment runs next; when to run it; what the lab concludes and investigates next | research state, scoring table, critic report | selection with justification, run, decision record, final report | `get_research_state`, `get_experiment_result`, `select_experiment`, `run_experiment`, `record_decision` + sub-agents `literature`, `designer`, `critic` |
| `literature` | Which prior work is evidence for/against the hypotheses; how novel the question is | hypotheses | OpenAlex-verified evidence records | `get_research_state`, `search_literature`, `record_evidence` |
| `designer` | Which competing experiments the lab should consider | state, design space, prior results | ≥2 validated candidate specs + deterministic scores | `get_research_state`, `list_design_space`, `propose_experiment`, `score_experiments`, `register_hypothesis` |
| `critic` | What a result does and does not show; threats to validity | experiment result, state | analysis record (triggers the Bayesian update), optional new hypothesis | `get_research_state`, `get_experiment_result`, `record_analysis`, `register_hypothesis` |

Least privilege is structural: the literature agent cannot run experiments, the
designer cannot select or run them, the critic cannot change specs, and only the
PI can spend compute.

## Optional Omnigent guardrails

| Policy | Where | Effect |
|---|---|---|
| `discolab.policies.approve_confirmatory_runs` | PI | **Human approval (ASK)** before any run on held-out landscapes — held-out data can only be seen for the first time once |
| `max_tool_calls_per_session` | every agent | bounds each agent's loop (PI 120, literature/designer 30, critic 20) |
| `cost_budget` | PI | hard model-spend cap with an approval threshold |
| ledger transition guards | all tools | invalid transitions (select unscored/infeasible/completed, run unselected, analyse before completion, unsourced evidence) fail loudly and write nothing |
| planner hard constraints | scoring | compute budget; confirmatory test of a hypothesis only after a development-stage test |

## Experiment selection (deterministic)

`U(E) = EIG(E) − η·wall_seconds(E) − λ·held-out landscapes used(E)` after hard
constraints, with EIG in bits from a pre-registered likelihood table over the
three verdicts (supported / inconclusive / refuted) and the design's power. The
same table converts an observed verdict into the posterior, so the planner's
expectations and the belief update agree. Measured effects replace the assumed
effect size for later scoring — the planner learns from results. The form is the
EigenBrains constrained utility (quality − risk − cost − latency), re-targeted from
choosing model architectures to choosing experiments: decision theory inspired by
portfolio allocation, not literal finance.

The research portfolio uses a deterministic, redundancy-aware greedy selector:
it adds the feasible experiment with the largest positive marginal joint
information after cost and held-out penalties, subject to the compute budget
and a three-experiment cap. Its selection quality is an empirical question.
The frozen `prereg.yaml` records a `(1 - 1/e)` guarantee claim;
the corrected mathematical conditions and interpretation are in
[Financial mathematics and the meta-agent](../docs/FINANCIAL_MATH_AND_META_AGENT.md#research-portfolio-selector-and-theory-correction).

## Science core

- **Landscapes**: Rastrigin, Ackley (development); Griewank, Levy, Styblinski–Tang
  (held-out), centered so the optimum is 0, translated by seeded shifts with a
  known moving optimum.
- **GA**: SBX + Gaussian mutation, tournament selection, re-evaluated elitism,
  common random numbers across controllers.
- **Telemetry**: population entropy H_t, genotypic dispersion D_t, fitness spread.
- **Controllers**: B0 fixed, B1 stall-adaptive, B2 entropy-level, B3 predictive
  (frozen logistic risk model), B4a triggered hypermutation, B4b random immigrants.
- **Phase 1 (prediction)**: AUROC for stagnation onset, fitness-only baseline vs
  entropy/dispersion/spread features; paired run-clustered bootstrap.
- **Phase 2 (control)**: restricted mean recovery time after shifts, Wilson
  recovery rates, rescue/damage vs B0 with exact McNemar, CVaR90, Holm correction.

## Run the primary Muse lab

From the repository root, start a read-only bridge to inspect committed runs
without a model key:

```powershell
Set-Location .\discolab
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m discolab.bridge --port 8765
```

Start the browser app separately from `frontend/` as shown in the
[root README](../README.md#try-it-locally). A live run needs Muse Code, an
explicit Meta credential outside the repository, `--enable-runs`, and a
spend decision. Follow the [operating procedure](../docs/hackathon/DEMO.md)
before enabling paid calls. The bridge defaults to read-only.

## Optional Omnigent reproduction

```bash
cd discolab
python -m venv .venv && .venv/Scripts/python -m pip install -e . "omnigent==0.16.0" "omnigent-client==0.16.0" pytest
.venv/Scripts/python -m pytest -q                      # invariant + statistics + ledger + end-to-end tests
bash scripts/start_lab.sh main 6810                    # Omnigent server + host, lab_home/main
DISCOLAB_HOME="$PWD/lab_home/main" .venv/Scripts/python scripts/run_session.py --port 6810 \
    --prompt "Run 2 complete discovery rounds, then give the final report."
DISCOLAB_HOME="$PWD/lab_home/main" .venv/Scripts/python -m discolab.cli trace   # who decided what, when
bash scripts/stop_lab.sh main
```

Requires `ANTHROPIC_API_KEY` in the environment (never written to disk by the lab).
On Linux/macOS use `.venv/bin/python`. Windows notes are in `scripts/start_lab.sh`.

## Evidence and interpretation

The [escalation study](results/escalation/README.md) reports simulation-compute
savings and agreement with its reference, with uncertainty. The
[sealed entropy study](../docs/SEALED_ENTROPY_EARLY_WARNING_RESULT.md) records
the negative held-out early-warning result. The
[Muse-agent baseline](../benchmark/reports/MUSE_AGENTS_BASELINE_V1.md)
separates provider-backed calls from offline replay. These are distinct
estimands; do not combine their denominators or present an unexecuted open-mode
protocol as an experimental finding.
