import type { LabExperiment } from '@/noesis/api/lab-types';
import { negativeResults } from './model';

const sign = (n: number | null) => (n === null ? 'not measured' : `${n > 0 ? '+' : ''}${n.toFixed(3)}`);

/** Keynote block: a development signal that did not survive the held-out test. Lab numbers only. */
export function NegativeResult({ experiments }: { experiments: Record<string, LabExperiment> }) {
  const items = negativeResults(experiments);
  if (!items.length) return null;
  return (
    <section className="avoid-break space-y-3 rounded-2xl border border-uncertain/50 bg-uncertain-soft/40 p-5" aria-labelledby="neg-title">
      <h3 id="neg-title" className="font-display text-2xl font-semibold">Noesis was willing to change its mind.</h3>
      <p className="text-sm text-muted-foreground">A signal found during development did not hold on sealed, held-out data. Reporting this is the point of a pre-registered study.</p>
      {items.map((r) => (
        <div key={r.hypothesis} className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-success/40 bg-success-soft p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Development signal · {r.dev.experiment}</p>
            <p className="mt-1 font-mono text-3xl text-success">{sign(r.dev.estimate)}</p>
            <p className="text-xs text-muted-foreground">{r.hypothesis} · {r.measure}</p>
          </div>
          <div className="rounded-xl border border-failure/40 bg-failure-soft p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Held-out result · {r.heldout.experiment}</p>
            <p className="mt-1 font-mono text-3xl">{sign(r.heldout.estimate)}</p>
            <p className="text-xs text-muted-foreground">{r.hypothesis} · {r.heldout.verdict}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
