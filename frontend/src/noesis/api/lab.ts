import { api } from './client';
import type {
  LabActivity, LabCapabilities, LabExperiment, LabRun, LabSession, LabSource, LabStartRunResponse, LabState,
} from './lab-types';

export const LAB_URL_KEY = 'noesis-lab-url';

export const LOCAL_LAB_URL = 'http://127.0.0.1:8765';

/** Build a URL for a lab feed path. Requests go through the app's
 * `/lab-proxy` relay so browsers are not blocked by the feed's missing CORS
 * headers. An empty base targets the feed on this machine. */
export function labUrl(base: string, path: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params);
  search.set('target', base || LOCAL_LAB_URL);
  return `/lab-proxy/${path}?${search.toString()}`;
}

export const labApi = {
  sources: (base: string) => api.get<{ sources: LabSource[] }>(labUrl(base, 'sources')),
  state: (base: string, source: string) => api.get<LabState>(labUrl(base, 'state', { source })),
  activity: (base: string, source: string) => api.get<{ activity: LabActivity[] }>(labUrl(base, 'activity', { source })),
  experiment: (base: string, source: string, id: string) => api.get<LabExperiment>(labUrl(base, 'experiment', { source, id })),
  streamUrl: (base: string, source: string) => labUrl(base, 'stream', { source }),
  run: (base: string, source: string) => api.get<LabRun>(labUrl(base, 'run', { source })),
  capabilities: (base: string) => api.get<LabCapabilities>(labUrl(base, 'capabilities')),
  /** Starts a Muse Code discovery run. The lab checks the question against the
   * supported domain first and answers 422 `out_of_scope` when it cannot run it. */
  startRun: (base: string, question: string, opts: { rounds?: number; ceiling_usd?: number } = {}) =>
    api.post<LabStartRunResponse>(labUrl(base, 'runs'), { question, ...opts }),
  answerApproval: (base: string, source: string, id: string, decision: 'approve' | 'decline') =>
    api.post<{ id: string; status: string }>(labUrl(base, 'approvals'), { source, id, decision }),
  /** The app server's write mode and this browser's operator session. The
   * session is an HttpOnly cookie, so page code never holds the token. */
  session: () => api.get<LabSession>('/lab-proxy/session'),
  signIn: (token: string) => api.post<LabSession>('/lab-proxy/session', { token }),
  signOut: () => api.delete<LabSession>('/lab-proxy/session'),
};
