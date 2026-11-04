/** Plain-language metric explanations. Formulas are quoted from the project's own documents. */
export type MetricKey = 'entropy' | 'eig' | 'posterior' | 'cvar' | 'ci' | 'auroc' | 'rmst';

export interface Explainer {
  title: string;
  plain: string;
  /** One-sentence hover translation. */
  short?: string;
  formula: string;
  /** The same formula in TeX, rendered with proper notation. */
  tex: string;
  source: { label: string; href: string };
}

export const EXPLAINERS: Record<MetricKey, Explainer> = {
  entropy: {
    title: 'Population entropy',
    plain: 'How varied the candidate solutions still are, from 0 (everyone is identical) to 1 (spread out evenly). When it collapses, the search may be about to get stuck — that is the early-warning signal Noesis tests.',
    formula: 'H_j = -sum_b p_b log p_b / log(B),    H_t = mean_j H_j  in [0, 1]',
    tex: 'H_j = -\\frac{\\sum_{b} p_b \\log p_b}{\\log B}, \\qquad H_t = \\frac{1}{d}\\sum_{j=1}^{d} H_j \\in [0, 1]',
    source: { label: 'discolab telemetry definition', href: '/docs/telemetry_entropy.txt' },
  },
  eig: {
    title: 'Expected information gain (bits)',
    plain: 'How much an experiment is expected to reduce uncertainty about the hypotheses before it is run. Noesis picks the experiment with the best gain after subtracting its compute cost — 10 minutes of compute costs one bit.',
    formula: 'utility = EIG_bits - eta * wall_seconds - lambda_heldout * heldout_landscapes_used',
    tex: 'U = \\mathrm{EIG}_{\\text{bits}} - \\eta \\, t_{\\text{wall}} - \\lambda_{\\text{held-out}} \\, n_{\\text{held-out}}',
    source: { label: 'Pre-registration · planner_policy', href: '/docs/prereg.yaml.txt' },
  },
  posterior: {
    title: 'Bayesian update (posterior)',
    plain: 'The current belief that a hypothesis is true, between 0 and 1. It starts at a registered prior and moves only when an experiment returns a verdict. A hypothesis is called supported only above 0.9 with a supporting result, refuted only below 0.1.',
    formula: 'supported if posterior >= 0.9 and some direct verdict was supported;\nrefuted if posterior <= 0.1 and some direct verdict was refuted; else open',
    tex: 'P(h \\mid D) \\propto P(D \\mid h)\\,P(h); \\quad \\text{supported} \\iff P(h \\mid D) \\ge 0.9 \\,\\wedge\\, \\text{a direct test supports } h',
    source: { label: 'Pre-registration · hypothesis_status', href: '/docs/prereg.yaml.txt' },
  },
  cvar: {
    title: 'Portfolio downside risk (CVaR)',
    plain: 'The average outcome in the worst slice of runs, rather than the typical run. It shows whether a method occasionally fails badly. With few runs this number is unstable and is labelled as a warning, not a precise estimate.',
    formula: 'CVaR_α(L) = E[ L | L ≥ VaR_α(L) ]',
    tex: '\\mathrm{CVaR}_{\\alpha}(L) = \\mathbb{E}\\left[\\, L \\mid L \\ge \\mathrm{VaR}_{\\alpha}(L) \\,\\right]',
    source: { label: 'Financial mathematics §6 Downside risk', href: '/docs/FINANCIAL_MATH_AND_META_AGENT.md' },
  },
  auroc: {
    title: 'AUROC (warning accuracy)',
    short: 'How well a signal separates runs about to stagnate from healthy ones: 0.5 is a coin flip, 1.0 is perfect.',
    plain: 'The chance that the warning signal ranks a run that is about to stagnate above a run that is not. 0.5 means no better than guessing; 1.0 means always right. The pre-registered tests compare AUROC with and without entropy features, out of sample.',
    formula: 'AUROC = P(score(stagnating) > score(healthy))',
    tex: '\\mathrm{AUROC} = P\\big(s(x^{+}) > s(x^{-})\\big)',
    source: { label: 'Pre-registration · hypotheses (delta AUROC)', href: '/docs/prereg.yaml.txt' },
  },
  rmst: {
    title: 'RMST (recovery time)',
    short: 'Average number of generations a controller needed to recover after a shift, capped at a fixed horizon; lower is faster.',
    plain: 'Restricted mean survival time: the mean recovery time up to a fixed horizon, keeping runs that never recovered as censored rather than dropping them. Lower means the controller recovered faster.',
    formula: 'RMST(τ) = ∫_0^τ S(t) dt',
    tex: '\\mathrm{RMST}(\\tau) = \\int_0^{\\tau} S(t)\\,dt',
    source: { label: 'Glossary · RMST', href: '/docs/GLOSSARY.md' },
  },
  ci: {
    title: '95% confidence interval',
    plain: 'The range the true effect plausibly lies in. If the range includes zero, the experiment could not tell an effect apart from no effect, so Noesis reports it as inconclusive.',
    formula: 'supported: 95% CI excludes zero in the hypothesised direction\nrefuted: 95% CI lies entirely inside (-inf, SESOI)\ninconclusive: otherwise',
    tex: '\\text{supported} \\iff \\mathrm{CI}_{95} \\cap \\{0\\} = \\varnothing \\text{ (predicted sign)}; \\quad \\text{refuted} \\iff \\mathrm{CI}_{95} \\subset (-\\infty, \\mathrm{SESOI})',
    source: { label: 'Scientific rigor standard §5', href: '/docs/SCIENTIFIC_RIGOR.md' },
  },
};

/** Example questions taken from the lab's pre-registered hypotheses. */
export const EXAMPLE_QUESTIONS = [
  'Does population entropy warn of stagnation in a genetic algorithm earlier than fitness history alone?',
  'Can a mutation controller driven by a stagnation-risk model recover faster after the landscape shifts?',
  'Does genotypic dispersion predict stagnation onset better than fitness history?',
  'Do fitness-spread features, which need no genotype access, predict stagnation onset?',
];
