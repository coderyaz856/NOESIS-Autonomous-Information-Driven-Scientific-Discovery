import { useEffect, useMemo, useRef, useState } from 'react';
import type { LabActivity, LabState } from '@/noesis/api/lab-types';
import { AGENT_ROLE_LABEL, activityToTrace, traceGraph, agentDisplayName, type AgentRole, type FlowSegment, type TraceEntry } from './model';
import { JsonView } from './JsonView';

/** IDE-style traceability console: Meta Model traces + auto-scrolling log. */
const ROLE_COLOR: Record<AgentRole, string> = {
  insight: 'var(--neon-cyan)', planner: 'var(--chart-4)', runner: 'var(--neon-pink)', analysis: 'var(--chart-5)',
};

/** IDE-style traceability console: workflow graphs (who handed what to whom) + traces + log. */
export function TraceConsole({ activity, state }: { activity: LabActivity[]; state: LabState | null }) {
  const trace = useMemo(() => activityToTrace(activity), [activity]);
  const graph = useMemo(() => traceGraph(activity), [activity]);
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [sel, setSel] = useState<{ type: 'agent'; name: string } | { type: 'seg'; id: string } | null>(null);
  const metaEntries = trace.filter((e) => e.meta && (e.reasoning || e.payload !== null || e.gate));
  const selEntries = !sel ? [] : sel.type === 'seg'
    ? graph.segments.find((s) => s.id === sel.id)?.entries ?? []
    : trace.filter((e) => e.agent === sel.name);
  const selLabel = !sel ? '' : sel.type === 'agent' ? agentDisplayName(sel.name) : (() => { const s = graph.segments.find((x) => x.id === sel.id); return s ? `${agentDisplayName(s.agent)} · step ${s.id.slice(1)}` : ''; })();
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-console text-console-foreground">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Traceability console</span>
        <span className="flex items-center gap-1" role="tablist" aria-label="Trace view">
          {(['graph', 'list'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded px-1.5 py-0.5 ${view === v ? 'bg-background/40 text-console-foreground' : ''}`}>{v === 'graph' ? 'Workflow' : 'Traces'}</button>
          ))}
          <span className="ml-1">{trace.length} ev</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {view === 'graph' ? (
          graph.segments.length === 0 ? <p className="px-1 font-mono text-[11px] text-muted-foreground">No agent activity yet.</p> : (
            <>
              <AgentGraph graph={graph} selected={sel?.type === 'agent' ? sel.name : null} onSelect={(name) => setSel({ type: 'agent', name })} />
              <SequenceFlow segments={graph.segments} selected={sel?.type === 'seg' ? sel.id : null} onSelect={(id) => setSel({ type: 'seg', id })} />
            </>
          )
        ) : (
          <div aria-label="Meta Model traces" className="space-y-1.5">
            {metaEntries.length === 0 && <p className="px-1 font-mono text-[11px] text-muted-foreground">No Insight or Analysis traces yet.</p>}
            {metaEntries.map((e) => <TraceBlock key={e.id} e={e} />)}
            {state && Object.entries(state.analyses).map(([id, a]) => (
              <details key={id} className="rounded border border-border/60 bg-background/20 px-2 py-1">
                <summary className="cursor-pointer font-mono text-[11px]"><span className="text-json-key">[View Meta Model Trace]</span> analysis {id} · {a.verification?.status ?? 'unverified'}</summary>
                <JsonView value={{ by: a.by, interpretation: a.interpretation, threats_to_validity: a.threats_to_validity, verification: a.verification ?? null }} />
              </details>
            ))}
          </div>
        )}
      </div>
      {view === 'graph' && sel ? (
        <div className="max-h-[45%] min-h-0 overflow-y-auto border-t border-border/60 p-2" aria-label="Selected node details">
          <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>console · {selLabel} · {selEntries.length} events</span>
            <button type="button" onClick={() => setSel(null)} aria-label="Close details">✕</button>
          </div>
          <div className="space-y-1">{selEntries.map((e) => <TraceBlock key={e.id} e={e} />)}</div>
        </div>
      ) : <LogTerminal trace={trace} />}
    </div>
  );
}

/** Agents as nodes, handoffs as arrows labelled with how many times work was passed. */
export function AgentGraph({ graph, selected, onSelect }: { graph: ReturnType<typeof traceGraph>; selected: string | null; onSelect: (n: string) => void }) {
  const W = 380, H = 290, cx = W / 2, cy = H / 2 + 4, R = 92;
  const n = graph.agents.length;
  const pos = new Map(graph.agents.map((a, i) => {
    const ang = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    return [a.name, n === 1 ? { x: cx, y: cy } : { x: cx + R * 1.5 * Math.cos(ang), y: cy + R * Math.sin(ang) }];
  }));
  return (
    <figure className="rounded-lg border border-border/60 bg-[radial-gradient(circle_at_50%_40%,color-mix(in_oklab,var(--neon-cyan)_10%,transparent),transparent_70%)] p-2">
      <figcaption className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Agent network · who passed work to whom</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${n} agents, ${graph.links.length} handoff routes`}>
        <defs>
          <marker id="tg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" fill="var(--neon-cyan)" />
          </marker>
          <filter id="tg-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          {graph.agents.map((a) => (
            <radialGradient key={a.name} id={`tg-g-${a.name}`} cx="35%" cy="30%" r="80%">
              <stop offset="0%" stopColor={ROLE_COLOR[a.role]} stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--console)" stopOpacity="1" />
            </radialGradient>
          ))}
        </defs>
        {graph.links.map((l) => {
          const a = pos.get(l.from), b = pos.get(l.to); if (!a || !b) return null;
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len, r = 24;
          const sx = a.x + ux * r, sy = a.y + uy * r, ex = b.x - ux * (r + 3), ey = b.y - uy * (r + 3);
          const mx = (sx + ex) / 2 - uy * 16, my = (sy + ey) / 2 + ux * 16;
          const label = `${l.count} handoff${l.count === 1 ? '' : 's'}`;
          const lw = label.length * 4.6 + 10;
          const d = `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
          return (
            <g key={`${l.from}-${l.to}`}>
              <title>{`${agentDisplayName(l.from)} sent work to ${agentDisplayName(l.to)} ${l.count} time${l.count === 1 ? '' : 's'}${l.titles.length ? `: ${l.titles.join('; ')}` : ''}`}</title>
              <path d={d} fill="none" stroke="var(--neon-cyan)" strokeOpacity="0.25" strokeWidth="6" />
              <path d={d} fill="none" stroke="var(--neon-cyan)" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#tg-arrow)" className="motion-safe:animate-[tg-dash_1.2s_linear_infinite]" />
              <rect x={mx - lw / 2} y={my - 7} width={lw} height={14} rx={7} fill="var(--console)" stroke="var(--neon-cyan)" strokeOpacity="0.6" />
              <text x={mx} y={my + 3} fontSize="8.5" textAnchor="middle" fill="var(--console-foreground)">{label}</text>
            </g>
          );
        })}
        {graph.agents.map((a) => {
          const p = pos.get(a.name)!; const on = selected === a.name;
          const nm = agentDisplayName(a.name);
          return (
            <g key={a.name} role="button" tabIndex={0} aria-label={`${nm}, ${AGENT_ROLE_LABEL[a.role]}, ${a.steps} actions`} className="cursor-pointer outline-none"
              onClick={() => onSelect(a.name)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a.name); } }}>
              <title>{`${nm} (${a.name}) · ${AGENT_ROLE_LABEL[a.role]} · ${a.steps} actions. Click for its console.`}</title>
              <circle cx={p.x} cy={p.y} r={on ? 27 : 24} fill={`url(#tg-g-${a.name})`} stroke={ROLE_COLOR[a.role]} strokeWidth={on ? 3 : 1.8} filter={on ? 'url(#tg-glow)' : undefined} />
              <text x={p.x} y={p.y + 1} fontSize="12" fontWeight="600" textAnchor="middle" fill="var(--console-foreground)">{a.steps}</text>
              <text x={p.x} y={p.y + 11} fontSize="6.5" textAnchor="middle" fill="var(--muted-foreground)">actions</text>
              <text x={p.x} y={p.y < cy - 10 ? p.y - 31 : p.y + 38} fontSize="9.5" fontWeight="600" textAnchor="middle" fill="var(--console-foreground)">{nm}</text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-2 font-mono text-[9.5px] text-muted-foreground">
        {(Object.keys(ROLE_COLOR) as AgentRole[]).map((r) => (
          <li key={r} className="flex items-center gap-1"><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: ROLE_COLOR[r], boxShadow: `0 0 6px ${ROLE_COLOR[r]}` }} />{AGENT_ROLE_LABEL[r]}</li>
        ))}
        <li>· number = actions taken · arrow = work handed over</li>
      </ul>
    </figure>
  );
}

