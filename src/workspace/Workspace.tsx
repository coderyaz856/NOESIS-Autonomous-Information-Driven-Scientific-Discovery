import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Bot, Hand, MessageSquare, RotateCcw, Settings2, Users, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { LabProvider, useLab } from '@/noesis/lab/LabContext';
import logo from '@/assets/logo_neosis.png';
import teamPicture from '@/assets/team-picture.jpeg';
import { EXAMPLE_QUESTIONS } from './explainers';
import { AGENT_ROLE_LABEL, activityToSteps, agentRole, type AgentRole, type Step } from './model';
import { MetricInfo, SourceBadge, StatusChip } from './parts';
import { HypothesisStrip, Report } from './Report';
import { useRun, type RunView } from './useRun';

export function Workspace() {
  return <LabProvider><Shell /></LabProvider>;
}

function Shell() {
  const run = useRun();
  const idle = run.phase === 'idle';
  return (
    <div className="min-h-dvh">
      <Header />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        {idle ? <Ask run={run} /> : <RunWorkspace run={run} />}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ header */
function Header() {
  const lab = useLab();
  const [addr, setAddr] = useState('');
  useEffect(() => setAddr(lab.baseUrl), [lab.baseUrl]);
  const statusText = lab.status === 'connected' ? 'Lab connected' : lab.status === 'checking' ? 'Checking lab…' : 'No lab connected';
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2 font-display text-lg">
          <img src={logo} alt="" className="size-7" />
          Noesis
        </a>
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" className="min-h-11 gap-2 text-sm">
                <span aria-hidden className={`size-2 rounded-full ${lab.status === 'connected' ? 'bg-success' : lab.status === 'checking' ? 'bg-uncertain animate-pulse-dot' : 'bg-muted-foreground'}`} />
                <span className="hidden sm:inline">{statusText}</span>
                <Settings2 aria-hidden className="size-4 sm:hidden" />
                <span className="sr-only sm:hidden">{statusText}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              <p className="text-sm font-medium">{statusText}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">Enter the public address of a running Noesis discovery lab. Without one, questions open the recorded demonstration.</p>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lab.setBaseUrl(addr); }}>
                <label htmlFor="lab-addr" className="sr-only">Lab address</label>
                <Input id="lab-addr" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="https://your-lab.example.org" />
                <Button type="submit">Connect</Button>
              </form>
              {lab.status === 'connected' && lab.sources.length > 0 && (
                <p className="text-xs text-muted-foreground">{lab.sources.length} run{lab.sources.length === 1 ? '' : 's'} available on this lab.</p>
              )}
            </PopoverContent>
          </Popover>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Meet the team"><Users className="size-4" /></Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle className="font-display text-xl">Team EigenBrains</DialogTitle></DialogHeader>
              <img src={teamPicture} alt="The Noesis team" className="aspect-video w-full rounded-lg object-cover" />
              <ul className="space-y-1 text-sm">
                <li><strong>El Yazid TEBBAA</strong> — Product &amp; systems</li>
                <li><strong>Saâd QACIF</strong> — Research &amp; experience</li>
                <li><strong>Ismail ELADRAOUI</strong> — AI &amp; engineering</li>
              </ul>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------------- ask */
function Ask({ run }: { run: RunView }) {
  const lab = useLab();
  const [q, setQ] = useState('');
  const tooShort = q.trim().length < 10;
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (!tooShort) run.submit(q); };
  const labRuns = lab.status === 'connected' ? lab.sources : [];
  const nothingToShow = lab.status !== 'connected' && run.recordingAvailable === false;

  return (
    <section className="mx-auto max-w-3xl pt-14 sm:pt-24" aria-labelledby="ask-title">
      <p className="text-xs uppercase tracking-[0.25em] text-primary">Autonomous scientific discovery</p>
      <h1 id="ask-title" className="mt-3 font-display text-4xl leading-tight sm:text-5xl">
        Ask a testable question. Watch agents run the experiments. Get the evidence.
      </h1>
      <form onSubmit={onSubmit} className="mt-8 rounded-2xl border bg-card p-3 shadow-panel focus-within:ring-2 focus-within:ring-ring">
        <label htmlFor="question" className="sr-only">Your research question</label>
        <Textarea
          id="question" value={q} onChange={(e) => setQ(e.target.value)} rows={3}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(e); }}
          placeholder="e.g. Does population entropy warn of stagnation earlier than fitness history?"
          className="resize-none border-0 bg-transparent text-lg shadow-none focus-visible:ring-0"
          aria-describedby="question-hint"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
          <p id="question-hint" className="text-xs text-muted-foreground">
            Falsifiable means an experiment could prove it wrong.
          </p>
          <Button type="submit" size="lg" disabled={tooShort} className="min-h-11 gap-2">
            Investigate <ArrowRight aria-hidden className="size-4" />
          </Button>
        </div>
      </form>

      {labRuns.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-medium">Runs on your connected lab — open one to see its agents, experiments and report:</p>
          <ul className="flex flex-wrap gap-2">
            {labRuns.map((s) => (
              <li key={s.id}>
                <Button variant="outline" className="min-h-11" onClick={() => run.openLabSource(s.id)}>
                  {s.kind === 'live' ? 'Live' : 'Recorded'} · {s.id.split('/')[1]} · {s.experiments} exp.
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <p className="mb-2 text-sm text-muted-foreground">Or try a pre-registered question:</p>
        <ul className="flex flex-col gap-2">
          {EXAMPLE_QUESTIONS.map((ex) => (
            <li key={ex}>
              <button type="button" onClick={() => setQ(ex)} className="min-h-11 w-full rounded-lg border bg-card/50 px-4 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent">
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>


      {lab.status === 'connected' && run.labCannotStart && (
        <p className="mt-6 rounded-lg border border-uncertain/40 bg-uncertain-soft px-4 py-3 text-sm">
          Your lab can show its existing runs. Starting new runs from a question needs a lab update.{' '}
          <a href="https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery/blob/main/docs/LAB_RUNS_ENDPOINT.md" target="_blank" rel="noreferrer" className="underline underline-offset-4">What's needed</a>
        </p>
      )}

      <p className="mt-8 text-xs text-muted-foreground" role="status">
        {lab.status === 'connected'
          ? 'Connected to a lab: open one of its runs above, or ask a question to start a new one when the lab supports it.'
          : run.recordingAvailable
            ? 'No lab connected: questions open a clearly labelled recorded demonstration.'
            : nothingToShow
              ? 'No lab connected and no recorded demonstration is installed yet. Connect a lab from the top bar to run questions.'
              : ''}
      </p>
    </section>
  );
}

/* --------------------------------------------------------------- run space */
function useElapsed(from: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  return from ? Math.max(0, Math.round((now - from) / 1000)) : 0;
}

function RunWorkspace({ run }: { run: RunView }) {
  const steps = activityToSteps(run.activity);
  const elapsed = useElapsed(run.startedAt);
  const sinceEvent = useElapsed(run.lastEventAt);
  const quiet = run.phase === 'running' && sinceEvent > 20;
  const [tab, setTab] = useState('run');
  useEffect(() => { if (run.phase === 'complete') setTab('report'); }, [run.phase]);

  return (
    <div className="pt-4">
      {/* Pinned question */}
      <div className="sticky top-14 z-20 -mx-4 border-b bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <SourceBadge label={run.label} />
              {run.phase === 'running' && <StatusChip status="running" label={`Working · ${elapsed}s`} />}
              {run.phase === 'complete' && <StatusChip status="succeeded" label="Run complete" />}
              {run.phase === 'failed' && <StatusChip status="failed" label="Stopped" />}
            </div>
            <h1 className="line-clamp-2 font-display text-lg leading-snug sm:text-xl">{run.question ?? 'Starting…'}</h1>
          </div>
          <Button variant="outline" className="min-h-11 gap-2" onClick={run.reset}><RotateCcw aria-hidden className="size-4" /> New question</Button>
        </div>
        {run.substituted && (
          <p className="mt-2 rounded-md bg-recorded-soft px-3 py-2 text-xs text-foreground">
            {run.fallbackReason} You asked: “<span className="italic">{run.asked}</span>”. {run.recordedAt && <>Recorded {new Date(run.recordedAt).toLocaleDateString()}.</>}
          </p>
        )}
        {!run.substituted && run.label === 'RECORDED' && (
          <p className="mt-2 text-xs text-muted-foreground">This is a recorded run, replayed step by step. It is not a new run.</p>
        )}
      </div>

      {run.phase === 'failed' && run.failure && <FailurePanel run={run} />}
      {run.phase === 'starting' && <LoadingPanel />}

      {(run.phase === 'running' || run.phase === 'complete') && run.state && (
        <>
          {/* Desktop: two columns */}
          <div className="mt-6 hidden gap-8 lg:grid lg:grid-cols-[minmax(0,22rem)_1fr]">
            <aside aria-label="Run timeline" className="lg:sticky lg:top-40 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto">
              <Timeline steps={steps} run={run} quiet={quiet} />
            </aside>
            <div className="min-w-0">
              <MainPanel run={run} />
            </div>
          </div>
          {/* Mobile: tabs */}
          <Tabs value={tab} onValueChange={setTab} className="mt-4 lg:hidden">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="run" className="min-h-10">Live run</TabsTrigger>
              <TabsTrigger value="report" className="min-h-10">Report</TabsTrigger>
            </TabsList>
            <TabsContent value="run" className="mt-4 space-y-6">
              <HypothesisStrip state={run.state} />
              <Timeline steps={steps} run={run} quiet={quiet} />
            </TabsContent>
            <TabsContent value="report" className="mt-4"><MainPanel run={run} /></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function MainPanel({ run }: { run: RunView }) {
  const lab = useLab();
  if (!run.state) return null;
  if (run.phase === 'running') {
    return (
      <div className="space-y-6">
        <div className="hidden lg:block">
          <p className="mb-2 text-sm text-muted-foreground">Hypotheses · <MetricInfo metric="posterior">current belief</MetricInfo></p>
          <HypothesisStrip state={run.state} />
        </div>
        <div className="rounded-xl border bg-card p-5">
          <p className="font-medium">The report will appear here when the run finishes.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Compute used: {Math.round(run.state.compute_seconds.used)}s of {run.state.compute_seconds.budget}s budget.
          </p>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Compute budget used"
            aria-valuemin={0} aria-valuemax={run.state.compute_seconds.budget} aria-valuenow={Math.round(run.state.compute_seconds.used)}>
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, (run.state.compute_seconds.used / Math.max(1, run.state.compute_seconds.budget)) * 100)}%` }} />
          </div>
          {run.label === 'RECORDED' && <Button variant="secondary" className="mt-4 min-h-11" onClick={run.skipToEnd}>Skip to report</Button>}
        </div>
      </div>
    );
  }
  return <Report state={run.state} experiments={run.experiments} label={run.label} runId={run.label === 'LIVE' ? lab.sourceId : null} />;
}

const ROLE_CLS: Record<AgentRole, string> = {
  insight: 'bg-recorded-soft text-recorded border-recorded/40',
  planner: 'bg-running-soft text-running border-running/40',
  runner: 'bg-uncertain-soft text-uncertain border-uncertain/40',
  analysis: 'bg-success-soft text-success border-success/40',
};

/** Role badge (colour + text) with the lab's own agent name as its accessible title. */
function AgentChip({ agent }: { agent: string }) {
  const role = agentRole(agent);
  return (
    <span title={`Lab agent: ${agent}`} className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ROLE_CLS[role]}`}>
      {AGENT_ROLE_LABEL[role]}<span className="sr-only"> ({agent})</span>
    </span>
  );
}

const KIND_ICON = { handoff: Bot, tool: Wrench, approval: Hand, message: MessageSquare } as const;
const KIND_LABEL = { handoff: 'Decision', tool: 'Tool / experiment', approval: 'Approval', message: 'Message' } as const;

function Timeline({ steps, run, quiet }: { steps: Step[]; run: RunView; quiet: boolean }) {
  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => { if (run.phase === 'running') endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [steps.length, run.phase]);
  const last = steps.length - 1;
  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">What the agents are doing</h2>
      {steps.length === 0 && run.phase === 'running' && <p className="text-sm text-muted-foreground">Waiting for the first agent action…</p>}
      {steps.length === 0 && run.phase === 'complete' && <p className="text-sm text-muted-foreground">No agent activity was recorded for this run.</p>}
      <ol className="relative space-y-3 border-l pl-5" aria-live="polite" aria-relevant="additions">
        {steps.map((s, i) => {
          const Icon = KIND_ICON[s.kind];
          const current = run.phase === 'running' && i === last;
          return (
            <li key={s.id} ref={i === last ? endRef : undefined} className="animate-step-in">
              <span aria-hidden className={`absolute -left-[9px] mt-1 flex size-4 items-center justify-center rounded-full border bg-background ${current ? 'border-primary' : ''}`}>
                <span className={`size-1.5 rounded-full ${current ? 'bg-primary animate-pulse-dot' : 'bg-muted-foreground'}`} />
              </span>
              <div className={`rounded-lg border p-3 ${current ? 'border-primary/50 bg-running-soft' : 'bg-card/60'}`} aria-current={current ? 'step' : undefined}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon aria-hidden className="size-3.5 shrink-0" />
                    <AgentChip agent={s.agent} />
                    <span className="truncate">{KIND_LABEL[s.kind]}</span>
                  </span>
                  <StatusChip status={current && s.status === 'succeeded' ? 'running' : s.status} />
                </div>
                <p className="mt-1 text-sm font-medium">{s.title}</p>
                <details className="mt-1 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none line-clamp-2">{s.detail}</summary>
                  <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono">{s.detail}</pre>
                </details>
              </div>
            </li>
          );
        })}
      </ol>
      {quiet && (
        <p className="mt-4 rounded-md bg-uncertain-soft px-3 py-2 text-xs" role="status">
          Still working — experiments can take several minutes. You can leave this page open; new steps will appear as they arrive.
        </p>
      )}
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[22rem_1fr]" aria-busy="true" aria-label="Starting the run">
      <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      <div className="space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      <p className="sr-only" role="status">Contacting the lab…</p>
    </div>
  );
}

function FailurePanel({ run }: { run: RunView }) {
  const f = run.failure!;
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-xl border border-failure/40 bg-failure-soft p-6" role="alert">
      <StatusChip status="failed" label="Could not run" />
      <h2 className="mt-3 font-display text-2xl">{f.title}</h2>
      <p className="mt-2 text-sm leading-relaxed">{f.meaning}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button className="min-h-11" onClick={() => (run.asked ? run.submit(run.asked) : run.reset())}>Try again</Button>
        {f.canUseRecording && <Button variant="secondary" className="min-h-11" onClick={() => run.openRecording(run.asked ?? undefined)}>Open recorded demonstration</Button>}
        <Button variant="ghost" className="min-h-11" onClick={run.reset}>Back</Button>
      </div>
    </div>
  );
}
