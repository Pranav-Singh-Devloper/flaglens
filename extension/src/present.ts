// Shared wording and formatting, so CodeLens, hover, tree, diagnostics and the matrix describe a flag the same way.

import * as vscode from 'vscode';
import { describeState, driftFor, relativeTime, staleness, type DriftResult, type StaleResult } from './core/analysis';
import { describeReason, type Evaluated, type Persona } from './core/engine';
import { formatValue, type FlagRow, type FsEnvironment, type FsState } from './core/model';
import type { Settings } from './config';
import type { FlagStore } from './store/flagStore';

export interface Ctx {
  store: FlagStore;
  settings(): Settings;
}

type Shown = Pick<FsState, 'enabled' | 'value'>;

export function stateGlyph(s: Shown | undefined): string {
  if (!s) return '—';
  return s.enabled ? '●' : '○';
}

/** "● on", "○ off", "● on 100", "● on "Black Friday"" */
export function stateShort(s: Shown | undefined, maxValue = 24): string {
  if (!s) return '— no state';
  const v = formatValue(s.value, maxValue);
  return `${stateGlyph(s)} ${s.enabled ? 'on' : 'off'}${v ? ` ${v}` : ''}`;
}

/**
 * Gap between CodeLens sections. CodeLens text is rendered as HTML, which collapses runs of normal spaces, so we use
 * an em space (not collapsible) to keep sections visibly apart.
 */
export const LENS_GAP = '\u2003';

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

/** "Checkout errors: Error rate 4.2% …" from a Feature Health event's reason. */
export function healthReason(e: { reason?: { text_blocks?: { title?: string; text: string }[] } | null }): string {
  return (e.reason?.text_blocks ?? []).map((b) => (b.title ? `${b.title}: ${b.text}` : b.text)).join('; ');
}

/** Extra lines for a write confirmation: Flagsmith says the flag is unhealthy there, or a prerequisite blocks it. */
export function writeNotes(ctx: Ctx, row: FlagRow, env: FsEnvironment): string {
  const notes: string[] = [];
  const sick = ctx.store.unhealthy(row.feature.id).filter((u) => !u.env || u.env.id === env.id);
  for (const u of sick) notes.push(`Flagsmith Feature Health reports this flag UNHEALTHY${u.env ? ` in ${u.env.name}` : ''}${healthReason(u.event) ? `: ${healthReason(u.event)}` : ''}.`);
  if (env.v2Versioning) notes.push(`${env.name} uses feature versioning: this publishes a new version, and Flagsmith keeps the previous one in the flag's history.`);
  for (const d of ctx.store.dependencies(row.feature.name)) {
    if (d.env.id === env.id) notes.push(`Requires ${d.requires.join(', ')}${d.blocked ? `, which is off in ${env.name}: this flag is served OFF there until it is on` : ''}.`);
  }
  return notes.length ? `\n\n${notes.join('\n')}` : '';
}

export function badgesFor(ctx: Ctx, row: FlagRow): Badge[] {
  const out: Badge[] = [];
  const sick = ctx.store.unhealthy(row.feature.id);
  if (sick.length) {
    const where = sick.map((u) => u.env?.name ?? 'all environments').join(', ');
    out.push({ icon: '$(pulse)', label: 'unhealthy', detail: `Flagsmith Feature Health: UNHEALTHY in ${where}${healthReason(sick[0]!.event) ? ` (${healthReason(sick[0]!.event)})` : ''}` });
  }
  const blocked = ctx.store.dependencies(row.feature.name).filter((d) => d.blocked);
  if (blocked.length) {
    out.push({ icon: '$(link)', label: 'blocked', detail: `Requires ${blocked[0]!.requires.join(', ')}: served OFF in ${blocked.map((d) => d.env.name).join(', ')} although its own state is on` });
  }
  if (row.feature.lifecycle === 'to_remove') out.push({ icon: '$(trash)', label: 'to remove', detail: 'Flagsmith lifecycle: to remove' });
  if (row.feature.isArchived) out.push({ icon: '$(archive)', label: 'archived', detail: 'Archived in Flagsmith' });
  const drift = driftOf(ctx, row);
  if (drift.drifted) out.push({ icon: '$(warning)', label: 'drift', detail: `Drift: ${drift.detail}` });
  const exps = runningExperiments(row);
  if (exps.length) {
    const envs = exps.map((x) => ctx.store.environment(x.envId)?.name ?? '?').join(', ');
    out.push({ icon: '$(lock)', label: 'experiment', detail: `Locked by experiment "${exps[0]!.name}" in ${envs}` });
  }
  const findings = ctx.store.findingsFor(row.feature.name);
  if (findings.length) {
    const more = findings.length > 1 ? ` (and ${findings.length - 1} more: FlagLens: Check Targeting Rules)` : '';
    out.push({ icon: '$(circle-slash)', label: findings.length === 1 ? 'rule issue' : `${findings.length} rule issues`, detail: `${findings[0]!.message}${more}` });
  }
  const stale = staleFor(ctx, row);
  if (stale.stale) out.push({ icon: '$(trash)', label: 'stale', detail: staleSentence(row.feature.name, stale) });
  return out;
}

