// "Check Targeting Rules" (segment-override problems, core/rules.ts) and "Generate Pairwise Test Plan"
// (core/pairwise.ts). Both open a Markdown document that can be pasted into a PR or an issue.

import * as vscode from 'vscode';
import type { App } from '../app';
import type { FlagValue } from '../api/types';
import type { FindingKind } from '../core/rules';
import { buildPlan, levelLabel, testPlanMarkdown, type Level, type PlanFlag } from '../core/testPlan';
import type { FlagRow } from '../core/model';

const TITLES: Record<FindingKind, string> = {
  shadowed: 'Never applies (shadowed)',
  'matches-nobody': 'Segment matches nobody',
  redundant: 'Changes nothing (redundant)',
  'default-unreachable': 'Default never served',
};

async function showMarkdown(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(doc, { preview: false });
}

/** Markdown report of every finding, grouped by environment. Returned for tests. */
export async function checkRulesCommand(app: App, opts: { show?: boolean } = {}): Promise<string> {
  const { store } = app;
  if (!store.connected) {
    void vscode.commands.executeCommand('flaglens.connect');
    return '';
  }
  if (!store.previewSupported) {
    void vscode.window.showWarningMessage('FlagLens: this Flagsmith server did not return environment documents, so targeting rules cannot be checked.');
    return '';
  }
  const findings = store.ruleFindings();
  const overrides = [...store.documents.values()].reduce((n, d) => n + d.project.segments.reduce((m, s) => m + s.feature_states.length, 0), 0);
  if (findings.length === 0) {
    void vscode.window.showInformationMessage(`FlagLens: no problems in ${overrides} segment override${overrides === 1 ? '' : 's'} across ${store.environments.length} environments.`);
    return '';
  }
  const lines = [
    `# Targeting rule check: ${store.project?.name ?? ''}`,
    '',
    `${findings.length} problem${findings.length === 1 ? '' : 's'} in ${overrides} segment overrides across ${store.environments.length} environments.`,
    '',
    'Each finding holds for **every possible user**: FlagLens splits trait values into equivalence classes from the constants in the rules and checks every class (conditions it cannot split, such as regexes, are treated as free, which can only hide a problem, never invent one).',
    '',
  ];
  for (const env of store.environments) {
    const here = findings.filter((f) => f.environment === env.name);
    if (!here.length) continue;
    lines.push(`## ${env.name}`, '', '| Flag | Problem | Details |', '|---|---|---|');
    for (const f of here) lines.push(`| \`${f.flag}\` | ${TITLES[f.kind]} | ${f.message.replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  const md = lines.join('\n');
  if (opts.show !== false) await showMarkdown(md);
  return md;
}

/** The values a flag takes in tests: on/off, or (values mode) off plus every value in use anywhere. */
export function levelsFor(app: App, row: FlagRow, mode: 'onoff' | 'values'): Level[] {
  const { store } = app;
  const active = store.activeEnvironment;
  if (row.feature.variants.length) {
    const control = (active && row.states.get(active.id)?.value) ?? null;
    const values = [control, ...row.feature.variants.map((v) => v.value)];
    return [...new Map(values.map((v) => [JSON.stringify(v), v])).values()].map((value) => ({ enabled: true, value }));
  }
  if (mode === 'values') {
    const seen = new Map<string, FlagValue>();
    const add = (v: FlagValue) => {
      if (v !== null && v !== '') seen.set(JSON.stringify(v), v);
    };
    for (const s of row.states.values()) add(s.value);
    for (const d of store.documents.values()) for (const seg of d.project.segments) for (const fs of seg.feature_states) if (fs.feature.name === row.feature.name) add(fs.feature_state_value);
    if (seen.size) return [{ enabled: false, value: null }, ...[...seen.values()].map((value) => ({ enabled: true, value }))];
  }
  return [
    { enabled: false, value: null },
    { enabled: true, value: null },
  ];
}

/**
 * Builds a pairwise test plan for chosen flags. Without arguments it asks which flags (the ones used in the active
 * editor are preselected) and, when it matters, whether to test on/off only or every value in use.
 */
export async function testPlanCommand(app: App, keys?: string[], mode?: 'onoff' | 'values', opts: { show?: boolean } = {}): Promise<string> {
  const { store } = app;
  if (!store.connected) {
    void vscode.commands.executeCommand('flaglens.connect');
    return '';
  }
  let source = 'chosen in FlagLens';
  if (!keys) {
    const editor = vscode.window.activeTextEditor;
    const inFile = new Set(editor ? app.refs.get(editor.document).map((r) => r.key) : []);
    const rows = [...store.rows.values()].filter((r) => !r.feature.isArchived).sort((a, b) => a.feature.name.localeCompare(b.feature.name));
    const items = rows.map((r) => ({
      label: r.feature.name,
      description: inFile.has(r.feature.name) ? 'used in this file' : undefined,
      detail: levelsFor(app, r, 'values').map(levelLabel).join(' · '),
      picked: inFile.has(r.feature.name),
    }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: 'Pairwise test plan: which flags?',
      placeHolder: 'Every pair of values of these flags will be tested together, in as few runs as possible',
      matchOnDetail: true,
    });
    if (!picked?.length) return '';
    keys = picked.map((p) => p.label);
    const offered = rows.filter((r) => inFile.has(r.feature.name)).length;
    source = offered && keys.length === offered && keys.every((k) => inFile.has(k)) ? `the flags used in \`${vscode.workspace.asRelativePath(editor!.document.uri)}\`` : 'chosen in FlagLens';
  }
  const rows = keys.map((k) => store.row(k)).filter((r): r is FlagRow => !!r);
  const flagsFor = (m: 'onoff' | 'values'): PlanFlag[] => rows.map((r) => ({ name: r.feature.name, levels: levelsFor(app, r, m) }));

  if (!mode) {
    const onoff = buildPlan(flagsFor('onoff'));
    const values = buildPlan(flagsFor('values'));
    if (values.rows.length === onoff.rows.length && values.exhaustive === onoff.exhaustive) mode = 'onoff';
    else {
      const pick = await vscode.window.showQuickPick(
        [
          { label: `On/off only: ${onoff.rows.length} runs`, description: `instead of ${onoff.exhaustive.toLocaleString('en-GB')}`, mode: 'onoff' as const },
          { label: `Every value in use: ${values.rows.length} runs`, description: `instead of ${values.exhaustive.toLocaleString('en-GB')}`, detail: 'Off, plus each value the flag has in any environment or segment override', mode: 'values' as const },
        ],
        { title: 'Pairwise test plan: which values?' },
      );
      if (!pick) return '';
      mode = pick.mode;
    }
  }
  const flags = flagsFor(mode);
  const md = testPlanMarkdown(flags, buildPlan(flags), { project: store.project?.name ?? '', source });
  if (opts.show !== false) await showMarkdown(md);
  return md;
}
