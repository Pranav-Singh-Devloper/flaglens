// Flagsmith Experimentation (beta) results, summarised for the editor. Pure: the store fetches the experiment and its
// results, this turns them into rows for hovers, badges and the report. FlagLens never recomputes the statistics; it
// shows Flagsmith's own (Bayesian lift with a 95% credible interval, and the chance each variation beats control).
//
// Verified on self-hosted 2.295.2: GET /environments/{key}/experiments/{id}/results/ returns
// {results: {as_of, is_final, payload: {metrics: [{metric_id, variants: {key: {n, sum, sum_squares}},
// inference: {key: {lift, ci_low, ci_high, chance_to_win} | null}}], srm_p_value}}}, where "control" is the flag's
// own value and the other keys are the multivariate option keys.

export interface ApiExperimentMetricRef {
  metric: number;
  metric_name: string;
  aggregation: 'occurrence' | 'count' | 'sum' | 'mean' | string;
  direction?: string;
  expected_direction: 'increase' | 'decrease' | 'not_increase' | 'not_decrease' | string;
}

export interface ApiExperimentDetail {
  id: number;
  name: string;
  hypothesis: string;
  status: 'created' | 'running' | 'paused' | 'completed';
  started_at?: string | null;
  ended_at?: string | null;
  feature: { id: number; name: string; initial_value?: string | null; multivariate_options?: { key?: string | null; string_value?: string | null }[] } | number;
  metrics: ApiExperimentMetricRef[];
}

export interface ApiInference {
  lift: number;
  ci_low: number;
  ci_high: number;
  chance_to_win: number;
}

export interface ApiExperimentResults {
  results: {
    as_of: string | null;
    is_final?: boolean;
    payload: {
      metrics: { metric_id: number; variants: Record<string, { n: number; sum: number; sum_squares?: number }>; inference: Record<string, ApiInference | null> }[];
      srm_p_value?: number | null;
    } | null;
  } | null;
}

export interface VariantSummary {
  key: string;
  /** The value the variation serves, e.g. "green" (control: the flag's own value). */
  value: string;
  control: boolean;
  /** Identities exposed to it. */
  exposures: number;
  /** Conversion rate (occurrence) or mean per identity (count, sum, mean). */
  metric: number;
  lift?: number;
  ciLow?: number;
  ciHigh?: number;
  chanceToWin?: number;
}

export interface ExperimentSummary {
  id: number;
  name: string;
  hypothesis: string;
  status: ApiExperimentDetail['status'];
  startedAt?: string | null;
  metricName?: string;
  /** "conversion" for occurrence metrics, "per identity" otherwise. */
  metricKind: 'conversion' | 'per identity';
  expected?: string;
  variants: VariantSummary[];
  exposures: number;
  asOf: string | null;
  final: boolean;
  /** A variation with at least a 95% chance to beat control. */
  likelyWinner?: VariantSummary;
  /** Sample ratio mismatch: the split differs from the configured one more than chance would explain. */
  srmWarning: boolean;
}

/** The threshold Flagsmith's own guidance uses for calling a winner. */
export const WIN_THRESHOLD = 0.95;

export function summariseExperiment(detail: ApiExperimentDetail, results: ApiExperimentResults | null): ExperimentSummary {
  const primary = detail.metrics[0];
  const payload = results?.results?.payload;
  const metric = payload?.metrics.find((m) => m.metric_id === primary?.metric) ?? payload?.metrics[0];
  const feature = typeof detail.feature === 'object' ? detail.feature : undefined;
  const valueOf = (key: string): string => {
    if (key === 'control') return feature?.initial_value ?? 'control';
    const option = feature?.multivariate_options?.find((o) => o.key === key);
    return option?.string_value ?? key;
  };
  const variants: VariantSummary[] = Object.entries(metric?.variants ?? {})
    .map(([key, v]) => {
      const inference = metric?.inference[key] ?? undefined;
      return {
        key,
        value: valueOf(key),
        control: key === 'control',
        exposures: v.n,
        metric: v.n ? v.sum / v.n : 0,
        ...(inference && { lift: inference.lift, ciLow: inference.ci_low, ciHigh: inference.ci_high, chanceToWin: inference.chance_to_win }),
      };
    })
    // Control first, then by chance to win.
    .sort((a, b) => Number(b.control) - Number(a.control) || (b.chanceToWin ?? -1) - (a.chanceToWin ?? -1));
  const best = variants.filter((v) => !v.control && v.chanceToWin !== undefined).sort((a, b) => b.chanceToWin! - a.chanceToWin!)[0];
  return {
    id: detail.id,
    name: detail.name,
    hypothesis: detail.hypothesis,
    status: detail.status,
    startedAt: detail.started_at,
    metricName: primary?.metric_name,
    metricKind: primary?.aggregation === 'occurrence' ? 'conversion' : 'per identity',
    expected: primary?.expected_direction,
    variants,
    exposures: variants.reduce((n, v) => n + v.exposures, 0),
    asOf: results?.results?.as_of ?? null,
    final: !!results?.results?.is_final,
    likelyWinner: best && best.chanceToWin! >= WIN_THRESHOLD ? best : undefined,
    srmWarning: typeof payload?.srm_p_value === 'number' && payload.srm_p_value < 0.01,
  };
}

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${pct(Math.abs(x))}`;

/** "green +40.0% (96% to win)" for badges, or a short status when there is no call to make yet. */
export function experimentHeadline(s: ExperimentSummary): string {
  if (!s.exposures) return `${s.name}: waiting for exposures`;
  const best = s.likelyWinner ?? s.variants.filter((v) => !v.control && v.chanceToWin !== undefined).sort((a, b) => b.chanceToWin! - a.chanceToWin!)[0];
  if (!best || best.lift === undefined) return `${s.name}: ${s.exposures} exposed, not enough data yet`;
  return `${best.value} ${signed(best.lift)} (${pct(best.chanceToWin!, 0)} to win)`;
}

/** Markdown table rows for hovers and the report. */
export function experimentTable(s: ExperimentSummary): string[] {
  const label = s.metricKind === 'conversion' ? 'Conversion' : 'Per identity';
  const rows = [`| Variation | Exposed | ${label} | vs control (95% interval) | Chance to win |`, '|---|--:|--:|---|--:|'];
  for (const v of s.variants) {
    const value = s.metricKind === 'conversion' ? pct(v.metric) : v.metric.toFixed(2);
    const lift = v.control ? 'control' : v.lift === undefined ? 'not enough data' : `${signed(v.lift)} (${signed(v.ciLow!)} to ${signed(v.ciHigh!)})`;
    const win = v.control ? '' : v.chanceToWin === undefined ? '' : pct(v.chanceToWin, 0);
    rows.push(`| \`${v.value}\`${v.control ? ' (control)' : ''} | ${v.exposures} | ${value} | ${lift} | ${win} |`);
  }
  return rows;
}
