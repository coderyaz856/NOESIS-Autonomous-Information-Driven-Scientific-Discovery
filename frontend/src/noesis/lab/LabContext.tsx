import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { LAB_URL_KEY, labApi } from '../api/lab';
import type { LabActivity, LabCapabilities, LabRun, LabSession, LabSource, LabState, LedgerEvent } from '../api/lab-types';
import { subscribeSSE } from '../api/sse';

export type LabStatus = 'checking' | 'connected' | 'offline';

export interface LabContextValue {
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  status: LabStatus;
  error: string | null;
  sources: LabSource[];
  sourceId: string | null;
  setSourceId: (id: string | null) => void;
  source: LabSource | null;
  state: LabState | null;
  activity: LabActivity[];
  ledger: LedgerEvent[];
  streaming: boolean;
  refresh: () => void;
  /** Lab address configured on the server, if any. */
  serverLabUrl: string | null;
  capabilities: LabCapabilities | null;
  session: LabSession | null;
  setSession: (s: LabSession) => void;
  run: LabRun | null;
  refreshRun: () => void;
}

const LabContext = createContext<LabContextValue | null>(null);

const message = (reason: unknown) => (reason instanceof ApiError ? reason.message : String(reason));

export function LabProvider({ children }: { children: ReactNode }) {
  const [baseUrl, setBaseUrlState] = useState('');
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<LabStatus>('checking');
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<LabSource[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [state, setState] = useState<LabState | null>(null);
  const [activity, setActivity] = useState<LabActivity[]>([]);
  const [ledger, setLedger] = useState<LedgerEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [tick, setTick] = useState(0);
  const refetchTimer = useRef<number | null>(null);
  const [serverLabUrl, setServerLabUrl] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<LabCapabilities | null>(null);
  const [session, setSession] = useState<LabSession | null>(null);
  const [run, setRun] = useState<LabRun | null>(null);
  const [runTick, setRunTick] = useState(0);

  useEffect(() => {
    labApi.session().then(setSession).catch(() => setSession(null));
    labApi.config().then((c) => c.lab_url, () => null).then((serverUrl) => {
      setServerLabUrl(serverUrl);
      const saved = window.localStorage.getItem(LAB_URL_KEY);
      // A saved address only counts if the server still relays to it.
      const usable = saved && serverUrl ? saved : null;
      setBaseUrlState(usable ?? serverUrl ?? saved ?? (import.meta.env['VITE_LAB_URL'] as string | undefined) ?? '');
      setReady(true);
    });
  }, []);

  const setBaseUrl = useCallback((url: string) => {
    const clean = url.trim().replace(/\/$/, '');
    window.localStorage.setItem(LAB_URL_KEY, clean);
    setBaseUrlState(clean);
    setSourceId(null);
  }, []);

  // Discover sources.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setStatus('checking');
    labApi.sources(baseUrl).then((res) => {
      if (cancelled) return;
      if ((res as { offline?: boolean })?.offline) {
        setStatus('offline');
        setSources([]);
        setSourceId(null);
        setError(null);
        return;
      }
      const list = Array.isArray(res?.sources) ? res.sources : [];
      setSources(list);
      setStatus('connected');
      setError(null);
      labApi.capabilities(baseUrl).then((c) => setCapabilities((c as { unsupported?: boolean }).unsupported ? null : c)).catch(() => setCapabilities(null));
      setSourceId((current) => current && list.some((s) => s.id === current)
        ? current
        : (list.find((s) => s.kind === 'live') ?? list[list.length - 1])?.id ?? null);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setStatus('offline');
      setSources([]);
      setSourceId(null);
      setError(message(reason));
    });
    return () => { cancelled = true; };
  }, [baseUrl, ready, tick]);

  const load = useCallback((id: string) => {
    Promise.all([labApi.state(baseUrl, id), labApi.activity(baseUrl, id)]).then(([s, a]) => {
      setState(s);
      setActivity(a.activity ?? []);
      setError(null);
    }).catch((reason: unknown) => setError(message(reason)));
  }, [baseUrl]);

  // Load the selected source and follow its stream.
  useEffect(() => {
    setState(null);
    setActivity([]);
    setLedger([]);
    if (!sourceId || status !== 'connected') return;
    load(sourceId);
    setStreaming(true);
    const unsubscribe = subscribeSSE(labApi.streamUrl(baseUrl, sourceId), {
      events: ['ledger', 'agent', 'run', 'heartbeat'],
      onEvent: (name, data) => {
        if (name === 'agent') setActivity((current) => [...current, data as LabActivity]);
        if (name === 'run') setRunTick((n) => n + 1);
        if (name === 'ledger') {
          setLedger((current) => [...current.slice(-199), data as LedgerEvent]);
          if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
          refetchTimer.current = window.setTimeout(() => load(sourceId), 400);
        }
      },
      onError: () => setStreaming(false),
    });
    return () => {
      unsubscribe();
      setStreaming(false);
      if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
    };
  }, [baseUrl, load, sourceId, status]);

  // Muse Code run record (status, spend, approvals) for the selected source.
  useEffect(() => {
    setRun(null);
    if (!sourceId || status !== 'connected') return;
    let cancelled = false;
    const fetchRun = () => labApi.run(baseUrl, sourceId).then((r) => {
      if (!cancelled) setRun((r as { unsupported?: boolean }).unsupported || !r?.runtime ? null : r);
    }).catch(() => undefined);
    fetchRun();
    const id = window.setInterval(fetchRun, 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [baseUrl, sourceId, status, runTick]);

  const value = useMemo<LabContextValue>(() => ({
    baseUrl,
    setBaseUrl,
    status,
    error,
    sources,
    sourceId,
    setSourceId,
    source: sources.find((s) => s.id === sourceId) ?? null,
    state,
    activity,
    ledger,
    streaming,
    refresh: () => setTick((n) => n + 1),
    serverLabUrl, capabilities, session, setSession, run,
    refreshRun: () => setRunTick((n) => n + 1),
  }), [activity, baseUrl, capabilities, error, ledger, run, serverLabUrl, session, setBaseUrl, sourceId, sources, state, status, streaming]);

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab(): LabContextValue {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error('useLab must be used inside LabProvider');
  return ctx;
}
