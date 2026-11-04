import type { CurveSet, ScoringRound } from '@/noesis/api/lab-types';

/** Charts draw only values the lab reported; nothing is interpolated or estimated here. */

const COLORS: string[] = ['var(--neon-pink)', 'var(--neon-cyan)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-1)'];

function niceRange(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

const W = 560, H = 190, P = { l: 44, r: 12, t: 12, b: 28 };

function Panel({ title, yLabel, series, n, shifts }: {
  title: string; yLabel: string; n: number; shifts: number[];
  series: { name: string; ys: number[]; color: string }[];
}) {
  const [lo, hi] = niceRange(series.flatMap((s) => s.ys));
  const x = (i: number) => P.l + (i / Math.max(1, n - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <figure className="chart-figure">
      <figcaption className="mb-1 text-xs font-medium text-muted-foreground">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}, ${series.length} controller${series.length === 1 ? '' : 's'}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={P.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{t.toFixed(2)}</text>
          </g>
        ))}
        {shifts.filter((s) => s >= 0 && s < n).map((s) => (
          <g key={`shift-${s}`}>
            <line x1={x(s)} x2={x(s)} y1={P.t} y2={H - P.b} stroke="var(--uncertain)" strokeWidth="1.5" strokeDasharray="4 3" />
            <text x={x(s) + 3} y={P.t + 10} fontSize="9" fill="var(--uncertain)">shift</text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.name} fill="none" stroke={s.color} strokeWidth="2"
            d={s.ys.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
        ))}
        <text x={(W + P.l) / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">generation</text>
        <text transform={`translate(11 ${(H - P.b + P.t) / 2}) rotate(-90)`} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{yLabel}</text>
      </svg>
    </figure>
  );
}

/** Error and entropy over generations, one line per controller, with landscape shifts marked. */
export function CurveChart({ name, curves }: { name: string; curves: CurveSet }) {
  const ctrls = Object.entries(curves.controllers);
  if (!ctrls.length) return null;
  const n = Math.max(...ctrls.map(([, c]) => c.entropy_mean.length));
  const err = ctrls.map(([k, c], i) => ({ name: k, ys: c.log10_best_err_mean, color: COLORS[i % COLORS.length] ?? 'var(--primary)' }));
  const ent = ctrls.map(([k, c], i) => ({ name: k, ys: c.entropy_mean, color: COLORS[i % COLORS.length] ?? 'var(--primary)' }));
  return (
    <div className="space-y-2 rounded-lg border bg-surface-sunken p-3 avoid-break">
      <p className="text-sm font-medium">Performance over time · <span className="font-mono text-xs text-muted-foreground">{name}</span></p>
      <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend">
        {err.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            {s.name} <span className="text-muted-foreground">(n = {curves.controllers[s.name]?.n_runs ?? '?'} runs)</span>
          </li>
        ))}
        {curves.shifts.length > 0 && (
          <li className="flex items-center gap-1.5 text-uncertain"><span aria-hidden className="inline-block h-3 border-l-2 border-dashed border-uncertain" /> landscape shift</li>
        )}
      </ul>
      <div className="grid gap-3">
        <Panel title="Best error (log₁₀, lower is better)" yLabel="log₁₀ error" series={err} n={n} shifts={curves.shifts} />
        <Panel title="Population entropy (0–1)" yLabel="entropy H" series={ent} n={n} shifts={curves.shifts} />
      </div>
    </div>
  );
}

/** Planner frontier: each candidate's expected information gain vs. its estimated compute time. */
export function FrontierChart({ round }: { round: ScoringRound }) {
  const rows = round.rows;
  if (!rows.length) return null;
  const chosen = round.selected ?? round.argmax;
  const [xlo, xhi] = niceRange(rows.map((r) => r.est_wall_seconds));
  const [ylo, yhi] = niceRange(rows.map((r) => r.eig_bits));
  const x = (v: number) => P.l + ((v - xlo) / (xhi - xlo)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - ylo) / (yhi - ylo)) * (H - P.t - P.b);
  return (
    <figure className="rounded-lg border bg-surface-sunken p-3 avoid-break">
      <figcaption className="mb-1 text-sm font-medium">Round {round.round}: which experiment was worth running</figcaption>
      <p className="mb-2 text-xs text-muted-foreground">Higher means more expected information; further right means more compute. The filled ring is the experiment chosen; hollow dots were infeasible.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Planner candidates for round ${round.round}; chosen ${chosen ?? 'none'}`}>
        {[ylo, (ylo + yhi) / 2, yhi].map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={P.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{t.toFixed(2)}</text>
          </g>
        ))}
        {rows.map((r) => {
          const sel = r.id === chosen;
          return (
            <g key={r.id}>
              <circle cx={x(r.est_wall_seconds)} cy={y(r.eig_bits)} r={sel ? 7 : 4.5}
                fill={r.feasible ? (sel ? 'var(--primary)' : 'var(--chart-2)') : 'none'}
                stroke={sel ? 'var(--foreground)' : 'var(--chart-2)'} strokeWidth={sel ? 2 : 1.5} />
              <text x={x(r.est_wall_seconds) + 9} y={y(r.eig_bits) + 3} fontSize="10" fill={sel ? 'var(--foreground)' : 'var(--muted-foreground)'}>{r.id}</text>
            </g>
          );
        })}
        <text x={(W + P.l) / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">estimated compute (s)</text>
        <text transform={`translate(11 ${(H - P.b + P.t) / 2}) rotate(-90)`} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">EIG (bits)</text>
      </svg>
    </figure>
  );
}
