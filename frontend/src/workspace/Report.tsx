import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LabActivity, LabExperiment, LabState } from '@/noesis/api/lab-types';
import { AgentGraph } from './TraceConsole';
import { NegativeResult } from './NegativeResult';
import { EvidenceContract } from './EvidenceContract';
import { CurveChart, FrontierChart } from './charts';
import { EXPLAINERS } from './explainers';
import { agentDisplayName, computeSaved, displayVerdict, traceGraph, experimentStatus, findingHeadline, fmtCI, formatBudgetPercent, tallyVerdicts, verdictStatus, type SourceLabel } from './model';
import { Expandable, IntervalBar, MetaFooter, MetricInfo, SectionTitle, StatusChip, TeX } from './parts';

export const REPO_URL = 'https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery';

function Posterior({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums">{value.toFixed(2)}</span>
    </div>
  );
}

function hypStatus(status: string) {
  const s = status.toLowerCase();
  return s === 'supported' ? 'succeeded' : s === 'refuted' ? 'failed' : 'uncertain';
}

export function HypothesisStrip({ state }: { state: LabState }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="Hypotheses and current belief">
      {state.hypotheses.map((h) => (
        <li key={h.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card/60 px-3 py-2">
          <span className="min-w-0 truncate text-sm"><span className="font-mono text-xs text-primary">{h.id}</span> {h.statement}</span>
          <Posterior value={h.posterior} />
        </li>
      ))}
    </ul>
  );
}


interface ReportProps {
  state: LabState;
  experiments: Record<string, LabExperiment>;
  label?: SourceLabel | null;
  runId?: string | null;
  print?: boolean;
  activity?: LabActivity[];
}

/** Screen report plus a print-only copy (light, paginated) used for "Download PDF". */
// Desktop and mobile layouts may each mount a Report; exactly one (re-elected on unmount) owns the print copy.
const printOwners: symbol[] = [];
const ownerListeners = new Set<() => void>();
const notifyOwners = () => ownerListeners.forEach((l) => l());

export function Report(props: ReportProps) {
  const [me] = useState(() => Symbol('report'));
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    const update = () => setOwner(printOwners[0] === me);
    printOwners.push(me); ownerListeners.add(update); notifyOwners();
    return () => { printOwners.splice(printOwners.indexOf(me), 1); ownerListeners.delete(update); notifyOwners(); };
  }, [me]);
  return (
    <>
      <ReportBody {...props} />
      {owner && createPortal(<div className="print-root"><ReportBody {...props} print /></div>, document.body)}
    </>
  );
}

function PrintHeader({ label, runId }: { label?: SourceLabel | null | undefined; runId?: string | null | undefined }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { QRCode.toDataURL(REPO_URL, { margin: 0, width: 160 }).then(setQr).catch(() => setQr(null)); }, []);
  return (
    <header className="print-cover mb-6 overflow-hidden rounded-xl">
      <div className="flex items-start justify-between gap-6 p-5">
        <div className="min-w-0">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.25em] opacity-80">Orchestrated by Omnigent · Powered by Meta Model API</p>
          <p className="mt-2 font-display text-2xl font-semibold tracking-tight">Noesis <span className="font-normal opacity-80">Evidence report</span></p>
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-wider">
            <span className="rounded-full border border-current px-2 py-0.5">{label === 'LIVE' ? 'Live run' : 'Recorded demonstration'}</span>
            {runId && <span className="rounded-full border border-current px-2 py-0.5">{runId}</span>}
            <span className="rounded-full border border-current px-2 py-0.5">{new Date().toLocaleString()}</span>
          </div>
        </div>
        {qr && (
          <figure className="shrink-0 rounded-md bg-[white] p-1.5 text-center">
            <img src={qr} alt="QR code linking to the Noesis source code on GitHub" className="size-16" />
            <figcaption className="mt-0.5 text-[7px] text-[black]">Source on GitHub</figcaption>
          </figure>
        )}
      </div>
      {label !== 'LIVE' && <div className="print-stamp" aria-hidden>RECORDED DEMONSTRATION</div>}
    </header>
  );
}

