import { describe, expect, it } from 'vitest';
import {
  differsAcross,
  driftFor,
  isDrifted,
  levenshtein,
  relativeTime,
  staleness,
  suggestKey,
  validateFlagName,
} from '../src/core/analysis';
import { ENVS, row } from './fixtures';

const NOW = Date.parse('2026-03-01T00:00:00Z'); // 59 days after the fixtures' default updated_at
const ALL = [1, 2, 3];
const opts = { now: NOW, thresholdDays: 30, permanentTags: ['permanent', 'kill-switch'] };

describe('drift', () => {
  const rate = row('rate_limit', { 1: [true, 1000], 2: [true, 100], 3: [true, 50] });
  it('detects a value difference between two environments', () => {
    expect(isDrifted(rate, 2, 3)).toBe(true);
    expect(driftFor(rate, ENVS, ['Staging', 'Production'])).toEqual({ drifted: true, detail: 'Staging on 100 ≠ Production on 50' });
  });
  it('detects an enabled difference', () => {
    expect(isDrifted(row('x', { 2: [true, null], 3: [false, null] }), 2, 3)).toBe(true);
  });
  it('ignores missing states and identical states', () => {
    expect(isDrifted(row('x', { 2: [true, 'a'] }), 2, 3)).toBe(false);
    expect(isDrifted(row('x', { 2: [true, 'a'], 3: [true, 'a'] }), 2, 3)).toBe(false);
  });
  it('treats 1 and "1" as different values', () => {
    expect(isDrifted(row('x', { 2: [true, 1], 3: [true, '1'] }), 2, 3)).toBe(true);
  });
  it('matches drift environment names case-insensitively and gives up when one is missing', () => {
    expect(driftFor(rate, ENVS, ['staging', 'PRODUCTION']).drifted).toBe(true);
    expect(driftFor(rate, ENVS, ['Staging', 'Live']).drifted).toBe(false);
  });
  it('differsAcross compares all environments', () => {
    expect(differsAcross(rate, ALL)).toBe(true);
    expect(differsAcross(row('x', { 1: [true, null], 2: [true, null] }), ALL)).toBe(false);
  });
});

describe('staleness', () => {
  it('flags a flag that is ON everywhere and unchanged past the threshold', () => {
    const r = staleness(row('dark_mode', { 1: [true, null], 2: [true, null], 3: [true, null] }), ALL, opts);
    expect(r).toMatchObject({ stale: true, days: 59, state: 'on' });
  });
  it('flags a flag that is OFF everywhere', () => {
    expect(staleness(row('old', { 1: [false, null], 2: [false, null], 3: [false, null] }), ALL, opts)).toMatchObject({ stale: true, state: 'off' });
  });
  it('uses the newest updated_at across environments', () => {
    const r = staleness(row('x', { 1: [true, null], 2: [true, null], 3: [true, null, '2026-02-25T00:00:00Z'] }), ALL, opts);
    expect(r).toMatchObject({ stale: false, days: 4, reason: 'recent' });
  });
  it('threshold 0 makes any uniform flag stale (used by the demo workspace)', () => {
    const r = staleness(row('x', { 1: [true, null, '2026-02-28T23:00:00Z'] }), [1], { ...opts, thresholdDays: 0 });
    expect(r).toMatchObject({ stale: true, days: 0 });
  });
  it.each([
    ['states differ', row('x', { 1: [true, null], 2: [false, null] }), 'differs'],
    ['values differ', row('x', { 1: [true, 'a'], 2: [true, 'b'] }), 'differs'],
    ['archived', row('x', { 1: [true, null] }, { isArchived: true }), 'archived'],
    ['permanent tag by name', row('x', { 1: [false, null] }, { tags: [{ id: 1, label: 'Kill-Switch', color: '', permanent: false }] }), 'permanent'],
    ['tag marked permanent in Flagsmith', row('x', { 1: [false, null] }, { tags: [{ id: 2, label: 'ops', color: '', permanent: true }] }), 'permanent'],
    ['segment overrides', row('x', { 1: [true, null] }, { segmentOverrides: 2 }), 'targeting'],
    ['no states', row('x', {}), 'no-states'],
  ])('is not stale when %s', (_n, r, reason) => {
    expect(staleness(r, ALL, opts)).toMatchObject({ stale: false, reason });
  });
  it('is not stale while variants are served', () => {
    const r = row('color', { 1: [true, 'blue'], 2: [true, 'blue'] });
    r.states.get(1)!.variantWeights.set(7, 50);
    expect(staleness(r, ALL, opts)).toMatchObject({ stale: false, reason: 'targeting' });
  });
  it('is not stale during an experiment', () => {
    const r = row('x', { 1: [true, null] });
    r.experiments.push({ id: 1, name: 'e', status: 'running', envId: 1 });
    expect(staleness(r, ALL, opts).reason).toBe('experiment');
  });
});

describe('suggestKey', () => {
  const known = ['new_checkout', 'banner_text', 'dark_mode', 'rate_limit_per_minute', 'beta'];
  it.each([
    ['new_chekout', 'new_checkout'],
    ['new_checkuot', 'new_checkout'],
    ['New_Checkout', 'new_checkout'],
    ['dark-mode', 'dark_mode'],
    ['bannertext', 'banner_text'],
    ['rate_limit', 'rate_limit_per_minute'],
    ['beat', undefined], // short keys need distance ≤ 1; "beat" → "beta" is 2
    ['totally_different', undefined],
  ])('%s → %s', (input, expected) => {
    expect(suggestKey(input, known)).toBe(expected);
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
  it('exits early above max', () => {
    expect(levenshtein('aaaaaaaa', 'bbbbbbbb', 2)).toBe(3);
  });
});

describe('validateFlagName', () => {
  const lower = { onlyLowerCase: true, nameRegex: null };
  it('accepts a good name', () => expect(validateFlagName('new_flag', lower)).toBeUndefined());
  it('enforces lower case', () => expect(validateFlagName('NewFlag', lower)).toMatch(/lower-case/));
  it('rejects spaces and empty names', () => {
    expect(validateFlagName('a b', lower)).toMatch(/spaces/);
    expect(validateFlagName(' ', lower)).toMatch(/empty/);
  });
  it('applies the project regex anchored at the start', () => {
    const rules = { onlyLowerCase: false, nameRegex: '[a-z]+_v\\d' };
    expect(validateFlagName('search_v2', rules)).toBeUndefined();
    expect(validateFlagName('x_search_v2', { onlyLowerCase: false, nameRegex: '^search' })).toMatch(/match/);
  });
  it('rejects duplicates', () => expect(validateFlagName('a', lower, ['a'])).toMatch(/exists/));
});

describe('relativeTime', () => {
  it('formats', () => {
    expect(relativeTime('2026-02-28T23:59:50Z', NOW)).toBe('just now');
    expect(relativeTime('2026-02-28T23:00:00Z', NOW)).toBe('1 hour ago');
    expect(relativeTime('2026-02-26T00:00:00Z', NOW)).toBe('3 days ago');
    expect(relativeTime(undefined, NOW)).toBe('unknown');
  });
});