export function staleSentence(name: string, stale: StaleResult): string {
  const age = stale.days === 0 ? 'today' : `for ${stale.days} day${stale.days === 1 ? '' : 's'}`;
  return `${name} has been ${stale.state?.toUpperCase()} in every environment, unchanged ${age}. Consider removing the flag and its dead code path.`;
}

/** "Beta tester" or the identifier. */
export function personaName(p: Persona): string {
  return p.name || p.identifier;
}

/** "email=alice@demo-shop.dev, plan=pro" */
export function traitsText(p: Persona): string {
  return Object.entries(p.traits ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/** The state a flag has for the previewed persona in an environment (undefined without a persona). */
export function personaState(ctx: Ctx, row: FlagRow, envId: number): Evaluated | undefined {
  return ctx.store.evaluation(envId)?.get(row.feature.name);
}

/** Short "why" for CodeLens: "beta_testers", "override", "split 37%" */
function reasonShort(e: Evaluated): string {
  if (e.reason.kind === 'segment') return e.reason.segment;
  if (e.reason.kind === 'identity') return 'identity override';
  if (e.split) return `bucket ${e.split.bucket.toFixed(0)}`;
  return '';
}

/**
 * One-line summary for CodeLens: "Development ● on · Staging ● on · Production ○ off".
 * While previewing as a persona: that user's state in each environment, with the segment that decided it.
 */
export function lensSummary(ctx: Ctx, row: FlagRow): string {
  return ctx.store.environments
    .map((e) => {
      const p = personaState(ctx, row, e.id);
      if (!p) return `${e.name} ${stateShort(row.states.get(e.id), 18)}`;
      const why = reasonShort(p);
      return `${e.name} ${stateShort(p, 18)}${why ? ` (${why})` : ''}`;
    })
    .join(' · ');
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

/** Commands that links in hovers may run. A link to any other command does nothing when clicked. */
export const HOVER_COMMANDS = [
  'flaglens.previewAs',
  'flaglens.toggleFlag',
  'flaglens.setValue',
  'flaglens.setUserOverride',
  'flaglens.editSegmentOverrides',
  'flaglens.openInDashboard',
  'flaglens.showHistory',
  'flaglens.createFlag',
  'flaglens.openMatrix',
];

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

/** Inline code. Backslash escapes show literally inside code spans, so only backticks need handling. */
function code(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
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
  const tags = f.tags.map((t) => code(t.label)).join(' ');
  md.appendMarkdown(`**$(flag) ${escapeMd(key)}** · ${kind}${tags ? ` · ${tags}` : ''}  \n`);
  if (f.description) md.appendMarkdown(`${escapeMd(f.description)}\n\n`);
  else md.appendMarkdown('\n');

  // While previewing as a user, their result is an extra column, so the two can be compared at a glance.
  const persona = ctx.store.persona && ctx.store.previewSupported ? ctx.store.persona : undefined;
  if (persona) {
    const traits = traitsText(persona);
    md.appendMarkdown(
      `$(person) Previewing as **${escapeMd(personaName(persona))}** · ${code(persona.identifier)}${traits ? ` · ${escapeMd(traits)}` : ''} · [change](${commandUri('flaglens.previewAs')} "Preview as another user")\n\n`,
    );
  }
  md.appendMarkdown(
    persona
      ? `| Environment | State | Value | ${escapeMd(personaName(persona))} gets | |\n|---|---|---|---|---|\n`
      : '| Environment | State | Value | |\n|---|---|---|---|\n',
  );
  const active = ctx.store.activeEnvironment;
  for (const env of ctx.store.environments) {
    const s = row.states.get(env.id);
    const name = `${env.id === active?.id ? '**' : ''}${escapeMd(env.name)}${env.id === active?.id ? '**' : ''}`;
    const marks = `${env.protected ? ' $(shield)' : ''}${env.v2Versioning ? ' $(versions)' : ''}`;
    const state = s ? `${stateGlyph(s)} ${s.enabled ? 'on' : 'off'}` : '—';
    const action =
      s && !f.isArchived && !runningExperiments(row).some((x) => x.envId === env.id)
        ? `[$(debug-start) ${s.enabled ? 'Turn off' : 'Turn on'}](${commandUri('flaglens.toggleFlag', key, env.id)} "Toggle ${key} in ${env.name}")`
        : '';
    const p = persona ? personaState(ctx, row, env.id) : undefined;
    const why = p && (p.reason.kind !== 'default' || p.split) ? ` · ${whyMarkdown(p)}` : '';
    const personaCell = persona ? ` ${p ? `${stateGlyph(p)} ${p.enabled ? 'on' : 'off'} ${valueCell(p.value)}${why}` : '—'} |` : '';
    md.appendMarkdown(`| ${name}${marks} | ${state} | ${s ? valueCell(s.value) : ''} |${personaCell} ${action} |\n`);
  }
  md.appendMarkdown('\n');
  if (!persona && ctx.store.previewSupported && (ctx.store.segmentOverrides(key).size || f.identityOverrides || f.variants.length)) {
    md.appendMarkdown(`$(person) Users can get different values: [preview as a user…](${commandUri('flaglens.previewAs')} "See exactly what one user gets")  \n`);
  }

  for (const b of badgesFor(ctx, row)) md.appendMarkdown(`${b.icon} ${escapeMd(b.detail)}  \n`);

  if (f.variants.length) {
    const control = row.states.get(active?.id ?? -1)?.value;
    const weights = row.states.get(active?.id ?? -1)?.variantWeights;
    const parts = f.variants.map((v) => `${code(String(v.key ?? v.value))} ${weights?.get(v.id) ?? v.weight}%`);
    md.appendMarkdown(`$(symbol-enum) Variants in ${escapeMd(active?.name ?? '')}: control ${valueCell(control ?? null) || '—'} · ${parts.join(' · ')}  \n`);
  }
  // Exact per-environment overrides from the environment documents; the features list alone can't count them.
  const byEnv = ctx.store.segmentOverrides(key);
  const segmentText = ctx.store.previewSupported
    ? byEnv.size
      ? `segment overrides: ${[...byEnv].map(([env, segs]) => `${escapeMd(env)} (${segs.map(code).join(', ')})`).join(' · ')}`
      : 'no segment overrides'
    : `${f.segmentOverrides} segment override${f.segmentOverrides === 1 ? '' : 's'}`;
  const overrides = [segmentText];
  for (const d of ctx.store.dependencies(key)) {
    md.appendMarkdown(`$(link) Requires ${d.requires.map(code).join(', ')} in ${escapeMd(d.env.name)}${d.blocked ? ': **served off** there until it is on' : ''}  \n`);
  }
  for (const u of ctx.store.unhealthy(f.id)) {
    const links = (u.event.reason?.url_blocks ?? []).map((b) => `[${escapeMd(b.title ?? 'details')}](${b.url})`).join(' · ');
    const onThere = u.env && row.states.get(u.env.id)?.enabled;
    const kill = onThere ? ` · [$(debug-stop) Turn off in ${escapeMd(u.env!.name)}](${commandUri('flaglens.toggleFlag', key, u.env!.id)} "Turn the flag off where it is unhealthy")` : '';
    md.appendMarkdown(`$(pulse) **Unhealthy** in ${escapeMd(u.env?.name ?? 'all environments')} (Flagsmith Feature Health, ${escapeMd(u.event.provider_name)})${healthReason(u.event) ? `: ${escapeMd(healthReason(u.event))}` : ''}${links ? ` · ${links}` : ''}${kill}  \n`);
  }
  const facts: string[] = [];
  if (f.lifecycle) facts.push(`lifecycle in ${escapeMd(ctx.store.activeEnvironment?.name ?? '')}: **${f.lifecycle.replace('_', ' ')}**`);
  if (f.codeReferences) facts.push(`${f.codeReferences} code reference${f.codeReferences === 1 ? '' : 's'} in Flagsmith`);
  if (f.owners.length) facts.push(`owners: ${escapeMd(f.owners.join(', '))}`);
  if (facts.length) md.appendMarkdown(`$(info) Flagsmith ${facts.join(' · ')}  \n`);
  if (f.identityOverrides) overrides.push(`${f.identityOverrides} identity override${f.identityOverrides === 1 ? '' : 's'}`);
  const stale = staleFor(ctx, row, now);
  md.appendMarkdown(`$(person) ${overrides.join(' · ')} · $(clock) last changed ${relativeTime(stale.lastChanged, now)}\n\n`);

  const links = [
    ...(persona ? [`[$(person-add) Set for ${escapeMd(personaName(persona))}…](${commandUri('flaglens.setUserOverride', key)} "Identity override in Flagsmith")`] : []),
    `[$(edit) Set value…](${commandUri('flaglens.setValue', key)})`,
    `[$(organization) Segment overrides…](${commandUri('flaglens.editSegmentOverrides', key)})`,
    `[$(history) History](${commandUri('flaglens.showHistory', key)})`,
    `[$(link-external) Open in Flagsmith](${commandUri('flaglens.openInDashboard', key)})`,
  ];
  md.appendMarkdown(links.join(' · '));
  return md;
}

/** "segment beta_testers (priority 0)", "bucket 37.21 → green (0–50%)", "environment default" */
export function whyText(e: Evaluated): string {
  const parts = [describeReason(e.reason) + (e.reason.kind === 'segment' && e.reason.priority !== null ? ` (priority ${e.reason.priority})` : '')];
  if (e.split) parts.push(`bucket ${e.split.bucket.toFixed(2)} → ${e.split.variant} (${round(e.split.from)}–${round(e.split.to)}%)`);
  return parts.join(' · ');
}

const round = (n: number) => String(Math.round(n * 100) / 100);

/** whyText as Markdown, with the segment name as code so underscores survive. */
export function whyMarkdown(e: Evaluated): string {
  if (e.reason.kind === 'segment') {
    const head = `segment ${code(e.reason.segment)}${e.reason.priority !== null ? ` (priority ${e.reason.priority})` : ''}`;
    return e.split ? `${head} · ${escapeMd(whyText(e).split(' · ').slice(1).join(' · '))}` : head;
  }
  return escapeMd(whyText(e));
}

/** Hover for a key that doesn't exist in the project. */
export function unknownFlagMarkdown(ctx: Ctx, key: string, suggestion: string | undefined): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: HOVER_COMMANDS };
  md.appendMarkdown(`**$(warning) ${escapeMd(key)}** is not a flag in Flagsmith project *${escapeMd(ctx.store.project?.name ?? '')}*.\n\n`);
  md.appendMarkdown('Every Flagsmith SDK silently returns the default for unknown keys, so this code path may never run.\n\n');
  if (suggestion) md.appendMarkdown(`Did you mean ${code(suggestion)}? `);
  md.appendMarkdown(`[$(add) Create ${code(key)} in Flagsmith…](${commandUri('flaglens.createFlag', key)})`);
  return md;
}

export { describeState };
