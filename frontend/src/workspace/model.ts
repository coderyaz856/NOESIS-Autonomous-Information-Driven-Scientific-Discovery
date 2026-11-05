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
      case 'gate':
        return {
          id, t: a.t, kind: 'message', agent: a.agent,
          title: a.decision === 'verdict' ? `Verifier verdict: ${a.verdict ?? 'unknown'}` : a.decision === 'escalate' ? 'Report sent to the verifier' : 'Report accepted',
          detail: [a.title, ...(a.reasons ?? [])].filter(Boolean).join('\n'),
          status: a.verdict === 'REJECTED' ? 'failed' : a.decision === 'escalate' ? 'uncertain' : 'succeeded',
        };
      case 'say':
      default:
        return { id, t: a.t, kind: 'message', agent: (a as { agent: string }).agent, title: 'Reports', detail: (a as { text?: string }).text ?? '', status: 'succeeded' };
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
  if (/analy|critic|review|stat|judge|verdict|verif/.test(a)) return 'analysis';
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

/** Format a budget share without turning fractional consumption into an endpoint. */
export function formatBudgetPercent(share: number): string {
  if (!Number.isFinite(share)) return '—';
  const percent = share * 100;
  if (percent > 0 && percent < 0.1) return '< 0.1%';
  if (percent >= 99 && percent < 100) {
    // Add precision when a single decimal would still misleadingly read 100%.
    for (let digits = 1; digits <= 15; digits += 1) {
      const text = percent.toFixed(digits);
      if (Number(text) < 100) return `${text}%`;
    }
    return '< 100.0%';
  }
  if (percent > 0 && percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

/** Per-visitor rate limits are enforced by the bridge. A cap that high
 * (1000 runs/hour or more) reads as no limit rather than a number. */
export function perVisitorLimitText(runsPerHour: number): string {
  return runsPerHour >= 1000
    ? 'no per-visitor limit on runs'
    : `${runsPerHour} run${runsPerHour === 1 ? '' : 's'} per hour per visitor`;
}

/** How a run's research mode is presented. Open mode never executed anything,
 * so it must never look like an experimental result. */
export function researchModeNote(mode: 'lab' | 'open' | null | undefined): { title: string; meaning: string } | null {
  if (mode === 'open') {
    return {
      title: 'Open research mode — nothing was executed',
      meaning: 'This question is outside the pre-registered lab domain. The agents gathered literature, proposed falsifiable hypotheses and study protocols, and critiqued them. No experiment was run, so there are no measured results.',
    };
  }
  if (mode === 'lab') {
    return { title: 'Lab mode — experiments executed', meaning: 'This question fits the pre-registered study, so the lab ran real experiments.' };
  }
  return null;
}

/** "Spent $0.42 of $2.00" from the lab's own run record; null when it reports nothing. */
export function spendText(cost: number | null | undefined, ceiling: number | null | undefined): string | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null;
  const c = `$${cost.toFixed(2)}`;
  return typeof ceiling === 'number' && Number.isFinite(ceiling) ? `Spent ${c} of $${ceiling.toFixed(2)}` : `Spent ${c}`;
}

/* ------------------------------------------------ orchestration & traces */
export type NodeState = 'idle' | 'active' | 'done' | 'failed';
export const PIPELINE: AgentRole[] = ['insight', 'planner', 'runner', 'analysis'];

/** Pipeline node states from activity only. The latest acting agent is active while the run is running. */
export function pipelineState(activity: LabActivity[], running: boolean): { nodes: Record<AgentRole, NodeState>; handoffs: number; verifier: boolean } {
  const nodes: Record<AgentRole, NodeState> = { insight: 'idle', planner: 'idle', runner: 'idle', analysis: 'idle' };
  let last: AgentRole | null = null;
  let handoffs = 0;
  let verifier = false;
  for (const a of activity) {
    const agent = a.kind === 'handoff' ? (a.to ?? a.from) : a.agent;
    const role = agentRole(agent);
    if (a.kind === 'handoff') handoffs += 1;
    if (a.kind === 'gate' && a.decision !== 'accept') verifier = true;
    if (a.kind === 'tool' && a.ok === false) nodes[role] = 'failed';
    else if (nodes[role] !== 'failed') nodes[role] = 'done';
    last = role;
  }
  if (running && last && nodes[last] !== 'failed') nodes[last] = 'active';
  return { nodes, handoffs, verifier };
}

export interface TraceEntry {
  id: string;
  t: number;
  agent: string;
  role: AgentRole;
  kind: LabActivity['kind'];
  summary: string;
  /** Agent-reported reasoning text, verbatim. */
  reasoning: string | null;
  /** Tool payload, parsed as JSON when possible. */
  payload: unknown;
  result: { ok?: boolean | undefined; ms?: number | undefined; error?: string | null | undefined } | null;
  gate: { decision: string; reasons: string[]; verdict?: string | undefined; verifier_model?: string | null | undefined } | null;
  meta: boolean;
}

function parseArgs(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

/** Friendly label shown instead of a bare `{}` when a tool call needs no parameters. */
export const NO_ARGS_LABEL = 'No parameters required — this call takes no arguments.';

/** True when a tool payload carries no information at all (null, '', or an empty object). */
export function isNoArgPayload(payload: unknown): boolean {
  if (payload === null || payload === undefined) return true;
  if (typeof payload === 'string') return ['', '{}', 'null'].includes(payload.trim());
  return typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 0;
}

/** Activity → trace entries, verbatim fields only (no invented prompts or reasoning). */
export function activityToTrace(activity: LabActivity[]): TraceEntry[] {
  return activity.map((a, i) => {
    const agent = a.kind === 'handoff' ? a.from : a.agent;
    const role = agentRole(agent);
    const base = { id: `${i}-${a.t}`, t: a.t, agent, role, kind: a.kind, reasoning: null, payload: null, result: null, gate: null, meta: role === 'insight' || role === 'analysis' } as TraceEntry;
    switch (a.kind) {
      case 'say': return { ...base, summary: ((a.text ?? '').split('\n')[0] ?? '').slice(0, 120), reasoning: a.text };
      case 'tool': return { ...base, summary: `${a.name}()`, payload: parseArgs(a.args), result: { ok: a.ok, ms: a.ms, error: a.error } };
      case 'handoff': return { ...base, summary: `→ ${a.to ?? 'done'}: ${a.title}` };
      case 'approval': return { ...base, summary: `approval ${a.state ?? ''}`.trim(), reasoning: a.text };
      case 'gate': return { ...base, summary: `gate ${a.decision}: ${a.title}`, gate: { decision: a.decision, reasons: a.reasons, verdict: a.verdict, verifier_model: a.verifier_model } };
    }
  });
}

/** "Why this matters" sentences, phrased only from lab-reported numbers. */
export function insightSentences(experiments: Record<string, LabExperiment>, compute: { used: number; budget: number } | null | undefined): { text: string; missing?: boolean }[] {
  const out: { text: string; missing?: boolean }[] = [];
  for (const e of Object.values(experiments)) {
    const auroc = Object.entries(e.auroc ?? {}).filter(([, c]) => c.estimate !== null).sort((a, b) => (b[1].estimate ?? 0) - (a[1].estimate ?? 0));
    if (auroc.length) {
      const [name, best] = auroc[0]!;
      const ci = best.ci95 ? ` (95% CI ${best.ci95[0].toFixed(2)}–${best.ci95[1].toFixed(2)})` : '';
      const rest = auroc.slice(1).map(([n, c]) => `${c.estimate!.toFixed(2)} for ${n}`).join(', ');
      out.push({ text: `${e.id}: the ${name} warning signal told stagnating runs apart from healthy ones with AUROC ${best.estimate!.toFixed(2)}${ci}${rest ? ` vs ${rest}` : ''}. 0.5 is a coin flip, 1.0 is perfect.` });
    }
    const pc = Object.entries(e.per_controller ?? {}).filter(([, v]) => v.rmst_gens !== null).sort((a, b) => (a[1].rmst_gens ?? 0) - (b[1].rmst_gens ?? 0));
    if (pc.length > 1) {
      const [fast, f] = pc[0]!;
      const [slow, s] = pc[pc.length - 1]!;
      out.push({ text: `${e.id}: after a landscape shift, ${fast} stayed stuck for ${f.rmst_gens!.toFixed(1)} generations on average vs ${s.rmst_gens!.toFixed(1)} for ${slow} (RMST).` });
    }
    for (const [h, v] of Object.entries(e.verdicts ?? {})) {
      const dv = displayVerdict(v.verdict, v.effect);
      out.push({ text: `${e.id} · ${findingHeadline(h, v.measure, dv)} Effect ${fmtCI(v.effect, 2)} over ${v.n_units} runs.` });
    }
  }
  const saved = computeSaved(compute);
  if (saved !== null && compute) out.push({ text: `The planner used ${Math.round(compute.used)}s of a ${compute.budget}s compute budget, leaving ${formatBudgetPercent(saved)} unspent.` });
  if (!Object.keys(experiments).length) out.push({ text: 'No executed experiments yet, so there are no measured numbers to translate.', missing: true });
  out.push({ text: 'The lab does not report a predicted stagnation generation, so Noesis does not claim how many generations early the warning fired.', missing: true });
  return out;
}

/* ------------------------------------------------ grouped agent view */
/** Plain one-line summary of a step, for the simplified agent view. Full text stays in `detail`. */
export function plainStep(s: Step): string {
  const first = ((s.detail ?? '').split('\n').find((l) => l.trim()) ?? '').trim();
  const short = first.length > 140 ? `${first.slice(0, 137)}…` : first;
  if (s.kind === 'tool') return `${s.title.replace(/^Runs /, 'Used ').replace(/_/g, ' ')}`;
  if (s.kind === 'handoff') return `${s.title}${short ? ` — ${short}` : ''}`;
  if (s.kind === 'approval') return `Asked for approval${short ? `: ${short}` : ''}`;
  return s.title !== 'Reports' ? `${s.title}${short ? ` — ${short}` : ''}` : short || 'Reported';
}

/** Role for grouping: tool calls that run or fetch experiments count as experiment work whoever called them. */
export function stepRole(s: Step): AgentRole {
  if (s.kind === 'tool' && /run_experiment|execute|experiment_result|simulat/i.test(s.title)) return 'runner';
  return agentRole(s.agent);
}

/** Collapse consecutive identical tool calls into one row with a count. */
export function collapseRepeats(steps: Step[]): { step: Step; count: number; all: Step[] }[] {
  const out: { step: Step; count: number; all: Step[] }[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && s.kind === 'tool' && prev.step.kind === 'tool' && prev.step.title === s.title && prev.step.status === s.status) { prev.count += 1; prev.all.push(s); }
    else out.push({ step: s, count: 1, all: [s] });
  }
  return out;
}

export interface AgentGroup {
  role: AgentRole;
  steps: Step[];
  tools: number;
  failed: number;
  agents: string[];
}

/** Steps grouped by agent role, in pipeline order. Every role is present, even with no steps. */
export function groupStepsByRole(steps: Step[]): AgentGroup[] {
  return PIPELINE.map((role) => {
    const mine = steps.filter((s) => stepRole(s) === role);
    return {
      role, steps: mine,
      tools: mine.filter((s) => s.kind === 'tool').length,
      failed: mine.filter((s) => s.status === 'failed').length,
      agents: [...new Set(mine.map((s) => s.agent))],
    };
  });
}

/** True when the activity feed itself says the run ended (last handoff finished with no next agent). */
export function activityFinished(activity: LabActivity[]): boolean {
  const last = [...activity].reverse().find((a) => a.kind === 'handoff');
  return !!last && last.kind === 'handoff' && last.to === null && last.state === 'finished';
}

export interface HypothesisTrail {
  id: string;
  statement: string;
  status: string;
  prior: number | null;
  posterior: number;
  experiments: { id: string; title: string; status: string }[];
  verdicts: { experiment: string; measure: string; verdict: Verdict; effect: string; n: number }[];
  evidence: number;
}

/** How each hypothesis reached its current state, from lab-reported fields only. */
export function hypothesisTrails(state: LabState, experiments: Record<string, LabExperiment>): HypothesisTrail[] {
  return state.hypotheses.map((h) => {
    const traj = state.trajectories[h.id] ?? [];
    const exps = state.candidates.filter((c) => c.hypotheses.includes(h.id)).map((c) => ({ id: c.id, title: c.title, status: c.status }));
    const verdicts = Object.values(experiments).flatMap((e) => {
      const v = e.verdicts?.[h.id];
      return v ? [{ experiment: e.id, measure: v.measure, verdict: displayVerdict(v.verdict, v.effect), effect: fmtCI(v.effect, 2), n: v.n_units }] : [];
    });
    return {
      id: h.id, statement: h.statement, status: h.status,
      prior: traj.length ? traj[0]!.posterior : null, posterior: h.posterior,
      experiments: exps, verdicts,
      evidence: state.evidence.filter((ev) => ev.hypothesis_id === h.id).length,
    };
  });
}

/** One uninterrupted stretch of work by a single agent, in run order. */
export interface FlowSegment {
  id: string;
  agent: string;
  role: AgentRole;
  /** Handoff title that started this segment, verbatim; null when the agent just started acting. */
  received: string | null;
  entries: TraceEntry[];
  failed: boolean;
}

export interface AgentLink { from: string; to: string; count: number; titles: string[] }

/** Trace graph from activity only: agents, who handed what to whom, and the ordered work segments. */
export function traceGraph(activity: LabActivity[]): { agents: { name: string; role: AgentRole; steps: number }[]; links: AgentLink[]; segments: FlowSegment[] } {
  const trace = activityToTrace(activity);
  const segments: FlowSegment[] = [];
  const links = new Map<string, AgentLink>();
  const steps = new Map<string, number>();
  let pending: { from: string; title: string } | null = null;
  const push = (agent: string, received: string | null) => {
    const s: FlowSegment = { id: `s${segments.length}`, agent, role: agentRole(agent), received, entries: [], failed: false };
    segments.push(s); return s;
  };
  activity.forEach((a, i) => {
    const e = trace[i]!;
    if (a.kind === 'handoff') {
      steps.set(a.from, steps.get(a.from) ?? 0);
      if (a.to) {
        steps.set(a.to, steps.get(a.to) ?? 0);
        const k = `${a.from}→${a.to}`;
        const l = links.get(k) ?? { from: a.from, to: a.to, count: 0, titles: [] };
        l.count += 1; if (a.title && !l.titles.includes(a.title)) l.titles.push(a.title);
        links.set(k, l);
        if (a.state !== 'finished') pending = { from: a.from, title: a.title };
      }
      const cur = segments[segments.length - 1];
      (cur && cur.agent === a.from ? cur : push(a.from, null)).entries.push(e);
      return;
    }
    const agent = a.agent;
    steps.set(agent, (steps.get(agent) ?? 0) + 1);
    let cur = segments[segments.length - 1];
    if (!cur || cur.agent !== agent) {
      const p = pending as { from: string; title: string } | null;
      cur = push(agent, p ? p.title : null); pending = null;
    }
    cur.entries.push(e);
    if (a.kind === 'tool' && a.ok === false) cur.failed = true;
  });
  return { agents: [...steps].map(([name, n]) => ({ name, role: agentRole(name), steps: n })), links: [...links.values()], segments };
}

const AGENT_NAMES: Record<string, string> = {
  pi: 'Lead scientist (PI)', operator: 'Operator', literature: 'Literature scout', designer: 'Experiment designer',
  critic: 'Critic', verifier: 'Verifier', runner: 'Experiment runner', analyst: 'Analyst', planner: 'Planner',
};
/** Readable name for a lab agent id; unknown ids are shown as-is. */
export function agentDisplayName(agent: string): string {
  return AGENT_NAMES[agent.toLowerCase()] ?? agent;
}

/* ------------------------------------------------ judge's narrative */
/** Header honesty badge. Open mode never executed anything. */
export function honestyBadge(mode: 'lab' | 'open' | null | undefined): { label: string; executed: boolean } | null {
  if (mode === 'lab') return { label: 'Executable lab study', executed: true };
  if (mode === 'open') return { label: 'Research protocol — not executed', executed: false };
  return null;
}

export interface RoutingRow { agent: string; model: string | null; tier: 'Spark' | 'Wonder' | null; calls: number | null; cost: number | null; seconds: number | null; effort: string | null }

/** Tier tag only when the lab's model name says so. */
export function modelTier(model: string | null | undefined): 'Spark' | 'Wonder' | null {
  if (!model) return null;
  if (/wonder/i.test(model)) return 'Wonder';
  if (/spark/i.test(model)) return 'Spark';
  return null;
}

/** Which model each agent ran on, from the run record's per-agent usage and role config only. */
export function routingRows(run: { per_agent?: { agent: string; model: string | null; calls: number; cost_usd: number; seconds: number }[]; config?: { roles?: Record<string, { model: string; effort: string }> } | null } | null | undefined): RoutingRow[] {
  if (!run) return [];
  const rows = new Map<string, RoutingRow>();
  for (const [agent, r] of Object.entries(run.config?.roles ?? {})) {
    rows.set(agent, { agent, model: r.model, tier: modelTier(r.model), calls: null, cost: null, seconds: null, effort: r.effort });
  }
  for (const a of run.per_agent ?? []) {
    const prev = rows.get(a.agent);
    const model = a.model ?? prev?.model ?? null;
    rows.set(a.agent, { agent: a.agent, model, tier: modelTier(model), calls: a.calls, cost: a.cost_usd, seconds: a.seconds, effort: prev?.effort ?? null });
  }
  return [...rows.values()];
}

export interface CandidateCard { id: string; title: string; eig: number; seconds: number; utility: number; feasible: boolean; hypotheses: string[]; selected: boolean }

/** Top competing experiments of the latest scoring round, by lab-reported utility. */
export function topCandidates(rounds: { round: number; selected: string | null; argmax: string | null; rows: { id: string; title: string; eig_bits: number; utility: number; feasible: boolean; est_wall_seconds: number; hypotheses: string[] }[] }[], n = 3): CandidateCard[] {
  const r = rounds[rounds.length - 1];
  if (!r) return [];
  const chosen = r.selected ?? r.argmax;
  const sorted = [...r.rows].sort((a, b) => b.utility - a.utility);
  const top = sorted.slice(0, n);
  const sel = sorted.find((x) => x.id === chosen);
  if (sel && !top.includes(sel)) top[top.length - 1] = sel;
  return top.map((x) => ({ id: x.id, title: x.title, eig: x.eig_bits, seconds: x.est_wall_seconds, utility: x.utility, feasible: x.feasible, hypotheses: x.hypotheses, selected: x.id === chosen }));
}

/** Consequence-first sentence. Only claims "best for the compute" when the lab says it followed the argmax. */
export function selectionConsequence(round: { followed_argmax: boolean | null; justification: string | null } | null | undefined): string | null {
  if (!round) return null;
  if (round.followed_argmax === true) return 'This experiment was selected because it teaches us more for the available compute.';
  if (round.justification) return `The planner chose differently from the top score: ${round.justification}`;
  if (round.followed_argmax === false) return 'The planner did not pick the top-scoring experiment and recorded no reason.';
  return null;
}

const HELD = /held|confirm|sealed|out.?of.?sample|test/i;

export interface NegativeResult { hypothesis: string; measure: string; dev: { experiment: string; estimate: number }; heldout: { experiment: string; estimate: number | null; verdict: Verdict } }

/** A positive development signal for a hypothesis that did not hold on a held-out / confirmation experiment. */
export function negativeResults(experiments: Record<string, LabExperiment>): NegativeResult[] {
  const exps = Object.values(experiments);
  const out: NegativeResult[] = [];
  const hyps = new Set(exps.flatMap((e) => Object.keys(e.verdicts ?? {})));
  for (const h of hyps) {
    const dev = exps.find((e) => !HELD.test(e.stage ?? '') && (e.verdicts?.[h]?.effect.estimate ?? 0) > 0);
    const held = exps.find((e) => HELD.test(e.stage ?? '') && e.verdicts?.[h] && displayVerdict(e.verdicts[h]!.verdict, e.verdicts[h]!.effect) !== 'supported');
    if (dev && held) {
      const hv = held.verdicts![h]!;
      out.push({ hypothesis: h, measure: dev.verdicts![h]!.measure, dev: { experiment: dev.id, estimate: dev.verdicts![h]!.effect.estimate! }, heldout: { experiment: held.id, estimate: hv.effect.estimate, verdict: displayVerdict(hv.verdict, hv.effect) } });
    }
  }
  return out;
}

export interface MapNode { name: string; role: AgentRole; lead: boolean; steps: number; x: number; y: number }

/** Node map layout from activity only: lead agent centred, others on a ring in order of first appearance. */
export function nodeMapState(activity: LabActivity[]): { nodes: MapNode[]; links: AgentLink[]; latest: { agent: string; text: string } | null } {
  const g = traceGraph(activity);
  if (!g.agents.length) return { nodes: [], links: [], latest: null };
  const lead = g.agents.find((a) => a.name.toLowerCase() === 'pi')?.name ?? g.agents[0]!.name;
  const others = g.agents.filter((a) => a.name !== lead);
  const nodes: MapNode[] = [{ ...g.agents.find((a) => a.name === lead)!, lead: true, x: 0, y: 0 }];
  others.forEach((a, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / others.length;
    nodes.push({ ...a, lead: false, x: Math.cos(ang), y: Math.sin(ang) });
  });
  const trace = activityToTrace(activity);
  const last = trace[trace.length - 1];
  return { nodes, links: g.links, latest: last ? { agent: last.agent, text: last.summary } : null };
}
