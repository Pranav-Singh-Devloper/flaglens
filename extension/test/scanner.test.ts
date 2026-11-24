import { describe, expect, it } from 'vitest';
import { compilePatterns, DEFAULT_EXTRA_PATTERNS, findFlagReferences, flagCallPrefix } from '../src/core/scanner';

const keys = (text: string, extraPatterns: string[] = []) => findFlagReferences(text, { extraPatterns }).map((r) => r.key);

describe('findFlagReferences: official Code References pattern', () => {
  it.each([
    ['JavaScript client', `if (flagsmith.hasFeature('new_checkout')) {}`],
    ['Node SDK', `flags.isFeatureEnabled("new_checkout")`],
    ['Node SDK value', `const v = flags.getFeatureValue('new_checkout');`],
    ['Python', `if flags.is_feature_enabled("new_checkout"):`],
    ['Python value', `flags.get_feature_value('new_checkout')`],
    ['Go', `enabled, _ := flags.IsFeatureEnabled("new_checkout")`],
    ['Java', `boolean on = flags.isFeatureEnabled("new_checkout");`],
    ['Kotlin', `val on = flagsmith.hasFeatureFlag("new_checkout")`],
    ['Dart', `final on = await flagsmithClient.hasFeatureFlag('new_checkout');`],
    ['Ruby', `flags.is_feature_enabled('new_checkout')`],
    ['C#', `var on = await flags.IsFeatureEnabled("new_checkout");`],
    ['generic getFlag', `flags.getFlag("new_checkout")`],
    ['experiment flag', `flagsmith.get_experiment_flag("new_checkout", identifier=user)`],
    ['spaces inside call', `isFeatureEnabled(   'new_checkout' )`],
  ])('%s', (_name, code) => {
    expect(keys(code)).toEqual(['new_checkout']);
  });

  it('is case-insensitive on the call name like the official scanner', () => {
    expect(keys(`HASFEATURE("a") ; Is_Feature_Enabled('b')`)).toEqual(['a', 'b']);
  });

  it('finds a key on the line after the call (two-line window)', () => {
    const refs = findFlagReferences(`flags.isFeatureEnabled(\n    "new_checkout"\n)`);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ key: 'new_checkout', line: 1, startCol: 5, endCol: 17 });
  });

  it('does not reach beyond two lines', () => {
    expect(keys(`isFeatureEnabled(\n\n  "too_far")`)).toEqual([]);
  });

  it.each([
    ['assignment, not a call', `const featureFlagsEnabled = "x";`],
    ['mismatched quotes', `isFeatureEnabled("x')`],
    ['variable argument', `isFeatureEnabled(name)`],
    ['template literal', 'isFeatureEnabled(`x`)'],
    ['dot between word and paren', `flagsmith.getValue('x')`],
    ['array argument', `useFlags(['x'])`],
    ['unrelated call', `console.log("feature")`],
  ])('no false positive: %s', (_name, code) => {
    expect(keys(code)).toEqual([]);
  });

  it('reports every reference with exact positions', () => {
    const text = `a\n  if (hasFeature('one') && hasFeature("two")) {}`;
    const refs = findFlagReferences(text);
    expect(refs.map((r) => [r.key, r.line, r.startCol, r.endCol])).toEqual([
      ['one', 1, 18, 21],
      ['two', 1, 39, 42],
    ]);
    expect(text.slice(refs[0]!.offset, refs[0]!.offset + 3)).toBe('one');
  });

  it('handles CRLF line endings', () => {
    const refs = findFlagReferences(`x\r\nhasFeature(\r\n 'k')`);
    expect(refs[0]).toMatchObject({ key: 'k', line: 2, startCol: 2 });
  });
});

describe('findFlagReferences: extra patterns', () => {
  it('default extras catch flagsmith.getValue and React useFlags', () => {
    expect(keys(`flagsmith.getValue('banner_text')`, DEFAULT_EXTRA_PATTERNS)).toEqual(['banner_text']);
    expect(keys(`const f = useFlags(['dark_mode', "new_checkout"], ['plan']);`, DEFAULT_EXTRA_PATTERNS)).toEqual([
      'dark_mode',
      'new_checkout',
    ]);
  });

  it('marks extra matches and de-duplicates overlaps with the official pattern', () => {
    const refs = findFlagReferences(`flagsmith.hasFeature('x')`, { extraPatterns: DEFAULT_EXTRA_PATTERNS });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.extra).toBe(false);
    expect(findFlagReferences(`flagsmith.getValue('y')`, { extraPatterns: DEFAULT_EXTRA_PATTERNS })[0]!.extra).toBe(true);
  });

  it('reports invalid user patterns instead of throwing', () => {
    const compiled = compilePatterns(['(unclosed', 'noKeyGroup\\(', String.raw`toggle\("(?<key>\w+)"\)`]);
    expect(compiled.errors).toHaveLength(2);
    expect(findFlagReferences(`toggle("custom")`, compiled).map((r) => r.key)).toEqual(['custom']);
  });

  it('survives zero-width user patterns', () => {
    expect(() => findFlagReferences('abc', { extraPatterns: ['(?<key>)'] })).not.toThrow();
  });
});

describe('flagCallPrefix (autocomplete)', () => {
  it('detects the cursor inside a flag call', () => {
    expect(flagCallPrefix(`if (flags.isFeatureEnabled("new_ch`)).toEqual({ quote: '"', partial: 'new_ch' });
    expect(flagCallPrefix(`flagsmith.getValue('`)).toEqual({ quote: "'", partial: '' });
    expect(flagCallPrefix(`useFlags(['a', '`)).toEqual({ quote: "'", partial: '' });
  });
  it('ignores other strings', () => {
    expect(flagCallPrefix(`console.log("new_ch`)).toBeUndefined();
    expect(flagCallPrefix(`isFeatureEnabled("done") + "`)).toBeUndefined();
  });
});
