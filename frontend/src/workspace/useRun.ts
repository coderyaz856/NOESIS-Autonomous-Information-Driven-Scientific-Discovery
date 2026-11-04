import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/noesis/api/client';
import { labApi } from '@/noesis/api/lab';
import type { LabActivity, LabExperiment, LabMode, LabRun, LabState } from '@/noesis/api/lab-types';
import { useLab } from '@/noesis/lab/LabContext';
import { activityFinished, sourceLabel, type SourceLabel } from './model';

/** Shape of the bundled recording at /recordings/demo.json (see docs/RECORDING_FORMAT.md). */
export interface Recording {
  source_id: string;
  recorded_at: string;
  state: LabState;
  activity: LabActivity[];
  experiments: Record<string, LabExperiment>;
}

export type RunPhase = 'idle' | 'starting' | 'running' | 'complete' | 'failed';

export interface RunFailure {
  title: string;
  meaning: string;
  canUseRecording: boolean;
  /** A run already in progress that the visitor can open instead. */
  busySource?: string | null;
  /** The lab needs an operator session before it accepts new runs. */
  needsUnlock?: boolean;
}

export interface RunView {
  phase: RunPhase;
  question: string | null;
  /** What the visitor actually typed. */
  asked: string | null;
  label: SourceLabel | null;
  /** True when the question shown was not the one the visitor typed (recording fallback). */
  substituted: boolean;
  fallbackReason: string | null;
  state: LabState | null;
  activity: LabActivity[];
  experiments: Record<string, LabExperiment>;
  failure: RunFailure | null;
  startedAt: number | null;
  lastEventAt: number | null;
  recordingAvailable: boolean | null;
  recordedAt: string | null;
  /** True once the connected lab answered that it cannot start runs from a question. */
  labCannotStart: boolean;
  /** 'lab' = experiments executed; 'open' = research only, nothing executed. */
  researchMode: LabMode | null;
  /** Live Muse Code run record (status, spend, approvals), when the lab has one. */
  runRecord: LabRun | null;
  submit: (question: string) => void;
  openRecording: (asked?: string) => void;
  openLabSource: (id: string) => void;
  skipToEnd: () => void;
  reset: () => void;
}

const REPLAY_STEP_MS = 900;

