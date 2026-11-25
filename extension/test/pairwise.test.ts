import { describe, expect, it } from 'vitest';
import { binaryCoveringArray, binomial, coversAllPairs, mixedCoveringArray, optimalBinaryRuns, pairwiseLowerBound, pairwisePlan } from '../src/core/pairwise';

/** Smallest N with C(N-1, ceil(N/2)) >= k, by brute force over the definition. */
function bruteForceOptimal(k: number): number {
  for (let n = 1; ; n++) if (binomial(n - 1, Math.ceil(n / 2)) >= k) return Math.max(n, 2);
}

describe('on/off flags (Kleitman–Spencer)', () => {
  it('matches the known optimal sizes', () => {
    // k: 1 2 3 4 5..10 11..15 16..35 36..56 …
    expect([1, 2, 3, 4, 5, 10, 11, 15, 16, 35, 36, 56, 57].map(optimalBinaryRuns)).toEqual([2, 4, 4, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10]);
    expect(optimalBinaryRuns(100)).toBe(10);
    expect(optimalBinaryRuns(1000)).toBe(14);
  });

  it('builds a covering array of exactly the optimal size for k = 1…200', () => {
    for (let k = 1; k <= 200; k++) {
      const rows = binaryCoveringArray(k);
      expect(rows.length).toBe(bruteForceOptimal(k));
      expect(rows.every((r) => r.length === k)).toBe(true);
      expect(coversAllPairs(rows, new Array(k).fill(2))).toBe(true);
    }
  });

  it('is far smaller than trying everything', () => {
    const plan = pairwisePlan(new Array(10).fill(2));
    expect(plan).toMatchObject({ method: 'kleitman-spencer', optimal: true, exhaustive: 1024n });
    expect(plan.rows.length).toBe(6);
  });
});

describe('flags with more values (IPOG)', () => {
  it('covers every pair for many random mixes of value counts', { timeout: 60_000 }, () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 300; t++) {
      const levels = Array.from({ length: 1 + Math.floor(rand() * 9) }, () => 2 + Math.floor(rand() * 4));
      const rows = mixedCoveringArray(levels);
      expect(coversAllPairs(rows, levels)).toBe(true);
      expect(rows.length).toBeGreaterThanOrEqual(pairwiseLowerBound(levels));
      expect(rows.every((r) => r.every((v, i) => v >= 0 && v < levels[i]!))).toBe(true);
    }
  });

  it('reaches the lower bound on simple mixes and says so', () => {
    const plan = pairwisePlan([4, 2, 2, 2]);
    expect(plan.method).toBe('ipog');
    expect(plan.lowerBound).toBe(8);
    expect(plan.rows.length).toBe(8);
    expect(plan.optimal).toBe(true);
  });

  it('improves on IPOG with simulated annealing', () => {
    // Four 3-value flags: an orthogonal array gives 9 rows (= the lower bound); IPOG alone finds 10.
    expect(pairwisePlan([3, 3, 3, 3])).toMatchObject({ optimal: true, lowerBound: 9 });
    expect(pairwisePlan([3, 3, 3, 3]).rows.length).toBe(9);
    // One 3-value flag and five on/off flags: 6 rows are impossible (each on/off column would have to split every
    // pair of rows sharing a value, leaving only 4 usable columns), so 7 is optimal even though the bound says 6.
    const mix = pairwisePlan([3, 2, 2, 2, 2, 2]);
    expect(mix.rows.length).toBe(7);
    expect(mix).toMatchObject({ lowerBound: 7, optimal: true });
    expect(coversAllPairs(mix.rows, [3, 2, 2, 2, 2, 2])).toBe(true);
  });

  it('proves 2a runs impossible when there are more than 2^(a-1) on/off flags', () => {
    // Brute force for a = 3, four or five on/off flags, N = 6: search every assignment of the on/off columns.
    const feasible = (k: number) => {
      const big = [0, 0, 1, 1, 2, 2];
      const cols: number[][] = [];
      for (let m = 0; m < 64; m++) cols.push([0, 1, 2, 3, 4, 5].map((r) => (m >> r) & 1));
      const ok = (c: number[]) => [0, 1, 2].every((v) => [0, 1].every((x) => big.some((bv, r) => bv === v && c[r] === x)));
      const good = cols.filter(ok);
      const pair = (c: number[], d: number[]) => [0, 1].every((x) => [0, 1].every((y) => c.some((cv, r) => cv === x && d[r] === y)));
      const pick = (chosen: number[][], start: number): boolean =>
        chosen.length === k || good.slice(start).some((c, i) => chosen.every((d) => pair(c, d)) && pick([...chosen, c], start + i + 1));
      return pick([], 0);
    };
    expect(feasible(4)).toBe(true);
    expect(feasible(5)).toBe(false);
    expect(pairwiseLowerBound([3, 2, 2, 2, 2])).toBe(6);
    expect(pairwiseLowerBound([3, 2, 2, 2, 2, 2])).toBe(7);
  });

  it('uses the on/off flags for a stronger lower bound', () => {
    expect(pairwiseLowerBound([3, ...new Array(20).fill(2)])).toBe(optimalBinaryRuns(20));
  });

  it('handles one flag and no flags', () => {
    expect(pairwisePlan([3]).rows.length).toBe(3);
    expect(pairwisePlan([]).rows).toEqual([]);
  });
});

describe('test plan document', async () => {
  const { buildPlan, testPlanMarkdown, pairCount } = await import('../src/core/testPlan');
  const onoff = [
    { enabled: false, value: null },
    { enabled: true, value: null },
  ];
  it('renders the table, JSON and GitHub Actions matrix for the optimal plan', () => {
    const flags = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, levels: onoff }));
    const plan = buildPlan(flags);
    const md = testPlanMarkdown(flags, plan, { project: 'Shop', source: 'test' });
    expect(md).toContain('**6 runs instead of 64**');
    expect(md).toContain('Provably optimal');
    expect(pairCount(flags)).toBe(60);
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md)![1]!) as Record<string, { enabled: boolean }>[];
    expect(json).toHaveLength(6);
    expect(Object.keys(json[0]!)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(md.match(/^ {6}- \{ run: \d+, a: (true|false)/gm)).toHaveLength(6);
  });

  it('labels values and reports IPOG plans honestly', () => {
    const flags = [
      { name: 'color', levels: ['blue', 'green', 'orange'].map((value) => ({ enabled: true, value })) },
      { name: 'limit', levels: [{ enabled: false, value: null }, { enabled: true, value: 50 }, { enabled: true, value: 500 }] },
      { name: 'beta', levels: onoff },
    ];
    const md = testPlanMarkdown(flags, buildPlan(flags), { project: 'Shop', source: 'test' });
    expect(md).toMatch(/\| 1 \| "blue" \| off \| off \|/);
    expect(md).toContain('**Optimal.**');
    expect(md).toContain('limit: "500"');
  });
});
