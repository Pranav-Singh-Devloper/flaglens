// Markdown reports. Pure: unit-tested in test/report.test.ts.

import { describeState } from './analysis';
import type { FlagRow, FsEnvironment } from './model';

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export interface DiffLine {
  flag: string;
  a: string;
  b: string;
}

/** Flags whose state differs between two environments (missing states included), sorted by name. */
export function diffEnvironments(rows: Iterable<FlagRow>, a: FsEnvironment, b: FsEnvironment): DiffLine[] {
  const out: DiffLine[] = [];
  for (const row of rows) {
    if (row.feature.isArchived) continue;
    const sa = row.states.get(a.id);
    const sb = row.states.get(b.id);
    const da = describeState(sa);
    const db = describeState(sb);
    if (da !== db) out.push({ flag: row.feature.name, a: da, b: db });
  }
  return out.sort((x, y) => x.flag.localeCompare(y.flag));
}

/** A Markdown table ready to paste into a pull request or change request. */
export function diffMarkdown(lines: DiffLine[], a: FsEnvironment, b: FsEnvironment, meta: { project: string; source: string; at: Date }): string {
  const header = `### Flagsmith drift: ${cell(a.name)} → ${cell(b.name)} (${cell(meta.project)})\n\n`;
  if (lines.length === 0) return `${header}No differences: every flag has the same state and value in both environments.\n`;
  const table = [
    `| Flag | ${cell(a.name)} | ${cell(b.name)} |`,
    '|---|---|---|',
    ...lines.map((l) => `| \`${cell(l.flag)}\` | ${cell(l.a)} | ${cell(l.b)} |`),
  ].join('\n');
  const footer = `\n\n<sub>${lines.length} difference${lines.length === 1 ? '' : 's'} · read from ${cell(meta.source)} at ${meta.at.toISOString().replace('T', ' ').slice(0, 16)} UTC by FlagLens</sub>\n`;
  return header + table + footer;
}
