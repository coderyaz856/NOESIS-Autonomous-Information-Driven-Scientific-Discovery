import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { labApi } from '../api/lab';
import type { LabApprovalRequest, LabRun, LabRunStatus } from '../api/lab-types';
import { StatusBadge } from '../components/ui';
import { useLab } from './LabContext';
import { OperatorUnlock, refreshLabSession, useLabSession, writeBlock } from './OperatorAccess';

const ACTIVE: LabRunStatus[] = ['prepared', 'running'];

const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`);
const tokens = (n: number | null | undefined) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

function statusTone(s: LabRunStatus | undefined) {
  return s === 'completed' ? 'ok' : s === 'failed' || s === 'interrupted' ? 'bad' : s === 'running' || s === 'prepared' ? 'info' : 'idle';
}

/** Live view of the selected Muse Code run (`/lab/run`): status, scope,
 * models, estimated spend against the soft spend guard, per-agent tokens, approvals awaiting a
 * human, and the PI's final report. Renders nothing for recorded Omnigent runs. */
export function useRun() {
  const { baseUrl, sourceId, status, activity, refresh } = useLab();
  const [run, setRun] = useState<LabRun | null>(null);
  const wasActive = useRef(false);
  const load = useCallback(() => {
    if (!sourceId || status !== 'connected') { setRun(null); return; }
    labApi.run(baseUrl, sourceId).then(setRun).catch(() => setRun(null));
  }, [baseUrl, sourceId, status]);

  useEffect(() => { setRun(null); }, [sourceId]);
  useEffect(() => { load(); }, [activity.length, load]);
  const active = run?.status ? ACTIVE.includes(run.status) : false;
  // When a run finishes, refresh the source list so experiment counts and status are current.
  useEffect(() => {
    if (wasActive.current && !active && run) refresh();
    wasActive.current = active;
  }, [active, refresh, run]);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(load, 2500);
    return () => window.clearInterval(id);
  }, [active, load]);
  return { run, reload: load };
}

export function ApprovalControls({ approvals, onDone }: { approvals: LabApprovalRequest[]; onDone: () => void }) {
  const { baseUrl, sourceId } = useLab();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useLabSession();
  const blocked = writeBlock(session);
  const pending = approvals.filter((a) => a.status === 'pending');
  if (!approvals.length) return null;

  const answer = async (id: string, decision: 'approve' | 'decline') => {
    if (!sourceId || blocked) return;
    setBusy(id);
    setError(null);
    try {
      await labApi.answerApproval(baseUrl, sourceId, id, decision);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : String(reason));
      if (reason instanceof ApiError && reason.status === 401) void refreshLabSession();
    } finally {
      setBusy(null);
      onDone();
    }
  };

  return (
    <div className="lab-approvals">
      {pending.map((a) => (
        <div key={a.id} className="lab-approval-row is-pending">
          <div>
            <strong>{a.id}</strong> needs your approval <span className="quiet">· requested by {a.requested_by ?? 'pi'}</span>
            {a.reason ? <p className="quiet">{a.reason}</p> : null}
            <p className="quiet">Held-out landscapes can be used only once. If nobody answers, the request is declined automatically.</p>
          </div>
          <div className="lab-approval-actions">
            <button type="button" className="btn" disabled={busy === a.id || !!blocked} onClick={() => answer(a.id, 'approve')}>Approve run</button>
            <button type="button" className="btn btn-ghost" disabled={busy === a.id || !!blocked} onClick={() => answer(a.id, 'decline')}>Decline</button>
          </div>
        </div>
      ))}
      {pending.length > 0 && blocked ? <p className="quiet">{blocked}</p> : null}
      {pending.length > 0 ? <OperatorUnlock session={session} /> : null}
      {approvals.filter((a) => a.status !== 'pending').map((a) => (
        <div key={a.id} className="lab-approval-row">
          <strong>{a.id}</strong> <StatusBadge tone={a.status === 'approved' ? 'ok' : 'warn'}>{a.status}</StatusBadge>
          <span className="quiet"> by {a.decided_by ?? '—'}</span>
        </div>
      ))}
      {error ? <p className="lab-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function RunPanel() {
  const { run, reload } = useRun();
  if (!run || run.runtime !== 'muse') return null;
  const usage = run.usage;
  const spent = usage?.cost_usd ?? 0;
  const ceiling = run.ceiling_usd ?? 0;
  const roles = run.config?.roles ?? {};
  const models = Array.from(new Set(Object.values(roles).map((r) => r.model)));

  return (
    <article className="lab-card lab-run">
      <header className="lab-run-head">
        <p className="eyebrow">Muse Code run · {run.run_id} · {run.mode === 'open' ? 'open research (nothing executed)' : 'lab study (experiments executed)'}</p>
        <StatusBadge tone={statusTone(run.status)}>{run.status ?? 'unknown'}</StatusBadge>
      </header>
      <strong>{run.question}</strong>
      {run.scope ? (
        <p className="quiet">
          {run.scope.in_scope
            ? <>Lab study · tests {run.scope.hypotheses.join(', ') || '—'}{run.scope.focus ? ` · focus: ${run.scope.focus}` : ''}</>
            : <>Open research · outside the lab's simulation engine{run.scope.reason ? ` (${run.scope.reason})` : ''}</>}
        </p>
      ) : null}
      <dl className="lab-run-stats">
        <div><dt>Harness</dt><dd>{run.harness?.muse_version ?? run.harness?.harness ?? 'Muse Code'}</dd></div>
        <div><dt>Models</dt><dd>{models.join(', ') || '—'}</dd></div>
        <div><dt>Spend (est.)</dt><dd>{usd(spent)} · soft guard {usd(ceiling)}</dd></div>
        <div><dt>Model calls</dt><dd>{usage?.calls ?? 0}{usage?.failed_calls ? ` (${usage.failed_calls} failed)` : ''}</dd></div>
        <div><dt>Tokens in / cached / out</dt><dd>{tokens(usage?.input_tokens)} / {tokens(usage?.cached_tokens)} / {tokens(usage?.output_tokens)}</dd></div>
        <div><dt>Wall time</dt><dd>{run.wall_seconds != null ? `${Math.round(run.wall_seconds)} s` : run.status === 'running' ? 'running…' : '—'}</dd></div>
      </dl>
      {ceiling > 0 ? (
        <div className="lab-post" title="Estimated from token usage at Model API list prices. Soft guard: new agent hand-offs stop once it is reached; agents already running can push spend past it. Not a hard cap.">
          <span className="lab-post-bar"><i style={{ width: `${Math.min(100, (spent / ceiling) * 100)}%` }} /></span>
          <span className="mono">{Math.round((spent / ceiling) * 100)}% of soft spend guard (estimate, not a hard cap)</span>
        </div>
      ) : null}
      {run.active_agents?.length ? (
        <p><span className="quiet">Working now:</span> {run.active_agents.map((a) => `${a.agent}${a.title ? ` (${a.title})` : ''}`).join(' · ')}</p>
      ) : null}
      {run.per_agent?.length ? (
        <div className="lab-table-wrap"><table className="lab-table"><thead><tr><th>Agent</th><th>Model</th><th>Sessions</th><th>Calls</th><th>Tokens in / out</th><th>Cost</th><th>Time</th></tr></thead><tbody>
          {run.per_agent.map((a) => (
            <tr key={a.agent}><td><strong>{a.agent}</strong></td><td className="mono">{a.model ?? '—'}</td><td>{a.runs}</td><td>{a.calls}</td><td>{tokens(a.input_tokens)} / {tokens(a.output_tokens)}</td><td>{usd(a.cost_usd)}</td><td>{Math.round(a.seconds)} s</td></tr>
          ))}
        </tbody></table></div>
      ) : <p className="quiet">Agent token usage appears when each agent session finishes.</p>}
      <ApprovalControls approvals={run.approvals ?? []} onDone={reload} />
      {run.error ? <p className="lab-error" role="alert">{run.error}</p> : null}
      {run.status === 'interrupted' ? <p className="lab-error">The run's driver process stopped before finishing. Ledger entries up to that point are kept.</p> : null}
      {run.final_report ? (
        <details open>
          <summary>Principal investigator's final report</summary>
          <pre className="lab-report">{run.final_report}</pre>
        </details>
      ) : null}
    </article>
  );
}
