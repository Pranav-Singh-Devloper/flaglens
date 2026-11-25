// Finds code that cannot run given the current flag states, so the editor can grey it out, the way C/C++ editors
// grey out an inactive `#ifdef`. Pure: no VS Code imports.
//
// Recognised shapes (JS/TS and other brace languages, and Python):
//
//   if (flags.isFeatureEnabled('x')) { A } else { B }        A or B is dead
//   if (!isOn('x') && user.isAdmin) { A }                     dead only when the result is certain (see below)
//   if flags.is_feature_enabled("x"): A  else: B              Python, by indentation
//   if (isOn('maintenance')) { return page(); }  REST          when the guard is on, the rest of the block is dead
//   isOn('x') ? A : B                                         ternaries, also inside template literals
//   const x = flags.isFeatureEnabled('x');  … if (x) / x ? :  simple aliases in the same block
//
// Conditions are evaluated with three-valued (Kleene) logic: anything FlagLens can't know (a variable, a function
// call) is "unknown", `unknown && false` is false, `unknown || true` is true, and every other mix stays unknown.
// Code is only reported dead when the condition is certainly true or certainly false. When in doubt, nothing is greyed.

import type { FlagValue } from '../api/types';
import type { FlagReference } from './scanner';

export type LanguageFamily = 'brace' | 'python';

const BRACE_LANGUAGES = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'vue',
  'svelte',
  'java',
  'kotlin',
  'go',
  'csharp',
  'c',
  'cpp',
  'php',
  'swift',
  'dart',
  'scala',
  'groovy',
  'rust',
]);

export function languageFamily(languageId: string): LanguageFamily | undefined {
  if (languageId === 'python') return 'python';
  return BRACE_LANGUAGES.has(languageId) ? 'brace' : undefined;
}

/** What is known about one flag in the environment (and for the persona) being previewed. */
export interface FlagFacts {
  /** undefined when it differs between users (segment or identity overrides) or is unknown. */
  enabled?: boolean;
  /** Only meaningful when valueKnown is true. */
  value?: FlagValue;
  valueKnown: boolean;
}

export interface DeadRange {
  /** Offsets into the text, [start, end). */
  start: number;
  end: number;
  /** Which part is dead: the if-branch, the else-branch, or the rest of the block after a guard that returns. */
  branch: 'then' | 'else' | 'rest';
  /** Flags in the deciding condition. */
  keys: string[];
}

// --- lexing ------------------------------------------------------------------------------------------------------

const CODE = 0;
const STRING = 1;
const COMMENT = 2;

/** Marks every character as code, string or comment. Template literals' `${…}` parts are code. */
export function lex(text: string, family: LanguageFamily): Uint8Array {
  const mask = new Uint8Array(text.length);
  const n = text.length;
  let i = 0;
  const templateDepths: number[] = [];
  let inTemplate = false;

  const fill = (from: number, to: number, kind: number) => mask.fill(kind, from, Math.min(to, n));

  while (i < n) {
    const c = text[i]!;
    const next = text[i + 1];
    if (inTemplate) {
      if (c === '\\') {
        fill(i, i + 2, STRING);
        i += 2;
      } else if (c === '`') {
        mask[i] = STRING;
        inTemplate = false;
        i++;
      } else if (c === '$' && next === '{') {
        // The braces of ${…} count as code, so bracket matching stays balanced across the expression.
        mask[i] = STRING;
        templateDepths.push(0);
        inTemplate = false;
        i += 2; // the `{` stays CODE (the mask default)
      } else {
        mask[i] = STRING;
        i++;
      }
      continue;
    }
    if (family === 'python' && c === '#') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      fill(i, stop, COMMENT);
      i = stop;
      continue;
    }
    if (family === 'brace' && c === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      fill(i, stop, COMMENT);
      i = stop;
      continue;
    }
    if (family === 'brace' && c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      fill(i, stop, COMMENT);
      i = stop;
      continue;
    }
    if (family === 'python' && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const quote = text.slice(i, i + 3);
      const end = text.indexOf(quote, i + 3);
      const stop = end === -1 ? n : end + 3;
      fill(i, stop, STRING);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      fill(i, j + 1, STRING);
      i = j + 1;
      continue;
    }
    if (family === 'brace' && c === '`') {
      mask[i] = STRING;
      inTemplate = true;
      i++;
      continue;
    }
    if (templateDepths.length) {
      if (c === '{') templateDepths[templateDepths.length - 1]!++;
      else if (c === '}') {
        if (templateDepths[templateDepths.length - 1] === 0) {
          templateDepths.pop();
          inTemplate = true;
          i++;
          continue;
        }
        templateDepths[templateDepths.length - 1]!--;
      }
    }
    i++;
  }
  return mask;
}

