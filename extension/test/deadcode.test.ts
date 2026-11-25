import { describe, expect, it } from 'vitest';
import { callKind, findDeadCode, type FlagFacts, type LanguageFamily } from '../src/core/deadcode';
import { findFlagReferences } from '../src/core/scanner';

const on: FlagFacts = { enabled: true, valueKnown: true, value: null };
const off: FlagFacts = { enabled: false, valueKnown: true, value: null };
const unknown: FlagFacts = { valueKnown: false };

/** The dead parts of `code`, as text, given facts per key. */
function dead(code: string, facts: Record<string, FlagFacts>, family: LanguageFamily = 'brace'): string[] {
  const refs = findFlagReferences(code);
  return findDeadCode(code, refs, family, (k) => facts[k]).map((r) => code.slice(r.start, r.end));
}

describe('if / else (brace languages)', () => {
  const code = `if (flags.isFeatureEnabled('x')) {\n  a();\n} else {\n  b();\n}`;

  it('greys the else branch when the flag is on, the if branch when off', () => {
    expect(dead(code, { x: on })).toEqual(['else {\n  b();\n}']);
    expect(dead(code, { x: off })).toEqual(['{\n  a();\n}']);
  });

  it('stays silent when the state differs between users', () => {
    expect(dead(code, { x: unknown })).toEqual([]);
  });

  it('handles negation and else-if chains', () => {
    const chain = `if (!flags.isFeatureEnabled('x')) { a(); } else if (y) { b(); } else { c(); }`;
    expect(dead(chain, { x: on })).toEqual(['{ a(); }']);
    expect(dead(chain, { x: off })).toEqual(['else if (y) { b(); } else { c(); }']);
  });

  it('uses three-valued logic with unknown operands', () => {
    const and = `if (isFeatureEnabled('x') && user.isAdmin()) { a(); }`;
    expect(dead(and, { x: off })).toEqual(['{ a(); }']); // false && ? = false
    expect(dead(and, { x: on })).toEqual([]); // true && ? = ?
    const or = `if (isFeatureEnabled('x') || user.isAdmin()) { a(); } else { b(); }`;
    expect(dead(or, { x: on })).toEqual(['else { b(); }']); // true || ? = true
    expect(dead(or, { x: off })).toEqual([]);
  });

  it('combines several flags in one condition', () => {
    const both = `if (isFeatureEnabled('a') && !isFeatureEnabled('b')) { go(); }`;
    expect(dead(both, { a: on, b: on })).toEqual(['{ go(); }']);
    expect(dead(both, { a: on, b: off })).toEqual([]);
  });

  it('compares values', () => {
    const v = `if (flags.getFeatureValue('color') === 'green') { g(); } else { o(); }`;
    expect(dead(v, { color: { enabled: true, valueKnown: true, value: 'green' } })).toEqual(['else { o(); }']);
    expect(dead(v, { color: { enabled: true, valueKnown: true, value: 'blue' } })).toEqual(['{ g(); }']);
    expect(dead(v, { color: { enabled: true, valueKnown: false } })).toEqual([]);
  });

  it('supports single statements without braces', () => {
    expect(dead(`if (isFeatureEnabled('x')) a(); else b();`, { x: on })).toEqual(['else b();']);
  });

  it('greys the rest of the block after a guard that returns', () => {
    const guard = `function render() {\n  if (flags.isFeatureEnabled('m')) {\n    return page();\n  }\n  const x = 1;\n  return x;\n}`;
    expect(dead(guard, { m: on })).toEqual(['const x = 1;\n  return x;']);
    expect(dead(guard, { m: off })).toEqual(['{\n    return page();\n  }']);
  });

  it('ignores flag calls in comments and strings', () => {
    expect(dead(`// if (isFeatureEnabled('x')) { a(); }\nconst s = "isFeatureEnabled('x')";`, { x: off })).toEqual([]);
  });

  it('gives up on expressions it does not understand', () => {
    expect(dead(`if (isFeatureEnabled('x') + 1) { a(); }`, { x: off })).toEqual([]);
  });
});

