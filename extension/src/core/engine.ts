// A local copy of Flagsmith's flag evaluation, so FlagLens can answer "what does THIS user get?" without a request.
// Pure (no VS Code imports) so it can be unit-tested and checked against a live server.
//
// Input is the environment document (GET /api/v1/environments/{key}/document/, readable with an Organisation API
// key): every flag's default state, every segment with its rules and overrides, and identity overrides. That is the
// same document Flagsmith's server-side SDKs use for local evaluation.
//
// Ported from Flagsmith's open-source engine (flagsmith-nodejs 8.1 `flagsmith-engine/`, same logic as the Python
// `flag_engine` the API runs):
//   - An identity's key is "<environment key>_<identifier>".
//   - Percentages come from md5("<id>,<id>") as a big integer, mod 9999, scaled to [0, 100).
//       · % split segments hash [segment id, identity key] and match when the result is <= the split value.
//       · Multivariate flags hash [feature state id, identity key] and walk the variants in id order.
//   - Segment overrides: the matching segment with the lowest priority number wins. Identity overrides beat both.
//
// `test/engine.test.ts` covers the rules; `npm run verify:engine` compares this file with a running Flagsmith for
// hundreds of random identities.

import { createHash } from 'node:crypto';
import type { FlagValue } from '../api/types';

// --- environment document (only the fields we read) --------------------------------------------------------------

export interface DocMultivariateValue {
  id: number | null;
  mv_fs_value_uuid?: string;
  percentage_allocation: number;
  multivariate_feature_option: { id?: number; value: FlagValue; key?: string | null };
}

export interface DocFeatureState {
  feature: { id: number; name: string; type: string };
  enabled: boolean;
  django_id: number | null;
  featurestate_uuid: string;
  feature_state_value: FlagValue;
  feature_segment: { priority: number | null } | null;
  multivariate_feature_state_values: DocMultivariateValue[];
}

export interface DocCondition {
  operator: string;
  value: string | null;
  /** The document calls it `property_`; the SDK context calls it `property`. Both are accepted. */
  property_?: string | null;
  property?: string | null;
}

export interface DocRule {
  type: string;
  rules: DocRule[];
  conditions: DocCondition[];
}

export interface DocSegment {
  id: number;
  name: string;
  rules: DocRule[];
  feature_states: DocFeatureState[];
}

export interface DocIdentityOverride {
  identifier: string;
  identity_features: DocFeatureState[];
}

export interface EnvironmentDocument {
  api_key: string;
  name: string;
  feature_states: DocFeatureState[];
  project: { segments: DocSegment[] };
  identity_overrides?: DocIdentityOverride[] | null;
  use_identity_composite_key_for_hashing?: boolean;
}

// --- results -----------------------------------------------------------------------------------------------------

export type Traits = Record<string, string | number | boolean | null>;

/** A test user to preview flags as. */
export interface Persona {
  /** Display name, e.g. "Beta tester". Defaults to the identifier. */
  name?: string;
  identifier: string;
  traits: Traits;
}

export type Reason =
  | { kind: 'default' }
  | { kind: 'identity' }
  | { kind: 'segment'; segment: string; priority: number | null };

export interface Evaluated {
  enabled: boolean;
  value: FlagValue;
  /** Where the enabled state came from. */
  reason: Reason;
  /** Set when the value was picked by a multivariate split: the identity's bucket and the variant's range. */
  split?: { bucket: number; from: number; to: number; variant: string };
}

/** Parses "plan=pro, country=IN, age=31, beta=true" into typed traits. */
export function parseTraits(text: string): Traits {
  const traits: Traits = {};
  for (const part of text.split(',')) {
    const m = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(part);
    if (!m) continue;
    const raw = m[2]!;
    traits[m[1]!] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
  }
  return traits;
}

// --- hashing -----------------------------------------------------------------------------------------------------

