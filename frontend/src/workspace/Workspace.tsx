import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, RotateCcw, Settings2, Users } from 'lucide-react';
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
import { labApi } from '@/noesis/api/lab';
import { activityToSteps, formatBudgetPercent, honestyBadge, perVisitorLimitText, researchModeNote, spendText, type Step } from './model';
import { MetricInfo, SourceBadge, StatusChip } from './parts';
import { HypothesisStrip, Report } from './Report';
import { useRun, type RunView } from './useRun';
import { TraceConsole } from './TraceConsole';
import { AgentBoard, HypothesisTrails } from './AgentBoard';
import { Insights } from './Insights';
import { PanelRightOpen, Printer } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { NodeMap } from './NodeMap';
import { DecisionConsole } from './DecisionConsole';

export function Workspace() {
  return <LabProvider><Shell /></LabProvider>;
}

function Shell() {
  const run = useRun();
  const idle = run.phase === 'idle';
  return (
    <div className="min-h-dvh">
      <Header />
      <main id="main" className={`mx-auto w-full px-3 pb-12 sm:px-4 ${idle ? 'max-w-6xl' : 'max-w-[96rem]'}`}>
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
              {lab.serverLabUrl && <p className="text-xs text-muted-foreground">This app is set up for the lab at <span className="font-mono">{lab.serverLabUrl}</span>.</p>}
              <p className="text-xs leading-relaxed text-muted-foreground">Enter the public address of a running Noesis discovery lab. Without one, questions open the recorded demonstration.</p>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lab.setBaseUrl(addr); }}>
                <label htmlFor="lab-addr" className="sr-only">Lab address</label>
                <Input id="lab-addr" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="https://your-lab.example.org" />
                <Button type="submit">Connect</Button>
              </form>
              <OperatorUnlock />
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

function OperatorUnlock() {
  const lab = useLab();
  const [token, setToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const s = lab.session;
  if (!s || s.write_mode !== 'operator') return null;
  if (s.signed_in) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-success">Runs unlocked on this browser.</span>
        <Button size="sm" variant="ghost" onClick={() => labApi.signOut().then(lab.setSession).catch(() => undefined)}>Lock</Button>
      </div>
    );
  }
  return (
    <form className="space-y-2" onSubmit={(e) => {
      e.preventDefault(); setErr(null);
      labApi.signIn(token).then((r) => { lab.setSession(r); setToken(''); }).catch((x: unknown) => setErr(x instanceof Error ? x.message : 'Not accepted'));
    }}>
      <label htmlFor="op-token" className="text-xs font-medium">Operator token (to start runs)</label>
      <div className="flex gap-2">
        <Input id="op-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={!token}>Unlock</Button>
      </div>
      {err && <p className="text-xs text-failure" role="alert">{err}</p>}
    </form>
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
    <section className="mx-auto max-w-2xl pt-20 text-center sm:pt-32" aria-labelledby="ask-title">
      <span aria-hidden className="mx-auto mb-6 block size-2.5 rounded-full bg-primary shadow-[0_0_24px_6px_color-mix(in_oklab,var(--primary)_55%,transparent)] animate-pulse-dot" />
      <h1 id="ask-title" className="font-display text-3xl font-light leading-tight sm:text-4xl">Enter a research question.</h1>
      <p className="mt-3 text-sm text-muted-foreground">Agents plan and run the experiments, then hand you the evidence.</p>
      <form onSubmit={onSubmit} className="mt-8 text-left rounded-2xl border bg-card p-3 shadow-panel focus-within:ring-2 focus-within:ring-ring">
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


      {lab.status === 'connected' && lab.capabilities && <Capabilities run={run} />}

      {lab.status === 'connected' && run.labCannotStart && (
        <p className="mt-6 rounded-lg border border-uncertain/40 bg-uncertain-soft px-4 py-3 text-sm">
          Your lab can show its existing runs. Starting new runs from a question needs a lab update.{' '}
          <a href="https://github.com/coderyaz856/NOESIS-Autonomous-Information-Driven-Scientific-Discovery/blob/main/docs/LAB_RUNS_ENDPOINT.md" target="_blank" rel="noreferrer" className="underline underline-offset-4">What's needed</a>
        </p>
      )}

      <p className="mt-8 text-xs text-muted-foreground" role="status">
        {lab.status === 'connected'
          ? 'Connected to a lab: open one of its runs above, or ask a question to start a new live run.'
          : run.recordingAvailable
            ? 'No lab connected: questions open a clearly labelled recorded demonstration.'
            : nothingToShow
              ? 'No lab connected and no recorded demonstration is installed yet. Connect a lab from the top bar to run questions.'
              : ''}
      </p>
    </section>
  );
}

