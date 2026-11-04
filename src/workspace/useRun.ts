import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/noesis/api/client';
import { labApi } from '@/noesis/api/lab';
import type { LabActivity, LabExperiment, LabState } from '@/noesis/api/lab-types';
import { useLab } from '@/noesis/lab/LabContext';
import { sourceLabel, type SourceLabel } from './model';

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
      lab.setSourceId(res.source);
      setMode('live');
    }).catch((reason: unknown) => {
      const status = reason instanceof ApiError ? reason.status : 0;
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
    const base = { asked, submit, openRecording, openLabSource, skipToEnd, reset, recordingAvailable, startedAt, lastEventAt, fallbackReason, failure, labCannotStart, recordedAt: recording?.recorded_at ?? null };
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
      const running = kind === 'live' && lab.streaming;
      return {
        ...base, phase: lab.state ? (running ? 'running' : 'complete') : 'starting',
        question: lab.state?.question ?? asked, label: sourceLabel(kind), substituted: false,
        state: lab.state, activity: lab.activity, experiments,
        failure: lab.error && !lab.state ? { title: 'The run stopped responding', meaning: lab.error, canUseRecording: !!recording } : failure,
      };
    }
    return {
      ...base, phase: mode === 'starting' ? 'starting' : mode === 'failed' ? 'failed' : 'idle',
      question: asked, label: null, substituted: false, state: null, activity: [], experiments: {},
    };
  }, [asked, experiments, labCannotStart, failure, fallbackReason, lab, lastEventAt, mode, openLabSource, openRecording, recording, recordingAvailable, reset, revealed, skipToEnd, startedAt, submit]);
}
