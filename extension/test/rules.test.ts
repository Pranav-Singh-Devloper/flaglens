import { describe, expect, it } from 'vitest';
import type { DocFeatureState, DocSegment, EnvironmentDocument } from '../src/core/engine';
import { analyseRules } from '../src/core/rules';

type Cond = [property: string | null, operator: string, value: string | null];

let nextId = 1;
function fs(name: string, enabled: boolean, value: DocFeatureState['feature_state_value'], priority: number | null = null): DocFeatureState {
  return {
    feature: { id: 1, name, type: 'STANDARD' },
    enabled,
    django_id: nextId++,
    featurestate_uuid: `uuid-${nextId}`,
    feature_state_value: value,
    feature_segment: priority === null ? null : { priority },
    multivariate_feature_state_values: [],
  };
}

/** A segment whose top-level ALL rule wraps one `type` rule with the given conditions (like the dashboard). */
function seg(name: string, type: 'ALL' | 'ANY' | 'NONE', conds: Cond[], override: DocFeatureState): DocSegment {
  return {
    id: nextId++,
    name,
    rules: [{ type: 'ALL', conditions: [], rules: [{ type, rules: [], conditions: conds.map(([property_, operator, value]) => ({ property_, operator, value })) }] }],
    feature_states: [override],
  };
}

function doc(defaultState: DocFeatureState, segments: DocSegment[]): EnvironmentDocument {
  return { api_key: 'k', name: 'Production', feature_states: [defaultState], project: { segments }, identity_overrides: [] };
}

const kinds = (d: EnvironmentDocument) => analyseRules(d).map((f) => `${f.kind}:${f.segment ?? '-'}`);

describe('shadowed overrides', () => {
  it('finds an override whose users are all caught by a higher-priority one', () => {
    const d = doc(fs('limit', true, 50), [
      seg('pro_plan', 'ALL', [['plan', 'EQUAL', 'pro']], fs('limit', true, 500, 1)),
      seg('pro_eu', 'ALL', [['plan', 'EQUAL', 'pro'], ['country', 'IN', 'DE,FR,GB']], fs('limit', true, 800, 4)),
    ]);
    const [f] = analyseRules(d);
    expect(f).toMatchObject({ kind: 'shadowed', segment: 'pro_eu', by: ['pro_plan'] });
    expect(f!.message).toMatch(/caught first by "pro_plan" \(priority 1\)/);
  });

  it('uses priority, not list order', () => {
    const d = doc(fs('limit', true, 50), [
      seg('pro_eu', 'ALL', [['plan', 'EQUAL', 'pro'], ['country', 'IN', 'DE,FR,GB']], fs('limit', true, 800, 0)),
      seg('pro_plan', 'ALL', [['plan', 'EQUAL', 'pro']], fs('limit', true, 500, 1)),
    ]);
    expect(kinds(d)).toEqual([]);
  });

  it('does not report a partial overlap', () => {
    const d = doc(fs('limit', true, 50), [
      seg('pro_plan', 'ALL', [['plan', 'EQUAL', 'pro']], fs('limit', true, 500, 0)),
      seg('paid', 'ALL', [['plan', 'IN', 'pro,team']], fs('limit', true, 300, 1)),
    ]);
    expect(kinds(d)).toEqual([]);
  });

  it('is shadowed by the union of several segments', () => {
    const d = doc(fs('x', false, null), [
      seg('pro', 'ALL', [['plan', 'EQUAL', 'pro']], fs('x', true, null, 0)),
      seg('team', 'ALL', [['plan', 'EQUAL', 'team']], fs('x', false, null, 1)),
      seg('paid', 'ALL', [['plan', 'IN', 'pro,team']], fs('x', true, 'paid', 2)),
    ]);
    expect(analyseRules(d)).toEqual([expect.objectContaining({ kind: 'shadowed', segment: 'paid', by: ['pro', 'team'] })]);
  });

  it('reasons about numeric thresholds', () => {
    const older = [seg('over30', 'ALL', [['age', 'GREATER_THAN', '30']], fs('x', true, 'a', 0)), seg('over40', 'ALL', [['age', 'GREATER_THAN', '40']], fs('x', true, 'b', 1))];
    expect(kinds(doc(fs('x', false, null), older))).toEqual(['shadowed:over40']);
    const flipped = [seg('over40', 'ALL', [['age', 'GREATER_THAN', '40']], fs('x', true, 'b', 0)), seg('over30', 'ALL', [['age', 'GREATER_THAN', '30']], fs('x', true, 'a', 1))];
    expect(kinds(doc(fs('x', false, null), flipped))).toEqual([]);
  });

  it('treats identical opaque conditions (REGEX) as the same fact, different ones as independent', () => {
    const same = [
      seg('staff', 'ALL', [['email', 'REGEX', '.*@shop\\.dev$']], fs('x', true, null, 0)),
      seg('staff_pro', 'ALL', [['email', 'REGEX', '.*@shop\\.dev$'], ['plan', 'EQUAL', 'pro']], fs('x', true, 'p', 1)),
    ];
    expect(kinds(doc(fs('x', false, null), same))).toEqual(['shadowed:staff_pro']);
    const different = [seg('a', 'ALL', [['email', 'REGEX', 'a']], fs('x', true, null, 0)), seg('b', 'ALL', [['email', 'REGEX', 'b']], fs('x', true, 'b', 1))];
    expect(kinds(doc(fs('x', false, null), different))).toEqual([]);
  });

  it('handles % splits: 100% catches everyone, 10% does not', () => {
    const all = [seg('everyone', 'ALL', [[null, 'PERCENTAGE_SPLIT', '100']], fs('x', true, null, 0)), seg('pro', 'ALL', [['plan', 'EQUAL', 'pro']], fs('x', true, 'p', 1))];
    expect(kinds(doc(fs('x', false, null), all))).toEqual(['shadowed:pro', 'default-unreachable:-']);
    const some = [seg('canary', 'ALL', [[null, 'PERCENTAGE_SPLIT', '10']], fs('x', true, null, 0)), seg('pro', 'ALL', [['plan', 'EQUAL', 'pro']], fs('x', true, 'p', 1))];
    expect(kinds(doc(fs('x', false, null), some))).toEqual([]);
  });
});

