import { describe, expect, it } from 'vitest';
import { buildRows, compileProtectedPattern, formatValue, rowSignature, toEnvironment, writeBlockReason } from '../src/core/model';
import { apiFeature, apiState, ENVS, TAGS } from './fixtures';

describe('buildRows', () => {
  const features = [
    apiFeature(1, 'new_checkout', { tags: [1, 99] }),
    apiFeature(2, 'color', {
      type: 'MULTIVARIATE',
      multivariate_options: [
        { id: 7, type: 'unicode', string_value: 'green', integer_value: null, boolean_value: null, default_percentage_allocation: 50, key: 'green' },
        { id: 8, type: 'int', string_value: null, integer_value: 3, boolean_value: null, default_percentage_allocation: 0, key: null },
      ],
    }),
  ];
  const states = new Map([
    [1, [apiState(10, 1, 1, { enabled: true }), apiState(11, 2, 1, { feature_state_value: 'blue', multivariate_feature_state_values: [{ id: 1, multivariate_feature_option: 7, percentage_allocation: 30 }] })]],
    [3, [apiState(30, 1, 3, { enabled: false }), apiState(31, 1, 3, { feature_segment: 5, enabled: true }), apiState(32, 1, 3, { identity: 9 })]],
  ]);

  it('joins features with environment default states only', () => {
    const rows = buildRows(features, TAGS, states);
    const nc = rows.get('new_checkout')!;
    expect(nc.states.get(1)).toMatchObject({ featureStateId: 10, enabled: true });
    expect(nc.states.get(3)).toMatchObject({ featureStateId: 30, enabled: false }); // segment/identity overrides skipped
    expect(nc.states.has(2)).toBe(false);
  });

  it('resolves tags and ignores unknown tag ids', () => {
    expect(buildRows(features, TAGS, states).get('new_checkout')!.feature.tags.map((t) => t.label)).toEqual(['kill-switch']);
  });

  it('maps variants and per-environment weights', () => {
    const color = buildRows(features, TAGS, states).get('color')!;
    expect(color.feature.variants).toEqual([
      { id: 7, key: 'green', value: 'green', weight: 50 },
      { id: 8, key: null, value: 3, weight: 0 },
    ]);
    expect(color.states.get(1)!.variantWeights.get(7)).toBe(30);
  });

  it('attaches experiments by feature id', () => {
    const rows = buildRows(features, TAGS, states, new Map([[1, [{ id: 4, feature: 1, name: 'exp', status: 'running' as const }]]]));
    expect(rows.get('new_checkout')!.experiments).toEqual([{ id: 4, name: 'exp', status: 'running', envId: 1 }]);
  });

  it('signature changes when a state changes', () => {
    const a = rowSignature(buildRows(features, TAGS, states).get('new_checkout')!);
    states.get(1)![0]!.enabled = false;
    const b = rowSignature(buildRows(features, TAGS, states).get('new_checkout')!);
    expect(a).not.toBe(b);
  });
});

describe('environments and writes', () => {
  it('marks protected environments with a case-insensitive regex', () => {
    const re = compileProtectedPattern('prod|live');
    const env = (name: string) => toEnvironment({ id: 1, name, api_key: 'k', project: 1, use_v2_feature_versioning: false }, re);
    expect(env('Production').protected).toBe(true);
    expect(env('LIVE-eu').protected).toBe(true);
    expect(env('Staging').protected).toBe(false);
  });

  it('falls back to the default pattern on an invalid regex and disables on empty', () => {
    expect(compileProtectedPattern('(')!.test('prod')).toBe(true);
    expect(compileProtectedPattern('')).toBeUndefined();
  });

  it('explains why a write is blocked', () => {
    const rows = buildRows([apiFeature(1, 'f')], [], new Map([[1, [apiState(10, 1, 1)]]]));
    const r = rows.get('f')!;
    expect(writeBlockReason(r, ENVS[0]!)).toBeUndefined();
    expect(writeBlockReason(r, { ...ENVS[0]!, v2Versioning: true })).toMatch(/versioning/);
    expect(writeBlockReason(r, ENVS[1]!)).toMatch(/no state/);
    r.experiments.push({ id: 1, name: 'e', status: 'running', envId: 1 });
    expect(writeBlockReason(r, ENVS[0]!)).toMatch(/experiment/);
  });

  it('formats values compactly', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue('hi')).toBe('"hi"');
    expect(formatValue(50)).toBe('50');
    expect(formatValue('x'.repeat(40), 10)).toHaveLength(10);
  });
});
