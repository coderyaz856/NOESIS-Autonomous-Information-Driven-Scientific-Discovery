import { describe, expect, it } from 'vitest';
import { activityToSteps, displayVerdict, experimentStatus, sourceLabel, verdictStatus } from './model';

describe('verdict rules', () => {
  it('a confidence interval crossing zero is shown as inconclusive, even if the lab said supported', () => {
    expect(displayVerdict('supported', { estimate: 0.02, ci95: [-0.01, 0.05] })).toBe('inconclusive');
  });
  it('supported with an interval excluding zero stays supported', () => {
    expect(displayVerdict('supported', { estimate: 0.04, ci95: [0.01, 0.07] })).toBe('supported');
  });
  it('inconclusive maps to the uncertain chip, never success', () => {
    expect(verdictStatus(displayVerdict('inconclusive', null))).toBe('uncertain');
  });
});

describe('experiment status', () => {
  it('a failed experiment gets the failed chip', () => {
    expect(experimentStatus({ status: 'failed', error: null })).toBe('failed');
  });
  it('an experiment with an error is failed even if marked completed', () => {
    expect(experimentStatus({ status: 'completed', error: 'boom' })).toBe('failed');
  });
});

describe('source labels', () => {
  it('a recording is always labelled RECORDED', () => {
    expect(sourceLabel('record')).toBe('RECORDED');
    expect(sourceLabel('bundled-recording')).toBe('RECORDED');
  });
  it('only a live lab run is labelled LIVE', () => {
    expect(sourceLabel('live')).toBe('LIVE');
  });
});

describe('activity mapping', () => {
  it('a tool call whose output mentions an error is failed', () => {
    const [step] = activityToSteps([{ t: 1, kind: 'tool', agent: 'pi', name: 'run_experiment', args: 'Error: timeout' }]);
    expect(step?.status).toBe('failed');
  });
});

import { agentRole, computeSaved, findingHeadline, formatBudgetPercent, tallyVerdicts } from './model';

describe('agent roles', () => {
  it('maps planner, runner, analysis and defaults to insight', () => {
    expect(agentRole('experiment_planner')).toBe('planner');
    expect(agentRole('Runner')).toBe('runner');
    expect(agentRole('analyst')).toBe('analysis');
    expect(agentRole('scout')).toBe('insight');
  });
});

describe('findings', () => {
  it('phrases an interval crossing zero as inconclusive', () => {
    expect(findingHeadline('H1', 'AUROC gain', 'inconclusive')).toContain('inconclusive');
  });
  it('tallies display verdicts, downgrading CIs that cross zero', () => {
    const t = tallyVerdicts({ E1: { id: 'E1', verdicts: {
      H1: { verdict: 'supported', measure: 'm', effect: { estimate: 0.1, ci95: [-0.1, 0.3] }, standardised_effect: null, n_units: 1 },
      H2: { verdict: 'refuted', measure: 'm', effect: { estimate: -0.2, ci95: [-0.3, -0.1] }, standardised_effect: null, n_units: 1 },
    } } });
    expect(t).toEqual({ supported: 0, refuted: 1, inconclusive: 1 });
  });
});

describe('compute saved', () => {
  it('uses only reported used and budget seconds', () => {
    expect(computeSaved({ used: 30, budget: 120 })).toBeCloseTo(0.75);
    expect(computeSaved({ used: 10, budget: 0 })).toBeNull();
    expect(computeSaved(null)).toBeNull();
  });
});

describe('compute budget percentage precision', () => {
  it('preserves at least one decimal between 99% and 100%', () => {
    expect(formatBudgetPercent(0.997)).toBe('99.7%');
    expect(formatBudgetPercent(0.99)).toBe('99.0%');
    expect(formatBudgetPercent(0.99999)).toBe('99.999%');
  });
  it('preserves a decimal between 0% and 1%', () => {
    expect(formatBudgetPercent(0.003)).toBe('0.3%');
    expect(formatBudgetPercent(0.001)).toBe('0.1%');
  });
  it('shows positive values below 0.1% as a bound rather than zero', () => {
    expect(formatBudgetPercent(0.0005)).toBe('< 0.1%');
    expect(formatBudgetPercent(Number.MIN_VALUE)).toBe('< 0.1%');
  });
  it('reserves 100% unspent for an entirely unused budget', () => {
    const partial = computeSaved({ used: 0.3, budget: 100 });
    expect(partial === null ? null : formatBudgetPercent(partial)).toBe('99.7%');
    expect(formatBudgetPercent(1 - Number.EPSILON)).not.toBe('100%');
    expect(formatBudgetPercent(1 - Number.EPSILON)).not.toBe('100.0%');
    expect(formatBudgetPercent(1)).toBe('100%');
    expect(formatBudgetPercent(0)).toBe('0%');
  });
});

