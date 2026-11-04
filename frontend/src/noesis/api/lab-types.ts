/** Shapes served by the discovery lab's read-only feed
 * (`discolab/discolab/bridge.py` + `views.py`). Keep in sync with those files. */

export interface CI {
  estimate: number | null;
  ci95: [number, number] | null;
}

export interface LabSource {
  id: string;
  kind: 'live' | 'record';
  events: number;
  experiments: number;
  prereg_sha256: string | null;
  /** 'muse' for runs launched through Muse Code, 'omnigent' for recorded Omnigent runs. */
  runtime?: 'muse' | 'omnigent' | null;
  run_status?: LabRunStatus | null;
  created_at?: string | null;
}

export type LabRunStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'interrupted';

export interface LabUsage {
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  calls: number;
  cost_usd: number;
  reasoning_tokens?: number;
  failed_calls?: number;
}

export interface LabAgentUsage extends LabUsage {
  agent: string;
  model: string | null;
  runs: number;
  seconds: number;
}

export interface LabApprovalRequest {
  id: string;
  status: 'pending' | 'approved' | 'declined';
  reason?: string;
  requested_by?: string;
  requested_at?: number;
  decided_by?: string;
  decided_at?: number;
}

export interface LabScope {
  in_scope: boolean;
  hypotheses: string[];
  focus?: string;
  reason: string;
  model?: string;
  cost_usd?: number;
}

export interface LabRoleConfig {
  model: string;
  effort: string;
  max_model_steps: number;
}

/** `/lab/run` — a Muse Code run record with live spend (bridge.run_view). */
export interface LabRun {
  runtime: 'muse' | null;
  mode?: LabMode;
  run_id?: string;
  source?: string;
  question?: string;
  scope?: LabScope | null;
  rounds?: number;
  ceiling_usd?: number;
  config?: { preset?: string; roles?: Record<string, LabRoleConfig> } | null;
  harness?: { harness?: string; muse_version?: string } | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  wall_seconds?: number | null;
  final_report?: string | null;
  error?: string | null;
  status?: LabRunStatus;
  usage?: LabUsage;
  per_agent?: LabAgentUsage[];
  active_agents?: { agent: string; title: string | null }[];
  model_calls_started?: number;
  approvals?: LabApprovalRequest[];
}

/** GET /lab-proxy/session: how this app server authorises lab writes.
 * open: development, writes go to the local bridge; operator: hosted, needs an
 * operator session; disabled: hosted and read-only. */
export interface LabSession {
  write_mode: 'open' | 'operator' | 'disabled';
  signed_in: boolean;
}

export interface LabCapabilities {
  runs_enabled: boolean;
  harness: string;
  max_rounds: number;
  max_ceiling_usd: number;
  modes?: Record<LabMode, string>;
  supported_domain: {
    domain: string;
    hypotheses: { id: string; statement: string }[];
    landscapes?: unknown;
    experiment_kinds?: unknown;
  };
}

/** 'lab': pre-registered GA/entropy study with executed experiments. 'open': any other
 * research question — literature, hypotheses, proposed protocols; nothing executed. */
export type LabMode = 'lab' | 'open';

/** A study design recorded in open mode. Never executed by the lab. */
export interface LabProtocol {
  id: string;
  title: string;
  hypotheses: string[];
  design: string;
  measurements: string;
  comparator: string;
  falsifier: string;
  sample_size: string;
  cost_estimate: string;
  risks: string;
  proposed_by: string;
  executed: false;
}

export interface LabStartRunResponse {
  source: string;
  run_id: string;
  mode: LabMode;
  scope: LabScope;
  rounds: number;
  ceiling_usd: number;
}

export interface LabHypothesis {
  id: string;
  family: string;
  origin: string;
  statement: string;
  status: string;
  posterior: number;
  n_direct_tests: number;
  last: { experiment: string; verdict: string; stage: string | null } | null;
}

export interface LabEvidence {
  source_id: string | null;
  source: 'OpenAlex' | 'arXiv';
  title: string | null;
  year: number | null;
  relation: string | null;
  hypothesis_id: string | null;
  claim: string | null;
  credibility?: string | null;
  limitation?: string | null;
  /** What record_evidence checked: the source's identity and metadata, never the claim. */
  source_check?: string;
  /** Always an agent's summary of the source; `claim_verified` is false. */
  claim_origin?: string;
  claim_verified?: false;
}