export function useRun(): RunView {
  const lab = useLab();
  const [mode, setMode] = useState<'idle' | 'starting' | 'live' | 'replay' | 'failed'>('idle');
  const [asked, setAsked] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [recordingAvailable, setRecordingAvailable] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [experiments, setExperiments] = useState<Record<string, LabExperiment>>({});
  const [labCannotStart, setLabCannotStart] = useState(false);
  const [startMode, setStartMode] = useState<LabMode | null>(null);
  const timer = useRef<number | null>(null);

  // Probe for the bundled real recording once.
  useEffect(() => {
    fetch('/recordings/demo.json').then(async (res) => {
      if (!res.ok) throw new Error('missing');
      const data = (await res.json()) as Recording;
      if (!data?.state?.question) throw new Error('invalid');
      setRecording(data);
      setRecordingAvailable(true);
    }).catch(() => setRecordingAvailable(false));
  }, []);

  const clearTimer = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; };

  const openRecording = useCallback((askedQuestion?: string) => {
    clearTimer();
    if (!recording) {
      setMode('failed');
      setFailure({
        title: 'No lab is connected and no recording is available yet',
        meaning: 'Noesis needs a running discovery lab to answer new questions. Connect a lab address, or add the recorded demonstration.',
        canUseRecording: false,
      });
      return;
    }
    setAsked(askedQuestion ?? null);
    setMode('replay');
    setFailure(null);
    setRevealed(0);
    setStartedAt(Date.now());
    setLastEventAt(Date.now());
    timer.current = window.setInterval(() => {
      setRevealed((n) => {
        if (n >= recording.activity.length) { clearTimer(); return n; }
        setLastEventAt(Date.now());
        return n + 1;
      });
    }, REPLAY_STEP_MS);
  }, [recording]);

  const submit = useCallback((question: string) => {
    const q = question.trim();
    setAsked(q);
    setFailure(null);
    setFallbackReason(null);
    if (lab.status !== 'connected') {
      setFallbackReason('No lab is connected, so this is a recorded run of a pre-registered question.');
      openRecording(q);
      return;
    }
    setMode('starting');
    setStartedAt(Date.now());
    labApi.startRun(lab.baseUrl, q).then((res) => {
      if ((res as { unsupported?: boolean }).unsupported) {
        setLabCannotStart(true);
        setFallbackReason('The connected lab cannot start new runs yet, so this is a recorded run of a pre-registered question.');
        openRecording(q);
        return;
      }
      if ((res as { offline?: boolean }).offline || !res.source) {
        lab.refresh();
        setFallbackReason('The lab did not answer, so this is a recorded run of a pre-registered question.');
        openRecording(q);
        return;
      }
      lab.refresh();
      setStartMode(res.mode ?? null);
      lab.setSourceId(res.source);
      setMode('live');
    }).catch((reason: unknown) => {
      const status = reason instanceof ApiError ? reason.status : 0;
      const code = reason instanceof ApiError ? reason.code : '';
      const msg = reason instanceof Error ? reason.message : '';
      const busy = reason instanceof ApiError ? (reason.details?.['source'] as string | undefined) : undefined;
      if (status === 409 && code === 'run_in_progress') {
        const src = busy ?? /\((lab_home\/[^)]+)\)/.exec(msg)?.[1];
        setMode('failed');
        setFailure({ title: 'Another run is already in progress', meaning: 'The lab runs one question at a time. Watch the current run, or try again when it finishes.', canUseRecording: !!recording, busySource: src ?? null });
        return;
      }
      if (status === 401 && code === 'operator_session_required') {
        setMode('failed');
        setFailure({ title: 'Starting runs needs the operator token', meaning: 'This lab only accepts new runs from its operator. Unlock runs from the lab menu at the top right, or open the recording.', canUseRecording: !!recording, needsUnlock: true });
        return;
      }
      if (status === 429) {
        setMode('failed');
        setFailure({ title: 'The public trial limit was reached', meaning: msg || 'Too many runs were started recently. Please try again later.', canUseRecording: !!recording });
        return;
      }
      if (status === 403 || status === 503) {
        setLabCannotStart(true);
        setFallbackReason(`The lab can't start runs here (${msg || 'not allowed'}), so this is a recorded run of a pre-registered question.`);
        openRecording(q);
        return;
      }
      if (status === 404 || status === 405 || status === 501) {
        setLabCannotStart(true);
        setFallbackReason('The connected lab cannot start new runs yet, so this is a recorded run of a pre-registered question.');
        openRecording(q);
      } else if (status === 400) {
        setMode('failed');
        setFailure({ title: 'The lab did not accept this question', meaning: reason instanceof Error ? reason.message : 'Try rephrasing it as a testable claim.', canUseRecording: !!recording });
      } else {
        setMode('failed');
        setFailure({ title: 'Could not reach the lab', meaning: 'The lab address did not answer. Check that the lab is running and reachable from the internet, then try again.', canUseRecording: !!recording });
      }
    });
  }, [lab, openRecording, recording]);

  const openLabSource = useCallback((id: string) => {
    clearTimer();
    setStartMode(null);
    setAsked(null);
    setFallbackReason(null);
    setFailure(null);
    lab.setSourceId(id);
    setStartedAt(Date.now());
    setMode('live');
  }, [lab]);

  const reset = useCallback(() => { clearTimer(); setMode('idle'); setAsked(null); setFailure(null); setFallbackReason(null); setExperiments({}); }, []);
  const skipToEnd = useCallback(() => { clearTimer(); if (recording) setRevealed(recording.activity.length); }, [recording]);
  useEffect(() => clearTimer, []);

  // Live: track activity freshness and fetch completed experiment details.
  useEffect(() => { if (mode === 'live' && lab.activity.length) setLastEventAt(Date.now()); }, [mode, lab.activity.length]);
  const completedKey = lab.state?.completed.join('|') ?? '';
  useEffect(() => {
    if (mode !== 'live' || !lab.sourceId || !lab.state) return;
    const missing = lab.state.completed.filter((id) => !experiments[id]);
    if (!missing.length) return;
    Promise.all(missing.map((id) => labApi.experiment(lab.baseUrl, lab.sourceId!, id).then((e) => ((e as { unavailable?: boolean }).unavailable ? null : [id, e] as const)).catch(() => null)))
      .then((rows) => setExperiments((cur) => ({ ...cur, ...Object.fromEntries(rows.filter((r): r is readonly [string, LabExperiment] => r !== null)) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, lab.sourceId, completedKey]);

  return useMemo<RunView>(() => {
    const base = { researchMode: null as LabMode | null, runRecord: null as LabRun | null, asked, submit, openRecording, openLabSource, skipToEnd, reset, recordingAvailable, startedAt, lastEventAt, fallbackReason, failure, labCannotStart, recordedAt: recording?.recorded_at ?? null };
    if (mode === 'replay' && recording) {
      const done = revealed >= recording.activity.length;
      return {
        ...base, phase: done ? 'complete' : 'running', question: recording.state.question, label: 'RECORDED',
        substituted: !!asked && asked !== recording.state.question,
        state: recording.state, activity: recording.activity.slice(0, revealed), experiments: done ? recording.experiments : {},
      };
    }
    if (mode === 'live') {
      const kind = lab.source?.kind ?? 'live';
      const runStatus = lab.run?.status;
      const running = runStatus ? runStatus === 'running' || runStatus === 'prepared' : kind === 'live' && lab.streaming && !activityFinished(lab.activity);
      return {
        ...base, researchMode: lab.run?.mode ?? startMode, runRecord: lab.run,
        phase: lab.state ? (running ? 'running' : 'complete') : 'starting',
        question: lab.state?.question ?? asked, label: sourceLabel(kind), substituted: false,
        state: lab.state, activity: lab.activity, experiments,
        failure: lab.error && !lab.state ? { title: 'The run stopped responding', meaning: lab.error, canUseRecording: !!recording } : failure,
      };
    }
    return {
      ...base, phase: mode === 'starting' ? 'starting' : mode === 'failed' ? 'failed' : 'idle',
      question: asked, label: null, substituted: false, state: null, activity: [], experiments: {},
    };
  }, [startMode, asked, experiments, labCannotStart, failure, fallbackReason, lab, lastEventAt, mode, openLabSource, openRecording, recording, recordingAvailable, reset, revealed, skipToEnd, startedAt, submit]);
}