// --- small scanning helpers --------------------------------------------------------------------------------------

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set([')', ']', '}']);
const isIdent = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);

class Source {
  readonly n: number;
  constructor(
    readonly text: string,
    readonly mask: Uint8Array,
    readonly family: LanguageFamily,
  ) {
    this.n = text.length;
  }

  code(i: number): boolean {
    return i >= 0 && i < this.n && this.mask[i] === CODE;
  }

  /** Next index ≥ i that is not whitespace or comment (strings count as content). */
  trimForward(i: number): number {
    while (i < this.n && (this.mask[i] === COMMENT || (this.mask[i] === CODE && /\s/.test(this.text[i]!)))) i++;
    return i;
  }

  /** Previous index ≤ i that is not whitespace or comment. */
  trimBack(i: number): number {
    while (i >= 0 && (this.mask[i] === COMMENT || (this.mask[i] === CODE && /\s/.test(this.text[i]!)))) i--;
    return i;
  }

  /** Index just after the bracket matching the one at `open`, or -1. */
  matchForward(open: number): number {
    const stack: string[] = [];
    for (let i = open; i < this.n; i++) {
      if (!this.code(i)) continue;
      const c = this.text[i]!;
      if (OPEN[c]) stack.push(OPEN[c]!);
      else if (CLOSE.has(c)) {
        if (stack.pop() !== c) return -1;
        if (stack.length === 0) return i + 1;
      }
    }
    return -1;
  }

  wordAt(i: number, word: string): boolean {
    return this.text.startsWith(word, i) && !isIdent(this.text[i - 1]) && !isIdent(this.text[i + word.length]) && this.code(i);
  }

  /** The word ending at index i (inclusive), e.g. "if" in "} else if". */
  wordEndingAt(i: number): string {
    let s = i;
    while (s >= 0 && isIdent(this.text[s])) s--;
    return this.text.slice(s + 1, i + 1);
  }

  lineStart(i: number): number {
    return this.text.lastIndexOf('\n', i - 1) + 1;
  }

  lineEnd(i: number): number {
    const e = this.text.indexOf('\n', i);
    return e === -1 ? this.n : e;
  }
}

// --- atoms: flag calls and their aliases -------------------------------------------------------------------------

interface Atom {
  start: number;
  end: number;
  key: string;
  /** undefined = unknown */
  known: boolean;
  value: FlagValue | undefined;
}

type CallKind = 'enabled' | 'value';

/** isFeatureEnabled / is_feature_enabled / hasFeature → enabled; getValue / getFeatureValue / get_feature_value → value. */
export function callKind(method: string): CallKind | undefined {
  const m = method.toLowerCase();
  if (m.includes('value')) return 'value';
  if (/enabled|^has|isfeature|is_feature|^isflag|^isenabled/.test(m)) return 'enabled';
  return undefined;
}

