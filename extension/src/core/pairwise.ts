// The smallest set of flag combinations that tests every PAIR of flag values together. Pure: no VS Code imports.
//
// Most flag bugs come from one flag or from two flags interacting, so a test plan that covers every pair of values
// (2-way coverage, a "covering array of strength 2") catches them without trying every combination: 10 on/off flags
// need 6 runs instead of 1,024.
//
// On/off flags (every flag has 2 values): the optimal size is known exactly (Katona 1973; Kleitman & Spencer 1973).
// The smallest N for k flags is the smallest N with C(N−1, ⌈N/2⌉) ≥ k, and this construction reaches it: give each
// flag a different column of length N that starts with 0 and has exactly ⌈N/2⌉ ones. For any two columns:
//   (0,0) appears in row 0;  (1,0) and (0,1) appear because two different columns of equal weight can't contain each
//   other;  (1,1) appears because 2·⌈N/2⌉ > N−1 ones can't fit in disjoint positions.
//
// Flags with more values (multivariate, remote config): no closed form is known. We build a plan with IPOG (Lei &
// Tai, 2007), a standard greedy algorithm, then shrink it with simulated annealing (Cohen, Colbourn & Ling, 2003),
// and report a lower bound. When the plan's size equals the bound it is optimal.

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) r = (r * (n - i + 1)) / i;
  return Math.round(r);
}

/** Minimum number of runs covering every pair of k on/off flags (Kleitman–Spencer). */
export function optimalBinaryRuns(k: number): number {
  if (k <= 0) return 0;
  let n = 2;
  while (binomial(n - 1, Math.ceil(n / 2)) < k) n++;
  return n;
}

/** Rows × k matrix of 0/1 covering every pair, with exactly optimalBinaryRuns(k) rows. */
export function binaryCoveringArray(k: number): number[][] {
  const n = optimalBinaryRuns(k);
  if (n === 0) return [];
  const weight = Math.ceil(n / 2);
  // Columns: the first k subsets of size `weight` of rows 1..n-1 (row 0 is always 0), in lexicographic order.
  const columns: number[][] = [];
  const pick = (start: number, chosen: number[]) => {
    if (columns.length === k) return;
    if (chosen.length === weight) {
      const col = new Array<number>(n).fill(0);
      for (const r of chosen) col[r] = 1;
      columns.push(col);
      return;
    }
    for (let r = start; r < n && columns.length < k; r++) pick(r + 1, [...chosen, r]);
  };
  pick(1, []);
  return Array.from({ length: n }, (_, row) => columns.map((col) => col[row]!));
}

/**
 * No pairwise plan can be smaller than this. Two arguments: the two flags with the most values need every pair of
 * their values (a·b rows); and the plan restricted to the on/off flags is itself a pairwise plan for them, so it needs
 * at least the Kleitman–Spencer optimum for that many on/off flags.
 */
export function pairwiseLowerBound(levels: readonly number[]): number {
  if (levels.length === 0) return 0;
  if (levels.length === 1) return levels[0]!;
  const sorted = [...levels].sort((x, y) => y - x);
  const [a, b] = sorted as [number, number];
  const onOff = levels.filter((l) => l === 2).length;
  let bound = Math.max(a * b, optimalBinaryRuns(onOff));
  // One flag with a > 2 values, all others on/off: a plan with exactly 2a runs has each value of the big flag in
  // exactly two runs, and every on/off flag must be on in one and off in the other. So an on/off column is one of 2^a
  // choices, and two columns cover all four on/off pairs only if they are neither equal nor complementary: at most
  // 2^(a-1) columns. With more on/off flags than that, 2a runs are impossible.
  if (a > 2 && onOff === levels.length - 1 && bound === 2 * a && onOff > 2 ** (a - 1)) bound = 2 * a + 1;
  return bound;
}

/**
 * IPOG's result depends on the order flags are added in. Largest-first is the usual heuristic; we also try a few
 * seeded shuffles (deterministic, so the same flags always give the same plan) and keep the smallest.
 */