describe('redundant overrides', () => {
  it('finds an override that serves the same as the environment default', () => {
    const d = doc(fs('banner', true, 'Black Friday'), [seg('uk', 'ALL', [['country', 'EQUAL', 'GB']], fs('banner', true, 'Black Friday', 0))]);
    expect(analyseRules(d)).toEqual([expect.objectContaining({ kind: 'redundant', segment: 'uk' })]);
  });

  it('is not redundant when its users would otherwise fall to a different lower override', () => {
    const d = doc(fs('banner', true, 'Hi'), [
      seg('uk', 'ALL', [['country', 'EQUAL', 'GB']], fs('banner', true, 'Hi', 0)),
      seg('europe', 'ALL', [['country', 'IN', 'GB,DE']], fs('banner', true, 'Hallo', 1)),
    ]);
    expect(kinds(d)).toEqual([]);
  });

  it('never calls a multivariate split redundant', () => {
    const mv = fs('c', true, 'blue', 0);
    mv.multivariate_feature_state_values = [{ id: 1, percentage_allocation: 50, multivariate_feature_option: { value: 'green' } }];
    expect(kinds(doc(fs('c', true, 'blue'), [seg('s', 'ALL', [['plan', 'EQUAL', 'pro']], mv)]))).toEqual([]);
  });
});

describe('segments that match nobody, and unreachable defaults', () => {
  it('finds contradictory rules', () => {
    const d = doc(fs('x', false, null), [seg('impossible', 'ALL', [['plan', 'EQUAL', 'pro'], ['plan', 'IS_NOT_SET', null]], fs('x', true, null, 0))]);
    expect(kinds(d)).toEqual(['matches-nobody:impossible']);
    const range = doc(fs('x', false, null), [seg('void', 'ALL', [['age', 'GREATER_THAN', '50'], ['age', 'LESS_THAN', '18']], fs('x', true, null, 0))]);
    expect(kinds(range)).toEqual(['matches-nobody:void']);
  });

  it('finds a default nobody gets', () => {
    const d = doc(fs('x', false, null), [seg('all', 'ANY', [['plan', 'IS_SET', null], ['plan', 'IS_NOT_SET', null]], fs('x', true, null, 0))]);
    expect(kinds(d)).toEqual(['default-unreachable:-']);
  });

  it('respects NONE rules', () => {
    const d = doc(fs('x', false, null), [
      seg('not_free', 'NONE', [['plan', 'EQUAL', 'free']], fs('x', true, null, 0)),
      seg('free', 'ALL', [['plan', 'EQUAL', 'free']], fs('x', true, 'f', 1)),
    ]);
    // Together they cover everyone, and neither shadows the other.
    expect(kinds(d)).toEqual(['default-unreachable:-']);
  });

  it('accounts for type casting: a boolean trait true EQUALs any value except "false"', () => {
    // The engines cast the condition value to the trait's type, so plan=true (a boolean) matches EQUAL "pro" AND
    // EQUAL "free". Without boolean representatives this would be wrongly reported as matching nobody.
    const d = doc(fs('x', false, null), [seg('looks_impossible', 'ALL', [['plan', 'EQUAL', 'pro'], ['plan', 'EQUAL', 'free']], fs('x', true, null, 0))]);
    expect(kinds(d)).toEqual([]);
  });

  it('is clean for well-formed overrides', () => {
    const d = doc(fs('x', false, null), [seg('beta', 'ANY', [['email', 'REGEX', '.*@shop\\.dev$']], fs('x', true, null, 0))]);
    expect(analyseRules(d)).toEqual([]);
  });
});

