// Drift, stale-flag and typo analysis. Pure: no VS Code imports, unit-tested in test/analysis.test.ts.

import type { FlagRow, FsEnvironment, FsState } from './model';

const DAY_MS = 86_400_000;

function sameState(a: FsState | undefined, b: FsState | undefined): boolean {
  if (!a || !b) return a === b;
  return a.enabled === b.enabled && JSON.stringify(a.value) === JSON.stringify(b.value);
}

/** Two environments disagree on a flag (enabled or value). Missing states never count as drift. */
export function isDrifted(row: FlagRow, envA: number, envB: number): boolean {
  const a = row.states.get(envA);
  const b = row.states.get(envB);
  if (!a || !b) return false;
  return !sameState(a, b);
}

/** Environments whose state differs from the first environment that has one. */
export function differsAcross(row: FlagRow, envIds: number[]): boolean {
  const present = envIds.map((id) => row.states.get(id)).filter((s): s is FsState => s !== undefined);
  return present.some((s) => !sameState(s, present[0]));
}

/**
 * Picks the pair of environments used for the drift badge from the `driftEnvironments` setting (matched by name,
 * case-insensitively). Returns undefined if either is missing; callers then fall back to comparing all environments.
 */
export function resolveDriftPair(envs: FsEnvironment[], names: readonly string[]): [FsEnvironment, FsEnvironment] | undefined {
  if (names.length < 2) return undefined;
  const find = (n: string) => envs.find((e) => e.name.toLowerCase() === n.toLowerCase());
  const a = find(names[0] ?? '');
  const b = find(names[1] ?? '');
  return a && b && a.id !== b.id ? [a, b] : undefined;
}

export interface DriftResult {
  drifted: boolean;
  /** Human description, e.g. "Staging 100 ≠ Production 50". */
  detail?: string;
}

export function driftFor(row: FlagRow, envs: FsEnvironment[], pairNames: readonly string[]): DriftResult {
  const pair = resolveDriftPair(envs, pairNames);
  if (pair) {
    const [a, b] = pair;
    if (!isDrifted(row, a.id, b.id)) return { drifted: false };
    const sa = row.states.get(a.id);
    const sb = row.states.get(b.id);
    return { drifted: true, detail: `${a.name} ${describeState(sa)} ≠ ${b.name} ${describeState(sb)}` };
  }
  return { drifted: false };
}

export function describeState(s: FsState | undefined): string {
  if (!s) return '—';
  const v = s.value === null || s.value === '' ? '' : ` ${typeof s.value === 'string' ? JSON.stringify(s.value) : String(s.value)}`;
  return `${s.enabled ? 'on' : 'off'}${v}`;
}

export interface StaleResult {
  stale: boolean;
  /** Whole days since the last change in any environment. */
  days: number;
  /** The uniform state, when every environment agrees. */
  state?: 'on' | 'off';
  lastChanged?: string;
  /** Why it is not stale, for hover text and tests. */
  reason?: 'archived' | 'permanent' | 'differs' | 'targeting' | 'recent' | 'no-states' | 'experiment';
}

export interface StaleOptions {
  now: number;
  thresholdDays: number;
  /** Tag labels (case-insensitive) that make a flag permanent. Tags marked permanent in Flagsmith always count. */
  permanentTags: readonly string[];
}

/**
 * A flag is stale when it is identical in every environment (fully on or fully off), has no targeting (segment
 * overrides or non-zero variant weights), is not permanent, and nothing changed for `thresholdDays`.
 *
 * "Last changed" is the newest feature-state `updated_at` across environments. Flagsmith's own
 * `last_modified_in_any_environment` is only filled by v2 feature versioning, so it is null on most OSS installs.
 */
