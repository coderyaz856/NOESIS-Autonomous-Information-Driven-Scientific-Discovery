import type { CI, LabActivity, LabExperiment, LabSource, LabState } from '@/noesis/api/lab-types';

/** Display status for anything the run did or measured. Never derived from colour alone. */
export type StepStatus = 'running' | 'succeeded' | 'failed' | 'uncertain';

export type Verdict = 'supported' | 'refuted' | 'inconclusive';

/**
 * Verdict shown to people. The lab's verdict is the source of truth, but a
 * "supported" or "refuted" claim whose 95% interval crosses zero is downgraded
 * to inconclusive (pre-registered rule: supported requires the CI to exclude zero).
 */
export function displayVerdict(labVerdict: string | null | undefined, effect?: CI | null): Verdict {
  const ci = effect?.ci95 ?? null;
  const crossesZero = ci !== null && ci[0] <= 0 && ci[1] >= 0;
  const v = (labVerdict ?? '').toLowerCase();
  if (v === 'supported' && !crossesZero) return 'supported';
  if (v === 'refuted') return 'refuted';
  return 'inconclusive';
}

export function verdictStatus(v: Verdict): StepStatus {
  return v === 'supported' ? 'succeeded' : v === 'refuted' ? 'failed' : 'uncertain';
}

/** Status of a whole experiment: an error or failed status is always "failed". */
export function experimentStatus(exp: Pick<LabExperiment, 'status' | 'error'> | null | undefined): StepStatus {
  if (!exp) return 'running';
  const s = (exp.status ?? '').toLowerCase();
  if (exp.error || s === 'failed' || s === 'error' || s === 'crashed') return 'failed';
  if (s === 'completed' || s === 'done' || s === 'finished') return 'succeeded';
  if (s === 'running' || s === 'queued' || s === 'proposed' || s === 'selected' || s === '') return 'running';
  return 'uncertain';
}

export type SourceLabel = 'LIVE' | 'RECORDED';

/** Anything that is not a live lab run is a recording — never shown as live. */
export function sourceLabel(kind: LabSource['kind'] | 'bundled-recording'): SourceLabel {
  return kind === 'live' ? 'LIVE' : 'RECORDED';
}

export type StepKind = 'handoff' | 'tool' | 'approval' | 'message';

export interface Step {
  id: string;
  t: number;
  kind: StepKind;
  agent: string;
  title: string;
  detail: string;
  status: StepStatus;
}

/** Turn the lab's activity feed into timeline steps. Only the last handoff can still be running. */
export function activityToSteps(activity: LabActivity[]): Step[] {
  return activity.map((a, i) => {
    const id = `${i}-${a.t}`;
    switch (a.kind) {
      case 'handoff':
        return {
          id, t: a.t, kind: 'handoff', agent: a.from,
          title: a.to ? `Hands off to ${a.to}` : 'Finishes its turn',
          detail: a.title,
          status: a.state === 'running' ? 'running' : 'succeeded',
        };
      case 'tool': {
        const failed = /error|fail|exception|traceback/i.test(a.args);
        return {
          id, t: a.t, kind: 'tool', agent: a.agent, title: `Runs ${a.name}`, detail: a.args,
          status: failed ? 'failed' : 'succeeded',
        };
      }
      case 'approval':
        return { id, t: a.t, kind: 'approval', agent: a.agent, title: 'Asks for human approval', detail: a.text, status: 'uncertain' };
      case 'say':
      default:
        return { id, t: a.t, kind: 'message', agent: (a as { agent: string }).agent, title: 'Reports', detail: (a as { text: string }).text, status: 'succeeded' };
    }
  });
}

/** True once the lab has produced at least one completed experiment and a next decision. */
export function hasReport(state: LabState | null): boolean {
  return !!state && (state.completed.length > 0 || Object.keys(state.analyses).length > 0);
}

export function fmtCI(ci: CI | null | undefined, digits = 3): string {
  if (!ci || ci.estimate === null) return 'not measured';
  const e = ci.estimate.toFixed(digits);
  return ci.ci95 ? `${e}  [${ci.ci95[0].toFixed(digits)}, ${ci.ci95[1].toFixed(digits)}]` : e;
}

/** The four agent roles shown on the timeline. The lab's own agent name is always shown next to the role. */
export type AgentRole = 'insight' | 'planner' | 'runner' | 'analysis';

export const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  insight: 'Insight Agent',
  planner: 'Experiment Planner',
  runner: 'Experiment Runner',
  analysis: 'Analysis Agent',
};

/** Map a lab agent name to its role by keywords in the name; unknown names default to Insight. */
export function agentRole(agent: string): AgentRole {
  const a = agent.toLowerCase();
  if (/plan|design|select|propos/.test(a)) return 'planner';
  if (/run|exec|experiment|worker|tool|sim/.test(a)) return 'runner';
  if (/analy|critic|review|stat|judge|verdict/.test(a)) return 'analysis';
  return 'insight';
}

/** Headline for one measured verdict, phrased only from the lab's own fields. */
export function findingHeadline(hypothesisId: string, measure: string, v: Verdict): string {
  if (v === 'supported') return `${hypothesisId} supported: ${measure} showed the predicted effect.`;
  if (v === 'refuted') return `${hypothesisId} not supported: ${measure} did not show the predicted effect.`;
  return `${hypothesisId} inconclusive: the 95% range for ${measure} includes no effect.`;
}

export interface VerdictTally { supported: number; refuted: number; inconclusive: number }

export function tallyVerdicts(experiments: Record<string, LabExperiment>): VerdictTally {
  const t: VerdictTally = { supported: 0, refuted: 0, inconclusive: 0 };
  for (const e of Object.values(experiments)) {
    for (const v of Object.values(e.verdicts ?? {})) t[displayVerdict(v.verdict, v.effect)] += 1;
  }
  return t;
}

/** Share of the pre-registered compute budget left unused, from lab-reported seconds only. Null when not reported. */
export function computeSaved(c: { used: number; budget: number } | null | undefined): number | null {
  if (!c || !(c.budget > 0) || !(c.used >= 0)) return null;
  return Math.max(0, Math.min(1, 1 - c.used / c.budget));
}
