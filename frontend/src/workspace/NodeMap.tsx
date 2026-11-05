import type { LabActivity } from '@/noesis/api/lab-types';
import { agentDisplayName, nodeMapState, type AgentRole } from './model';

const ROLE_VAR: Record<AgentRole, string> = {
  insight: 'var(--primary)', planner: 'var(--chart-2, var(--primary))', runner: 'var(--success)', analysis: 'var(--uncertain)',
};

/** Luminous agent map: nodes and lines appear only for agents and handoffs the lab reported. */
export function NodeMap({ activity, running, onSelect }: { activity: LabActivity[]; running: boolean; onSelect?: (agent: string) => void }) {
  const { nodes, links, latest } = nodeMapState(activity);
  const W = 640, H = 380, R = 140, cx = W / 2, cy = H / 2;
  const pos = new Map(nodes.map((n) => [n.name, { x: cx + n.x * R * 1.6, y: cy + n.y * R }]));
  return (
    <section aria-label="Agent map" className="relative overflow-hidden rounded-xl border bg-console/90 text-console-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_65%)]" />
      {nodes.length === 0 ? (
        <div className="flex h-72 flex-col items-center justify-center gap-3">
          <span className="size-3 rounded-full bg-primary shadow-[0_0_24px_6px_color-mix(in_oklab,var(--primary)_60%,transparent)] animate-pulse-dot" />
          <p className="text-xs opacity-70">{running ? 'Waiting for the lead agent…' : 'No agent activity was recorded.'}</p>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="relative block w-full" role="img" aria-label={`${nodes.length} agents, ${links.length} handoff routes`}>
          <defs>
            <filter id="nm-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6" /></filter>
          </defs>
          {links.map((l) => {
            const a = pos.get(l.from), b = pos.get(l.to);
            if (!a || !b) return null;
            return (
              <g key={`${l.from}-${l.to}`}>
                <title>{`${agentDisplayName(l.from)} → ${agentDisplayName(l.to)}: ${l.count} handoff${l.count === 1 ? '' : 's'}`}</title>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--primary)" strokeOpacity={0.25} strokeWidth={6} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--primary)" strokeWidth={1.4} className="nm-draw" />
              </g>
            );
          })}
          {nodes.map((n) => {
            const p = pos.get(n.name)!;
            const c = ROLE_VAR[n.role];
            const active = running && latest?.agent === n.name;
            const r = n.lead ? 12 : 8;
            return (
              <g key={n.name} className="nm-node cursor-pointer" role="button" tabIndex={0} aria-label={`${agentDisplayName(n.name)}, ${n.steps} actions`}
                onClick={() => onSelect?.(n.name)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(n.name); }}>
                <circle cx={p.x} cy={p.y} r={r * 2.2} fill={c} opacity={active ? 0.55 : 0.3} filter="url(#nm-glow)" className={active ? 'animate-pulse-dot' : ''} />
                <circle cx={p.x} cy={p.y} r={r} fill={c} />
                <text x={p.x} y={p.y + (n.y > 0.2 ? r + 18 : -r - 23)} textAnchor="middle" fontSize="12" fill="currentColor">{agentDisplayName(n.name)}</text>
                <text x={p.x} y={p.y + (n.y > 0.2 ? r + 31 : -r - 10)} textAnchor="middle" fontSize="10" fill="currentColor" opacity={0.6}>{n.steps} action{n.steps === 1 ? '' : 's'}</text>
              </g>
            );
          })}
        </svg>
      )}
      {latest && (
        <div className="glass absolute bottom-3 left-3 right-3 rounded-lg px-3 py-2 text-xs text-foreground sm:right-auto sm:max-w-sm" role="status" aria-live="polite">
          <span className="font-medium">{agentDisplayName(latest.agent)}</span>
          <span className="text-muted-foreground"> · {running ? 'now' : 'last'}: </span>
          <span className="break-words">{latest.text.replace(/^#+\s*/, '') || '…'}</span>
        </div>
      )}
    </section>
  );
}