export function staleness(row: FlagRow, envIds: number[], opts: StaleOptions): StaleResult {
  const f = row.feature;
  const states = envIds.map((id) => row.states.get(id)).filter((s): s is FsState => s !== undefined);
  const lastChangedMs = Math.max(...states.map((s) => Date.parse(s.updatedAt)).filter((n) => !Number.isNaN(n)), Date.parse(f.createdAt) || 0);
  const days = lastChangedMs > 0 ? Math.max(0, Math.floor((opts.now - lastChangedMs) / DAY_MS)) : 0;
  const lastChanged = lastChangedMs > 0 ? new Date(lastChangedMs).toISOString() : undefined;
  const base = { stale: false, days, lastChanged };

  if (f.isArchived) return { ...base, reason: 'archived' };
  const permanent = new Set(opts.permanentTags.map((t) => t.toLowerCase()));
  if (f.tags.some((t) => t.permanent || permanent.has(t.label.toLowerCase()))) return { ...base, reason: 'permanent' };
  if (states.length === 0) return { ...base, reason: 'no-states' };
  if (row.experiments.some((x) => x.status === 'running' || x.status === 'paused')) return { ...base, reason: 'experiment' };
  if (states.some((s) => !sameState(s, states[0]))) return { ...base, reason: 'differs' };
  const servesVariants = states.some((s) => [...s.variantWeights.values()].some((w) => w > 0));
  if (f.segmentOverrides > 0 || servesVariants) return { ...base, reason: 'targeting' };

  const state = states[0]?.enabled ? 'on' : 'off';
  if (days < opts.thresholdDays) return { ...base, state, reason: 'recent' };
  return { stale: true, days, state, lastChanged };
}

/** Classic Levenshtein edit distance with an early exit once `max` is exceeded. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/**
 * The most likely intended key for an unknown one: a case-only difference first, then the closest key by edit
 * distance (≤ 1 for short keys, ≤ 2 otherwise), then a unique key that starts with what was typed.
 */
export function suggestKey(unknown: string, knownKeys: Iterable<string>): string | undefined {
  const keys = [...knownKeys];
  const lower = unknown.toLowerCase();
  const caseOnly = keys.find((k) => k.toLowerCase() === lower);
  if (caseOnly) return caseOnly;

  const limit = unknown.length <= 4 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const k of keys) {
    const d = levenshtein(lower, k.toLowerCase(), limit);
    if (d < bestDistance || (d === bestDistance && best !== undefined && k.length < best.length)) {
      best = k;
      bestDistance = d;
    }
  }
  if (best !== undefined && bestDistance <= limit) return best;

  if (unknown.length >= 3) {
    const prefixed = keys.filter((k) => k.toLowerCase().startsWith(lower));
    if (prefixed.length === 1) return prefixed[0];
  }
  return undefined;
}

/** Checks a new flag name against the project's naming rules. Returns an error message, or undefined if valid. */
export function validateFlagName(
  name: string,
  rules: { onlyLowerCase: boolean; nameRegex: string | null },
  existing: Iterable<string> = [],
): string | undefined {
  if (!name.trim()) return 'Flag name cannot be empty.';
  if (/\s/.test(name)) return 'Flag names cannot contain spaces.';
  if (rules.onlyLowerCase && name !== name.toLowerCase()) return 'This project only allows lower-case flag names.';
  if (rules.nameRegex) {
    try {
      // Flagsmith applies the regex with re.match semantics in Python, anchored at the start.
      const re = new RegExp(rules.nameRegex.startsWith('^') ? rules.nameRegex : `^(?:${rules.nameRegex})`);
      if (!re.test(name)) return `This project requires flag names to match ${rules.nameRegex}.`;
    } catch {
      // An invalid project regex is the server's problem; let the API decide.
    }
  }
  for (const k of existing) if (k === name) return `A flag named "${name}" already exists.`;
  return undefined;
}

/** "3 days ago", "just now"… for hover text. */
export function relativeTime(iso: string | undefined, now: number): string {
  if (!iso) return 'unknown';
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return 'unknown';
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
