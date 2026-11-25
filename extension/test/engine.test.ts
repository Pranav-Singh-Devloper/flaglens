import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  conditionMatches,
  evaluateFlags,
  hashedPercentage,
  matchingSegments,
  uniformity,
  type DocFeatureState,
  type DocSegment,
  type EnvironmentDocument,
} from '../src/core/engine';

function fs(id: number, name: string, enabled: boolean, value: DocFeatureState['feature_state_value'] = null, extra: Partial<DocFeatureState> = {}): DocFeatureState {
  return {
    feature: { id, name, type: 'STANDARD' },
    enabled,
    django_id: 100 + id,
    featurestate_uuid: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`,
    feature_state_value: value,
    feature_segment: null,
    multivariate_feature_state_values: [],
    ...extra,
  };
}

function segment(id: number, name: string, conditions: { property: string | null; operator: string; value: string | null }[], overrides: DocFeatureState[]): DocSegment {
  return {
    id,
    name,
    rules: [{ type: 'ALL', conditions: [], rules: [{ type: 'ANY', rules: [], conditions: conditions.map(({ property, ...c }) => ({ ...c, property_: property })) }] }],
    feature_states: overrides,
  };
}

const colour = fs(4, 'button_color', true, 'blue', {
  feature: { id: 4, name: 'button_color', type: 'MULTIVARIATE' },
  multivariate_feature_state_values: [
    // Deliberately out of order: the engines walk variants by id.
    { id: 9, percentage_allocation: 50, multivariate_feature_option: { value: 'orange', key: 'orange' } },
    { id: 3, percentage_allocation: 30, multivariate_feature_option: { value: 'green', key: 'green' } },
  ],
});

const doc: EnvironmentDocument = {
  api_key: 'envkey',
  name: 'Production',
  feature_states: [fs(1, 'new_checkout', false), fs(2, 'banner', true, 'Hello'), fs(3, 'limit', true, 50), colour],
  project: {
    segments: [
      segment(10, 'beta', [{ property: 'email', operator: 'REGEX', value: '.*@shop\\.dev$' }], [fs(1, 'new_checkout', true, null, { django_id: 201, feature_segment: { priority: 1 } })]),
      segment(11, 'vip', [{ property: 'plan', operator: 'EQUAL', value: 'vip' }], [fs(1, 'new_checkout', false, null, { django_id: 202, feature_segment: { priority: 0 } }), fs(3, 'limit', true, 500, { django_id: 203, feature_segment: { priority: 0 } })]),
      { id: 12, name: 'empty', rules: [], feature_states: [] },
    ],
  },
  identity_overrides: [{ identifier: 'ceo', identity_features: [fs(2, 'banner', true, 'Hi boss')] }],
};

describe('hashedPercentage', () => {
  it('matches independently computed md5 percentages (Python hashlib)', () => {
    expect(hashedPercentage(['1', '2'])).toBeCloseTo(26.59531906381276, 10);
    expect(hashedPercentage(['29', 'env_alice'])).toBeCloseTo(73.76475295059012, 10);
    expect(hashedPercentage(['4', 'PFd_user-1'])).toBeCloseTo(61.17223444688938, 10);
  });

  it('is deterministic and in [0, 100)', () => {
    for (let i = 0; i < 2000; i++) {
      const v = hashedPercentage(['seg', `user-${i}`]);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
      expect(hashedPercentage(['seg', `user-${i}`])).toBe(v);
    }
  });

  it('spreads identities evenly (chi-square over 10 buckets, 10 000 identities)', () => {
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < 10_000; i++) counts[Math.floor(hashedPercentage(['7', `envkey_u${i}`]) / 10)]!++;
    const chi2 = counts.reduce((s, c) => s + (c - 1000) ** 2 / 1000, 0);
    // 9 degrees of freedom: p = 0.001 at 27.9. A fair split stays well below that.
    expect(chi2).toBeLessThan(27.9);
  });
});

describe('evaluateFlags', () => {
  it('without an identity returns the environment defaults (multivariate → control)', () => {
    const r = evaluateFlags(doc);
    expect(r.get('new_checkout')).toMatchObject({ enabled: false, reason: { kind: 'default' } });
    expect(r.get('button_color')?.value).toBe('blue');
    expect(r.get('button_color')?.split).toBeUndefined();
  });

  it('applies a matching segment override', () => {
    const r = evaluateFlags(doc, { identifier: 'a', traits: { email: 'a@shop.dev' } });
    expect(r.get('new_checkout')).toMatchObject({ enabled: true, reason: { kind: 'segment', segment: 'beta' } });
    expect(r.get('limit')?.value).toBe(50);
  });

  it('picks the override with the lowest priority number, whatever the segment order', () => {
    const r = evaluateFlags(doc, { identifier: 'a', traits: { email: 'a@shop.dev', plan: 'vip' } });
    expect(r.get('new_checkout')).toMatchObject({ enabled: false, reason: { kind: 'segment', segment: 'vip' } });
    expect(r.get('limit')?.value).toBe(500);
  });

  it('identity overrides beat everything', () => {
    expect(evaluateFlags(doc, { identifier: 'ceo', traits: {} }).get('banner')).toMatchObject({ value: 'Hi boss', reason: { kind: 'identity' } });
  });

  it('picks multivariate variants by bucket, walking variants in id order', () => {
    for (let i = 0; i < 300; i++) {
      const identifier = `user-${i}`;
      const bucket = hashedPercentage([String(colour.django_id), `envkey_${identifier}`]);
      const expected = bucket < 30 ? 'green' : bucket < 80 ? 'orange' : 'blue';
      const got = evaluateFlags(doc, { identifier, traits: {} }).get('button_color')!;
      expect(got.value).toBe(expected);
      expect(got.split?.bucket).toBe(bucket);
    }
  });

  it('never matches a segment without rules', () => {
    expect(matchingSegments(doc, { identifier: 'x', traits: {} }).map((s) => s.name)).toEqual([]);
  });
});

describe('conditionMatches', () => {
  const ctx = (traits: Record<string, string | number | boolean | null>, identifier = 'u1') => ({
    environment: { key: 'envkey', name: 'Production' },
    identity: { identifier, key: `envkey_${identifier}`, traits },
  });
  const m = (operator: string, value: string | null, traits: Record<string, string | number | boolean | null>, property: string | null = 't') =>
    conditionMatches({ operator, value, property_: property }, 1, ctx(traits));

  it('REGEX anchors at the start like the API (Python re.match)', () => {
    expect(m('REGEX', 'shop', { t: 'a@shop.dev' })).toBe(false);
    expect(m('REGEX', '.*shop', { t: 'a@shop.dev' })).toBe(true);
    expect(m('REGEX', '[', { t: 'x' })).toBe(false);
  });

  it('casts the condition value to the trait type', () => {
    expect(m('EQUAL', '18', { t: 18 })).toBe(true);
    expect(m('GREATER_THAN', '18', { t: 20 })).toBe(true);
    expect(m('GREATER_THAN', '18', { t: 9 })).toBe(false);
    expect(m('EQUAL', 'true', { t: true })).toBe(true);
    expect(m('EQUAL', 'false', { t: true })).toBe(false);
  });

  it('IN accepts comma lists and JSON arrays; MODULO takes divisor|remainder', () => {
    expect(m('IN', 'IN,GB', { t: 'GB' })).toBe(true);
    expect(m('IN', '["IN","GB"]', { t: 'GB' })).toBe(true);
    expect(m('IN', 'IN,GB', { t: 'US' })).toBe(false);
    expect(m('MODULO', '3|1', { t: 7 })).toBe(true);
    expect(m('MODULO', '3|1', { t: 9 })).toBe(false);
    expect(m('MODULO', 'bad', { t: 9 })).toBe(false);
  });

  it('IS_SET / IS_NOT_SET, missing traits and unknown operators', () => {
    expect(m('IS_SET', null, { t: 'x' })).toBe(true);
    expect(m('IS_NOT_SET', null, {})).toBe(true);
    expect(m('EQUAL', 'x', {})).toBe(false);
    expect(m('SOMETHING_NEW', 'x', { t: 'x' })).toBe(false);
  });

  it('semver comparisons with the :semver suffix', () => {
    expect(m('GREATER_THAN_INCLUSIVE', '2.0.0:semver', { t: '2.10.1' })).toBe(true);
    expect(m('LESS_THAN', '2.0.0:semver', { t: '2.0.0-beta.1' })).toBe(true);
    expect(m('EQUAL', '2.0.0:semver', { t: 'nope' })).toBe(false);
    expect(compareSemver('1.2.3', '1.10.0')).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
  });

  it('PERCENTAGE_SPLIT hashes [segment id, identity key]', () => {
    const inside = Array.from({ length: 1000 }, (_, i) => conditionMatches({ operator: 'PERCENTAGE_SPLIT', value: '25', property_: null }, 1, ctx({}, `u${i}`)));
    const share = inside.filter(Boolean).length / 1000;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });

  it('reads JSONPath properties from the context', () => {
    expect(m('EQUAL', 'u1', {}, '$.identity.identifier')).toBe(true);
    expect(m('EQUAL', 'Production', {}, '$.environment.name')).toBe(true);
    expect(m('EQUAL', 'x', { 'odd.name': 'x' }, "$.identity.traits['odd.name']")).toBe(true);
  });
});

describe('uniformity', () => {
  it('is uniform only without overrides (and, for values, without a split)', () => {
    expect(uniformity(doc, 'new_checkout')).toEqual({ enabled: false, value: false });
    expect(uniformity(doc, 'banner')).toEqual({ enabled: false, value: false });
    expect(uniformity(doc, 'button_color')).toEqual({ enabled: true, value: false });
    const plain = { ...doc, project: { segments: [] }, identity_overrides: [] };
    expect(uniformity(plain, 'new_checkout')).toEqual({ enabled: true, value: true });
  });
});
