import type { ReactNode } from 'react';

/** Tiny colour-coded JSON renderer (keys, strings, numbers). */
export function JsonView({ value }: { value: unknown }) {
  return <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{render(value, 0)}</pre>;
}

function render(v: unknown, depth: number): ReactNode {
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  if (v === null || typeof v === 'boolean') return <span className="text-json-number">{String(v)}</span>;
  if (typeof v === 'number') return <span className="text-json-number">{v}</span>;
  if (typeof v === 'string') return <span className="text-json-string">{JSON.stringify(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return <>[{'\n'}{v.map((x, i) => <span key={i}>{pad}{render(x, depth + 1)}{i < v.length - 1 ? ',' : ''}{'\n'}</span>)}{end}]</>;
  }
  if (typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>);
    if (!e.length) return '{}';
    return <>{'{'}{'\n'}{e.map(([k, x], i) => <span key={k}>{pad}<span className="text-json-key">{JSON.stringify(k)}</span>: {render(x, depth + 1)}{i < e.length - 1 ? ',' : ''}{'\n'}</span>)}{end}{'}'}</>;
  }
  return String(v);
}
