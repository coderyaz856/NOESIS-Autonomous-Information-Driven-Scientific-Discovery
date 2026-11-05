import { Compass, HelpCircle } from 'lucide-react';
import type { LabRun, LabState } from '@/noesis/api/lab-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FrontierChart } from './charts';
import { EXPLAINERS } from './explainers';
import { MetricInfo, TeX } from './parts';
import { agentDisplayName, routingRows, selectionConsequence, topCandidates } from './model';

const DOC = '/docs/FINANCIAL_MATH_AND_META_AGENT.md';

/** Left panel: why Noesis made its choices, consequence first, math behind toggles. */
export function DecisionConsole({ state, run }: { state: LabState; run: LabRun | null }) {
  const routes = routingRows(run);
  const cards = topCandidates(state.rounds);
  const round = state.rounds[state.rounds.length - 1] ?? null;
  const consequence = selectionConsequence(round);
  const hyp = (id: string) => state.hypotheses.find((h) => h.id === id);
  return (
    <div className="space-y-4 text-sm">
      <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"><Compass aria-hidden className="size-3.5" />Decision console</h2>

      <section className="glass rounded-lg p-3" aria-labelledby="dc-routing">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="dc-routing" className="font-medium">Agent routing</h3>
          <Popover>
            <PopoverTrigger className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-primary hover:bg-accent"><HelpCircle aria-hidden className="size-3.5" />Why?</PopoverTrigger>
            <PopoverContent className="w-80 space-y-2 text-xs">
              <p className="font-medium">What the lab reported for this run</p>
              {routes.length ? (
                <table className="w-full font-mono text-[11px]">
                  <thead><tr className="text-muted-foreground"><th className="text-left">agent</th><th className="text-right">calls</th><th className="text-right">cost</th><th className="text-right">sec</th></tr></thead>
                  <tbody>{routes.map((r) => <tr key={r.agent}><td>{r.agent}</td><td className="text-right">{r.calls ?? '—'}</td><td className="text-right">{r.cost !== null ? `$${r.cost.toFixed(3)}` : '—'}</td><td className="text-right">{r.seconds !== null ? Math.round(r.seconds) : '—'}</td></tr>)}</tbody>
                </table>
              ) : <p className="text-muted-foreground">No per-agent usage reported.</p>}
              <p className="text-muted-foreground">Failure overlap and rescue chance are not reported per run, so no values are shown. The routing rule weighs expected loss, failure dependence, cost and latency:</p>
              <TeX tex={'U(A)=E[Q_A]-\\lambda R_A-\\eta\\frac{C_A}{B}-\\rho\\frac{T_A}{T_{\\max}}'} block />
              <TeX tex={'\\Delta Q = P(F\\text{ wrong},A\\text{ correct}) - P(F\\text{ correct},A\\text{ wrong})'} block />
              <a className="text-primary underline" href={DOC} target="_blank" rel="noreferrer">Read the documented formulas</a>
            </PopoverContent>
          </Popover>
        </div>
        {routes.length ? (
          <ul className="space-y-1.5">
            {routes.map((r) => (
              <li key={r.agent} className="flex items-center justify-between gap-2">
                <span className="truncate">{agentDisplayName(r.agent)}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {r.tier && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r.tier === 'Wonder' ? 'bg-uncertain-soft' : 'bg-running-soft'}`}>{r.tier}</span>}
                  <span className="max-w-[9rem] truncate font-mono text-[11px] text-muted-foreground" title={r.model ?? ''}>{r.model ?? 'model not reported'}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">The lab has not reported which model each agent used.</p>}
      </section>

      <section className="space-y-2" aria-labelledby="dc-exp">
        <h3 id="dc-exp" className="font-medium">Experiment selection</h3>
        {state.mode === 'open' && state.protocols?.length ? (
          state.protocols.slice(0, 3).map((p) => (
            <div key={p.id} className="rounded-lg border bg-card/70 p-3">
              <p className="font-mono text-[11px] text-primary">{p.id} · proposed, not executed</p>
              <p className="mt-0.5 font-medium leading-snug">{p.title}</p>
              <p className="mt-1.5 text-xs"><span className="text-muted-foreground">Falsifier: </span>{p.falsifier}</p>
            </div>
          ))
        ) : cards.length ? (
          <>
            {cards.map((c) => (
              <div key={c.id} className={`rounded-lg border p-3 ${c.selected ? 'border-primary bg-running-soft shadow-[0_0_18px_-6px_var(--primary)]' : 'bg-card/70 opacity-80'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[11px] text-primary">{c.id}</p>
                  {c.selected && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">Selected</span>}
                </div>
                <p className="mt-0.5 font-medium leading-snug">{c.title}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{c.eig.toFixed(2)} bits · ~{Math.round(c.seconds)}s{!c.feasible ? ' · infeasible' : ''}</p>
                {c.hypotheses.map((h) => hyp(h) && (
                  <p key={h} className="mt-1.5 text-xs"><span className="text-muted-foreground">Falsifier ({h}, pre-registered): </span>the 95% CI for the effect includes zero — “{hyp(h)!.statement}” would not be supported.</p>
                ))}
              </div>
            ))}
            {consequence && <p className="text-xs leading-relaxed">{consequence}</p>}
          </>
        ) : <p className="text-xs text-muted-foreground">No experiment has been scored yet.</p>}
      </section>

      <Collapsible>
        <CollapsibleTrigger className="w-full rounded-md border px-3 py-2 text-left text-xs font-medium hover:bg-accent">How was this decided?</CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-3">
          {round && round.rows.length > 0 && <FrontierChart round={round} />}
          <div className="max-w-full overflow-x-auto text-xs"><TeX tex={EXPLAINERS.eig.tex} block /></div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <MetricInfo metric="eig">EIG</MetricInfo>
            <MetricInfo metric="posterior">Bayesian update</MetricInfo>
            <MetricInfo metric="cvar">CVaR</MetricInfo>
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