import { researchModeNote, spendText } from './model';
describe('research mode and spend', () => {
  it('labels open mode as not executed', () => {
    expect(researchModeNote('open')?.title).toContain('nothing was executed');
    expect(researchModeNote(null)).toBeNull();
  });
  it('formats spend only from reported values', () => {
    expect(spendText(0.4219, 2)).toBe('Spent $0.42 of $2.00');
    expect(spendText(1, undefined)).toBe('Spent $1.00');
    expect(spendText(undefined, 2)).toBeNull();
  });
});

import { activityToTrace, insightSentences, pipelineState } from './model';
import { describe as d2, expect as e2, it as i2 } from 'vitest';

d2('pipelineState', () => {
  i2('marks the latest agent active while running and counts handoffs', () => {
    const r = pipelineState([
      { t: 1, kind: 'handoff', from: 'insight', to: 'planner', title: 'plan', state: 'finished' },
      { t: 2, kind: 'tool', agent: 'runner', name: 'run', args: '{}', ok: false },
      { t: 3, kind: 'say', agent: 'critic', text: 'hi' },
    ], true);
    e2(r.handoffs).toBe(1);
    e2(r.nodes.runner).toBe('failed');
    e2(r.nodes.analysis).toBe('active');
    e2(pipelineState([{ t: 3, kind: 'say', agent: 'critic', text: 'hi' }], false).nodes.analysis).toBe('done');
  });
});

d2('activityToTrace', () => {
  i2('parses tool args as JSON and keeps text verbatim', () => {
    const [a, b] = activityToTrace([
      { t: 1, kind: 'tool', agent: 'runner', name: 'run', args: '{"n":3}', ok: true, ms: 5 },
      { t: 2, kind: 'say', agent: 'insight', text: 'I observe X' },
    ]);
    e2(a!.payload).toEqual({ n: 3 });
    e2(b!.reasoning).toBe('I observe X');
    e2(b!.meta).toBe(true);
  });
});

d2('insightSentences', () => {
  i2('uses reported AUROC and never claims a stagnation generation', () => {
    const s = insightSentences({ E1: { id: 'E1', auroc: { entropy: { estimate: 0.81, ci95: [0.74, 0.88] }, fitness: { estimate: 0.62, ci95: null } } } }, null);
    e2(s[0]!.text).toContain('AUROC 0.81 (95% CI 0.74–0.88) vs 0.62 for fitness');
    e2(s.some((x) => x.missing && x.text.includes('does not report'))).toBe(true);
  });
});

import { activityFinished, groupStepsByRole, hypothesisTrails } from './model';
describe('grouped agent view', () => {
  it('groups steps by role in pipeline order', () => {
    const g = groupStepsByRole([
      { id: '1', t: 1, kind: 'tool', agent: 'experiment_runner', title: 'Runs x', detail: '', status: 'failed' },
      { id: '2', t: 2, kind: 'message', agent: 'critic', title: 'Reports', detail: 'ok', status: 'succeeded' },
    ]);
    expect(g.map((x) => x.role)).toEqual(['insight', 'planner', 'runner', 'analysis']);
    expect(g[2]!.failed).toBe(1);
    expect(g[3]!.steps).toHaveLength(1);
  });
  it('detects a finished run from the activity feed', () => {
    expect(activityFinished([{ t: 1, kind: 'handoff', from: 'a', to: null, title: '', state: 'finished' }])).toBe(true);
    expect(activityFinished([{ t: 1, kind: 'handoff', from: 'a', to: 'b', title: '', state: 'running' }])).toBe(false);
  });
  it('downgrades a hypothesis verdict whose CI crosses zero', () => {
    const state = { hypotheses: [{ id: 'H1', family: '', origin: '', statement: 's', status: 'open', posterior: 0.6, n_direct_tests: 1, last: null }],
      trajectories: { H1: [{ seq: 1, posterior: 0.5, label: 'prior' }] }, candidates: [], evidence: [] } as never;
    const exps = { E1: { id: 'E1', verdicts: { H1: { verdict: 'supported', measure: 'm', effect: { estimate: 0.1, ci95: [-0.1, 0.3] }, standardised_effect: null, n_units: 10 } } } } as never;
    const [t] = hypothesisTrails(state, exps);
    expect(t!.prior).toBe(0.5);
    expect(t!.verdicts[0]!.verdict).toBe('inconclusive');
  });
});

import { traceGraph } from './model';
describe('traceGraph', () => {
  it('links handoffs between agents and segments work in order', () => {
    const g = traceGraph([
      { t: 1, kind: 'say', agent: 'lead', text: 'hi' },
      { t: 2, kind: 'handoff', from: 'lead', to: 'planner', title: 'design E1', state: 'running' },
      { t: 3, kind: 'tool', agent: 'planner', name: 'score', args: '{}', ok: false },
      { t: 4, kind: 'handoff', from: 'lead', to: 'planner', title: 'design E1', state: 'running' },
    ] as never);
    expect(g.links).toEqual([{ from: 'lead', to: 'planner', count: 2, titles: ['design E1'] }]);
    expect(g.segments.map((s) => [s.agent, s.received, s.failed])).toEqual([['lead', null, false], ['planner', 'design E1', true], ['lead', null, false]]);
  });
});