function SummaryBox({ state, experiments, print = false }: { state: LabState; experiments: Record<string, LabExperiment>; print?: boolean }) {
  const saved = computeSaved(state.compute_seconds);
  const t = tallyVerdicts(experiments);
  const next = state.next_decision;
  return (
    <section aria-labelledby="summary-title" className="avoid-break glass rounded-2xl border-primary/40 p-5 shadow-panel">
      <h3 id="summary-title" className="sr-only">Summary</h3>
      <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Compute saved</p>
          <p className="break-words font-mono text-4xl font-semibold leading-none text-primary tabular-nums">{saved === null ? '—' : formatBudgetPercent(saved)}</p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Budget {fmtSeconds(state.compute_seconds.budget)} vs. Noesis {fmtSeconds(state.compute_seconds.used)}
          </p>
        </div>
        <div className="space-y-3">
          <ul className="flex flex-wrap gap-2" aria-label="Verdict counts">
            <li><StatusChip status="succeeded" label={`${t.supported} supported`} /></li>
            <li><StatusChip status="failed" label={`${t.refuted} not supported`} /></li>
            <li><StatusChip status="uncertain" label={`${t.inconclusive} inconclusive`} /></li>
          </ul>
          {!print && next?.decision && <p className="text-sm leading-relaxed"><span className="text-muted-foreground">Next decision:</span> <strong>{next.decision}</strong></p>}
          <p className="text-xs text-muted-foreground">Compute saved is the share of the pre-registered compute budget the lab did not need, from the lab's reported seconds.</p>
        </div>
      </div>
    </section>
  );
}

