import { describe, expect, it } from 'vitest';
import { experimentHeadline, experimentTable, summariseExperiment, type ApiExperimentDetail, type ApiExperimentResults, type ApiInference } from '../src/core/experiment';

// Shapes copied from self-hosted Flagsmith 2.295.2 (trimmed).
const detail: ApiExperimentDetail = {
  id: 1,
  name: 'Checkout button colour',
  hypothesis: 'A green checkout button will increase checkout completion by at least 15% within 14 days.',
  status: 'running',
  started_at: '2026-11-27T13:03:41Z',
  feature: {
    id: 4,
    name: 'checkout_button_color',
    initial_value: 'blue',
    multivariate_options: [
      { key: 'green', string_value: 'green' },
      { key: 'orange', string_value: 'orange' },
    ],
  },
  metrics: [{ metric: 1, metric_name: 'Checkout completed', aggregation: 'occurrence', direction: 'up', expected_direction: 'increase' }],
};

const results = (inference: Record<string, ApiInference | null>, srm: number | null = 0.4): ApiExperimentResults => ({
  results: {
    as_of: '2026-11-27T13:20:00Z',
    is_final: false,
    payload: {
      metrics: [
        {
          metric_id: 1,
          variants: { control: { n: 200, sum: 20 }, green: { n: 200, sum: 28 }, orange: { n: 200, sum: 18 } },
          inference,
        },
      ],
      srm_p_value: srm,
    },
  },
});

describe('experiment results', () => {
  it('summarises variations with their served values, control first, best chance to win next', () => {
    const s = summariseExperiment(detail, results({ green: { lift: 0.4, ci_low: 0.05, ci_high: 0.8, chance_to_win: 0.97 }, orange: { lift: -0.1, ci_low: -0.4, ci_high: 0.2, chance_to_win: 0.3 } }));
    expect(s.variants.map((v) => [v.value, v.control, v.exposures, v.metric])).toEqual([
      ['blue', true, 200, 0.1],
      ['green', false, 200, 0.14],
      ['orange', false, 200, 0.09],
    ]);
    expect(s.exposures).toBe(600);
    expect(s.metricKind).toBe('conversion');
    expect(s.likelyWinner?.value).toBe('green');
    expect(experimentHeadline(s)).toBe('green +40.0% (97% to win)');
    expect(experimentTable(s)[3]).toBe('| `green` | 200 | 14.0% | +40.0% (+5.0% to +80.0%) | 97% |');
    expect(experimentTable(s)[2]).toBe('| `blue` (control) | 200 | 10.0% | control |  |');
  });

  it('calls no winner below 95%, and says when there is not enough data', () => {
    const s = summariseExperiment(detail, results({ green: { lift: 0.2, ci_low: -0.1, ci_high: 0.5, chance_to_win: 0.8 }, orange: null }));
    expect(s.likelyWinner).toBeUndefined();
    expect(experimentHeadline(s)).toBe('green +20.0% (80% to win)');
    expect(experimentTable(s).find((r) => r.includes('orange'))).toContain('not enough data');
    expect(experimentHeadline(summariseExperiment(detail, results({ green: null, orange: null })))).toBe('Checkout button colour: 600 exposed, not enough data yet');
    expect(experimentHeadline(summariseExperiment(detail, null))).toBe('Checkout button colour: waiting for exposures');
  });

  it('flags a sample ratio mismatch', () => {
    expect(summariseExperiment(detail, results({}, 0.001)).srmWarning).toBe(true);
    expect(summariseExperiment(detail, results({}, null)).srmWarning).toBe(false);
  });
});
