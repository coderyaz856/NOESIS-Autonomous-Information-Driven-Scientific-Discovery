import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { labApi } from '../api/lab';
import type { LabSession } from '../api/lab-types';

/* Who may start runs and answer approvals from this app.
 *
 * - Development (`open`): the local bridge on this machine; nothing to unlock.
 * - Hosted with an operator token (`operator`): an operator types the token once.
 *   The app server checks it and sets an HttpOnly session cookie, so page code
 *   never keeps the token and none ships in the bundle.
 * - Hosted without a token (`disabled`): read-only; runs start from a local lab.
 *
 * The server enforces all of this (routes/lab-proxy.$.ts); the UI only explains it. */

let current: LabSession | null = null;
const listeners = new Set<() => void>();

function publish(next: LabSession | null) {
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function refreshLabSession(): Promise<void> {
  return labApi.session().then(publish, () => publish(null));
}

/** Test helper: forget the cached session. */
export function resetLabSession() {
  publish(null);
}

/** The app server's write mode and this browser's session; null while unknown. */
export function useLabSession(): LabSession | null {
  const session = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => { void refreshLabSession(); }, []);
  return session;
}

/** Why this browser cannot write right now, or null when it can (or the server decides). */
export function writeBlock(session: LabSession | null): string | null {
  if (!session) return null;
  if (session.write_mode === 'disabled') {
    return 'This hosted Noesis is read-only: explore recorded runs here, and start new runs from a local lab (see the README).';
  }
  if (session.write_mode === 'operator' && !session.signed_in) {
    return 'Starting runs on this hosted app needs an operator session. Unlock runs with the operator token.';
  }
  return null;
}

/** Operator sign-in for hosted deployments. Renders nothing in development or read-only mode. */
export function OperatorUnlock({ session }: { session: LabSession | null }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session || session.write_mode !== 'operator') return null;

  if (session.signed_in) {
    const lock = async () => {
      setBusy(true);
      try {
        publish(await labApi.signOut());
      } catch {
        await refreshLabSession();
      } finally {
        setBusy(false);
      }
    };
    return (
      <p className="operator-access quiet">
        Operator session active on this browser ·{' '}
        <button type="button" className="btn btn-ghost operator-lock" disabled={busy} onClick={lock}>Lock runs</button>
      </p>
    );
  }

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      publish(await labApi.signIn(token));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : String(reason));
    } finally {
      setToken('');
      setBusy(false);
    }
  };
  return (
    <form className="operator-access operator-unlock" onSubmit={unlock}>
      <label>
        <span className="quiet">Operator token</span>
        <input type="password" name="operator-token" autoComplete="off" value={token} disabled={busy}
          onChange={(e) => setToken(e.target.value)} />
      </label>
      <button type="submit" className="btn" disabled={busy || !token}>Unlock runs</button>
      {error ? <p className="lab-error" role="alert">{error}</p> : null}
    </form>
  );
}