/** Run order: each node is one stretch of work by one agent; arrows carry the handoff title that was transmitted. */
function SequenceFlow({ segments, selected, onSelect }: { segments: FlowSegment[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <section className="rounded border border-border/60 bg-background/20 p-2" aria-label="Workflow in run order">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Workflow · run order (click a node for its console)</p>
      <ol className="space-y-0">
        {segments.map((s, i) => {
          const tools = s.entries.filter((e) => e.kind === 'tool').length;
          const says = s.entries.filter((e) => e.kind === 'say').length;
          const gates = s.entries.filter((e) => e.kind === 'gate').length;
          return (
            <li key={s.id}>
              {i > 0 && (
                <div className="flex items-stretch gap-2 pl-4">
                  <span aria-hidden className="w-px bg-border" />
                  <span className="py-1 font-mono text-[10px] text-muted-foreground">↓ {s.received ? <span className="text-json-string">“{s.received}”</span> : 'continues'}</span>
                </div>
              )}
              <button type="button" onClick={() => onSelect(s.id)} aria-pressed={selected === s.id}
                className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-background/40 ${selected === s.id ? 'bg-background/40' : ''}`}
                style={{ borderColor: s.failed ? 'var(--failure)' : ROLE_COLOR[s.role] }}>
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ROLE_COLOR[s.role] }} />
                <span className="min-w-0 flex-1 truncate"><span className="text-console-foreground">{agentDisplayName(s.agent)}</span> <span className="text-muted-foreground">· {AGENT_ROLE_LABEL[s.role]}</span></span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{tools ? `${tools} tool ` : ''}{says ? `${says} msg ` : ''}{gates ? `${gates} gate` : ''}{s.failed ? <span className="text-failure"> ✕</span> : ''}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TraceBlock({ e }: { e: TraceEntry }) {
  return (
    <details className="rounded border border-border/60 bg-background/20 px-2 py-1">
      <summary className="cursor-pointer font-mono text-[11px]">
        <span className="text-json-key">[View Meta Model Trace]</span> {AGENT_ROLE_LABEL[e.role]} · <span className="text-muted-foreground">{e.summary}</span>
      </summary>
      <div className="mt-1 space-y-1.5 font-mono text-[11px]">
        <p className="text-muted-foreground">// system prompt: not exposed by the lab feed</p>
        {e.reasoning && <div><p className="text-json-number">reasoning</p><pre className="whitespace-pre-wrap break-words">{e.reasoning}</pre></div>}
        {e.payload !== null && <div><p className="text-json-number">tool_call</p><JsonView value={{ name: e.summary.replace('()', ''), args: e.payload, ...e.result }} /></div>}
        {e.gate && <div><p className="text-json-number">gate</p><JsonView value={e.gate} /></div>}
        <p className="text-muted-foreground">agent: {e.agent}</p>
      </div>
    </details>
  );
}

function LogTerminal({ trace }: { trace: TraceEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => { if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [trace.length, follow]);
  const onScroll = () => {
    const el = ref.current; if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };
  return (
    <div className="relative border-t border-border/60">
      <div ref={ref} onScroll={onScroll} role="log" aria-live="off" aria-label="System log" className="h-48 overflow-y-auto px-2 py-1.5 font-mono text-[10.5px] leading-snug">
        {trace.map((e) => (
          <div key={e.id} className="whitespace-pre-wrap break-words">
            <span className="text-muted-foreground">{fmtT(e.t)}</span>{' '}
            <span className={e.result?.ok === false ? 'text-failure' : 'text-json-key'}>{e.kind.padEnd(8)}</span>{' '}
            <span className="text-json-string">{e.agent}</span> {e.summary}
          </div>
        ))}
      </div>
      {!follow && (
        <button type="button" onClick={() => setFollow(true)} className="absolute bottom-2 right-3 rounded border bg-background px-2 py-0.5 font-mono text-[10px]">jump to latest ↓</button>
      )}
    </div>
  );
}

function fmtT(t: number) {
  const d = new Date(t > 1e12 ? t : t * 1000);
  return Number.isNaN(d.getTime()) ? String(t) : d.toISOString().slice(11, 19);
}
