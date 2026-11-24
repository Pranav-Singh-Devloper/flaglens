import { describe, expect, it } from 'vitest';
import { diffEnvironments, diffMarkdown } from '../src/core/report';
import { ENVS, row } from './fixtures';

const [, STG, PRD] = ENVS as [unknown, (typeof ENVS)[number], (typeof ENVS)[number]];
const meta = { project: 'Demo Shop', source: 'http://localhost:8000', at: new Date('2026-11-27T10:00:00Z') };

describe('diffEnvironments', () => {
  const rows = [
    row('rate_limit', { 2: [true, 100], 3: [true, 50] }),
    row('new_checkout', { 2: [true, null], 3: [false, null] }),
    row('same', { 2: [true, 'x'], 3: [true, 'x'] }),
    row('only_staging', { 2: [true, null] }),
    row('archived', { 2: [true, null], 3: [false, null] }, { isArchived: true }),
  ];

  it('lists differences sorted by name, skipping archived and identical flags', () => {
    expect(diffEnvironments(rows, STG, PRD)).toEqual([
      { flag: 'new_checkout', a: 'on', b: 'off' },
      { flag: 'only_staging', a: 'on', b: '—' },
      { flag: 'rate_limit', a: 'on 100', b: 'on 50' },
    ]);
  });

  it('renders a paste-ready Markdown table', () => {
    const md = diffMarkdown(diffEnvironments(rows, STG, PRD), STG, PRD, meta);
    expect(md).toContain('### Flagsmith drift: Staging → Production (Demo Shop)');
    expect(md).toContain('| Flag | Staging | Production |');
    expect(md).toContain('| `rate_limit` | on 100 | on 50 |');
    expect(md).toContain('3 differences');
    expect(md).toContain('2026-11-27 10:00 UTC');
  });

  it('escapes pipes and says so when there is nothing to report', () => {
    const md = diffMarkdown([{ flag: 'a|b', a: 'on "x|y"', b: 'off' }], STG, PRD, meta);
    expect(md).toContain('a\\|b');
    expect(diffMarkdown([], STG, PRD, meta)).toMatch(/No differences/);
  });
});
