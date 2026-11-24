// Shared wording and formatting, so CodeLens, hover, tree, diagnostics and the matrix describe a flag the same way.

import * as vscode from 'vscode';
import { describeState, driftFor, relativeTime, staleness, type DriftResult, type StaleResult } from './core/analysis';
import { formatValue, type FlagRow, type FsEnvironment, type FsState } from './core/model';
import type { Settings } from './config';
import type { FlagStore } from './store/flagStore';

export interface Ctx {
  store: FlagStore;
  settings(): Settings;
}

export function stateGlyph(s: FsState | undefined): string {
  if (!s) return '—';
  return s.enabled ? '●' : '○';
}

/** "● on", "○ off", "● on · 100" */
export function stateShort(s: FsState | undefined, maxValue = 24): string {
  if (!s) return '— no state';
  const v = formatValue(s.value, maxValue);
  return `${stateGlyph(s)} ${s.enabled ? 'on' : 'off'}${v ? ` · ${v}` : ''}`;
}

export function staleThreshold(ctx: Ctx): number {
  const s = ctx.settings();
  if (s.staleAfterDaysExplicit) return s.staleAfterDays;
  return ctx.store.project?.stale_flags_limit_days ?? s.staleAfterDays;
}

export function staleFor(ctx: Ctx, row: FlagRow, now = Date.now()): StaleResult {
  return staleness(
    row,
    ctx.store.environments.map((e) => e.id),
    { now, thresholdDays: staleThreshold(ctx), permanentTags: ctx.settings().permanentTags },
  );
}

export function driftOf(ctx: Ctx, row: FlagRow): DriftResult {
  return driftFor(row, ctx.store.environments, ctx.settings().driftEnvironments);
}

export function runningExperiments(row: FlagRow) {
  return row.experiments.filter((x) => x.status === 'running');
}

export interface Badge {
  icon: string;
  label: string;
  detail: string;
}

export function badgesFor(ctx: Ctx, row: FlagRow): Badge[] {
  const out: Badge[] = [];
  if (row.feature.isArchived) out.push({ icon: '$(archive)', label: 'archived', detail: 'Archived in Flagsmith' });
  const drift = driftOf(ctx, row);
  if (drift.drifted) out.push({ icon: '$(warning)', label: 'drift', detail: `Drift: ${drift.detail}` });
  const exps = runningExperiments(row);
  if (exps.length) {
    const envs = exps.map((x) => ctx.store.environment(x.envId)?.name ?? '?').join(', ');
    out.push({ icon: '$(lock)', label: 'experiment', detail: `Locked by experiment "${exps[0]!.name}" in ${envs}` });
  }
  const stale = staleFor(ctx, row);
  if (stale.stale) out.push({ icon: '$(trash)', label: 'stale', detail: staleSentence(row.feature.name, stale) });
  return out;
}

export function staleSentence(name: string, stale: StaleResult): string {
  const age = stale.days === 0 ? 'today' : `for ${stale.days} day${stale.days === 1 ? '' : 's'}`;
  return `${name} has been ${stale.state?.toUpperCase()} in every environment, unchanged ${age}. Consider removing the flag and its dead code path.`;
}

/** One-line summary for CodeLens: "Development ● on · Staging ● on · Production ○ off" */
export function lensSummary(ctx: Ctx, row: FlagRow): string {
  return ctx.store.environments.map((e) => `${e.name} ${stateShort(row.states.get(e.id), 18)}`).join('   ');
}

export function dashboardUrl(ctx: Ctx, row?: FlagRow, env?: FsEnvironment): string | undefined {
  const conn = ctx.store.connection;
  const target = env ?? ctx.store.activeEnvironment;
  if (!conn || !target) return undefined;
  const base = `${conn.dashboardUrl}/project/${conn.project.id}/environment/${target.apiKey}/features`;
  return row ? `${base}?feature=${row.feature.id}` : base;
}

export function commandUri(command: string, ...args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

const HOVER_COMMANDS = ['flaglens.toggleFlag', 'flaglens.setValue', 'flaglens.openInDashboard', 'flaglens.showHistory', 'flaglens.createFlag', 'flaglens.openMatrix'];

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

function valueCell(v: FsState['value']): string {
  if (v === null || v === '') return '';
  const text = typeof v === 'string' ? v : String(v);
  return `\`${text.replace(/`/g, "'").slice(0, 60)}\``;
}

