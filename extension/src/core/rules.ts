// Finds mistakes in a flag's segment overrides: overrides that can never apply, overrides that change nothing, and
// segments that match nobody. Pure: no VS Code imports.
//
// The idea comes from firewall policy analysis (Al-Shaer & Hamed, "Firewall Policy Advisor", 2004): a firewall is
// a priority-ordered list of rules over packet fields, and a rule is *shadowed* when earlier rules catch every packet
// it matches, *redundant* when removing it changes no decision. Flagsmith segment overrides are exactly that: a
// priority-ordered list of rules over identity traits, deciding a flag's state.
//
// How we check "for every user" exactly:
//
//   Each rule operator that compares a trait with constants (EQUAL, NOT_EQUAL, IN, <, <=, >, >=, IS_SET, IS_NOT_SET)
//   gives the same answer for every value between two consecutive constants. So the infinite space of trait values
//   splits into a few equivalence classes per trait: unset, each constant, a value between each pair of constants, one
//   below and one above, and "anything else" (the same idea as packet-space segmentation in FAME, Hu et al. 2012).
//   One representative per class is enough: a property holds for every user iff it holds for every combination of
//   representatives. A % split is a number in [0, 100) per segment, split the same way at its thresholds.
//
//   Operators we can't partition (REGEX, CONTAINS, NOT_CONTAINS, MODULO, SemVer, splits on a trait) become free
//   true/false variables; identical conditions share one variable. That only ADDS impossible users, so every "for
//   every user" finding stays true. We may miss a finding; we never report a false one.

import type { FlagValue } from '../api/types';
import { conditionMatches, type DocCondition, type DocFeatureState, type DocRule, type DocSegment, type EnvironmentDocument, type Traits } from './engine';

export type FindingKind = 'shadowed' | 'redundant' | 'matches-nobody' | 'default-unreachable';

export interface RuleFinding {
  kind: FindingKind;
  flag: string;
  environment: string;
  /** The override's segment (not set for default-unreachable). */
  segment?: string;
  priority?: number | null;
  /** shadowed: the higher-priority segments that catch its users. */
  by?: string[];
  /** One sentence for hovers, diagnostics and the report. */
  message: string;
}

/** Above this many combinations we skip a flag rather than slow the editor down. */
const MAX_COMBINATIONS = 250_000;

const EXACT = new Set(['EQUAL', 'NOT_EQUAL', 'IN', 'IS_SET', 'IS_NOT_SET', 'GREATER_THAN', 'GREATER_THAN_INCLUSIVE', 'LESS_THAN', 'LESS_THAN_INCLUSIVE']);
const ORDERING = new Set(['GREATER_THAN', 'GREATER_THAN_INCLUSIVE', 'LESS_THAN', 'LESS_THAN_INCLUSIVE']);
const IDENTIFIER = '\u0000identifier';
const UNSET = Symbol('unset');
type Rep = string | number | boolean | typeof UNSET;

/** The trait a condition reads, or IDENTIFIER, or undefined for anything else ($.environment.*, $.identity.key…). */
function traitOf(property: string | null | undefined): string | undefined {
  if (!property) return undefined;
  if (!property.startsWith('$.')) return property;
  if (property === '$.identity.identifier') return IDENTIFIER;
  return /^\$\.identity\.traits\.(.+)$/.exec(property)?.[1] ?? /^\$\.identity\.traits\['(.+)'\]$/.exec(property)?.[1];
}

const propertyOf = (c: DocCondition) => c.property_ ?? c.property ?? null;

type Classified =
  | { kind: 'exact'; trait: string }
  | { kind: 'split'; key: string; threshold: number }
  | { kind: 'fixed' } // depends only on the environment, e.g. $.environment.name
  | { kind: 'opaque'; key: string };

function classify(c: DocCondition, segmentId: number): Classified {
  const property = propertyOf(c);
  if (c.operator === 'PERCENTAGE_SPLIT') {
    if (property) return { kind: 'opaque', key: `split|${segmentId}|${property}|${c.value}` };
    return { kind: 'split', key: `\u0000split:${segmentId}`, threshold: parseFloat(String(c.value)) };
  }
  if (property?.startsWith('$.environment.')) return { kind: 'fixed' };
  const trait = traitOf(property);
  if (trait !== undefined && EXACT.has(c.operator) && !String(c.value ?? '').endsWith(':semver')) return { kind: 'exact', trait };
  return { kind: 'opaque', key: `${property}|${c.operator}|${c.value}` };
}

function conditionsOf(rules: DocRule[]): DocCondition[] {
  return rules.flatMap((r) => [...(r.conditions ?? []), ...conditionsOf(r.rules ?? [])]);
}

/** Constants a condition compares with, as the strings the API stores. */
function constantsOf(c: DocCondition): string[] {
  const v = c.value;
  if (v === null || v === undefined) return [];
  if (c.operator !== 'IN') return [String(v)];
  try {
    const parsed: unknown = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // comma-separated
  }
  return v.split(',');
}

