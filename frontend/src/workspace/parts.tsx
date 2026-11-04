import katex from 'katex';
import 'katex/dist/katex.min.css';
import { CheckCircle2, CircleDashed, HelpCircle, Info, Loader2, XCircle, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { CI } from '@/noesis/api/lab-types';
import { EXPLAINERS, type MetricKey } from './explainers';
import type { SourceLabel, StepStatus } from './model';

const STATUS: Record<StepStatus, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  running: { label: 'Running', icon: Loader2, cls: 'bg-running-soft text-running' },
  succeeded: { label: 'Succeeded', icon: CheckCircle2, cls: 'bg-success-soft text-success' },
  failed: { label: 'Failed', icon: XCircle, cls: 'bg-failure-soft text-failure' },
  uncertain: { label: 'Uncertain', icon: HelpCircle, cls: 'bg-uncertain-soft text-uncertain' },
};

/** Status is always icon + text, never colour alone. */
export function StatusChip({ status, label }: { status: StepStatus; label?: string }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', s.cls)}>
      <Icon aria-hidden className={cn('size-3.5', status === 'running' && 'animate-spin motion-reduce:animate-none')} />
      {label ?? s.label}
    </span>
  );
}

export function SourceBadge({ label }: { label: SourceLabel | null }) {
  if (!label) return null;
  const live = label === 'LIVE';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] font-semibold tracking-wider', live ? 'bg-success-soft text-success' : 'bg-recorded-soft text-recorded')}>
      {live ? <span aria-hidden className="size-1.5 rounded-full bg-success animate-pulse-dot" /> : <CircleDashed aria-hidden className="size-3" />}
      {live ? 'LIVE RUN' : 'RECORDED DEMONSTRATION'}
    </span>
  );
}

export function MetricInfo({ metric, children }: { metric: MetricKey; children?: ReactNode }) {
  const e = EXPLAINERS[metric];
  return (
    <Dialog>
      <DialogTrigger className="inline-flex min-h-6 items-center gap-1 rounded text-left text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground" aria-label={`What is ${e.title}?`} title={e.short ?? e.plain.split('. ')[0] + '.'}>
        {children ?? e.title}
        <Info aria-hidden className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-2rem)] max-w-xl flex-col overflow-y-auto overflow-x-hidden rounded-lg">
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className="font-display text-xl break-words">{e.title}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed break-words text-foreground/90">{e.plain}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border bg-surface-sunken p-3">
          <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Documented formula</p>
          <TeX tex={e.tex} block />
        </div>
        <a href={e.source.href} target="_blank" rel="noreferrer" className="break-words text-sm text-primary underline underline-offset-4">
          Source: {e.source.label}
        </a>
      </DialogContent>
    </Dialog>
  );
}

/** Horizontal interval bar: zero line, estimate dot and 95% range. Uses only reported values. */
export function IntervalBar({ ci, status }: { ci: CI | null | undefined; status: StepStatus }) {
  if (!ci || ci.estimate === null || !ci.ci95) return null;
  const [lo, hi] = ci.ci95;
  const span = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(ci.estimate)) * 1.2 || 1;
  const pos = (v: number) => `${50 + (v / span) * 50}%`;
  const tone = status === 'succeeded' ? 'bg-success' : status === 'failed' ? 'bg-failure' : 'bg-uncertain';
  return (
    <div className="relative h-6 w-full" role="img" aria-label={`Estimate ${ci.estimate.toFixed(3)}, 95% interval ${lo.toFixed(3)} to ${hi.toFixed(3)}`}>
      <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
      <div className="absolute top-1 bottom-1 w-px bg-muted-foreground" style={{ left: '50%' }} title="zero" />
      <div className={cn('absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-60', tone)} style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} />
      <div className={cn('absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background', tone)} style={{ left: pos(ci.estimate) }} />
    </div>
  );
}

export function Expandable({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border bg-surface-sunken/60">
      <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between px-4 text-left text-sm font-medium">
        {title}
        <span aria-hidden className="text-muted-foreground transition-transform group-data-[state=open]:rotate-90">›</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 py-3 text-sm">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function SectionTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h3 className="flex items-baseline gap-3 font-display text-xl">
      <span className="font-mono text-xs text-primary">{String(n).padStart(2, '0')}</span>
      {children}
    </h3>
  );
}

export function MetaBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full meta-pill px-2 py-0.5 text-[10px] font-semibold">
      <Zap aria-hidden className="size-3" /> Powered by Meta Model
    </span>
  );
}

export function MetaThinking() {
  return (
    <span role="status" className="animate-pulse-dot font-mono text-[11px] text-primary">Meta Model API synthesizing evidence…</span>
  );
}

export function MetaFooter() {
  return (
    <p className="flex items-center gap-1.5 border-t pt-2 font-mono text-[11px] text-muted-foreground">
      <Zap aria-hidden className="size-3 text-primary" />
      Reasoning and hypothesis generation executed via Meta Llama / Meta Model API.
    </p>
  );
}

/** Render a TeX formula with KaTeX (works during server rendering too). */
export function TeX({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = katex.renderToString(tex, { displayMode: block, throwOnError: false, output: 'htmlAndMathml' });
  return <span className={block ? 'block max-w-full overflow-x-auto overflow-y-hidden py-1 text-foreground [&_.katex-display]:my-1' : 'text-foreground'} dangerouslySetInnerHTML={{ __html: html }} />;
}