describe('ternaries and aliases', () => {
  it('greys the losing side of a ternary', () => {
    expect(dead(`const t = isFeatureEnabled('d') ? 'dark' : 'light';`, { d: on })).toEqual(["'light'"]);
    expect(dead(`const t = (isFeatureEnabled('d') ? 'dark' : 'light');`, { d: off })).toEqual(["'dark'"]);
  });

  it('follows a const alias into ifs and template-literal ternaries', () => {
    const code = [
      'async function render() {',
      "  const newCheckout = flags.isFeatureEnabled('nc');",
      "  const html = `<p class=\"${newCheckout ? 'new' : 'old'}\">`;",
      '  if (newCheckout) { fast(); }',
      '}',
    ].join('\n');
    expect(dead(code, { nc: off })).toEqual(["'new'", '{ fast(); }']);
    expect(dead(code, { nc: on })).toEqual(["'old'"]);
  });

  it('does not grey an empty fallback', () => {
    expect(dead("const b = `${flags.getFeatureValue('t') ? 'x' : ''}`;", { t: { enabled: true, valueKnown: true, value: 'hi' } })).toEqual([]);
  });

  it('follows `value ?? fallback`', () => {
    const code = "const c = flags.getFeatureValue('c') ?? 'blue';\nif (c === 'blue') { b(); } else { o(); }";
    expect(dead(code, { c: { enabled: true, valueKnown: true, value: null } })).toEqual(['else { o(); }']);
  });

  it('drops an alias that is reassigned', () => {
    const code = "let x = isFeatureEnabled('x');\nx = other();\nif (x) { a(); }";
    expect(dead(code, { x: off })).toEqual([]);
  });

  it('handles multi-line ternaries inside a template literal', () => {
    const code = "function f() {\n  const on = isFeatureEnabled('n');\n  return `${\n    on\n      ? `<h3>new</h3>`\n      : `<h3>old</h3>`\n  }`;\n}";
    expect(dead(code, { n: on })).toEqual(['`<h3>old</h3>`']);
  });
});

describe('Python', () => {
  const py = [
    'def send():',
    '    if flags.is_feature_enabled("maint"):',
    '        print("maintenance")',
    '        return',
    '',
    '    limit = 5',
    '    if not flags.is_feature_enabled("nc"):',
    '        old()',
    '    else:',
    '        new()',
    '',
    'send()',
  ].join('\n');

  it('greys if/else blocks by indentation', () => {
    expect(dead(py, { maint: off, nc: on }, 'python')).toEqual(['print("maintenance")\n        return', 'old()']);
    expect(dead(py, { maint: off, nc: off }, 'python')).toEqual(['print("maintenance")\n        return', 'else:\n        new()']);
  });

  it('greys the rest of the function after a guard that returns', () => {
    const [rest] = dead(py, { maint: on, nc: unknown }, 'python');
    expect(rest).toMatch(/^limit = 5[\s\S]*new\(\)$/);
    expect(rest).not.toContain('send()\n');
  });

  it('uses Python truthiness and keywords', () => {
    const v = 'if flags.get_feature_value("t") is None and x:\n    a()\n';
    expect(dead(v, { t: { enabled: true, valueKnown: true, value: 'hi' } }, 'python')).toEqual(['a()']);
  });
});

describe('callKind', () => {
  it.each([
    ['isFeatureEnabled', 'enabled'],
    ['is_feature_enabled', 'enabled'],
    ['hasFeature', 'enabled'],
    ['IsFeatureEnabled', 'enabled'],
    ['getFeatureValue', 'value'],
    ['get_feature_value', 'value'],
    ['getValue', 'value'],
    ['getFlag', undefined],
    ['useFlags', undefined],
  ])('%s → %s', (method, kind) => {
    expect(callKind(method)).toBe(kind);
  });
});
