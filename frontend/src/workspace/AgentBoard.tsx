import { Bot, FlaskConical, Hand, Lightbulb, MessageSquare, Microscope, Route, Wrench } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { LabExperiment, LabState } from '@/noesis/api/lab-types';
import { AGENT_ROLE_LABEL, collapseRepeats, groupStepsByRole, hypothesisTrails, plainStep, verdictStatus, type AgentRole, type Step } from './model';
import { MetricInfo, StatusChip } from './parts';

const ROLE_ICON: Record<AgentRole, typeof Bot> = { insight: Lightbulb, planner: Route, runner: FlaskConical, analysis: Microscope };
const ROLE_JOB: Record<AgentRole, string> = {
  insight: 'Reads the question and literature, proposes hypotheses.',
  planner: 'Scores candidate experiments and picks the next one.',
  runner: 'Executes the chosen experiments and records results.',
  analysis: 'Interprets results and flags threats to validity.',
};
const KIND_ICON = { handoff: Bot, tool: Wrench, approval: Hand, message: MessageSquare } as const;

/** Agent activity grouped by role: pick an agent to see exactly what it did, step by step. */
export function AgentBoard({ steps, running }: { steps: Step[]; running: boolean }) {
  const groups = groupStepsByRole(steps);
  const lastRole = steps.length ? groups.find((g) => g.steps.includes(steps[steps.length - 1]!))?.role ?? null : null;
  const [picked, setPicked] = useState<AgentRole | null>(null);
  const role = picked ?? lastRole ?? 'insight';
  const g = groups.find((x) => x.role === role)!;

  return (
    <div className="space-y-2">
      <div role="tablist" aria-label="Agents" className="grid grid-cols-2 gap-1.5">
        {groups.map((x) => {
          const Icon = ROLE_ICON[x.role];
          const active = running && x.role === lastRole;
          return (
            <button key={x.role} role="tab" type="button" aria-selected={x.role === role} onClick={() => setPicked(x.role)}
              className={cn('flex min-h-11 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                x.role === role ? 'border-primary bg-running-soft' : 'hover:bg-muted/50', x.steps.length === 0 && 'opacity-60')}>
              <Icon aria-hidden className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{AGENT_ROLE_LABEL[x.role].replace(' Agent', '')}</span>
                <span className="block text-[10px] text-muted-foreground">{x.steps.length} step{x.steps.length === 1 ? '' : 's'}{x.failed ? ` · ${x.failed} failed` : ''}</span>
              </span>
              {active && <span aria-label="working now" className="size-2 rounded-full bg-primary animate-pulse-dot" />}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="glass rounded-md p-2.5">
        <p className="text-xs text-muted-foreground">{ROLE_JOB[role]}{g.agents.length > 0 && <> Lab name: <span className="font-mono">{g.agents.join(', ')}</span>.</>}</p>
        {g.steps.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{running ? 'Has not acted yet.' : 'Did not act in this run.'}</p>
        ) : (
          <ol className="mt-2 space-y-1">
            {collapseRepeats(g.steps).map(({ step: s, count, all }, i) => {
              const Icon = KIND_ICON[s.kind];
              const now = running && all.includes(steps[steps.length - 1]!);
              const shown = s.status === 'running' && !now ? 'succeeded' : s.status;
              return (
                <li key={s.id}>
                  <details className={cn('group rounded border px-2 py-1', now && 'border-primary/60')}>
                    <summary className="flex cursor-pointer list-none items-start gap-2 text-sm">
                      <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                      <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 break-words">{plainStep(s)}{count > 1 && <span className="ml-1 font-mono text-xs text-muted-foreground">×{count}</span>}</span>
                      {shown !== 'succeeded' || now ? <StatusChip status={now ? 'running' : shown} /> : null}
                    </summary>
                    <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-sunken p-2 font-mono text-[11px] text-muted-foreground">{all.map((x) => x.detail || '(no details reported)').join('\n\n')}</pre>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/** How each hypothesis got its result: experiments that tested it, verdicts and belief change. */
export function HypothesisTrails({ state, experiments }: { state: LabState; experiments: Record<string, LabExperiment> }) {
  const trails = hypothesisTrails(state, experiments);
  if (!trails.length) return null;
  return (
    <section aria-labelledby="hyp-trails" className="space-y-2">
      <h2 id="hyp-trails" className="text-sm font-medium text-muted-foreground">How each hypothesis got its result</h2>
      {trails.map((t) => (
        <details key={t.id} className="glass rounded-md px-2.5 py-2">
          <summary className="cursor-pointer text-sm">
            <span className="font-mono text-xs text-primary">{t.id}</span> <span className="break-words">{t.statement}</span>
          </summary>
          <ol className="mt-2 space-y-1.5 border-l pl-3 text-xs">
            <li><strong>Evidence:</strong> {t.evidence} source{t.evidence === 1 ? '' : 's'} linked.</li>
            <li><strong>Tested by:</strong> {t.experiments.length ? t.experiments.map((e) => `${e.id} (${e.status})`).join(', ') : 'no experiment yet.'}</li>
            <li><strong>Measured:</strong> {t.verdicts.length ? (
              <ul className="mt-1 space-y-1">{t.verdicts.map((v) => (
                <li key={v.experiment} className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono">{v.experiment}</span> {v.measure}: <span className="font-mono">{v.effect}</span> over {v.n} runs
                  <StatusChip status={verdictStatus(v.verdict)} label={v.verdict} />
                </li>
              ))}</ul>
            ) : 'no measured verdict reported.'}</li>
            <li><strong><MetricInfo metric="posterior">Belief</MetricInfo>:</strong>{' '}
              {t.prior !== null ? `${(t.prior * 100).toFixed(0)}% → ` : ''}{(t.posterior * 100).toFixed(0)}% · status {t.status}</li>
          </ol>
        </details>
      ))}
    </section>
  );
}
