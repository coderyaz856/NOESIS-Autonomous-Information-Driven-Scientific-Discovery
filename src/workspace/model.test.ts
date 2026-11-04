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

import { agentRole, computeSaved, findingHeadline, tallyVerdicts } from './model';

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