/** Load every KaTeX font the formulas use before printing, so symbols such as sums are not dropped. */
export async function printReport() {
  const fonts = ['KaTeX_Main', 'KaTeX_Math', 'KaTeX_AMS', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4'];
  try { await Promise.all(fonts.map((f) => document.fonts.load(`16px ${f}`, '∑∫𝔼∅'))); } catch { /* print anyway */ }
  window.print();
}

function fmtSeconds(s: number): string {
  if (!Number.isFinite(s)) return '—';
  if (s >= 3600) return `${(s / 3600).toFixed(1)} h`;
  if (s >= 60) return `${(s / 60).toFixed(1)} min`;
  return `${Math.round(s)} s`;
}

function ReportBody({ state, experiments, label, runId, print = false, activity }: ReportProps) {
  const completed = state.completed.map((id) => ({ id, exp: experiments[id], cand: state.candidates.find((c) => c.id === id) }));
  const threats = Object.values(state.analyses).flatMap((a) => a.threats_to_validity);
  const next = state.next_decision;
  const titleId = print ? 'report-title-print' : 'report-title';

  return (
    <article className="space-y-8" aria-labelledby={titleId}>
      {print && <PrintHeader label={label} runId={runId} />}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Evidence report</p>
          <h2 id={titleId} className="mt-1 font-display text-3xl">{print ? state.question : 'What the lab found'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {state.completed.length} experiment{state.completed.length === 1 ? '' : 's'} completed · {state.events} recorded events
          </p>
        </div>
        {!print && (
          <Button variant="outline" className="min-h-11 gap-2" onClick={printReport}>
            <Download aria-hidden className="size-4" /> Download PDF
          </Button>
        )}
      </header>

      <SummaryBox state={state} experiments={experiments} print={print} />
      <NegativeResult experiments={experiments} />

      <section className="space-y-3">
        <SectionTitle n={1}>Question &amp; hypotheses</SectionTitle>
        {!print && <p className="leading-relaxed">{state.question}</p>}
        <ul className="space-y-2">
          {state.hypotheses.map((h) => (
            <li key={h.id} className="avoid-break rounded-lg border bg-card/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-primary">{h.id} · {h.family}{h.origin !== 'preregistered' ? ` · ${h.origin}` : ''}</span>
                <div className="flex items-center gap-3">
                  {!print && <MetricInfo metric="posterior">belief</MetricInfo>}
                  <span className="text-xs text-muted-foreground"><TeX tex={`P(${h.id} \\mid D)`} /></span>
                  <Posterior value={h.posterior} />
                  <StatusChip status={hypStatus(h.status)} label={h.status} />
                </div>
              </div>
              <p className="mt-1 text-sm leading-relaxed">{h.statement}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <SectionTitle n={2}>Experimental design</SectionTitle>
        {state.rounds.length ? (
          <ul className="space-y-3">
            {state.rounds.map((r) => {
              const chosen = r.rows.find((x) => x.id === (r.selected ?? r.argmax));
              return (
                <li key={r.round} className="space-y-2 rounded-lg border bg-card/60 p-3 text-sm">
                  <p><span className="text-muted-foreground">Round {r.round}:</span> chose <strong>{chosen?.title ?? r.selected ?? r.argmax ?? '—'}</strong>
                    {r.followed_argmax === false && <span className="text-uncertain"> (overrode the planner's top pick)</span>}</p>
                  {chosen && (
                    <p className="text-muted-foreground">
                      {!print ? <MetricInfo metric="eig">information gain</MetricInfo> : 'Information gain'}{' '}
                      <span className="font-mono text-foreground">{chosen.eig_bits.toFixed(3)} bits</span> · est. {Math.round(chosen.est_wall_seconds)} s · tests {chosen.hypotheses.join(', ')}
                    </p>
                  )}
                  {r.justification && <p>{r.justification}</p>}
                  <FrontierChart round={r} />
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-muted-foreground">No experiment selection recorded yet.</p>}
      </section>

      <section className="space-y-3">
        <SectionTitle n={3}>Measured findings</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Each result shows the estimate with its {!print ? <MetricInfo metric="ci">95% confidence interval</MetricInfo> : '95% confidence interval'}. The vertical line marks zero (no effect); a range that touches it is reported as inconclusive.
        </p>
        {completed.length === 0 && <p className="text-sm text-muted-foreground">No completed experiments yet.</p>}
        {completed.map(({ id, exp, cand }) => (
          <div key={id} className="space-y-4 glass rounded-xl p-4 shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-medium"><span className="font-mono text-xs text-muted-foreground">{id}</span> {exp?.title ?? cand?.title ?? ''}</h4>
              <StatusChip status={experimentStatus(exp ?? { status: 'completed', error: null })} label={exp?.error ? 'Failed' : 'Completed'} />
            </div>
            {exp?.error && <p className="text-sm text-failure">Error reported by the lab: {exp.error}</p>}
            {!exp && <p className="text-sm text-muted-foreground">Measurements not available from the lab yet.</p>}

            {exp?.verdicts && Object.entries(exp.verdicts).map(([hid, v]) => {
              const dv = displayVerdict(v.verdict, v.effect);
              const downgraded = v.verdict.toLowerCase() !== dv;
              return (
                <div key={hid} className="avoid-break space-y-2 rounded-lg border bg-surface-sunken p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium leading-snug">{findingHeadline(hid, v.measure, dv)}</p>
                    <StatusChip status={verdictStatus(dv)} label={dv === 'refuted' ? 'Not supported' : dv.charAt(0).toUpperCase() + dv.slice(1)} />
                  </div>
                  <IntervalBar ci={v.effect} status={verdictStatus(dv)} />
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div><dt className="text-muted-foreground">Estimate [95% CI]</dt><dd className="font-mono tabular-nums">{fmtCI(v.effect)}</dd></div>
                    <div><dt className="text-muted-foreground">Standardised effect</dt><dd className="font-mono tabular-nums">{v.standardised_effect === null ? 'not reported' : v.standardised_effect.toFixed(2)}</dd></div>
                    <div><dt className="text-muted-foreground">Units tested</dt><dd className="font-mono tabular-nums">n = {v.n_units}</dd></div>
                    <div><dt className="text-muted-foreground">Lab verdict</dt><dd>{v.verdict}</dd></div>
                  </dl>
                  {downgraded && <p className="text-xs text-uncertain">The lab said “{v.verdict}”, but the 95% range includes zero, so it is shown as inconclusive.</p>}
                </div>
              );
            })}

            {exp?.auroc && Object.keys(exp.auroc).length > 0 && (
              <div className="avoid-break overflow-x-auto">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Early-warning accuracy (AUROC ∈ [0, 1]; 0.5 = chance)</p>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-normal">Predictor</th><th className="py-1 font-normal">AUROC [95% CI]</th></tr></thead>
                  <tbody>{Object.entries(exp.auroc).map(([k, ci]) => <tr key={k} className="border-t"><td className="py-1 pr-3">{k}</td><td className="py-1 font-mono text-xs tabular-nums">{fmtCI(ci)}</td></tr>)}</tbody>
                </table>
              </div>
            )}

            {exp?.per_controller && Object.keys(exp.per_controller).length > 0 && (
              <div className="avoid-break overflow-x-auto">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Results by controller</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-3 font-normal">Controller</th>
                      <th className="py-1 pr-3 font-normal">Recovery rate [95% CI]</th>
                      <th className="py-1 pr-3 font-normal">Mean time to recover (RMST, generations)</th>
                      <th className="py-1 pr-3 font-normal">Worst-10% recovery (<TeX tex="\mathrm{CVaR}_{0.9}" />, generations)</th>
                      <th className="py-1 font-normal">Mean mutation rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(exp.per_controller).map(([k, c]) => (
                      <tr key={k} className="border-t font-mono text-xs tabular-nums">
                        <td className="py-1 pr-3 font-sans text-sm">{k}</td>
                        <td className="py-1 pr-3">{fmtCI(c.recovery_rate)}</td>
                        <td className="py-1 pr-3">{c.rmst_gens ?? 'not reported'}</td>
                        <td className="py-1 pr-3">{c.cvar90_recovery_gens ?? 'not reported'}</td>
                        <td className="py-1">{c.mean_p_mut === null ? 'not reported' : c.mean_p_mut.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {exp?.curves && Object.keys(exp.curves).length > 0
              ? Object.entries(exp.curves).map(([name, c]) => <CurveChart key={name} name={name} curves={c} />)
              : exp && <p className="text-xs text-muted-foreground">No curve data reported for this experiment.</p>}

            {exp?.analysis && (
              <div className="avoid-break rounded-lg border-l-2 border-primary pl-3">
                <p className="text-xs font-medium text-muted-foreground">What this means · written by {exp.analysis.by}</p>
                <p className="mt-1 text-sm leading-relaxed">{exp.analysis.interpretation}</p>
              </div>
            )}
          </div>
        ))}
        <MetaFooter />
      </section>

      <section className="avoid-break space-y-3">
        <SectionTitle n={4}>Uncertainty</SectionTitle>
        <ul className="space-y-1 text-sm leading-relaxed">
          <li>Open hypotheses: <strong>{state.hypotheses.filter((h) => !['supported', 'refuted'].includes(h.status.toLowerCase())).length}</strong> of {state.hypotheses.length}.</li>
          <li>Any interval that includes zero is reported as inconclusive, never as success.</li>
          <li>Tail figures such as {!print ? <MetricInfo metric="cvar">downside risk</MetricInfo> : 'downside risk'} are unstable at small sample sizes and are shown only when the lab reports them.</li>
        </ul>
      </section>

      <section className="avoid-break space-y-3">
        <SectionTitle n={5}>Limitations</SectionTitle>
        {threats.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">{threats.map((t, i) => <li key={i}>{t}</li>)}</ul>
        ) : <p className="text-sm text-muted-foreground">The lab has not recorded threats to validity yet.</p>}
      </section>

      <section className="avoid-break space-y-3">
        <SectionTitle n={6}>Next decision</SectionTitle>
        {next?.decision ? (
          <div className="rounded-xl border border-primary/40 bg-running-soft p-4">
            <p className="font-medium">{next.decision}</p>
            {next.rationale && <p className="mt-1 text-sm leading-relaxed">{next.rationale}</p>}
            {next.next_experiment && <p className="mt-2 font-mono text-xs text-primary">Next experiment: {next.next_experiment}</p>}
          </div>
        ) : <p className="text-sm text-muted-foreground">No next decision recorded yet.</p>}
        <MetaFooter />
      </section>

      <EvidenceContract runId={runId} print={print} />

      {print && activity && activity.length > 0 && <AgentTraceSection activity={activity} />}

      {print ? (
        <section className="space-y-3 page-break-before">
          <h3 className="font-display text-xl">Appendix · Metric definitions</h3>
          {Object.values(EXPLAINERS).map((e) => (
            <div key={e.title} className="avoid-break space-y-1 border-b pb-3">
              <p className="font-medium">{e.title}</p>
              <p className="text-sm leading-relaxed">{e.plain}</p>
              <TeX tex={e.tex} block />
              <p className="text-xs text-muted-foreground">Source: {e.source.label}</p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Pre-registration sha256: <span className="break-all font-mono">{state.prereg_sha256 ?? 'not recorded'}</span></p>
          <p className="text-xs text-muted-foreground">Source code: {REPO_URL}</p>
        </section>
      ) : (
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Verify this result</h3>
        <p className="text-xs text-muted-foreground">Raw scoring tables, sources, specifications and the pre-registration fingerprint behind every number above.</p>
        <Expandable title="Planner scoring tables">
          {state.rounds.map((r) => (
            <div key={r.round} className="mb-3 overflow-x-auto">
              <p className="mb-1 font-mono text-xs">Round {r.round}</p>
              <table className="w-full font-mono text-xs">
                <thead><tr className="text-left text-muted-foreground"><th className="pr-3">id</th><th className="pr-3">EIG bits</th><th className="pr-3">utility</th><th className="pr-3">feasible</th><th>est s</th></tr></thead>
                <tbody>{r.rows.map((x) => <tr key={x.id}><td className="pr-3">{x.id}</td><td className="pr-3">{x.eig_bits.toFixed(3)}</td><td className="pr-3">{x.utility.toFixed(3)}</td><td className="pr-3">{x.feasible ? 'yes' : `no: ${x.violations.join('; ')}`}</td><td>{Math.round(x.est_wall_seconds)}</td></tr>)}</tbody>
              </table>
            </div>
          ))}
        </Expandable>
        <Expandable title="Literature evidence">
          {state.evidence.length ? <ul className="space-y-1">{state.evidence.map((e, i) => <li key={i}>{e.source} · {e.title ?? e.source_id} {e.year ? `(${e.year})` : ''} — {e.relation} {e.hypothesis_id}</li>)}</ul> : 'None recorded.'}
        </Expandable>
        <Expandable title="Experiment specifications (raw)">
          <pre className="max-h-80 overflow-auto font-mono text-xs">{JSON.stringify(Object.fromEntries(Object.entries(experiments).map(([k, v]) => [k, v.spec ?? null])), null, 2)}</pre>
        </Expandable>
        <Expandable title="Pre-registration fingerprint">
          <p className="break-all font-mono text-xs">sha256 {state.prereg_sha256 ?? 'not recorded'}</p>
        </Expandable>
      </section>
      )}
    </article>
  );
}

/** Print-only: who handed what to whom, from lab activity only. */
function AgentTraceSection({ activity }: { activity: LabActivity[] }) {
  const g = traceGraph(activity);
  return (
    <section className="page-break-before space-y-3">
      <SectionTitle n={7}>Agent workflow &amp; traceability</SectionTitle>
      <p className="text-sm text-muted-foreground">Each circle is an agent with the number of actions it took; arrows show work handed from one agent to another, as recorded in the lab's activity log.</p>
      <div className="avoid-break mx-auto max-w-[150mm] rounded-xl bg-console p-3 text-console-foreground"><AgentGraph graph={g} selected={null} onSelect={() => {}} /></div>
      {g.links.length > 0 && (
        <table className="avoid-break w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-normal">From</th><th className="py-1 pr-3 font-normal">To</th><th className="py-1 pr-3 font-normal">Handoffs</th><th className="py-1 font-normal">Work transmitted</th></tr></thead>
          <tbody>{g.links.map((l) => (
            <tr key={`${l.from}-${l.to}`} className="border-t align-top">
              <td className="py-1 pr-3">{agentDisplayName(l.from)}</td><td className="py-1 pr-3">{agentDisplayName(l.to)}</td>
              <td className="py-1 pr-3 font-mono tabular-nums">{l.count}</td><td className="py-1 text-xs">{l.titles.join('; ') || '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="text-xs text-muted-foreground">{g.segments.length} work segments across {g.agents.length} agents. Full tool payloads are in the app's Traceability console.</p>
    </section>
  );
}