/** The hover card / tree tooltip for a flag. */
export function flagMarkdown(ctx: Ctx, row: FlagRow, now = Date.now()): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: HOVER_COMMANDS };
  md.supportHtml = false;
  const f = row.feature;
  const key = f.name;
  const kind = f.type === 'MULTIVARIATE' ? 'Multivariate flag' : 'Flag';
  const tags = f.tags.map((t) => `\`${escapeMd(t.label)}\``).join(' ');
  md.appendMarkdown(`**$(flag) ${escapeMd(key)}** · ${kind}${tags ? ` · ${tags}` : ''}  \n`);
  if (f.description) md.appendMarkdown(`${escapeMd(f.description)}\n\n`);
  else md.appendMarkdown('\n');

  md.appendMarkdown('| Environment | State | Value | |\n|---|---|---|---|\n');
  const active = ctx.store.activeEnvironment;
  for (const env of ctx.store.environments) {
    const s = row.states.get(env.id);
    const name = `${env.id === active?.id ? '**' : ''}${escapeMd(env.name)}${env.id === active?.id ? '**' : ''}`;
    const marks = `${env.protected ? ' $(shield)' : ''}${env.v2Versioning ? ' $(versions)' : ''}`;
    const state = s ? `${stateGlyph(s)} ${s.enabled ? 'on' : 'off'}` : '—';
    const action =
      s && !env.v2Versioning && !f.isArchived && !runningExperiments(row).some((x) => x.envId === env.id)
        ? `[$(debug-start) ${s.enabled ? 'Turn off' : 'Turn on'}](${commandUri('flaglens.toggleFlag', key, env.id)} "Toggle ${key} in ${env.name}")`
        : '';
    md.appendMarkdown(`| ${name}${marks} | ${state} | ${s ? valueCell(s.value) : ''} | ${action} |\n`);
  }
  md.appendMarkdown('\n');

  for (const b of badgesFor(ctx, row)) md.appendMarkdown(`${b.icon} ${escapeMd(b.detail)}  \n`);

  if (f.variants.length) {
    const control = row.states.get(active?.id ?? -1)?.value;
    const weights = row.states.get(active?.id ?? -1)?.variantWeights;
    const parts = f.variants.map((v) => `\`${escapeMd(String(v.key ?? v.value))}\` ${weights?.get(v.id) ?? v.weight}%`);
    md.appendMarkdown(`$(symbol-enum) Variants in ${escapeMd(active?.name ?? '')}: control ${valueCell(control ?? null) || '—'} · ${parts.join(' · ')}  \n`);
  }
  const overrides = [`${f.segmentOverrides} segment override${f.segmentOverrides === 1 ? '' : 's'}`];
  if (f.identityOverrides) overrides.push(`${f.identityOverrides} identity override${f.identityOverrides === 1 ? '' : 's'}`);
  const stale = staleFor(ctx, row, now);
  md.appendMarkdown(`$(person) ${overrides.join(' · ')} · $(clock) last changed ${relativeTime(stale.lastChanged, now)}\n\n`);

  const links = [
    `[$(edit) Set value…](${commandUri('flaglens.setValue', key)})`,
    `[$(history) History](${commandUri('flaglens.showHistory', key)})`,
    `[$(link-external) Open in Flagsmith](${commandUri('flaglens.openInDashboard', key)})`,
  ];
  md.appendMarkdown(links.join(' · '));
  return md;
}

/** Hover for a key that doesn't exist in the project. */
export function unknownFlagMarkdown(ctx: Ctx, key: string, suggestion: string | undefined): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: HOVER_COMMANDS };
  md.appendMarkdown(`**$(warning) ${escapeMd(key)}** is not a flag in Flagsmith project *${escapeMd(ctx.store.project?.name ?? '')}*.\n\n`);
  md.appendMarkdown('Every Flagsmith SDK silently returns the default for unknown keys, so this code path may never run.\n\n');
  if (suggestion) md.appendMarkdown(`Did you mean \`${escapeMd(suggestion)}\`? `);
  md.appendMarkdown(`[$(add) Create \`${escapeMd(key)}\` in Flagsmith…](${commandUri('flaglens.createFlag', key)})`);
  return md;
}

export { describeState };