function Capabilities({ run }: { run: RunView }) {
  const lab = useLab();
  const c = lab.capabilities!;
  const t = c.trial;
  const mode = lab.session?.write_mode;
  return (
    <div className="mt-6 rounded-lg border bg-card/60 px-4 py-3 text-sm" role="status">
      {c.runs_enabled ? (
        <p><StatusChip status="succeeded" label="Live runs available" /> <span className="ml-1 text-muted-foreground">Agents: {c.harness}. Up to {c.max_rounds} round{c.max_rounds === 1 ? '' : 's'}, ${c.max_ceiling_usd.toFixed(2)} per run.</span></p>
      ) : (
        <p><StatusChip status="uncertain" label="Read-only lab" /> <span className="ml-1 text-muted-foreground">This lab shows existing runs but was not started with new runs enabled.</span></p>
      )}
      {t?.enabled && (
        <p className="mt-1 text-xs text-muted-foreground">
          Public trial: {t.accepting ? `$${(t.remaining_usd ?? 0).toFixed(2)} of $${t.total_usd.toFixed(2)} left, ${perVisitorLimitText(t.client_runs_per_hour)}.` : 'not accepting new runs right now.'}
        </p>
      )}
      {c.runs_enabled && mode === 'operator' && !lab.session?.signed_in && (
        <p className="mt-1 text-xs text-muted-foreground">Starting runs needs the operator token — unlock it from the lab menu at the top right.</p>
      )}
      {c.runs_enabled && mode === 'disabled' && <p className="mt-1 text-xs text-muted-foreground">This hosted app is read-only: no operator token or public trial is configured.</p>}
      {c.active_run && (
        <Button variant="outline" size="sm" className="mt-2 min-h-10" onClick={() => run.openLabSource(c.active_run!)}>A run is in progress — watch it</Button>
      )}
    </div>
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
  const [traceOpen, setTraceOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const showMap = run.phase === 'running' || mapOpen;
  const badge = honestyBadge(run.researchMode ?? run.state?.mode ?? null);
  useEffect(() => { if (run.phase === 'complete') setTab('report'); }, [run.phase]);

  return (
    <div className="pt-4">
      {/* Pinned question */}
      <div className="sticky top-14 z-20 -mx-3 border-b bg-background/90 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <SourceBadge label={run.label} />
              {badge && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.executed ? 'border-success/50 bg-success-soft' : 'border-uncertain/50 bg-uncertain-soft'}`}>{badge.label}</span>}
              {run.phase === 'running' && <StatusChip status="running" label={`Working · ${elapsed}s`} />}
              {run.phase === 'complete' && <StatusChip status="succeeded" label="Run complete" />}
              {run.phase === 'failed' && <StatusChip status="failed" label="Stopped" />}
              {spendText(run.runRecord?.usage?.cost_usd, run.runRecord?.ceiling_usd) && (
                <span className="rounded-full border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{spendText(run.runRecord?.usage?.cost_usd, run.runRecord?.ceiling_usd)}</span>
              )}
            </div>
            <h1 className="line-clamp-2 font-display text-lg leading-snug sm:text-xl">{run.question ?? 'Starting…'}</h1>
          </div>
          <div role="toolbar" aria-label="Run actions" className="flex items-center gap-0.5 rounded-md border bg-surface-sunken/60 p-0.5">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={run.reset}><RotateCcw aria-hidden className="size-3.5" />New</Button>
            {run.phase === 'complete' && <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => window.print()}><Printer aria-hidden className="size-3.5" />PDF</Button>}
            <Button variant="ghost" size="sm" className="hidden h-8 gap-1.5 px-2 text-xs lg:inline-flex" aria-expanded={traceOpen} onClick={() => setTraceOpen(true)}>
              <PanelRightOpen aria-hidden className="size-3.5" />Trace
            </Button>
          </div>
        </div>
        {run.substituted && (
          <p className="mt-2 rounded-md bg-recorded-soft px-3 py-2 text-xs text-foreground">
            {run.fallbackReason} You asked: “<span className="italic">{run.asked}</span>”. {run.recordedAt && <>Recorded {new Date(run.recordedAt).toLocaleDateString()}.</>}
          </p>
        )}
        {researchModeNote(run.researchMode) && (
          <p className={`mt-2 rounded-md px-3 py-2 text-xs ${run.researchMode === 'open' ? 'bg-uncertain-soft' : 'bg-success-soft'}`}>
            <strong>{researchModeNote(run.researchMode)!.title}.</strong> {researchModeNote(run.researchMode)!.meaning}
          </p>
        )}
        {run.runRecord?.status === 'failed' && run.runRecord.error && (
          <p className="mt-2 rounded-md bg-failure-soft px-3 py-2 text-xs" role="alert">The lab reported an error: {run.runRecord.error}</p>
        )}
        {!run.substituted && run.label === 'RECORDED' && (
          <p className="mt-2 text-xs text-muted-foreground">This is a recorded run, replayed step by step. It is not a new run.</p>
        )}
      </div>

      {run.phase === 'failed' && run.failure && <FailurePanel run={run} />}
      {run.phase === 'starting' && <LoadingPanel />}

      {(run.phase === 'running' || run.phase === 'complete') && run.state && (
        <>
          {/* Desktop: decision console + main stage */}
          <div className="mt-3 hidden gap-5 lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside aria-label="Decision console" className="print:hidden lg:sticky lg:top-32 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto lg:pr-1">
              <DecisionConsole state={run.state} run={run.runRecord} />
            </aside>
            <div className="min-w-0 space-y-4">
              {showMap && (
                <div className="animate-step-in space-y-2">
                  <NodeMap activity={run.activity} running={run.phase === 'running'} onSelect={() => setTraceOpen(true)} />
                  {run.phase === 'complete' && <Button variant="ghost" size="sm" className="text-xs" onClick={() => setMapOpen(false)}>Hide agent map</Button>}
                </div>
              )}
              {!showMap && <Button variant="outline" size="sm" className="text-xs" onClick={() => setMapOpen(true)}>Show agent map</Button>}
              {run.phase === 'complete' && <div className="animate-step-in space-y-3"><Insights state={run.state} experiments={run.experiments} /><MainPanel run={run} /></div>}
              {run.phase === 'running' && <MainPanel run={run} />}
              <Collapsible defaultOpen={run.phase === 'running'}>
                <CollapsibleTrigger className="w-full rounded-md border px-3 py-2 text-left text-sm font-medium hover:bg-accent">What each agent did, step by step</CollapsibleTrigger>
                <CollapsibleContent className="mt-3"><Timeline steps={steps} run={run} quiet={quiet} /></CollapsibleContent>
              </Collapsible>
            </div>
          </div>
          {/* Mobile: tabs */}
          <Tabs value={tab} onValueChange={setTab} className="mt-3 lg:hidden">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="run" className="min-h-10 text-xs">Live</TabsTrigger>
              <TabsTrigger value="report" className="min-h-10 text-xs">Report</TabsTrigger>
              <TabsTrigger value="decide" className="min-h-10 text-xs">Decisions</TabsTrigger>
              <TabsTrigger value="trace" className="min-h-10 text-xs">Trace</TabsTrigger>
            </TabsList>
            <TabsContent value="run" className="mt-3 space-y-4">
              <NodeMap activity={run.activity} running={run.phase === 'running'} onSelect={() => setTab('trace')} />
              <HypothesisStrip state={run.state} />
              <Timeline steps={steps} run={run} quiet={quiet} />
            </TabsContent>
            <TabsContent value="report" className="mt-3 space-y-3">
              {run.phase === 'complete' && <Insights state={run.state} experiments={run.experiments} />}
              <MainPanel run={run} />
            </TabsContent>
            <TabsContent value="decide" className="mt-3"><DecisionConsole state={run.state} run={run.runRecord} /></TabsContent>
            <TabsContent value="trace" className="mt-3 h-[75dvh]"><TraceConsole activity={run.activity} state={run.state} /></TabsContent>
          </Tabs>
          <Sheet open={traceOpen} onOpenChange={setTraceOpen}>
            <SheetContent side="right" className="w-full p-0 sm:max-w-xl">
              <SheetHeader className="sr-only"><SheetTitle>Traceability console</SheetTitle></SheetHeader>
              <div className="h-full p-2"><TraceConsole activity={run.activity} state={run.state} /></div>
            </SheetContent>
          </Sheet>
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
            aria-valuemin={0} aria-valuemax={run.state.compute_seconds.budget} aria-valuenow={run.state.compute_seconds.used}
            aria-valuetext={`${formatBudgetPercent(run.state.compute_seconds.used / run.state.compute_seconds.budget)} used`}>
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, (run.state.compute_seconds.used / Math.max(1, run.state.compute_seconds.budget)) * 100)}%` }} />
          </div>
          {run.label === 'RECORDED' && <Button variant="secondary" className="mt-4 min-h-11" onClick={run.skipToEnd}>Skip to report</Button>}
        </div>
      </div>
    );
  }
  return <Report state={run.state} experiments={run.experiments} label={run.label} runId={run.label === 'LIVE' ? lab.sourceId : null} activity={run.activity} />;
}

