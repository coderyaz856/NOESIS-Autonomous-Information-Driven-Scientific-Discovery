import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { labApi } from '../api/lab';
import type { LabCapabilities } from '../api/lab-types';
import { useLab } from '../lab/LabContext';
import { OperatorUnlock, refreshLabSession, useLabSession, writeBlock } from '../lab/OperatorAccess';
import { useShell } from './shell';
import { IconArrow, IconMic, IconPlus } from './icons';
import { Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipContent, TooltipTrigger } from './overlay';
import { cx } from './ui';

const SAMPLE_QUESTION = 'Does population entropy give early warning of genetic-algorithm stagnation beyond the fitness history?';
const OPEN_SAMPLE = 'Does intermittent fasting improve insulin sensitivity in adults with prediabetes?';

type Phase = 'idle' | 'checking' | 'error';

/** The research-question box. Any research question starts a real Muse Code run.
 * The lab classifies it first: questions in its pre-registered GA/entropy domain
 * run executed experiments ("lab" mode); every other question runs in "open" mode
 * (verified literature, falsifiable hypotheses, proposed protocols, critique —
 * nothing is executed or simulated, and the UI says so). */
export function CommandSurface({ docked }: { docked: boolean }) {
  const [question, setQuestion] = useState('');
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [revealed, setRevealed] = useState(false);
  const [caps, setCaps] = useState<LabCapabilities | null>(null);
  const lab = useLab();
  const session = useLabSession();
  const { navigate } = useShell();
  const [questions, setQuestions] = useState<{ id: string; kind: string; question: string }[]>([]);

  useEffect(() => {
    if (lab.status !== 'connected') { setQuestions([]); setCaps(null); return; }
    let cancelled = false;
    Promise.all(lab.sources.map((src) => labApi.state(lab.baseUrl, src.id).then((st) => ({ id: src.id, kind: src.kind as string, question: st.question })).catch(() => null)))
      .then((rows) => { if (!cancelled) setQuestions(rows.filter((r): r is { id: string; kind: string; question: string } => r !== null)); });
    labApi.capabilities(lab.baseUrl).then((c) => { if (!cancelled) setCaps(c); }).catch(() => { if (!cancelled) setCaps(null); });
    return () => { cancelled = true; };
  }, [lab.baseUrl, lab.sources, lab.status]);

  const open = (sourceId: string | null) => {
    if (sourceId) lab.setSourceId(sourceId);
    navigate('discovery');
  };

  const fail = (text: string) => { setPhase('error'); setMessage(text); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const q = question.trim();
    if (phase === 'checking') return;
    if (lab.status !== 'connected') return fail('No lab is connected. Start the lab feed (see the README) and reload.');
    const blocked = writeBlock(session);
    if (blocked) return fail(blocked);
    if (caps && !caps.runs_enabled) return fail('This lab feed is read-only. Restart it with --enable-runs to launch runs from here.');
    if (q.length < 8) return fail('Ask a full research question (at least 8 characters).');
    setPhase('checking');
    setMessage('Classifying the question (Muse Spark): executable lab study or open research…');
    try {
      const res = await labApi.startRun(lab.baseUrl, q, { rounds: 1 });
      setPhase('idle');
      setMessage(res.mode === 'open'
        ? `Run ${res.run_id} started · open research: literature, hypotheses and study protocols (no experiments executed) · soft spend guard $${res.ceiling_usd.toFixed(2)} (estimate, not a hard cap)`
        : `Run ${res.run_id} started · lab study: tests ${res.scope.hypotheses.join(', ')} with executed experiments · soft spend guard $${res.ceiling_usd.toFixed(2)} (estimate, not a hard cap)`);
      setQuestion('');
      lab.setSourceId(res.source);
      lab.refresh();
      navigate('discovery');
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) return fail(`${reason.message}. Wait for it to finish, or open it from Discovery.`);
      if (reason instanceof ApiError && (reason.status === 401 || reason.code === 'writes_disabled')) void refreshLabSession();
      fail(reason instanceof ApiError ? reason.message : String(reason));
    }
  };

  const scopeNote = session?.write_mode === 'disabled'
    ? 'Read-only hosted app: recorded runs can be explored here; new runs start from a local lab (see the README).'
    : caps
    ? caps.runs_enabled
      ? `Any research question. Meta agents (${caps.harness}) research it: verified sources (claims are agent summaries), falsifiable hypotheses, study protocols and critique. Experiments are executed only for the lab's simulation domain: ${caps.supported_domain.domain}`
      : 'Read-only lab feed: recorded runs can be explored, new runs are disabled.'
    : null;

  return (
    <div className={cx('command-surface-wrap', docked ? 'is-dock' : 'is-float')}>
      <form className="command-surface material-pop" onSubmit={submit} aria-busy={phase === 'checking'}>
        <Popover>
          <PopoverTrigger label="Add context" className="command-action">
            <IconPlus />
          </PopoverTrigger>
          <PopoverContent title="What Noesis can do">
            {caps ? (
              <>
                <p className="quiet"><strong>Any question:</strong> literature, hypotheses, study protocols, critique.</p>
                <p className="quiet"><strong>Executed experiments:</strong> {caps.supported_domain.domain}</p>
                <ul className="lab-list">{caps.supported_domain.hypotheses.map((h) => <li key={h.id}><strong>{h.id}</strong> {h.statement}</li>)}</ul>
              </>
            ) : <p className="quiet">Connect a lab to see what it can run.</p>}
          </PopoverContent>
        </Popover>
        <input
          aria-label="Ask Noesis a research question"
          placeholder="Ask any research question…"
          value={question}
          maxLength={600}
          disabled={phase === 'checking'}
          onFocus={() => setRevealed(true)}
          onChange={(e) => { setQuestion(e.target.value); if (phase === 'error') { setPhase('idle'); setMessage(''); } }}
        />
        <Tooltip>
          <TooltipTrigger>
            <button type="button" className="btn btn-icon command-action" aria-label="Microphone" aria-disabled="true">
              <IconMic />
            </button>
          </TooltipTrigger>
          <TooltipContent>No input device registered</TooltipContent>
        </Tooltip>
        <button type="submit" className="btn btn-icon command-submit" aria-label="Start discovery run" disabled={phase === 'checking'}>
          <IconArrow />
        </button>
      </form>
      {revealed && !question && phase !== 'error' && (
        <div className="question-chips" aria-label="Questions already studied">
          <button type="button" className="question-chip" onClick={() => setQuestion(SAMPLE_QUESTION)}>
            <small>Lab study (experiments executed) · click to use</small>{SAMPLE_QUESTION}
          </button>
          <button type="button" className="question-chip" onClick={() => setQuestion(OPEN_SAMPLE)}>
            <small>Open research · click to use</small>{OPEN_SAMPLE}
          </button>
          {questions.slice(-1).reverse().map((q) => (
            <button key={q.id} type="button" className="question-chip" onClick={() => open(q.id)}>
              <small>{q.kind === 'live' ? 'Live lab' : 'Recorded run'} · {q.id.split('/')[1]}</small>
              {q.question.length > 120 ? `${q.question.slice(0, 118)}…` : q.question}
            </button>
          ))}
        </div>
      )}
      {revealed && scopeNote && phase !== 'error' ? <p className="command-message command-scope is-visible">{scopeNote}</p> : null}
      <p className={cx('command-message', message && 'is-visible', phase === 'error' && 'is-error')} role={phase === 'error' ? 'alert' : undefined} aria-live="polite">{message}</p>
      {revealed || phase === 'error' ? <OperatorUnlock session={session} /> : null}
    </div>
  );
}
