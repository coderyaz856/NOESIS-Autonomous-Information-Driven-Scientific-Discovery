import { Lightbulb } from 'lucide-react';
import type { LabExperiment, LabState } from '@/noesis/api/lab-types';
import { insightSentences } from './model';
import { MetricInfo } from './parts';

/** "Why this matters": plain-language readouts built only from reported values. */
export function Insights({ state, experiments }: { state: LabState; experiments: Record<string, LabExperiment> }) {
  const items = insightSentences(experiments, state.compute_seconds);
  return (
    <section className="glass rounded-lg p-3" aria-labelledby="why-matters">
      <h2 id="why-matters" className="mb-2 flex items-center gap-2 text-sm font-medium"><Lightbulb aria-hidden className="size-4 text-primary" />Why this matters</h2>
      <ul className="space-y-1.5 text-sm">
        {items.map((it, i) => (
          <li key={i} className={it.missing ? 'text-xs text-muted-foreground' : ''}>{it.text}</li>
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <MetricInfo metric="auroc">AUROC</MetricInfo>
        <MetricInfo metric="rmst">RMST</MetricInfo>
        <MetricInfo metric="entropy">Entropy</MetricInfo>
        <MetricInfo metric="cvar">CVaR</MetricInfo>
        <MetricInfo metric="ci">95% CI</MetricInfo>
      </p>
    </section>
  );
}