export function mixedCoveringArray(levels: readonly number[], attempts = 24): number[][] {
  const k = levels.length;
  if (k === 0) return [];
  const largestFirst = levels.map((l, i) => [l, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  let best = ipog(levels, largestFirst);
  let seed = 0x9e3779b9;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let t = 0; t < attempts && best.length > pairwiseLowerBound(levels); t++) {
    const order = [...largestFirst];
    // Keep the two largest first (they fix the starting rows), shuffle the rest.
    for (let i = order.length - 1; i > 2; i--) {
      const j = 2 + Math.floor(rand() * (i - 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const rows = ipog(levels, order);
    if (rows.length < best.length) best = rows;
  }
  // Then try to beat it: look for a plan with one row fewer, until that fails or we reach the lower bound.
  const bound = pairwiseLowerBound(levels);
  for (let n = best.length - 1; n >= bound; n--) {
    const rows = anneal(levels, n);
    if (!rows) break;
    best = rows;
  }
  return best;
}

/**
 * Simulated annealing for a pairwise plan with exactly n rows (Cohen, Colbourn & Ling, 2003). The cost is the number
 * of value pairs not covered by any row. A move picks an uncovered pair and writes it into a random row; worse moves
 * are accepted with probability e^(−Δ/T) as the temperature T cools. Returns undefined if no plan is found in time.
 */
export function anneal(levels: readonly number[], n: number, maxSteps = 40_000): number[][] | undefined {
  const k = levels.length;
  if (k < 2 || n <= 0) return undefined;
  let seed = 0x2545f491 ^ (n * 7919 + k);
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const rows = Array.from({ length: n }, (_, r) => levels.map((l, i) => (r + i * 7 + Math.floor(rand() * l)) % l));

  // cover[p][x * Lb + y]: how many rows cover value x of factor a with value y of factor b, for pair p = (a, b).
  const pairs: [number, number][] = [];
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) pairs.push([a, b]);
  const pairIndex = (a: number, b: number) => (a < b ? a * k + b : b * k + a);
  const index = new Map(pairs.map(([a, b], i) => [pairIndex(a, b), i]));
  const cover = pairs.map(([a, b]) => new Int32Array(levels[a]! * levels[b]!));
  const missing = pairs.map(([a, b]) => levels[a]! * levels[b]!);
  let uncovered = missing.reduce((s, m) => s + m, 0);
  const touch = (r: number, a: number, delta: 1 | -1) => {
    for (let b = 0; b < k; b++) {
      if (b === a) continue;
      const p = index.get(pairIndex(a, b))!;
      const [lo, hi] = pairs[p]!;
      const cell = rows[r]![lo]! * levels[hi]! + rows[r]![hi]!;
      const before = cover[p]![cell]!;
      cover[p]![cell] = before + delta;
      if (delta === 1 && before === 0) {
        missing[p]!--;
        uncovered--;
      }
      if (delta === -1 && before === 1) {
        missing[p]!++;
        uncovered++;
      }
    }
  };
  // Initial counts: add every cell of every row once per pair.
  for (let r = 0; r < n; r++) {
    for (const [p, [a, b]] of pairs.entries()) {
      const cell = rows[r]![a]! * levels[b]! + rows[r]![b]!;
      if (cover[p]![cell]!++ === 0) {
        missing[p]!--;
        uncovered--;
      }
    }
  }
  const set = (r: number, a: number, v: number) => {
    if (rows[r]![a] === v) return;
    // Remove the row's pairs that involve a, change the cell, add them back. (touch counts each pair once.)
    touch(r, a, -1);
    rows[r]![a] = v;
    touch(r, a, 1);
  };

  let temperature = 0.5;
  for (let step = 0; step < maxSteps && uncovered > 0; step++) {
    // A random pair of factors that still has an uncovered value combination, and one such combination.
    let p = Math.floor(rand() * pairs.length);
    while (missing[p] === 0) p = (p + 1) % pairs.length;
    const [a, b] = pairs[p]!;
    const cells = cover[p]!;
    let c = Math.floor(rand() * cells.length);
    while (cells[c] !== 0) c = (c + 1) % cells.length;
    const x = Math.floor(c / levels[b]!);
    const y = c % levels[b]!;
    const r = Math.floor(rand() * n);
    const [oldA, oldB] = [rows[r]![a]!, rows[r]![b]!];
    const before = uncovered;
    set(r, a, x);
    set(r, b, y);
    const delta = uncovered - before;
    if (delta > 0 && rand() >= Math.exp(-delta / temperature)) {
      set(r, a, oldA);
      set(r, b, oldB);
    }
    temperature = Math.max(0.02, temperature * 0.9995);
  }
  return uncovered === 0 ? rows : undefined;
}

/** IPOG for strength 2: grows the plan one flag at a time, first sideways (new column), then down (new rows). */
function ipog(levels: readonly number[], order: readonly number[]): number[][] {
  const k = levels.length;
  const L = order.map((i) => levels[i]!);
  const DC = -1; // "don't care" until a later step needs the cell

  let rows: number[][] = [];
  if (k === 1) rows = Array.from({ length: L[0]! }, (_, v) => [v]);
  else for (let a = 0; a < L[0]!; a++) for (let b = 0; b < L[1]!; b++) rows.push([a, b]);

  for (let f = 2; f < k; f++) {
    // Pairs (earlier factor j, its value, this factor's value) still to cover.
    const uncovered = new Set<string>();
    const key = (j: number, vj: number, vf: number) => `${j}:${vj}:${vf}`;
    for (let j = 0; j < f; j++) for (let vj = 0; vj < L[j]!; vj++) for (let vf = 0; vf < L[f]!; vf++) uncovered.add(key(j, vj, vf));

    // Horizontal growth: give each existing row the value covering the most new pairs.
    for (const row of rows) {
      let best = 0;
      let bestGain = -1;
      for (let v = 0; v < L[f]!; v++) {
        let gain = 0;
        for (let j = 0; j < f; j++) if (row[j] !== DC && uncovered.has(key(j, row[j]!, v))) gain++;
        if (gain > bestGain) [best, bestGain] = [v, gain];
      }
      row[f] = best;
      for (let j = 0; j < f; j++) if (row[j] !== DC) uncovered.delete(key(j, row[j]!, best));
    }

    // Vertical growth: fill don't-cares where possible, otherwise add a row.
    for (const pair of [...uncovered]) {
      const [j, vj, vf] = pair.split(':').map(Number) as [number, number, number];
      const host = rows.find((r) => r[f] === vf && r[j] === DC);
      if (host) host[j] = vj;
      else {
        const row = new Array<number>(f + 1).fill(DC);
        row[j] = vj;
        row[f] = vf;
        rows.push(row);
      }
      uncovered.delete(pair);
    }
  }
  // Don't-cares can take any value; restore the caller's flag order.
  return rows.map((r) => {
    const out = new Array<number>(k);
    order.forEach((orig, pos) => (out[orig] = r[pos] === DC || r[pos] === undefined ? 0 : r[pos]!));
    return out;
  });
}

/** True when every pair of values of every two flags appears in some row. */
export function coversAllPairs(rows: readonly number[][], levels: readonly number[]): boolean {
  for (let a = 0; a < levels.length; a++) {
    for (let b = a + 1; b < levels.length; b++) {
      const seen = new Set(rows.map((r) => r[a]! * 1000 + r[b]!));
      for (let x = 0; x < levels[a]!; x++) for (let y = 0; y < levels[b]!; y++) if (!seen.has(x * 1000 + y)) return false;
    }
  }
  // A single flag still needs each of its values once.
  if (levels.length === 1) return new Set(rows.map((r) => r[0])).size === levels[0];
  return true;
}

export interface PairwisePlan {
  rows: number[][];
  method: 'kleitman-spencer' | 'ipog';
  /** No pairwise plan can have fewer rows. */
  lowerBound: number;
  optimal: boolean;
  /** Rows needed to try every combination. */
  exhaustive: bigint;
}

/** The best plan we can build: exact construction for on/off flags, IPOG otherwise. */
export function pairwisePlan(levels: readonly number[]): PairwisePlan {
  const exhaustive = levels.reduce((p, l) => p * BigInt(l), levels.length ? 1n : 0n);
  if (levels.length > 0 && levels.every((l) => l === 2)) {
    const rows = binaryCoveringArray(levels.length);
    return { rows, method: 'kleitman-spencer', lowerBound: rows.length, optimal: true, exhaustive };
  }
  const rows = mixedCoveringArray(levels);
  const lowerBound = pairwiseLowerBound(levels);
  return { rows, method: 'ipog', lowerBound, optimal: rows.length === lowerBound, exhaustive };
}