export interface LabCandidate {
  id: string;
  title: string;
  kind: string;
  stage: string | null;
  hypotheses: string[];
  status: string;
  proposed_by: string;
  utility: number | null;
  eig_bits: number | null;
  est_wall_seconds: number | null;
  feasible: boolean | null;
  violations: string[] | null;
}

export interface TrajectoryPoint {
  seq: number;
  posterior: number;
  label: string;
  verdict?: string | null;
  experiment?: string | null;
}

export interface ScoringRow {
  id: string;
  title: string;
  kind: string;
  stage: string | null;
  eig_bits: number;
  utility: number;
  feasible: boolean;
  violations: string[];
  est_wall_seconds: number;
  hypotheses: string[];
}

export interface ScoringRound {
  round: number;
  seq: number;
  argmax: string | null;
  selected: string | null;
  followed_argmax: boolean | null;
  justification: string | null;
  rows: ScoringRow[];
}

export interface LabDecision {
  seq: number;
  by: string;
  decision: string | null;
  rationale: string | null;
  next_experiment: string | null;
}

/** Verification state of a critic's analysis. The analysis is written first; the Noesis
 * gate (and, if it escalates, the Wonder verifier) judges it afterwards. */
export interface LabAnalysisVerification {
  status: 'unverified' | 'not_escalated' | 'confirmed' | 'corrected' | 'rejected' | 'unparsed';
  reasons?: string[];
  verifier_model?: string | null;
  verifier_report?: string | null;
}

export interface LabAnalysis {
  by: string;
  interpretation: string;
  threats_to_validity: string[];
  /** Absent on runs recorded before verification tracking (treat as unverified). */
  verification?: LabAnalysisVerification;
}

export interface LabState {
  question: string;
  /** Absent on runs recorded before open mode existed (treated as 'lab'). */
  mode?: LabMode;
  protocols?: LabProtocol[];
  compute_seconds: { used: number; budget: number };
  hypotheses: LabHypothesis[];
  evidence: LabEvidence[];
  candidates: LabCandidate[];
  selected: string | null;
  latest_scoring_round: { round: number; argmax: string | null } | null;
  next_decision: { decision?: string; rationale?: string; next_experiment?: string | null } | null;
  events: number;
  prereg_sha256: string | null;
  trajectories: Record<string, TrajectoryPoint[]>;
  rounds: ScoringRound[];
  decisions: LabDecision[];
  analyses: Record<string, LabAnalysis>;
  completed: string[];
}

export type LabActivity =
  | { t: number; kind: 'handoff'; from: string; to: string | null; title: string; state: 'running' | 'finished' }
  | { t: number; kind: 'approval'; agent: string; text: string; id?: string; state?: string }
  | { t: number; kind: 'tool'; agent: string; name: string; args: string; ok?: boolean; error?: string | null; ms?: number }
  | { t: number; kind: 'say'; agent: string; text: string }
  /** Noesis escalation gate on a specialist report (decision) or the verifier's verdict. */
  | {
      t: number; kind: 'gate'; agent: string; title: string; decision: 'accept' | 'escalate' | 'verdict';
      reasons: string[]; family?: string | null; ucb?: number | null; threshold?: number;
      verifier_model?: string | null; verdict?: 'CONFIRMED' | 'CORRECTED' | 'REJECTED' | 'UNPARSED';
    };

export interface LabVerdict {
  verdict: string;
  measure: string;
  effect: CI;
  standardised_effect: number | null;
  n_units: number;
}

export interface CurveSet {
  shifts: number[];
  controllers: Record<string, { n_runs: number; log10_best_err_mean: number[]; entropy_mean: number[]; p_mut_mean: number[] }>;
}

export interface LabExperiment {
  id: string;
  title?: string;
  kind?: string;
  stage?: string;
  status?: string;
  runtime_sec?: number | null;
  verdicts?: Record<string, LabVerdict>;
  auroc?: Record<string, CI>;
  per_controller?: Record<string, { rmst_gens: number | null; recovery_rate: CI; cvar90_recovery_gens: number | null; mean_p_mut: number | null }>;
  analysis?: LabAnalysis;
  curves?: Record<string, CurveSet> | null;
  spec?: Record<string, unknown>;
  score?: { eig_bits: number | null; utility: number | null };
  result?: null;
  error?: string | null;
}

export interface LedgerEvent {
  seq: number;
  ts: string;
  type: string;
  actor: string;
  id: string | null;
}
