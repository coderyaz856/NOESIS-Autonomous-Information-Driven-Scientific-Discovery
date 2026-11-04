# noesis-discovery

The Python SDK of [Noesis](https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery),
an agent-run scientific discovery lab. It is also the sidecar that the Rust
(`noesis-discovery` on crates.io) and Julia (`NoesisDiscovery`) SDKs start.

```bash
pip install noesis-discovery     # import name: discolab
```

## What it gives you

- **Evidence runs:** declared experiment contracts, controlled RNG and budgets,
  hash-chained append-only run logs, checkpoint/resume, terminal accept/reject
  decisions, lineage and content-addressed bundles.
- **The discolab lab:** a ledger with transition guards, prediction experiments
  and the statistics behind them.
- **A cross-language bridge:** `python -m discolab.rpc` speaks the JSONL
  protocol v1 used by the Rust and Julia clients.
- **A command line:** `noesis-discovery` lists, validates, reproduces, resumes
  and exports evidence runs.

```python
from discolab import DiscoveryLab, Experiment

lab = DiscoveryLab("lab_home/sdk-demo", actor="example")
lab.initialize()
experiment = Experiment.prediction(
    title="Entropy warning signal",
    rationale="Test incremental predictive information.",
    hypotheses=["H1"],
    landscapes=["rastrigin", "ackley"],
    n_seeds=12,
    feature_sets=["fitness", "fitness+entropy"],
)
experiment_id = lab.propose(experiment)["id"]
lab.score()
lab.select(experiment_id, "highest feasible expected information gain")
result = lab.run()
```

The full guide is [docs/RESEARCH_SDK.md](https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery/blob/main/docs/RESEARCH_SDK.md).

## What this package does not include

The live lab, meaning the authenticated bridge running Muse Code agents on the Meta Model API
with the study protocols and recorded runs, runs from a checkout of the repository
or from the lab Docker image. This package makes no model or network calls by itself.

## License

[PolyForm Noncommercial 1.0.0](https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery/blob/main/LICENSE.md):
free for research and other noncommercial use.
