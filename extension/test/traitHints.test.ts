import { describe, expect, it } from 'vitest';
import type { EnvironmentDocument } from '../src/core/engine';
import { applyCompletion, completeTraits, traitSuggestions } from '../src/core/traitHints';

const cond = (property_: string, operator: string, value: string | null) => ({ property_, operator, value });
const seg = (name: string, ...conditions: ReturnType<typeof cond>[]) => ({ id: 0, name, feature_states: [], rules: [{ type: 'ALL', conditions: [], rules: [{ type: 'ANY', rules: [], conditions }] }] });
// The demo's segments, as the environment document has them.
const doc = {
  project: {
    segments: [
      seg('beta_testers', cond('email', 'REGEX', '.*@demo-shop\\.dev$')),
      seg('pro_plan', cond('plan', 'EQUAL', 'pro')),
      seg('india', cond('country', 'EQUAL', 'IN')),
      seg('canary_10pct', cond('', 'PERCENTAGE_SPLIT', '10')),
      seg('pro_eu', cond('plan', 'EQUAL', 'pro'), cond('country', 'IN', 'DE,FR, GB')),
      seg('uk', cond('country', 'EQUAL', 'GB')),
      seg('flag-depends-on-x', cond('$.flags["x"].enabled', 'NOT_EQUAL', 'true')),
      seg('new_app', cond('app_version', 'GREATER_THAN_INCLUSIVE', '2.0.0:semver')),
    ],
  },
} as unknown as EnvironmentDocument;

describe('trait suggestions', () => {
  const s = traitSuggestions([doc, doc], ['plan', 'age']);

  it('collects every trait a rule reads, with values worth trying, most used first', () => {
    expect(s.map((x) => x.key)).toEqual(['country', 'plan', 'app_version', 'email', 'age']);
    expect(s.find((x) => x.key === 'country')).toEqual({ key: 'country', values: ['IN', 'DE', 'FR', 'GB'], segments: ['india', 'pro_eu', 'uk'], stored: false });
    expect(s.find((x) => x.key === 'plan')).toMatchObject({ values: ['pro'], stored: true });
    expect(s.find((x) => x.key === 'app_version')!.values).toEqual(['2.0.0']);
    expect(s.find((x) => x.key === 'email')!.values).toEqual([]);
    expect(s.find((x) => x.key === 'age')).toEqual({ key: 'age', values: [], segments: [], stored: true });
  });

  it('completes keys that are not used yet, then values', () => {
    expect(completeTraits('', s).map((c) => c.insert)).toEqual(['country=', 'plan=', 'app_version=', 'email=', 'age=']);
    expect(completeTraits('plan=pro, c', s)).toEqual([{ insert: 'country=', description: 'used by india, pro_eu, uk' }]);
    expect(completeTraits('country=IN, ', s).map((c) => c.insert)).not.toContain('country=');
    expect(completeTraits('plan=pro, country=', s).map((c) => c.insert)).toEqual(['country=IN', 'country=DE', 'country=FR', 'country=GB']);
    expect(completeTraits('country=g', s).map((c) => c.insert)).toEqual(['country=GB']);
    expect(completeTraits('country=GB', s)).toEqual([]);
    expect(completeTraits('nope=', s)).toEqual([]);
  });

  it('applies a completion to the pair being typed', () => {
    expect(applyCompletion('plan=pro, c', 'country=')).toBe('plan=pro, country=');
    expect(applyCompletion('plan=pro, country=', 'country=IN')).toBe('plan=pro, country=IN, ');
    expect(applyCompletion('pl', 'plan=')).toBe('plan=');
  });
});
