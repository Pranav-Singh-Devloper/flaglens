import { describe, expect, it } from 'vitest';
import { checkMarkdown, runCheck } from '../src/cli/check';
import type { DocFeatureState, EnvironmentDocument } from '../src/core/engine';

const fs = (name: string, enabled: boolean, value: DocFeatureState['feature_state_value'], priority: number | null = null): DocFeatureState => ({
  feature: { id: 1, name, type: 'STANDARD' },
  enabled,
  django_id: Math.floor(Math.random() * 1e6),
  featurestate_uuid: 'u',
  feature_state_value: value,
  feature_segment: priority === null ? null : { priority },
  multivariate_feature_state_values: [],
});
const seg = (id: number, name: string, conds: [string, string, string][], override: DocFeatureState) => ({
  id,
  name,
  rules: [{ type: 'ALL', conditions: [], rules: [{ type: 'ALL', rules: [], conditions: conds.map(([property_, operator, value]) => ({ property_, operator, value })) }] }],
  feature_states: [override],
});
// The demo's deliberate mistake: pro_eu is caught first by pro_plan.
const production: EnvironmentDocument = {
  api_key: 'k',
  name: 'Production',
  feature_states: [fs('rate_limit_per_minute', true, 50)],
  project: {
    segments: [
      seg(1, 'pro_plan', [['plan', 'EQUAL', 'pro']], fs('rate_limit_per_minute', true, 500, 1)),
      seg(2, 'pro_eu', [['plan', 'EQUAL', 'pro'], ['country', 'IN', 'DE,FR,GB']], fs('rate_limit_per_minute', true, 800, 4)),
    ],
  },
  identity_overrides: [],
};

const input = {
  project: 'Demo Shop',
  flags: [
    { name: 'new_checkout', archived: false },
    { name: 'rate_limit_per_minute', archived: false },
    { name: 'legacy_search', archived: true },
    { name: 'dark_mode', archived: false },
  ],
  documents: [production],
  files: [
    { path: 'server.mjs', text: "if (flags.isFeatureEnabled('new_checkout')) {}\nconst r = flags.getFeatureValue('rate_limit_per_minute');\nflags.isFeatureEnabled('legacy_search');" },
    { path: 'typo.ts', text: "\n\nif (flags.isFeatureEnabled('new_chekout')) {}" },
  ],
};

describe('flaglens check', () => {
  const r = runCheck(input);

  it('finds unknown keys (with a suggestion), archived flags in code, rule findings and unused flags', () => {
    expect(r.references).toBe(4);
    expect(r.unknown).toEqual([{ path: 'typo.ts', line: 3, key: 'new_chekout', suggestion: 'new_checkout' }]);
    expect(r.archived).toEqual([{ path: 'server.mjs', line: 3, key: 'legacy_search' }]);
    expect(r.rules.map((f) => `${f.kind}:${f.segment}`)).toEqual(['shadowed:pro_eu']);
    expect(r.unused).toEqual(['dark_mode']);
    expect(r.problems).toBe(3);
  });

  it('renders a report with links, and says so when there is nothing to fix', () => {
    const md = checkMarkdown(r, (p, l) => `https://example.com/${p}#L${l}`);
    expect(md).toContain('**3 problems** in 4 flag references');
    expect(md).toContain('| [typo.ts:3](https://example.com/typo.ts#L3) | `new_chekout` | `new_checkout` |');
    expect(md).toContain('| `rate_limit_per_minute` | Production | Never applies (shadowed) |');
    expect(md).toContain('1 flag no file references');
    const clean = checkMarkdown(runCheck({ ...input, files: [input.files[0]!].map((f) => ({ ...f, text: f.text.split('\n')[0]! })), documents: [] }));
    expect(clean).toContain('**No problems** in 1 flag references');
  });
});