/**
 * Flagsmith's deterministic percentage for a list of ids: a number in [0, 100).
 * md5 of the comma-joined ids, as a 128-bit integer, mod 9999, scaled by 100/9998. The (practically impossible)
 * result 100 is re-hashed with the ids repeated, exactly like the official engines.
 */
export function hashedPercentage(ids: readonly (string | number)[], iterations = 1): number {
  const text = Array.from({ length: iterations }, () => ids.join(',')).join(',');
  const hex = createHash('md5').update(text).digest('hex');
  const value = (Number(BigInt(`0x${hex}`) % 9999n) / 9998) * 100;
  return value === 100 ? hashedPercentage(ids, iterations + 1) : value;
}

export function identityKey(doc: Pick<EnvironmentDocument, 'api_key'>, identifier: string): string {
  return `${doc.api_key}_${identifier}`;
}

// --- segment rules -----------------------------------------------------------------------------------------------

interface EvalContext {
  environment: { key: string; name: string };
  identity: { identifier: string; key: string; traits: Traits };
  /** Other flags' evaluated states, for flag dependencies (conditions on `$.flags["name"].enabled`). */
  flags?: Record<string, { enabled: boolean; value: FlagValue }>;
}

function contextFor(doc: EnvironmentDocument, persona: Persona): EvalContext {
  return {
    environment: { key: doc.api_key, name: doc.name },
    identity: { identifier: persona.identifier, key: identityKey(doc, persona.identifier), traits: persona.traits ?? {} },
  };
}