function Timeline({ steps, run, quiet }: { steps: Step[]; run: RunView; quiet: boolean }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">What each agent did</h2>
        {steps.length === 0 && run.phase === 'running' && <p className="text-sm text-muted-foreground">Waiting for the first agent action…</p>}
        {steps.length === 0 && run.phase === 'complete' && <p className="text-sm text-muted-foreground">No agent activity was recorded for this run.</p>}
        {steps.length > 0 && <AgentBoard steps={steps} running={run.phase === 'running'} />}
      </div>
      {run.state && <HypothesisTrails state={run.state} experiments={run.experiments} />}
      <Approvals run={run} />
      {quiet && (
        <p className="rounded-md bg-uncertain-soft px-3 py-2 text-xs" role="status">
          Still working — experiments can take several minutes. New steps will appear as they arrive.
        </p>
      )}
    </div>
  );
}

function Approvals({ run }: { run: RunView }) {
  const lab = useLab();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pending = (run.runRecord?.approvals ?? []).filter((a) => a.status === 'pending');
  if (!pending.length || !lab.sourceId) return null;
  const canWrite = lab.session?.signed_in || lab.session?.write_mode === 'trial';
  const decide = (id: string, decision: 'approve' | 'decline') => {
    setBusy(id); setErr(null);
    labApi.answerApproval(lab.baseUrl, lab.sourceId!, id, decision)
      .then(() => lab.refreshRun())
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'The lab did not accept the answer.'))
      .finally(() => setBusy(null));
  };
  return (
    <div className="mt-4 space-y-3" role="region" aria-label="Waiting for approval">
      {pending.map((a) => (
        <div key={a.id} className="rounded-lg border border-uncertain/50 bg-uncertain-soft p-3">
          <StatusChip status="uncertain" label={`Approval needed · ${a.id}`} />
          <p className="mt-2 text-sm">{a.reason ?? 'The agents want to run a confirmatory experiment and are waiting for a human decision.'}</p>
          {canWrite ? (
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="min-h-10" disabled={busy === a.id} onClick={() => decide(a.id, 'approve')}>Approve</Button>
              <Button size="sm" variant="outline" className="min-h-10" disabled={busy === a.id} onClick={() => decide(a.id, 'decline')}>Decline</Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Only the lab operator can answer. Unlock runs from the lab menu at the top right.</p>
          )}
        </div>
      ))}
      {err && <p className="text-xs text-failure" role="alert">{err}</p>}
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
        {f.busySource && <Button variant="secondary" className="min-h-11" onClick={() => run.openLabSource(f.busySource!)}>Watch the current run</Button>}
        {f.canUseRecording && <Button variant="secondary" className="min-h-11" onClick={() => run.openRecording(run.asked ?? undefined)}>Open recorded demonstration</Button>}
        <Button variant="ghost" className="min-h-11" onClick={run.reset}>Back</Button>
      </div>
    </div>
  );
}
