// Trait suggestions for "Preview as → Custom identity": which trait keys matter, and values worth trying.
// Keys come from the project's segment rules (every trait a rule reads, with the values it compares against) and from
// Flagsmith's trait-keys endpoint (traits stored on real identities). Pure functions, so they are unit-tested.

import type { DocRule, EnvironmentDocument } from './engine';

export interface TraitSuggestion {
  key: string;
  /** Values that make a rule match or not, e.g. "pro" for plan EQUAL pro. */
  values: string[];
  /** Segments whose rules read this trait. */
  segments: string[];
  /** Seen on identities stored in Flagsmith. */
  stored: boolean;
}

/** Operators whose value is a list or a pattern rather than one value to try. */
const LIST = new Set(['IN']);
const NO_VALUE = new Set(['IS_SET', 'IS_NOT_SET', 'PERCENTAGE_SPLIT', 'REGEX', 'MODULO']);

export function traitSuggestions(documents: Iterable<EnvironmentDocument>, storedKeys: Iterable<string> = []): TraitSuggestion[] {
  const byKey = new Map<string, TraitSuggestion>();
  const get = (key: string) => {
    let s = byKey.get(key);
    if (!s) byKey.set(key, (s = { key, values: [], segments: [], stored: false }));
    return s;
  };
  const walk = (rules: DocRule[], segment: string) => {
    for (const r of rules) {
      for (const c of r.conditions ?? []) {
        const key = c.property_ ?? c.property;
        // $.identity.identifier and $.flags[...] are not traits.
        if (!key || key.startsWith('$.') || c.operator === 'PERCENTAGE_SPLIT') continue;
        const s = get(key);
        if (!s.segments.includes(segment)) s.segments.push(segment);
        if (c.value === null || NO_VALUE.has(c.operator)) continue;
        const raw = c.value.replace(/:semver$/, '');
        for (const v of LIST.has(c.operator) ? raw.split(',') : [raw]) {
          const t = v.trim();
          if (t && !s.values.includes(t)) s.values.push(t);
        }
      }
      walk(r.rules ?? [], segment);
    }
  };
  for (const doc of documents) for (const seg of doc.project?.segments ?? []) walk(seg.rules, seg.name);
  for (const key of storedKeys) get(key).stored = true;
  return [...byKey.values()].sort((a, b) => b.segments.length - a.segments.length || a.key.localeCompare(b.key));
}

export interface Completion {
  /** Text that replaces the pair being typed, e.g. "plan=" or "plan=pro". */
  insert: string;
  description: string;
}

/** The pair being typed: everything after the last comma. */
function lastPair(text: string): { head: string; pair: string } {
  const i = text.lastIndexOf(',');
  return { head: i < 0 ? '' : text.slice(0, i + 1), pair: text.slice(i + 1).trimStart() };
}

/** Completions for the pair being typed in "plan=pro, coun": keys not used yet, or values once "key=" is typed. */
export function completeTraits(text: string, suggestions: TraitSuggestion[]): Completion[] {
  const { head, pair } = lastPair(text);
  const used = new Set(head.split(',').map((p) => p.split('=')[0]!.trim()).filter(Boolean));
  const eq = pair.indexOf('=');
  if (eq < 0) {
    const prefix = pair.toLowerCase();
    return suggestions
      .filter((s) => !used.has(s.key) && s.key.toLowerCase().startsWith(prefix) && s.key !== pair)
      .map((s) => ({
        insert: `${s.key}=`,
        description: [s.segments.length ? `used by ${s.segments.join(', ')}` : '', s.stored ? 'stored on identities' : ''].filter(Boolean).join(' · '),
      }));
  }
  const key = pair.slice(0, eq).trim();
  const typed = pair.slice(eq + 1).trim().toLowerCase();
  const s = suggestions.find((x) => x.key === key);
  return (s?.values ?? [])
    .filter((v) => v.toLowerCase().startsWith(typed) && v.toLowerCase() !== typed)
    .map((v) => ({ insert: `${key}=${v}`, description: s!.segments.length ? `matters to ${s!.segments.join(', ')}` : '' }));
}

/** Replaces the pair being typed with a completion, ready for the next one when a value was completed. */
export function applyCompletion(text: string, insert: string): string {
  const { head } = lastPair(text);
  const next = `${head}${head ? ' ' : ''}${insert}`;
  return insert.endsWith('=') ? next : `${next}, `;
}