/** One representative value per equivalence class of a trait. */
function representatives(conds: DocCondition[], isIdentifier: boolean): Rep[] {
  const constants = [...new Set(conds.flatMap(constantsOf))];
  const ordered = conds.some((c) => ORDERING.has(c.operator));
  const reps: Rep[] = isIdentifier ? [] : [UNSET];

  // Strings: each constant, something different from all of them, and (for < >) a value inside each gap.
  const strings = new Set<string>([...constants, '\u0001other']);
  if (ordered) {
    strings.add('');
    strings.add('\uffff\uffff');
    for (const c of constants) strings.add(`${c}\u0000`); // the next string after c in lexicographic order
  }
  reps.push(...strings);
  if (isIdentifier) return reps;

  // A trait can hold any JSON type and the engine casts the condition to it, so numbers and booleans are classes of
  // their own (a boolean trait `true` even EQUALs "pro"). Numbers: each numeric constant, a value in every gap, one
  // below and one above, and one unrelated number.
  const nums = [...new Set(constants.map(Number).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  const pts = new Set<number>([...nums, -7.25]);
  if (nums.length) {
    pts.add(nums[0]! - 1);
    pts.add(nums[nums.length - 1]! + 1);
    for (let i = 1; i < nums.length; i++) pts.add((nums[i - 1]! + nums[i]!) / 2);
  }
  reps.push(...pts, true, false);
  return reps;
}

/** Bucket values for a % split: 0, each threshold, a value in each gap, and the top of the range. */
function splitRepresentatives(thresholds: number[]): number[] {
  const t = [...new Set(thresholds.filter((x) => Number.isFinite(x)))].sort((a, b) => a - b);
  const pts = new Set<number>([0, 99.99]);
  for (const x of t) if (x >= 0 && x < 100) pts.add(x);
  const all = [...pts].sort((a, b) => a - b);
  for (let i = 1; i < all.length; i++) pts.add((all[i - 1]! + all[i]!) / 2);
  return [...pts].sort((a, b) => a - b);
}

interface Override {
  segment: DocSegment;
  fs: DocFeatureState;
  priority: number;
}

interface Space {
  traits: { name: string; reps: Rep[] }[];
  splits: { key: string; reps: number[] }[];
  opaque: string[];
  size: number;
}

function buildSpace(segments: DocSegment[]): Space {
  const byTrait = new Map<string, DocCondition[]>();
  const splits = new Map<string, number[]>();
  const opaque = new Set<string>();
  for (const s of segments) {
    for (const c of conditionsOf(s.rules)) {
      const k = classify(c, s.id);
      if (k.kind === 'exact') byTrait.set(k.trait, [...(byTrait.get(k.trait) ?? []), c]);
      else if (k.kind === 'split') splits.set(k.key, [...(splits.get(k.key) ?? []), k.threshold]);
      else if (k.kind === 'opaque') opaque.add(k.key);
    }
  }
  const traits = [...byTrait].map(([name, conds]) => ({ name, reps: representatives(conds, name === IDENTIFIER) }));
  const splitList = [...splits].map(([key, ts]) => ({ key, reps: splitRepresentatives(ts) }));
  const size = traits.reduce((n, t) => n * t.reps.length, 1) * splitList.reduce((n, s) => n * s.reps.length, 1) * 2 ** opaque.size;
  return { traits, splits: splitList, opaque: [...opaque], size };
}

/** Calls fn once per combination of representatives (a mixed-radix counter). */
function forEachUser(space: Space, fn: (traits: Map<string, Rep>, splits: Map<string, number>, opaque: Map<string, boolean>) => void): void {
  const radices = [...space.traits.map((t) => t.reps.length), ...space.splits.map((s) => s.reps.length), ...space.opaque.map(() => 2)];
  const digits = radices.map(() => 0);
  for (;;) {
    const traits = new Map<string, Rep>();
    space.traits.forEach((t, i) => traits.set(t.name, t.reps[digits[i]!]!));
    const splits = new Map<string, number>();
    space.splits.forEach((s, i) => splits.set(s.key, s.reps[digits[space.traits.length + i]!]!));
    const opaque = new Map<string, boolean>();
    space.opaque.forEach((k, i) => opaque.set(k, digits[space.traits.length + space.splits.length + i] === 1));
    fn(traits, splits, opaque);
    let i = 0;
    while (i < digits.length && ++digits[i]! === radices[i]) digits[i++] = 0;
    if (i === digits.length) return;
  }
}

function matches(doc: EnvironmentDocument, segment: DocSegment, traits: Map<string, Rep>, splits: Map<string, number>, opaque: Map<string, boolean>): boolean {
  const plain: Traits = {};
  for (const [k, v] of traits) if (k !== IDENTIFIER && v !== UNSET) plain[k] = v as string | number | boolean;
  const identifier = traits.get(IDENTIFIER);
  const ctx = {
    environment: { key: doc.api_key, name: doc.name },
    identity: { identifier: typeof identifier === 'string' ? identifier : 'someone', key: '', traits: plain },
  };
  const cond = (c: DocCondition): boolean => {
    const k = classify(c, segment.id);
    if (k.kind === 'split') return (splits.get(k.key) ?? 0) <= k.threshold;
    if (k.kind === 'opaque') return opaque.get(k.key) ?? false;
    return conditionMatches(c, segment.id, ctx);
  };
  const rule = (r: DocRule): boolean => {
    const results = (r.conditions ?? []).map(cond);
    const ok =
      results.length === 0 ||
      (r.type === 'ALL' ? results.every(Boolean) : r.type === 'ANY' ? results.some(Boolean) : r.type === 'NONE' ? !results.some(Boolean) : false);
    return ok && (r.rules ?? []).every(rule);
  };
  return segment.rules.length > 0 && segment.rules.every(rule);
}

/** Two feature states serve the same thing to everyone they apply to. A live variant split never counts as equal. */
function sameState(a: DocFeatureState, b: DocFeatureState): boolean {
  const split = (fs: DocFeatureState) => (fs.multivariate_feature_state_values ?? []).some((v) => v.percentage_allocation > 0);
  return a.enabled === b.enabled && a.feature_state_value === b.feature_state_value && !split(a) && !split(b);
}

export function describeState(fs: DocFeatureState): string {
  const v: FlagValue = fs.feature_state_value;
  return `${fs.enabled ? 'on' : 'off'}${v === null || v === '' ? '' : ` ${JSON.stringify(v)}`}`;
}

/** Analyses every flag's segment overrides in one environment. */
export function analyseRules(doc: EnvironmentDocument): RuleFinding[] {
  const out: RuleFinding[] = [];
  const byFlag = new Map<string, Override[]>();
  doc.project.segments.forEach((segment) => {
    for (const fs of segment.feature_states) {
      const list = byFlag.get(fs.feature.name) ?? [];
      list.push({ segment, fs, priority: fs.feature_segment?.priority ?? Infinity });
      byFlag.set(fs.feature.name, list);
    }
  });

  for (const [flag, unsorted] of byFlag) {
    // Same order as the engine: lowest priority number first; on a tie the earlier segment wins (stable sort).
    const overrides = [...unsorted].sort((a, b) => a.priority - b.priority);
    const base = doc.feature_states.find((fs) => fs.feature.name === flag);
    const space = buildSpace(overrides.map((o) => o.segment));
    if (space.size > MAX_COMBINATIONS) continue;

    const everMatched = overrides.map(() => false);
    const everFired = overrides.map(() => false);
    const changesSomething = overrides.map(() => false);
    const caughtBy = overrides.map(() => new Set<number>());
    let defaultServed = false;

    forEachUser(space, (traits, splits, opaque) => {
      const m = overrides.map((o) => matches(doc, o.segment, traits, splits, opaque));
      const first = m.indexOf(true);
      m.forEach((hit, j) => {
        if (!hit) return;
        everMatched[j] = true;
        for (let i = 0; i < j; i++) if (m[i]) caughtBy[j]!.add(i);
      });
      if (first === -1) {
        defaultServed = true;
        return;
      }
      everFired[first] = true;
      // Without this override, the user falls through to the next matching one, or the environment default.
      const next = m.indexOf(true, first + 1);
      const fallback = next === -1 ? base : overrides[next]!.fs;
      if (!fallback || !sameState(overrides[first]!.fs, fallback)) changesSomething[first] = true;
    });

    overrides.forEach((o, j) => {
      const where = `${flag} in ${doc.name}`;
      const name = `"${o.segment.name}"`;
      const prio = o.fs.feature_segment?.priority ?? null;
      const common = { flag, environment: doc.name, segment: o.segment.name, priority: prio };
      if (!everMatched[j]) {
        out.push({ ...common, kind: 'matches-nobody', message: `Segment ${name} matches nobody (its rules can't all be true), so its override for ${where} never applies.` });
      } else if (!everFired[j]) {
        const by = [...caughtBy[j]!].sort((a, b) => a - b).map((i) => overrides[i]!);
        const names = by.map((b) => `"${b.segment.name}" (priority ${b.fs.feature_segment?.priority ?? '—'})`).join(', ');
        out.push({
          ...common,
          kind: 'shadowed',
          by: by.map((b) => b.segment.name),
          message: `The ${name} override for ${where} never applies: everyone in ${name} is caught first by ${names}.`,
        });
      } else if (!changesSomething[j]) {
        out.push({
          ...common,
          kind: 'redundant',
          message: `The ${name} override for ${where} changes nothing: its users would get the same (${describeState(o.fs)}) without it.`,
        });
      }
    });
    if (!defaultServed && base && overrides.length) {
      out.push({
        kind: 'default-unreachable',
        flag,
        environment: doc.name,
        message: `Every user matches a segment override for ${flag} in ${doc.name}, so the environment default (${describeState(base)}) is never served.`,
      });
    }
  }
  return out;
}