function atomFor(src: Source, ref: FlagReference, facts: (key: string) => FlagFacts | undefined): Atom | undefined {
  const { text } = src;
  const quote = ref.offset - 1;
  const paren = src.trimBack(quote - 1);
  if (text[paren] !== '(' || text.slice(paren + 1, quote).trim() !== '') return undefined;
  let nameStart = paren;
  while (nameStart > 0 && isIdent(text[nameStart - 1])) nameStart--;
  const method = text.slice(nameStart, paren);
  const kind = callKind(method);
  if (!kind) return undefined;
  // Walk the receiver chain back: flags.isFeatureEnabled, this.flagsmith.hasFeature, flags?.getFeatureValue …
  let start = nameStart;
  while (start > 0) {
    let j = start - 1;
    if (text[j] === '.' && text[j - 1] === '?') j--;
    if (text[j] !== '.' && !(text[j] === '?' && text[j + 1] === '.')) break;
    let k = j;
    while (k > 0 && isIdent(text[k - 1])) k--;
    if (k === j) break;
    start = k;
  }
  const end = src.matchForward(paren);
  if (end === -1) return undefined;
  const f = facts(ref.key);
  if (!f) return { start, end, key: ref.key, known: false, value: undefined };
  if (kind === 'enabled') return { start, end, key: ref.key, known: f.enabled !== undefined, value: f.enabled };
  return { start, end, key: ref.key, known: f.valueKnown, value: f.valueKnown ? (f.value ?? null) : undefined };
}

/** `const x = <atom>;` (or `let`, `var`, Go's `x :=`, Python's `x = …`) → occurrences of x in the same block. */
function aliasesOf(src: Source, atom: Atom): Atom[] {
  const { text } = src;
  let before = src.trimBack(atom.start - 1);
  if (src.wordEndingAt(before) === 'await') before = src.trimBack(before - 5);
  if (text[before] !== '=' || /[=!<>]/.test(text[before - 1] ?? '')) return [];
  let nameEnd = src.trimBack(before - (text[before - 1] === ':' ? 2 : 1));
  if (text[nameEnd] === ':') nameEnd = src.trimBack(nameEnd - 1); // TypeScript annotation: const x: boolean = …
  const name = src.wordEndingAt(nameEnd);
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return [];
  const declStart = nameEnd - name.length + 1;
  if (src.family === 'brace' && text[before - 1] !== ':') {
    const kw = src.wordEndingAt(src.trimBack(declStart - 1));
    if (!['const', 'let', 'var', 'val'].includes(kw)) return [];
  }
  if (src.family === 'python' && text.slice(src.lineStart(declStart), declStart).trim() !== '') return [];

  // What does the variable hold? The call itself, or `call ?? literal`.
  const isKnown = atom.known;
  let value = atom.value;
  const after = src.trimForward(atom.end);
  if (text.startsWith('??', after)) {
    const lit = /^\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)|(true|false))\s*[;\n]/.exec(text.slice(after + 2, after + 200));
    if (!lit) return [];
    if (isKnown && (value === null || value === undefined)) value = lit[1] ?? lit[2] ?? (lit[3] !== undefined ? Number(lit[3]) : lit[4] === 'true');
  } else if (after < src.n && text[after] !== ';' && !text.slice(atom.end, after).includes('\n')) {
    return [];
  }

  // Scope: to the end of the enclosing block (brace) or the end of the indented block (Python).
  let scopeEnd = src.n;
  if (src.family === 'brace') {
    let depth = 0;
    for (let i = atom.end; i < src.n; i++) {
      if (!src.code(i)) continue;
      const c = text[i]!;
      if (OPEN[c]) depth++;
      else if (CLOSE.has(c) && --depth < 0) {
        scopeEnd = i;
        break;
      }
    }
  } else {
    const indent = indentOf(text, src.lineStart(declStart));
    scopeEnd = pythonBlockEnd(text, src.lineEnd(atom.end) + 1, indent - 1);
  }

  const out: Atom[] = [];
  const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
  re.lastIndex = atom.end;
  for (let m = re.exec(text); m && m.index < scopeEnd; m = re.exec(text)) {
    if (!src.code(m.index)) continue;
    const next = src.trimForward(m.index + name.length);
    // Reassigned later? Then we can't be sure what it holds: drop the alias entirely.
    if (text[next] === '=' && text[next + 1] !== '=' && text[next + 1] !== '>') return [];
    if (/^(?:\+\+|--|[+\-*/|&]=)/.test(text.slice(next, next + 2))) return [];
    out.push({ start: m.index, end: m.index + name.length, key: atom.key, known: isKnown, value });
  }
  return out;
}

// --- three-valued condition evaluation ---------------------------------------------------------------------------

/** A value that may be unknown; `truthy` can be known even when the value isn't (unknown || true). */
interface V {
  known: boolean;
  v?: unknown;
  truthy?: boolean;
}