describe('soundness (randomised): every finding holds for thousands of random users, checked with the engine', async () => {
  const { evaluateFlags, matchingSegments } = await import('../src/core/engine');
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const CONDS: Cond[] = [
    ['plan', 'EQUAL', 'pro'],
    ['plan', 'EQUAL', 'free'],
    ['plan', 'NOT_EQUAL', 'free'],
    ['plan', 'IN', 'pro,team'],
    ['plan', 'IS_SET', null],
    ['plan', 'IS_NOT_SET', null],
    ['country', 'EQUAL', 'GB'],
    ['country', 'IN', 'GB,DE,FR'],
    ['age', 'GREATER_THAN', '30'],
    ['age', 'LESS_THAN_INCLUSIVE', '40'],
    ['age', 'GREATER_THAN_INCLUSIVE', '18'],
    ['email', 'REGEX', '.*@shop\\.dev$'],
    ['email', 'CONTAINS', 'shop'],
    [null, 'PERCENTAGE_SPLIT', '30'],
  ];
  const TRAIT_VALUES: Record<string, unknown[]> = {
    plan: [undefined, 'pro', 'free', 'team', 'x', true, false, 3],
    country: [undefined, 'GB', 'DE', 'US', 'gb'],
    age: [undefined, 10, 18, 30, 31, 40, 41, 99, '35', 'old'],
    email: [undefined, 'a@shop.dev', 'b@other.com', 'shop@x.io'],
  };
  const values = ['a', 'b', null];

  it('holds for 150 random rule sets', () => {
    let findings = 0;
    for (let round = 0; round < 150; round++) {
      const n = 2 + Math.floor(rand() * 3);
      const segments = Array.from({ length: n }, (_, i) =>
        seg(`s${i}`, pick(['ALL', 'ANY', 'NONE'] as const), Array.from({ length: 1 + Math.floor(rand() * 2) }, () => pick(CONDS)), fs('x', rand() < 0.5, pick(values), Math.floor(rand() * 4))),
      );
      const d = doc(fs('x', rand() < 0.5, pick(values)), segments);
      const users = Array.from({ length: 1500 }, (_, i) => {
        const traits: Record<string, string | number | boolean | null> = {};
        for (const [k, vs] of Object.entries(TRAIT_VALUES)) {
          const v = pick(vs);
          if (v !== undefined) traits[k] = v as string | number | boolean;
        }
        return { identifier: `u${round}-${i}`, traits };
      });
      for (const f of analyseRules(d)) {
        findings++;
        for (const u of users) {
          const got = evaluateFlags(d, u).get('x')!;
          if (f.kind === 'shadowed') expect(got.reason).not.toEqual(expect.objectContaining({ segment: f.segment }));
          if (f.kind === 'matches-nobody') expect(matchingSegments(d, u).map((s) => s.name)).not.toContain(f.segment);
          if (f.kind === 'default-unreachable') expect(got.reason.kind).toBe('segment');
          if (f.kind === 'redundant') {
            const without = { ...d, project: { segments: d.project.segments.filter((s) => s.name !== f.segment) } };
            const alt = evaluateFlags(without, u).get('x')!;
            expect([alt.enabled, alt.value]).toEqual([got.enabled, got.value]);
          }
        }
      }
    }
    expect(findings).toBeGreaterThan(20); // the generator does produce anomalies to check
  }, 60_000); // ~200 000 engine evaluations: give slow CI machines room
});
