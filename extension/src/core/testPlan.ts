// Turns flags and their values into a pairwise test plan document (Markdown table, JSON, GitHub Actions matrix).
// Pure: no VS Code imports.

import type { FlagValue } from '../api/types';
import { optimalBinaryRuns, pairwisePlan, type PairwisePlan } from './pairwise';

/** One value a flag can take in a test run. */
export interface Level {
  enabled: boolean;
  value: FlagValue;
}

export interface PlanFlag {
  name: string;
  levels: Level[];
}

export function levelLabel(l: Level): string {
  if (!l.enabled) return 'off';
  return l.value === null || l.value === '' ? 'on' : JSON.stringify(l.value);
}

/** Every pair of values of two different flags: what the plan must cover. */
export function pairCount(flags: readonly PlanFlag[]): number {
  let n = 0;
  for (let a = 0; a < flags.length; a++) for (let b = a + 1; b < flags.length; b++) n += flags[a]!.levels.length * flags[b]!.levels.length;
  return n;
}

export function buildPlan(flags: readonly PlanFlag[]): PairwisePlan {
  return pairwisePlan(flags.map((f) => f.levels.length));
}

const yamlScalar = (l: Level) => (!l.enabled ? 'false' : l.value === null || l.value === '' ? 'true' : JSON.stringify(String(l.value)));

export function testPlanMarkdown(flags: readonly PlanFlag[], plan: PairwisePlan, context: { project: string; source: string }): string {
  const n = plan.rows.length;
  const k = flags.length;
  const exhaustive = plan.exhaustive.toLocaleString('en-GB');
  const lines: string[] = [];
  lines.push(`# Pairwise test plan: ${k} flag${k === 1 ? '' : 's'} in ${context.project}`, '');
  lines.push(
    `Every pair of values of any two of these flags appears together in at least one run (${pairCount(flags)} pairs): ` +
      `**${n} run${n === 1 ? '' : 's'} instead of ${exhaustive}** for every combination.`,
    '',
  );
  if (plan.method === 'kleitman-spencer') {
    lines.push(
      `**Provably optimal.** For on/off flags the smallest such plan has the smallest N with C(N−1, ⌈N/2⌉) ≥ k ` +
        `(Katona; Kleitman & Spencer, 1973). For k = ${k} that is N = ${optimalBinaryRuns(k)}, and this plan uses that construction.`,
      '',
    );
  } else {
    lines.push(
      plan.optimal
        ? `**Optimal.** No plan can have fewer than ${plan.lowerBound} runs, and this one has ${n}. Built with IPOG (Lei & Tai, 2007) and simulated annealing (Cohen et al., 2003).`
        : `Built with IPOG (Lei & Tai, 2007) and shrunk with simulated annealing (Cohen et al., 2003). No plan can have fewer than ${plan.lowerBound} runs (the two flags with most values need every pair of their values, and the on/off flags need a plan of their own).`,
      '',
    );
  }
  lines.push(`Flags: ${context.source}.`, '');

  lines.push(`| Run | ${flags.map((f) => `\`${f.name}\``).join(' | ')} |`);
  lines.push(`|---:|${flags.map(() => '---').join('|')}|`);
  plan.rows.forEach((row, i) => {
    lines.push(`| ${i + 1} | ${row.map((v, j) => levelLabel(flags[j]!.levels[v]!)).join(' | ')} |`);
  });
  lines.push('');

  lines.push('## How to use it', '');
  lines.push(
    'Run your tests once per row with the flags set as shown: for example stub `isFeatureEnabled` / `getFeatureValue` ' +
      'from the JSON below in unit tests, or point an end-to-end job at a test environment configured per row. ' +
      'Interaction bugs between two flags show up in at least one run.',
    '',
  );
  lines.push('### JSON (one object per run)', '', '```json');
  const json = plan.rows.map((row) => Object.fromEntries(row.map((v, j) => [flags[j]!.name, flags[j]!.levels[v]!])));
  lines.push(JSON.stringify(json, null, 2), '```', '');
  lines.push('### GitHub Actions matrix', '', '```yaml', 'strategy:', '  matrix:', '    include:');
  plan.rows.forEach((row, i) => {
    lines.push(`      - { run: ${i + 1}, ${row.map((v, j) => `${flags[j]!.name}: ${yamlScalar(flags[j]!.levels[v]!)}`).join(', ')} }`);
  });
  lines.push('```', '');
  return lines.join('\n');
}