const UNKNOWN: V = { known: false };
const known = (v: unknown, family: LanguageFamily): V => ({ known: true, v, truthy: isTruthy(v, family) });

function isTruthy(v: unknown, family: LanguageFamily): boolean {
  if (family === 'python') return !(v === false || v === null || v === undefined || v === 0 || v === '');
  return !!v;
}

type Tok = { t: 'val'; v: V } | { t: 'op'; v: string } | { t: '(' } | { t: ')' };

/** Tokenizes a condition. Atoms become known/unknown values; other operands become unknown. undefined = give up. */
function tokenize(src: Source, from: number, to: number, atoms: Atom[]): Tok[] | undefined {
  const { text, family } = src;
  const out: Tok[] = [];
  let i = from;
  const sorted = atoms.filter((a) => a.start >= from && a.end <= to).sort((a, b) => a.start - b.start);
  while (i < to) {
    const c = text[i]!;
    if (!src.code(i) && src.mask[i] === COMMENT) {
      i++;
      continue;
    }
    const atom = sorted.find((a) => a.start === i);
    if (atom) {
      out.push({ t: 'val', v: atom.known ? known(atom.value, family) : UNKNOWN });
      i = atom.end;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.mask[i] === STRING) {
      let j = i;
      while (j < to && src.mask[j] === STRING) j++;
      const raw = text.slice(i, j);
      const m = /^[rbuf]*(['"`])([\s\S]*)\1$/i.exec(raw);
      out.push({ t: 'val', v: m && !raw.includes('${') ? known(m[2], family) : UNKNOWN });
      i = j;
      continue;
    }
    const op = /^(?:===|!==|==|!=|<=|>=|&&|\|\||\?\?|[<>!()])/.exec(text.slice(i, i + 3))?.[0];
    if (op === '(') {
      out.push({ t: '(' });
      i++;
      continue;
    }
    if (op === ')') {
      out.push({ t: ')' });
      i++;
      continue;
    }
    if (op) {
      out.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    const num = /^-?\d+(?:\.\d+)?/.exec(text.slice(i, i + 32))?.[0];
    if (num && !isIdent(text[i - 1])) {
      out.push({ t: 'val', v: known(Number(num), family) });
      i += num.length;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 200))?.[0];
    if (word) {
      const lit: Record<string, unknown> =
        family === 'python' ? { True: true, False: false, None: null } : { true: true, false: false, null: null, undefined: undefined };
      if (word in lit) {
        out.push({ t: 'val', v: known(lit[word], family) });
        i += word.length;
        continue;
      }
      if (family === 'python' && ['and', 'or', 'not', 'is'].includes(word)) {
        if (word === 'is' && /^is\s+not\b/.test(text.slice(i, i + 20))) {
          out.push({ t: 'op', v: 'is not' });
          i = i + (/^is\s+not/.exec(text.slice(i))![0].length);
          continue;
        }
        out.push({ t: 'op', v: word });
        i += word.length;
        continue;
      }
      // An opaque operand: a.b.c, a?.b, f(x), a[0] … all unknown. Atoms inside it are swallowed (still unknown).
      let j = i + word.length;
      for (;;) {
        const k = j;
        if (text[j] === '?' && text[j + 1] === '.') j += 2;
        else if (text[j] === '.') j++;
        if (j !== k) {
          const w = /^[A-Za-z_$][\w$]*/.exec(text.slice(j, j + 200))?.[0];
          if (!w) return undefined;
          j += w.length;
          continue;
        }
        if (text[j] === '(' || text[j] === '[') {
          const e = src.matchForward(j);
          if (e === -1 || e > to) return undefined;
          j = e;
          continue;
        }
        break;
      }
      out.push({ t: 'val', v: UNKNOWN });
      i = j;
      continue;
    }
    return undefined; // arithmetic, assignment, lambdas…: too clever for us, so we stay silent
  }
  return out;
}

/** Recursive-descent parser over the tokens. Returns undefined when the expression isn't understood. */
function evaluate(tokens: Tok[], family: LanguageFamily): V | undefined {
  let p = 0;
  const peekOp = (...ops: string[]) => {
    const t = tokens[p];
    return t && t.t === 'op' && ops.includes(t.v) ? t.v : undefined;
  };
  const OR = family === 'python' ? ['or'] : ['||', '??'];
  const AND = family === 'python' ? ['and'] : ['&&'];
  const CMP = family === 'python' ? ['==', '!=', '<', '>', '<=', '>=', 'is', 'is not'] : ['===', '!==', '==', '!=', '<', '>', '<=', '>='];

  function or(): V | undefined {
    let a = and();
    for (let op = peekOp(...OR); a && op; op = peekOp(...OR)) {
      p++;
      const b = and();
      if (!b) return undefined;
      if (op === '??') a = a.known ? (a.v === null || a.v === undefined ? b : a) : UNKNOWN;
      else if (a.truthy === true) a = a.known ? a : { known: false, truthy: true };
      else if (a.truthy === false) a = b;
      else a = b.truthy === true ? { known: false, truthy: true } : UNKNOWN;
    }
    return a;
  }
  function and(): V | undefined {
    let a = not();
    for (let op = peekOp(...AND); a && op; op = peekOp(...AND)) {
      p++;
      const b = not();
      if (!b) return undefined;
      if (a.truthy === false) a = a.known ? a : { known: false, truthy: false };
      else if (a.truthy === true) a = b;
      else a = b.truthy === false ? { known: false, truthy: false } : UNKNOWN;
    }
    return a;
  }
  function not(): V | undefined {
    if (family === 'python' && peekOp('not')) {
      p++;
      const a = not();
      return a && negate(a);
    }
    return cmp();
  }
  function negate(a: V): V {
    return a.truthy === undefined ? UNKNOWN : known(!a.truthy, family);
  }
  function cmp(): V | undefined {
    const a = unary();
    const op = peekOp(...CMP);
    if (!a || !op) return a;
    p++;
    const b = unary();
    if (!b) return undefined;
    if (!a.known || !b.known) return UNKNOWN;
    const x = a.v as never;
    const y = b.v as never;
    switch (op) {
      case '===':
      case 'is':
        return known(x === y, family);
      case '!==':
      case 'is not':
        return known(x !== y, family);
      case '==':
        // eslint-disable-next-line eqeqeq -- JS loose equality is what the code under analysis does
        return known(family === 'python' ? x === y : x == y, family);
      case '!=':
        // eslint-disable-next-line eqeqeq
        return known(family === 'python' ? x !== y : x != y, family);
      case '<':
        return known(x < y, family);
      case '>':
        return known(x > y, family);
      case '<=':
        return known(x <= y, family);
      default:
        return known(x >= y, family);
    }
  }
  function unary(): V | undefined {
    if (family === 'brace' && peekOp('!')) {
      p++;
      const a = unary();
      return a && negate(a);
    }
    const t = tokens[p];
    if (!t) return undefined;
    if (t.t === 'val') {
      p++;
      return t.v;
    }
    if (t.t === '(') {
      p++;
      const a = or();
      if (tokens[p]?.t !== ')') return undefined;
      p++;
      return a;
    }
    return undefined;
  }

  const result = or();
  return p === tokens.length ? result : undefined;
}

// --- statement structure -----------------------------------------------------------------------------------------

interface IfShape {
  condFrom: number;
  condTo: number;
  then: [number, number];
  else?: [number, number];
  /** End of the whole if/else statement. */
  end: number;
  thenEndsWithExit: boolean;
  /** Python only: indentation of the `if`. */
  indent?: number;
}

/** The statement after `)` of an if: a {block} or a single statement up to `;`. */
function braceStatement(src: Source, from: number): [number, number] | undefined {
  const s = src.trimForward(from);
  if (s >= src.n) return undefined;
  if (src.text[s] === '{') {
    const e = src.matchForward(s);
    return e === -1 ? undefined : [s, e];
  }
  if (src.wordAt(s, 'if')) {
    const nested = braceIfAt(src, s);
    return nested ? [s, nested.end] : undefined;
  }
  let depth = 0;
  for (let i = s; i < src.n; i++) {
    if (!src.code(i)) continue;
    const c = src.text[i]!;
    if (OPEN[c]) depth++;
    else if (CLOSE.has(c)) {
      if (--depth < 0) return [s, i];
    } else if (c === ';' && depth === 0) return [s, i + 1];
    else if (c === '\n' && depth === 0 && i > s && src.family === 'brace' && !/[;{(,]$/.test(src.text.slice(s, i).trimEnd())) {
      // No semicolons (ASI): a single-line statement ends at the line break.
      if (!/^\s*[.?:+\-*/&|]/.test(src.text.slice(i + 1, i + 40))) return [s, i];
    }
  }
  return undefined;
}

/** Parses `if (cond) stmt [else stmt]` starting at the `if` keyword. */
function braceIfAt(src: Source, ifAt: number): IfShape | undefined {
  const open = src.trimForward(ifAt + 2);
  if (src.text[open] !== '(') return undefined;
  const close = src.matchForward(open);
  if (close === -1) return undefined;
  const then = braceStatement(src, close);
  if (!then) return undefined;
  let end = then[1];
  let elseRange: [number, number] | undefined;
  const k = src.trimForward(then[1]);
  if (src.wordAt(k, 'else')) {
    const stmt = braceStatement(src, k + 4);
    if (stmt) {
      elseRange = [k, stmt[1]];
      end = stmt[1];
    }
  }
  const body = src.text.slice(then[0], then[1]);
  const inner = body.startsWith('{') ? body.slice(1, -1) : body;
  const statements = stripComments(inner).trim().replace(/;\s*$/, '').split(/;\s*(?=\S)/);
  const last = statements[statements.length - 1]?.trim() ?? '';
  return { condFrom: open + 1, condTo: close - 1, then, else: elseRange, end, thenEndsWithExit: /^(return|throw)\b/.test(last) };
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function indentOf(text: string, lineStart: number): number {
  let i = lineStart;
  while (text[i] === ' ' || text[i] === '\t') i++;
  return i - lineStart;
}

/** First offset (a line start) at or after `from` whose non-blank line is indented ≤ `maxIndent`. */
function pythonBlockEnd(text: string, from: number, maxIndent: number): number {
  let i = from;
  let lastContentEnd = from;
  while (i < text.length) {
    const e = text.indexOf('\n', i);
    const lineEnd = e === -1 ? text.length : e;
    const line = text.slice(i, lineEnd);
    if (line.trim() !== '' && !line.trim().startsWith('#')) {
      if (indentOf(text, i) <= maxIndent) return lastContentEnd;
      lastContentEnd = lineEnd;
    }
    if (e === -1) break;
    i = e + 1;
  }
  return lastContentEnd;
}

/** Parses a Python `if`/`elif` line and its block, plus the rest of the elif/else chain. */
function pythonIfAt(src: Source, lineStart: number): IfShape | undefined {
  const { text } = src;
  const lineEnd = src.lineEnd(lineStart);
  const indent = indentOf(text, lineStart);
  const kw = /^(if|elif)\s+/.exec(text.slice(lineStart + indent, lineEnd));
  if (!kw) return undefined;
  // The condition ends at the last ':' that is code on this line.
  let colon = -1;
  for (let i = lineEnd - 1; i > lineStart; i--) {
    if (src.code(i) && text[i] === ':') {
      colon = i;
      break;
    }
    if (src.code(i) && !/\s/.test(text[i]!)) break;
  }
  if (colon === -1) return undefined;
  const bodyStart = lineEnd + 1;
  const thenEnd = pythonBlockEnd(text, bodyStart, indent);
  if (thenEnd <= bodyStart) return undefined;
  let end = thenEnd;
  let elseRange: [number, number] | undefined;
  // Following clauses at the same indentation: elif … / else:
  for (let i = thenEnd + 1; i < text.length; ) {
    const le = src.lineEnd(i);
    const line = text.slice(i, le);
    if (line.trim() === '') {
      i = le + 1;
      continue;
    }
    if (indentOf(text, i) !== indent || !/^\s*(elif\b|else\s*:)/.test(line)) break;
    const clauseEnd = pythonBlockEnd(text, le + 1, indent);
    elseRange = [elseRange?.[0] ?? i + indent, clauseEnd];
    end = clauseEnd;
    i = clauseEnd + 1;
  }
  const lastLine = text.slice(text.lastIndexOf('\n', thenEnd - 1) + 1, thenEnd).trim();
  return {
    condFrom: lineStart + indent + kw[0].length,
    condTo: colon,
    then: [bodyStart + indentOf(text, bodyStart), thenEnd],
    else: elseRange,
    end,
    thenEndsWithExit: /^(return|raise)\b/.test(lastLine),
    indent,
  };
}

/** Finds the `if` whose condition contains `pos`, by walking outwards through brackets. */
function enclosingBraceIf(src: Source, pos: number): number | undefined {
  let depth = 0;
  for (let i = pos - 1, steps = 0; i >= 0 && steps < 4000; i--, steps++) {
    if (!src.code(i)) continue;
    const c = src.text[i]!;
    if (CLOSE.has(c)) depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (c !== '(') return undefined; // reached a block or array: not inside a condition
      const before = src.trimBack(i - 1);
      if (src.wordEndingAt(before) === 'if') return before - 1;
    } else if (c === ';' && depth === 0) return undefined;
  }
  return undefined;
}

/** For `cond ? a : b` where cond is the atom (optionally negated), the two branches. */
function ternaryAround(src: Source, atom: Atom): { negated: boolean; a: [number, number]; b: [number, number] } | undefined {
  const { text } = src;
  const q = src.trimForward(atom.end);
  if (text[q] !== '?' || text[q + 1] === '.' || text[q + 1] === '?') return undefined;
  let before = src.trimBack(atom.start - 1);
  let negated = false;
  if (text[before] === '!' && text[before + 1] !== '=') {
    negated = true;
    before = src.trimBack(before - 1);
  }
  const prev = text[before];
  const okBefore = before < 0 || /[({[,=:?]/.test(prev ?? '') || src.wordEndingAt(before) === 'return' || (prev === '{' && text[before - 1] === '$');
  if (!okBefore || (prev === '=' && /[=!<>]/.test(text[before - 1] ?? ''))) return undefined;

  let depth = 0;
  let nest = 0;
  let colon = -1;
  for (let i = q + 1; i < src.n; i++) {
    if (!src.code(i)) continue;
    const c = text[i]!;
    if (OPEN[c]) depth++;
    else if (CLOSE.has(c)) {
      if (--depth < 0) return undefined;
    } else if (depth === 0 && c === '?' && text[i + 1] !== '.' && text[i + 1] !== '?' && text[i - 1] !== '?') nest++;
    else if (depth === 0 && c === ':') {
      if (nest === 0) {
        colon = i;
        break;
      }
      nest--;
    } else if (depth === 0 && c === ';') return undefined;
  }
  if (colon === -1) return undefined;
  depth = 0;
  let end = src.n;
  for (let i = colon + 1; i < src.n; i++) {
    if (!src.code(i)) continue;
    const c = text[i]!;
    if (OPEN[c]) depth++;
    else if (CLOSE.has(c)) {
      if (--depth < 0) {
        end = i;
        break;
      }
    } else if (depth === 0 && (c === ',' || c === ';')) {
      end = i;
      break;
    } else if (depth === 0 && c === '\n' && text.slice(colon + 1, i).trim() !== '' && !/^\s*[.?:+\-*/&|]/.test(text.slice(i + 1, i + 40))) {
      end = i;
      break;
    }
  }
  const a: [number, number] = [src.trimForward(q + 1), src.trimBack(colon - 1) + 1];
  const b: [number, number] = [src.trimForward(colon + 1), src.trimBack(end - 1) + 1];
  return { negated, a, b };
}

/** End of the block enclosing `pos` (brace): the index of its closing `}`. undefined at top level. */
function enclosingBlockEnd(src: Source, pos: number): number | undefined {
  let depth = 0;
  for (let i = pos; i < src.n; i++) {
    if (!src.code(i)) continue;
    const c = src.text[i]!;
    if (OPEN[c]) depth++;
    else if (CLOSE.has(c) && --depth < 0) return c === '}' ? i : undefined;
  }
  return undefined;
}

// --- main --------------------------------------------------------------------------------------------------------

/**
 * Every range of `text` that cannot run, given what `facts` knows about each flag.
 * `refs` are the flag references the scanner found in the same text.
 */
export function findDeadCode(text: string, refs: readonly FlagReference[], family: LanguageFamily, facts: (key: string) => FlagFacts | undefined): DeadRange[] {
  const src = new Source(text, lex(text, family), family);
  const atoms: Atom[] = [];
  for (const ref of refs) {
    // The key must be a string literal in code, not text inside a comment.
    if (src.mask[ref.offset] !== STRING) continue;
    const atom = atomFor(src, ref, facts);
    if (!atom || !src.code(atom.start)) continue;
    atoms.push(atom, ...aliasesOf(src, atom));
  }

  const out: DeadRange[] = [];
  const seenIfs = new Set<number>();
  const keysIn = (from: number, to: number) => [...new Set(atoms.filter((a) => a.start >= from && a.end <= to).map((a) => a.key))];

  for (const atom of atoms) {
    // 1. if / elif conditions
    let shape: IfShape | undefined;
    let ifKey: number | undefined;
    if (family === 'brace') {
      const ifAt = enclosingBraceIf(src, atom.start);
      if (ifAt !== undefined) {
        ifKey = ifAt;
        shape = seenIfs.has(ifAt) ? undefined : braceIfAt(src, ifAt);
      }
    } else {
      const ls = src.lineStart(atom.start);
      ifKey = ls;
      shape = seenIfs.has(ls) ? undefined : pythonIfAt(src, ls);
      if (shape && atom.start < shape.condFrom) shape = undefined;
    }
    if (shape && ifKey !== undefined) {
      seenIfs.add(ifKey);
      const tokens = tokenize(src, shape.condFrom, shape.condTo, atoms);
      const result = tokens && evaluate(tokens, family);
      const keys = keysIn(shape.condFrom, shape.condTo);
      if (result?.truthy === false) out.push({ start: shape.then[0], end: shape.then[1], branch: 'then', keys });
      if (result?.truthy === true && shape.else) out.push({ start: shape.else[0], end: shape.else[1], branch: 'else', keys });
      if (result?.truthy === true && !shape.else && shape.thenEndsWithExit) {
        const rest = restOfBlock(src, shape);
        if (rest) out.push({ ...rest, branch: 'rest', keys });
      }
      continue;
    }

    // 2. ternaries
    const t = family === 'brace' ? ternaryAround(src, atom) : undefined;
    if (t && atom.known) {
      const truthy = isTruthy(atom.value, family) !== t.negated;
      const dead = truthy ? t.b : t.a;
      if (dead[1] > dead[0]) out.push({ start: dead[0], end: dead[1], branch: truthy ? 'else' : 'then', keys: [atom.key] });
    }
  }
  return mergeRanges(out.filter((r) => !isTrivial(text.slice(r.start, r.end))));
}

/** An empty fallback such as '' or null: greying it out adds noise, not information. */
function isTrivial(code: string): boolean {
  return /^(?:''|""|``|null|undefined|None|\[\]|\{\})$/.test(code.trim());
}

function restOfBlock(src: Source, shape: IfShape): { start: number; end: number } | undefined {
  if (src.family === 'brace') {
    const close = enclosingBlockEnd(src, shape.end);
    if (close === undefined) return undefined;
    const start = src.trimForward(shape.end);
    const end = src.trimBack(close - 1) + 1;
    return start < end ? { start, end } : undefined;
  }
  if (!shape.indent) return undefined; // module level: "the rest of the file" is too bold a claim
  const end = pythonBlockEnd(src.text, shape.end + 1, shape.indent - 1);
  const start = src.trimForward(shape.end);
  return start < end ? { start, end } : undefined;
}

/** Sorts and merges overlapping ranges so greyed-out text never gets dimmed twice. */
function mergeRanges(ranges: DeadRange[]): DeadRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: DeadRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) {
      if (r.end > last.end) last.end = r.end;
      for (const k of r.keys) if (!last.keys.includes(k)) last.keys.push(k);
      continue;
    }
    out.push({ ...r, keys: [...r.keys] });
  }
  return out;
}
