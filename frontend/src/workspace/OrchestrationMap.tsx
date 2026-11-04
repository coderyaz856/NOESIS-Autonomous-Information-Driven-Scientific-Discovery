import { Check, ShieldCheck, X } from 'lucide-react';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import type { LabActivity } from '@/noesis/api/lab-types';
import { AGENT_ROLE_LABEL, PIPELINE, pipelineState } from './model';

/** Insight → Planner → Runner → Analysis, highlighted from real activity. */
export function OrchestrationMap({ activity, running }: { activity: LabActivity[]; running: boolean }) {
  const { nodes, handoffs, verifier } = pipelineState(activity, running);
  return (
    <div className="glass rounded-lg px-3 py-2.5" role="group" aria-label="Agent orchestration">
      <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Agent orchestration</span>
        <span>{handoffs} handoff{handoffs === 1 ? '' : 's'}</span>
      </div>
      <ol className="flex items-center">
        {PIPELINE.map((r, i) => {
          const s = nodes[r];
          return (
            <Fragment key={r}>
              <li className={cn('flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md border px-1.5 py-1.5 text-center text-[11px] transition-colors',
                s === 'active' && 'border-primary bg-running-soft shadow-[0_0_14px_var(--primary)]',
                s === 'done' && 'border-success/40',
                s === 'failed' && 'border-failure/60 bg-failure-soft',
                s === 'idle' && 'opacity-60')}
                aria-current={s === 'active' ? 'step' : undefined}>
                <span className="flex items-center gap-1 font-medium">
                  {s === 'done' && <Check aria-hidden className="size-3 text-success" />}
                  {s === 'failed' && <X aria-hidden className="size-3 text-failure" />}
                  {s === 'active' && <span aria-hidden className="size-1.5 rounded-full bg-primary animate-pulse-dot" />}
                  <span className="truncate">{AGENT_ROLE_LABEL[r].replace(' Agent', '').replace('Experiment ', '')}</span>
                </span>
                <span className="sr-only">{s}</span>
              </li>
              {i < PIPELINE.length - 1 && (
                <span aria-hidden className="relative mx-1 h-px w-4 shrink-0 bg-border sm:w-8">
                  {running && <span key={handoffs} className="edge-pulse absolute -top-[2px] size-[5px] rounded-full bg-primary" />}
                </span>
              )}
            </Fragment>
          );
        })}
        {verifier && (
          <li className="ml-2 flex items-center gap-1 rounded-md border border-uncertain/50 px-1.5 py-1.5 text-[11px]"><ShieldCheck aria-hidden className="size-3 text-uncertain" />Verifier</li>
        )}
      </ol>
    </div>
  );
}
