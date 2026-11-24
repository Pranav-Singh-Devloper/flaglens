// Finds flag keys in source code. Pure: no VS Code imports.
//
// The built-in pattern mirrors Flagsmith's official Code References scanner (github.com/Flagsmith/ci,
// src/code_references/cli/scan_code_references.py), which looks for a feature NAME with
//
//     (?i:(?:feature|flag)\w*\(\s*(["']){re.escape(NAME)})\1
//
// over a two-line window. In words: an identifier containing "feature" or "flag" (any case) followed by more word
// characters and "(", optional whitespace that may include ONE line break, then the key in matching quotes. So
// `hasFeature("x")`, `flags.is_feature_enabled('x')`, `getFeatureValue("x")`, `flags.getFlag("x")` and
// `isFeatureEnabled("x")` all match, while `featureFlagsEnabled = "x"` does not (no call).
//
// We capture ANY key instead of one known NAME, so we can also report keys that don't exist in Flagsmith.
// Calls the official scanner misses (`flagsmith.getValue('x')`, React's `useFlags(['a', 'b'])`) are handled by
// user-configurable extra patterns with a named group `key`.

export interface FlagReference {
  key: string;
  /** 0-based line of the key. */
  line: number;
  /** 0-based column where the key starts (inside the quotes). */
  startCol: number;
  /** 0-based column just after the key. */
  endCol: number;
  /** Offset of the key's first character in the text. */
  offset: number;
  /** True when found by an extra pattern rather than the official one. */
  extra: boolean;
}

/** Characters allowed in a captured key. Flagsmith names are usually snake_case; dots, dashes and colons appear too. */
const KEY_CHARS = String.raw`[A-Za-z0-9_\-.:/]+`;

/** Whitespace with at most one line break: the official scanner's two-line window. */
const WS_ONE_BREAK = String.raw`[^\S\n]*(?:\r?\n[^\S\n]*)?`;

export const OFFICIAL_PATTERN_SOURCE = String.raw`(?:feature|flag)\w*\(` + WS_ONE_BREAK + String.raw`(["'])(` + KEY_CHARS + String.raw`)\1`;

/** Default extra patterns. Also declared as the default of the `flaglens.extraPatterns` setting. */
export const DEFAULT_EXTRA_PATTERNS = [
  // Flagsmith JavaScript client: flagsmith.getValue('key')  (the official scanner misses it: "flagsmith." has no "(")
  String.raw`\bflagsmith\.(?:getValue|hasFeature)\(\s*(["'])(?<key>[A-Za-z0-9_\-.:]+)\1`,
  // Flagsmith React SDK: useFlags(['a', 'b']). A lookbehind finds every quoted key inside the first array argument.
  String.raw`(?<=\buseFlags\(\s*\[[^\]]*)(["'])(?<key>[A-Za-z0-9_\-.:]+)\1`,
];

export interface ScanOptions {
  /** Extra regex sources, each with a named group `key`. Invalid ones are reported and skipped. */
  extraPatterns?: readonly string[];
  /** Ignore files bigger than this (characters). Default 1 MB. */
  maxLength?: number;
}

export interface CompiledPatterns {
  official: RegExp;
  extras: RegExp[];
  errors: string[];
}

/** Compiles the official pattern plus user extras. Bad user regexes are returned in `errors` instead of throwing. */
export function compilePatterns(extraPatterns: readonly string[] = []): CompiledPatterns {
  const extras: RegExp[] = [];
  const errors: string[] = [];
  for (const source of extraPatterns) {
    try {
      const re = new RegExp(source, 'gd');
      if (!/\(\?<key>/.test(source)) {
        errors.push(`Pattern has no named group "key": ${source}`);
        continue;
      }
      extras.push(re);
    } catch (e) {
      errors.push(`Invalid pattern ${source}: ${(e as Error).message}`);
    }
  }
  return { official: new RegExp(OFFICIAL_PATTERN_SOURCE, 'gid'), extras, errors };
}

/** Returns the start offset of every line, so offsets can be turned into line/column quickly. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function toLineCol(starts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: offset - (starts[lo] ?? 0) };
}

export function findFlagReferences(text: string, patterns: CompiledPatterns | ScanOptions = {}): FlagReference[] {
  const compiled = 'official' in patterns ? patterns : compilePatterns(patterns.extraPatterns);
  const maxLength = 'maxLength' in patterns && patterns.maxLength ? patterns.maxLength : 1_000_000;
  if (text.length > maxLength) return [];

  const starts = lineStarts(text);
  const byOffset = new Map<number, FlagReference>();
  const add = (key: string, offset: number, extra: boolean) => {
    if (byOffset.has(offset)) return; // the official pattern wins when both match the same key
    const { line, col } = toLineCol(starts, offset);
    byOffset.set(offset, { key, line, startCol: col, endCol: col + key.length, offset, extra });
  };

  for (const m of text.matchAll(compiled.official)) {
    const key = m[2];
    const span = m.indices?.[2];
    if (key && span) add(key, span[0], false);
  }
  for (const re of compiled.extras) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const key = m.groups?.key;
      const span = m.indices?.groups?.key;
      if (key && span) add(key, span[0], true);
      if (m[0].length === 0) re.lastIndex++; // guard against zero-width user patterns
    }
  }
  return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
}

/**
 * For autocomplete: if the text before the cursor ends inside the quotes of a flag call, returns the partial key
 * typed so far and the quote character. Otherwise undefined.
 */
export function flagCallPrefix(linePrefix: string): { partial: string; quote: string } | undefined {
  const m =
    /(?:feature|flag)\w*\(\s*(["'])([A-Za-z0-9_\-.:/]*)$/i.exec(linePrefix) ??
    /\bflagsmith\.(?:getValue|hasFeature)\(\s*(["'])([A-Za-z0-9_\-.:]*)$/.exec(linePrefix) ??
    /\buseFlags\(\s*\[[^\]]*?(["'])([A-Za-z0-9_\-.:]*)$/.exec(linePrefix);
  if (!m || m[1] === undefined || m[2] === undefined) return undefined;
  return { quote: m[1], partial: m[2] };
}