/** Resolves the JSONPath subset the engines document: $.identity.identifier, $.identity.traits.x, $.environment.name… */
function contextValue(path: string, ctx: EvalContext): unknown {
  // Flag dependencies: Flagsmith stores "B requires A" as a system segment whose condition reads A's evaluated state.
  const flag = /^\$\.flags\[["'](.+)["']\]\.(enabled|value)$/.exec(path) ?? /^\$\.flags\.([^.[\]]+)\.(enabled|value)$/.exec(path);
  if (flag) {
    const f = ctx.flags?.[flag[1]!];
    return f ? f[flag[2] as 'enabled' | 'value'] : undefined;
  }
  const bracket = /^\$\.identity\.traits\['(.+)'\]$/.exec(path);
  if (bracket) return ctx.identity.traits[bracket[1]!];
  const dotted = /^\$\.identity\.traits\.(.+)$/.exec(path);
  if (dotted) return ctx.identity.traits[dotted[1]!];
  let node: unknown = ctx;
  for (const part of path.slice(2).split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function traitValue(property: string, ctx: EvalContext): unknown {
  if (property.startsWith('$.')) {
    const v = contextValue(property, ctx);
    if (v !== undefined && (v === null || typeof v !== 'object')) return v;
  }
  return ctx.identity.traits[property];
}

const SEMVER_SUFFIX = ':semver';

/** Compares two "1.2.3" / "1.2.3-beta.1" versions: negative, 0 or positive. NaN when either isn't a version. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return NaN;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d;
  }
  // A pre-release sorts before its release; pre-releases compare field by field (numbers numerically).
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0;
  const px = x[4].split('.');
  const py = y[4].split('.');
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    if (px[i] === undefined) return -1;
    if (py[i] === undefined) return 1;
    const nx = /^\d+$/.test(px[i]!) ? Number(px[i]) : NaN;
    const ny = /^\d+$/.test(py[i]!) ? Number(py[i]) : NaN;
    if (!isNaN(nx) && !isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (px[i] !== py[i]) {
      return isNaN(nx) && isNaN(ny) ? (px[i]! < py[i]! ? -1 : 1) : isNaN(nx) ? 1 : -1;
    }
  }
  return 0;
}

/** Casts the condition's string value to the trait's type, like the engines do before comparing. */
function cast(conditionValue: string, trait: unknown): unknown {
  switch (typeof trait) {
    case 'boolean':
      return !['False', 'false'].includes(conditionValue);
    case 'number':
      return parseFloat(conditionValue);
    default:
      return String(conditionValue);
  }
}

/** Does one condition match? Mirrors traitsMatchSegmentCondition + SegmentConditionModel.matchesTraitValue. */
export function conditionMatches(cond: DocCondition, segmentId: number | string, ctx: EvalContext): boolean {
  const property = cond.property_ ?? cond.property ?? null;
  const raw = cond.value;

  if (cond.operator === 'PERCENTAGE_SPLIT') {
    const splitKey = property ? contextValue(property, ctx) : ctx.identity.key;
    if (splitKey === undefined || splitKey === null || splitKey === '') return false;
    return hashedPercentage([String(segmentId), String(splitKey)]) <= parseFloat(String(raw));
  }
  if (!property) return false;
  const trait = traitValue(property, ctx);
  if (cond.operator === 'IS_SET') return trait !== undefined && trait !== null;
  if (cond.operator === 'IS_NOT_SET') return trait === undefined || trait === null;
  if (trait === undefined || trait === null) return false;
  const value = raw ?? '';

  switch (cond.operator) {
    case 'NOT_CONTAINS':
      return typeof trait === 'string' && !!value && !trait.includes(value);
    case 'REGEX':
      // The API evaluates with Python's re.match, which anchors at the start of the trait.
      try {
        return !!value && new RegExp(`^(?:${value})`).test(String(trait));
      } catch {
        return false;
      }
    case 'MODULO': {
      const parts = value.split('|');
      const n = parseFloat(String(trait));
      const divisor = parseFloat(parts[0] ?? '');
      const remainder = parseFloat(parts[1] ?? '');
      if (parts.length !== 2 || isNaN(n) || isNaN(divisor) || isNaN(remainder) || divisor === 0) return false;
      return n % divisor === remainder;
    }
    case 'IN': {
      if (typeof trait === 'boolean') return false;
      let list: unknown[] = value.split(',');
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        // a plain comma-separated list
      }
      return list.map(String).includes(String(trait));
    }
  }

  if (value.endsWith(SEMVER_SUFFIX)) {
    const c = compareSemver(String(trait), value.slice(0, -SEMVER_SUFFIX.length));
    if (isNaN(c)) return false;
    return compareResult(cond.operator, c);
  }
  const v = cast(value, trait);
  switch (cond.operator) {
    case 'EQUAL':
      // eslint-disable-next-line eqeqeq -- the engines compare loosely after casting
      return v == trait;
    case 'NOT_EQUAL':
      // eslint-disable-next-line eqeqeq
      return v != trait;
    case 'GREATER_THAN':
      return (trait as number) > (v as number);
    case 'GREATER_THAN_INCLUSIVE':
      return (trait as number) >= (v as number);
    case 'LESS_THAN':
      return (trait as number) < (v as number);
    case 'LESS_THAN_INCLUSIVE':
      return (trait as number) <= (v as number);
    case 'CONTAINS':
      return typeof trait === 'string' && trait.includes(String(v));
    default:
      // Unknown operators evaluate to false in every SDK.
      return false;
  }
}

function compareResult(operator: string, c: number): boolean {
  switch (operator) {
    case 'EQUAL':
      return c === 0;
    case 'NOT_EQUAL':
      return c !== 0;
    case 'GREATER_THAN':
      return c > 0;
    case 'GREATER_THAN_INCLUSIVE':
      return c >= 0;
    case 'LESS_THAN':
      return c < 0;
    case 'LESS_THAN_INCLUSIVE':
      return c <= 0;
    default:
      return false;
  }
}

function ruleMatches(rule: DocRule, segmentId: number | string, ctx: EvalContext): boolean {
  const results = (rule.conditions ?? []).map((c) => conditionMatches(c, segmentId, ctx));
  let ok: boolean;
  if (results.length === 0) ok = true;
  else if (rule.type === 'ALL') ok = results.every(Boolean);
  else if (rule.type === 'ANY') ok = results.some(Boolean);
  else if (rule.type === 'NONE') ok = !results.some(Boolean);
  else ok = false;
  return ok && (rule.rules ?? []).every((r) => ruleMatches(r, segmentId, ctx));
}

/** The segments this persona belongs to in this environment. A segment without rules matches nobody. */
function conditionsOfRules(rules: DocRule[]): DocCondition[] {
  return rules.flatMap((r) => [...(r.conditions ?? []), ...conditionsOfRules(r.rules ?? [])]);
}

/**
 * A flag-dependency segment: Flagsmith implements "B requires A" as a system segment (named "B-depends-on-A") whose
 * condition is `$.flags["A"].enabled NOT_EQUAL true` and whose override turns B off. Verified on 2.295.2: it is an
 * ordinary override in the priority order, it applies with or without an identity, and prerequisites can't have
 * prerequisites of their own (the API rejects chains), so two passes evaluate it exactly.
 */
export function isDependencySegment(s: DocSegment): boolean {
  return conditionsOfRules(s.rules).some((c) => (c.property_ ?? c.property ?? '').startsWith('$.flags'));
}

/** "B requires A" pairs found in an environment document. */
export function dependenciesOf(doc: EnvironmentDocument): { flag: string; requires: string }[] {
  const out: { flag: string; requires: string }[] = [];
  for (const s of doc.project.segments) {
    if (!isDependencySegment(s)) continue;
    for (const c of conditionsOfRules(s.rules)) {
      const m = /^\$\.flags\[["'](.+)["']\]\.enabled$/.exec(c.property_ ?? c.property ?? '') ?? /^\$\.flags\.([^.[\]]+)\.enabled$/.exec(c.property_ ?? c.property ?? '');
      if (!m) continue;
      for (const fs of s.feature_states) out.push({ flag: fs.feature.name, requires: m[1]! });
    }
  }
  return out;
}

const NO_IDENTITY = { identifier: '', traits: {} } as const;

function matches(s: DocSegment, ctx: EvalContext): boolean {
  return s.rules.length > 0 && s.rules.every((r) => ruleMatches(r, s.id, ctx));
}

/**
 * The segments that apply, in document order. Regular segments need an identity; dependency segments are then
 * evaluated against the flags as resolved without them (pass one), with or without an identity.
 */
function applicableSegments(doc: EnvironmentDocument, persona: Persona | undefined): DocSegment[] {
  const ctx = contextFor(doc, persona ?? NO_IDENTITY);
  const regular = persona ? doc.project.segments.filter((s) => !isDependencySegment(s) && matches(s, ctx)) : [];
  const deps = doc.project.segments.filter(isDependencySegment);
  if (!deps.length) return regular;
  const pass1 = resolve(doc, regular, persona);
  const flags = Object.fromEntries([...pass1].map(([name, e]) => [name, { enabled: e.enabled, value: e.value }]));
  const withFlags = { ...ctx, flags };
  const dep = new Set(deps.filter((s) => matches(s, withFlags)));
  const reg = new Set(regular);
  return doc.project.segments.filter((s) => reg.has(s) || dep.has(s));
}

/** The segments this persona belongs to in this environment (including flag-dependency segments that apply). */
export function matchingSegments(doc: EnvironmentDocument, persona: Persona): DocSegment[] {
  return applicableSegments(doc, persona);
}

// --- flags -------------------------------------------------------------------------------------------------------

/** Variants sorted the way the engines walk them: by multivariate feature state value id (uuid as a fallback). */
function sortedVariants(fs: DocFeatureState): DocMultivariateValue[] {
  const order = (v: DocMultivariateValue): bigint =>
    v.id !== null && v.id !== undefined ? BigInt(v.id) : v.mv_fs_value_uuid ? BigInt(`0x${v.mv_fs_value_uuid.replace(/-/g, '')}`) : 0n;
  return [...fs.multivariate_feature_state_values].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}

function valueFor(fs: DocFeatureState, key: string | undefined): Pick<Evaluated, 'value' | 'split'> {
  const variants = fs.multivariate_feature_state_values ?? [];
  if (!key || variants.length === 0) return { value: fs.feature_state_value };
  const bucket = hashedPercentage([fs.django_id?.toString() || fs.featurestate_uuid, key]);
  let start = 0;
  for (const v of sortedVariants(fs)) {
    const end = start + v.percentage_allocation;
    if (start <= bucket && bucket < end) {
      const option = v.multivariate_feature_option;
      return { value: option.value, split: { bucket, from: start, to: end, variant: String(option.key ?? option.value) } };
    }
    start = end;
  }
  return { value: fs.feature_state_value, split: { bucket, from: start, to: 100, variant: 'control' } };
}

/**
 * Every flag in the environment, evaluated for `persona` (or for "no identity" when omitted, which is what
 * environment-flag calls return: defaults only, multivariate flags give their control value).
 */
export function evaluateFlags(doc: EnvironmentDocument, persona?: Persona): Map<string, Evaluated> {
  return resolve(doc, applicableSegments(doc, persona), persona);
}

/** Resolves every flag from the applicable segments: lowest priority number wins, identity overrides beat all. */
function resolve(doc: EnvironmentDocument, segments: DocSegment[], persona: Persona | undefined): Map<string, Evaluated> {
  const out = new Map<string, Evaluated>();
  const key = persona ? identityKey(doc, persona.identifier) : undefined;

  const chosen = new Map<string, { fs: DocFeatureState; reason: Reason; priority: number }>();
  for (const fs of doc.feature_states) chosen.set(fs.feature.name, { fs, reason: { kind: 'default' }, priority: Infinity });

  for (const segment of segments) {
    for (const fs of segment.feature_states) {
      const priority = fs.feature_segment?.priority ?? Infinity;
      const current = chosen.get(fs.feature.name);
      // Lower number = higher priority; on a tie the first segment wins (like the engines).
      if (!current || current.reason.kind === 'default' || priority < current.priority) {
        chosen.set(fs.feature.name, { fs, reason: { kind: 'segment', segment: segment.name, priority: fs.feature_segment?.priority ?? null }, priority });
      }
    }
  }
  const identity = persona && (doc.identity_overrides ?? []).find((i) => i.identifier === persona.identifier);
  for (const fs of identity ? identity.identity_features : []) chosen.set(fs.feature.name, { fs, reason: { kind: 'identity' }, priority: -Infinity });

  for (const [name, { fs, reason }] of chosen) out.set(name, { enabled: fs.enabled, ...valueFor(fs, key), reason });
  return out;
}

/**
 * Is a flag the same for every user in this environment? `enabled` is uniform when no segment or identity override
 * touches the flag; `value` additionally needs no multivariate split. FlagLens only greys out code when it is sure.
 */
export function uniformity(doc: EnvironmentDocument, flag: string): { enabled: boolean; value: boolean } {
  const overridden =
    doc.project.segments.some((s) => s.feature_states.some((fs) => fs.feature.name === flag)) ||
    (doc.identity_overrides ?? []).some((i) => i.identity_features.some((fs) => fs.feature.name === flag));
  const base = doc.feature_states.find((fs) => fs.feature.name === flag);
  const split = (base?.multivariate_feature_state_values ?? []).some((v) => v.percentage_allocation > 0);
  return { enabled: !overridden, value: !overridden && !split };
}

/** "segment beta_testers", "identity override", "environment default" */
export function describeReason(r: Reason): string {
  switch (r.kind) {
    case 'segment':
      return `segment ${r.segment}`;
    case 'identity':
      return 'identity override';
    default:
      return 'environment default';
  }
}
