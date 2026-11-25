// Flag commands: toggle, set value, create, history, open in dashboard, copy diff, find unused flags.
// Every write: confirmWrite() → API call → instant local update → journal + log → refresh → toast with Undo.

import * as vscode from 'vscode';
import { describeState, relativeTime, validateFlagName } from '../core/analysis';
import { formatValue, writeBlockReason, type FlagRow, type FsEnvironment } from '../core/model';
import { diffEnvironments, diffMarkdown } from '../core/report';
import { findFlagReferences } from '../core/scanner';
import type { App } from '../app';
import type { ApiFeatureState, FlagValue } from '../api/types';
import { dashboardUrl, stateShort, writeNotes } from '../present';
import type { FlagNode } from '../views/flagsTree';

/** Commands are invoked from CodeLens/hover (key, envId), the tree (node) or the palette (nothing). */
export type Target = string | FlagNode | undefined;

export function keyFrom(arg: Target): string | undefined {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'key' in arg) return arg.key;
  return undefined;
}

export function envFrom(arg: Target, envArg: unknown): number | undefined {
  if (typeof envArg === 'number') return envArg;
  if (arg && typeof arg === 'object' && arg.kind === 'state') return arg.envId;
  return undefined;
}

export function requireConnected(app: App): boolean {
  if (app.store.connected && app.store.rows.size > 0) return true;
  void vscode.window.showWarningMessage('FlagLens is not connected to Flagsmith.', 'Connect…').then((c) => {
    if (c) void vscode.commands.executeCommand('flaglens.connect');
  });
  return false;
}

export async function pickFlag(app: App, placeHolder: string): Promise<string | undefined> {
  const active = app.store.activeEnvironment;
  const items = [...app.store.rows.values()]
    .filter((r) => !r.feature.isArchived)
    .sort((a, b) => a.feature.name.localeCompare(b.feature.name))
    .map((r) => ({ label: r.feature.name, description: active ? `${active.name}: ${stateShort(r.states.get(active.id))}` : '', detail: r.feature.description || undefined }));
  return (await vscode.window.showQuickPick(items, { placeHolder, matchOnDetail: true }))?.label;
}

export async function pickEnvironment(app: App, row: FlagRow, title: string): Promise<FsEnvironment | undefined> {
  const active = app.store.activeEnvironment;
  const envs = [...app.store.environments].sort((a, b) => Number(b.id === active?.id) - Number(a.id === active?.id));
  const items = envs.map((env) => {
    const blocked = writeBlockReason(row, env);
    return {
      label: `${env.name}`,
      description: `${stateShort(row.states.get(env.id))}${env.protected ? '   $(shield) protected' : ''}`,
      detail: blocked,
      env,
    };
  });
  return (await vscode.window.showQuickPick(items, { title, placeHolder: 'Environment' }))?.env;
}

async function resolveRowAndEnv(app: App, arg: Target, envArg: unknown, title: string): Promise<{ row: FlagRow; env: FsEnvironment } | undefined> {
  if (!requireConnected(app)) return undefined;
  const key = keyFrom(arg) ?? (await pickFlag(app, title));
  if (!key) return undefined;
  const row = app.store.row(key);
  if (!row) {
    void vscode.window.showWarningMessage(`"${key}" is not a flag in ${app.store.project?.name}.`, 'Create It…').then((c) => {
      if (c) void vscode.commands.executeCommand('flaglens.createFlag', key);
    });
    return undefined;
  }
  const envId = envFrom(arg, envArg);
  const env = envId !== undefined ? app.store.environment(envId) : await pickEnvironment(app, row, `${title}: ${key}`);
  if (!env) return undefined;
  const blocked = row.feature.isArchived ? `${key} is archived in Flagsmith. Unarchive it in the dashboard first.` : writeBlockReason(row, env);
  if (blocked) {
    const open = await vscode.window.showWarningMessage(blocked, 'Open in Flagsmith');
    if (open) await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl(app, row, env)!));
    return undefined;
  }
  return { row, env };
}

/** Performs one feature-state write, then offers Undo. */
async function writeState(
  app: App,
  row: FlagRow,
  env: FsEnvironment,
  patch: { enabled?: boolean; value?: FlagValue },
  label: string,
  undo?: { patch: { enabled?: boolean; value?: FlagValue }; label: string },
): Promise<void> {
  const conn = app.store.connection!;
  const key = row.feature.name;
  const state = row.states.get(env.id)!;
  let updated: ApiFeatureState;
  try {
    updated = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${label}: ${key} in ${env.name}…` }, () =>
      env.v2Versioning
        ? conn.client.publishFeatureVersion(
            env,
            row.feature.id,
            { enabled: patch.enabled ?? state.enabled, value: patch.value !== undefined ? patch.value : state.value },
            `FlagLens: ${label}`,
          )
        : conn.client.updateFeatureState(env.apiKey, state.featureStateId, patch),
    );
  } catch (e) {
    const message = (e as Error).message;
    app.log.error(`${label} ${key} in ${env.name} FAILED: ${message}`);
    await app.journal.add({ at: new Date().toISOString(), flag: key, env: env.name, action: label, apiUrl: conn.client.baseUrl, projectId: conn.project.id, result: 'failed' });
    void vscode.window.showErrorMessage(`FlagLens: could not change ${key} in ${env.name}. ${message}`);
    return;
  }

  app.store.applyLocalState(key, env.id, { enabled: updated.enabled, value: updated.feature_state_value, updatedAt: updated.updated_at });
  const now = describeState({ ...state, enabled: updated.enabled, value: updated.feature_state_value });
  app.log.info(`${label}: ${key} in ${env.name} → ${now} (feature state ${state.featureStateId})`);
  await app.journal.add({ at: new Date().toISOString(), flag: key, env: env.name, action: `${label} → ${now}`, apiUrl: conn.client.baseUrl, projectId: conn.project.id, result: 'ok' });
  void app.store.refresh();

  // Not awaited: the command finishes now, and the toast's buttons work for as long as it is visible.
  const buttons = undo ? ['Undo', 'Open in Flagsmith'] : ['Open in Flagsmith'];
  const shown = formatValue(updated.feature_state_value);
  void vscode.window
    .showInformationMessage(`✓ ${key} is now ${updated.enabled ? 'ON' : 'OFF'}${shown ? ` (${shown})` : ''} in ${env.name}.`, ...buttons)
    .then(async (choice) => {
      if (choice === 'Open in Flagsmith') await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl(app, row, env)!));
      if (choice === 'Undo' && undo) {
        const fresh = app.store.row(key);
        if (!fresh) return;
        // Undo is a write like any other; protected environments still need the typed confirmation.
        if (env.protected && !(await app.confirm({ flag: key, env, action: undo.label, detail: 'Undo of your last change' }))) return;
        await writeState(app, fresh, env, undo.patch, `Undo (${undo.label})`);
      }
    });
}

export async function toggleCommand(app: App, arg?: Target, envArg?: unknown): Promise<void> {
  const target = await resolveRowAndEnv(app, arg, envArg, 'Toggle flag');
  if (!target) return;
  const { row, env } = target;
  const current = row.states.get(env.id)!;
  const action = current.enabled ? 'Turn OFF' : 'Turn ON';
  const ok = await app.confirm({ flag: row.feature.name, env, action, detail: `Currently ${current.enabled ? 'ON' : 'OFF'} in ${env.name}.${writeNotes(app, row, env)}` });
  if (!ok) return;
  await writeState(app, row, env, { enabled: !current.enabled }, action, {
    patch: { enabled: current.enabled },
    label: current.enabled ? 'Turn ON' : 'Turn OFF',
  });
}

/** Parses user input into the same type as the current value (Flagsmith stores string, integer or boolean). */
export function parseValue(input: string, kind: 'string' | 'integer' | 'boolean'): FlagValue | Error {
  if (kind === 'integer') return /^-?\d+$/.test(input.trim()) ? Number(input.trim()) : new Error('Enter a whole number');
  if (kind === 'boolean') return /^(true|false)$/i.test(input.trim()) ? input.trim().toLowerCase() === 'true' : new Error('Enter true or false');
  return input;
}

export async function setValueCommand(app: App, arg?: Target, envArg?: unknown): Promise<void> {
  const target = await resolveRowAndEnv(app, arg, envArg, 'Set flag value');
  if (!target) return;
  const { row, env } = target;
  const current = row.states.get(env.id)!;
  let kind: 'string' | 'integer' | 'boolean' = typeof current.value === 'number' ? 'integer' : typeof current.value === 'boolean' ? 'boolean' : 'string';
  if (current.value === null) {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Text', valueType: 'string' as const },
        { label: 'Integer', valueType: 'integer' as const },
        { label: 'Boolean', valueType: 'boolean' as const },
      ],
      { title: `${row.feature.name} has no value in ${env.name}. Value type?` },
    );
    if (!pick) return;
    kind = pick.valueType;
  }
  const input = await vscode.window.showInputBox({
    title: `Set value of ${row.feature.name} in ${env.name} (${kind})`,
    value: current.value === null ? '' : String(current.value),
    prompt: `Current: ${current.value === null ? '(none)' : JSON.stringify(current.value)}`,
    validateInput: (v) => {
      const parsed = parseValue(v, kind);
      return parsed instanceof Error ? parsed.message : undefined;
    },
  });
  if (input === undefined) return;
  const value = parseValue(input, kind) as FlagValue;
  if (JSON.stringify(value) === JSON.stringify(current.value)) return;
  const action = `Set value to ${JSON.stringify(value)}`;
  const ok = await app.confirm({ flag: row.feature.name, env, action, detail: `Current value: ${JSON.stringify(current.value)}${writeNotes(app, row, env)}` });
  if (!ok) return;
  await writeState(app, row, env, { value }, action, { patch: { value: current.value }, label: `Set value to ${JSON.stringify(current.value)}` });
}

export async function createFlagCommand(app: App, suggested?: unknown): Promise<void> {
  if (!app.store.connected || !app.store.project) return void requireConnected(app);
  const project = app.store.project;
  const rules = { onlyLowerCase: project.only_allow_lower_case_feature_names, nameRegex: project.feature_name_regex };
  const name = await vscode.window.showInputBox({
    title: `Create flag in Flagsmith project "${project.name}"`,
    value: typeof suggested === 'string' ? suggested : '',
    prompt: 'Flag name (the key your code uses)',
    validateInput: (v) => validateFlagName(v, rules, app.store.rows.keys()),
  });
  if (!name) return;
  const description = await vscode.window.showInputBox({ title: `Description for ${name} (optional)`, prompt: 'What does this flag control?' });
  if (description === undefined) return;
  const confirm = await vscode.window.showWarningMessage(
    `Create flag "${name}" in "${project.name}"?`,
    { modal: true, detail: `It starts OFF in all ${app.store.environments.length} environments (${app.store.environments.map((e) => e.name).join(', ')}).` },
    'Create Flag',
  );
  if (confirm !== 'Create Flag') return;
  const conn = app.store.connection!;
  try {
    await conn.client.createFeature(project.id, { name, description, default_enabled: false, type: 'STANDARD' });
  } catch (e) {
    app.log.error(`Create flag ${name} FAILED: ${(e as Error).message}`);
    void vscode.window.showErrorMessage(`FlagLens: could not create ${name}. ${(e as Error).message}`);
    return;
  }
  app.log.info(`Created flag ${name} in project ${project.name}`);
  await app.journal.add({ at: new Date().toISOString(), flag: name, env: '(all)', action: 'Created flag', apiUrl: conn.client.baseUrl, projectId: project.id, result: 'ok' });
  await app.store.refresh();
  const env = app.store.activeEnvironment;
  const next = await vscode.window.showInformationMessage(`✓ Created ${name} (OFF everywhere).`, ...(env ? [`Turn on in ${env.name}…`] : []), 'Open in Flagsmith');
  if (next?.startsWith('Turn on') && env) await toggleCommand(app, name, env.id);
  if (next === 'Open in Flagsmith') await openInDashboardCommand(app, name);
}

export async function openInDashboardCommand(app: App, arg?: Target, envArg?: unknown): Promise<void> {
  if (!app.store.connected) return void requireConnected(app);
  const key = keyFrom(arg);
  const row = key ? app.store.row(key) : undefined;
  const envId = envFrom(arg, envArg);
  const url = dashboardUrl(app, row, envId !== undefined ? app.store.environment(envId) : undefined);
  if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
}

export async function copyKeyCommand(_app: App, arg?: Target): Promise<void> {
  const key = keyFrom(arg);
  if (!key) return;
  await vscode.env.clipboard.writeText(key);
  void vscode.window.setStatusBarMessage(`$(copy) Copied ${key}`, 2000);
}

/** The menu behind each CodeLens. */
export async function flagActionsCommand(app: App, arg?: Target): Promise<void> {
  const key = keyFrom(arg);
  if (!key) return;
  const row = app.store.row(key);
  if (!row) return createFlagCommand(app, key);
  type Item = vscode.QuickPickItem & { run?: () => Thenable<unknown> | Promise<unknown> };
  const items: Item[] = [{ label: 'Toggle', kind: vscode.QuickPickItemKind.Separator }];
  for (const env of app.store.environments) {
    const s = row.states.get(env.id);
    const blocked = row.feature.isArchived ? 'archived' : writeBlockReason(row, env);
    items.push({
      label: `$(${s?.enabled ? 'circle-slash' : 'debug-start'}) ${s?.enabled ? 'Turn off' : 'Turn on'} in ${env.name}`,
      description: `${stateShort(s)}${env.protected ? '   $(shield) protected' : ''}`,
      detail: blocked,
      run: () => toggleCommand(app, key, env.id),
    });
  }
  items.push(
    { label: 'More', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(edit) Set value…', run: () => setValueCommand(app, key) },
    { label: '$(history) Show history', run: () => showHistoryCommand(app, key) },
    { label: '$(link-external) Open in Flagsmith dashboard', run: () => openInDashboardCommand(app, key) },
    { label: '$(table) Open environment matrix', run: () => vscode.commands.executeCommand('flaglens.openMatrix', key) },
    { label: '$(copy) Copy key', run: () => copyKeyCommand(app, key) },
  );
  const pick = await vscode.window.showQuickPick(items, { title: `${key} · ${app.store.project?.name}`, placeHolder: row.feature.description || 'Flag actions' });
  await pick?.run?.();
}

interface AuditEntry {
  created_date: string;
  log: string;
  author?: { email?: string } | null;
  environment?: { name?: string } | number | null;
}

/**
 * History = the Flagsmith audit log when the server exposes it, plus each environment's last change, plus FlagLens's
 * own journal. (On open-source self-hosted Flagsmith the audit-log API returns no rows without a licence.)
 */
export async function showHistoryCommand(app: App, arg?: Target): Promise<void> {
  if (!requireConnected(app)) return;
  const key = keyFrom(arg) ?? (await pickFlag(app, 'Show history for which flag?'));
  if (!key) return;
  const row = app.store.row(key);
  const conn = app.store.connection!;
  const now = Date.now();
  type Item = vscode.QuickPickItem;
  const items: Item[] = [];

  let audit: AuditEntry[] = [];
  try {
    const page = await conn.client.request<{ results: AuditEntry[] }>('GET', `/projects/${conn.project.id}/audit/?search=${encodeURIComponent(key)}&page_size=30`);
    audit = page.results ?? [];
  } catch (e) {
    app.log.info(`Audit log unavailable: ${(e as Error).message}`);
  }
  if (audit.length) {
    items.push({ label: 'Flagsmith audit log', kind: vscode.QuickPickItemKind.Separator });
    for (const a of audit) {
      const env = typeof a.environment === 'object' && a.environment ? a.environment.name : undefined;
      items.push({ label: `$(history) ${a.log}`, description: `${relativeTime(a.created_date, now)}${env ? ` · ${env}` : ''}`, detail: a.author?.email ?? undefined });
    }
  }

  if (row) {
    items.push({ label: 'Last change per environment', kind: vscode.QuickPickItemKind.Separator });
    for (const env of app.store.environments) {
      const s = row.states.get(env.id);
      items.push({ label: `$(clock) ${env.name}: ${stateShort(s)}`, description: s ? `changed ${relativeTime(s.updatedAt, now)}` : '', detail: s ? new Date(s.updatedAt).toLocaleString() : undefined });
    }
  }

  const journal = app.journal.forFlag(conn.client.baseUrl, conn.project.id, key);
  items.push({ label: 'Changes made with FlagLens', kind: vscode.QuickPickItemKind.Separator });
  if (journal.length === 0) items.push({ label: '$(info) None yet' });
  for (const j of journal.slice(0, 30)) {
    items.push({ label: `${j.result === 'ok' ? '$(check)' : '$(error)'} ${j.action}`, description: `${j.env} · ${relativeTime(j.at, now)}`, detail: new Date(j.at).toLocaleString() });
  }
  if (!audit.length) {
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(info) Flagsmith audit log: not available on this server', detail: 'Open-source self-hosted Flagsmith hides audit-log entries from the API unless the instance has a licence.' });
  }
  await vscode.window.showQuickPick(items, { title: `History: ${key}`, matchOnDescription: true });
}

export async function copyDiffMarkdownCommand(app: App, envA?: unknown, envB?: unknown): Promise<string | undefined> {
  if (!requireConnected(app)) return undefined;
  const { store } = app;
  let a = typeof envA === 'number' ? store.environment(envA) : undefined;
  let b = typeof envB === 'number' ? store.environment(envB) : undefined;
  if (!a || !b) {
    const items = store.environments.map((e) => ({ label: e.name, env: e }));
    a = (await vscode.window.showQuickPick(items, { title: 'Compare environments (1/2): from' }))?.env;
    if (!a) return undefined;
    b = (await vscode.window.showQuickPick(items.filter((i) => i.env.id !== a!.id), { title: `Compare ${a.name} with (2/2)` }))?.env;
    if (!b) return undefined;
  }
  const lines = diffEnvironments(store.rows.values(), a, b);
  const md = diffMarkdown(lines, a, b, { project: store.project?.name ?? '', source: store.connection?.client.baseUrl ?? '', at: new Date() });
  await vscode.env.clipboard.writeText(md);
  void vscode.window.showInformationMessage(`Copied ${lines.length} difference${lines.length === 1 ? '' : 's'} between ${a.name} and ${b.name} as Markdown.`);
  return md;
}

/** Scans the workspace for references and lists project flags that no file mentions. */
/** A flag reference found by scanning the workspace: the file, the 0-based line and the key. */
export interface WorkspaceReference {
  uri: vscode.Uri;
  line: number;
  key: string;
}

/** Scans every text file in the workspace (outside build and dependency folders) for flag references. */
export async function scanWorkspace(app: App, title: string): Promise<{ refs: WorkspaceReference[]; files: number }> {
  const exclude = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.next/**,**/vendor/**,**/*.min.js,**/*.map,**/*.lock,**/package-lock.json}';
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (_p, token) => {
    const files = await vscode.workspace.findFiles('**/*', exclude, 20_000, token);
    const refs: WorkspaceReference[] = [];
    let count = 0;
    for (const file of files) {
      if (token.isCancellationRequested) break;
      try {
        const stat = await vscode.workspace.fs.stat(file);
        if (stat.size > 1_000_000) continue;
        const bytes = await vscode.workspace.fs.readFile(file);
        if (bytes.subarray(0, 8000).includes(0)) continue; // binary
        for (const ref of findFlagReferences(new TextDecoder().decode(bytes), app.refs.compiled)) refs.push({ uri: file, line: ref.line, key: ref.key });
        count++;
      } catch {
        // unreadable file: skip
      }
    }
    return { refs, files: count };
  });
}

export async function findUnusedFlagsCommand(app: App): Promise<void> {
  if (!requireConnected(app)) return;
  const { refs, files: scanned } = await scanWorkspace(app, 'FlagLens: scanning workspace for flag references…');
  const used = new Set(refs.map((r) => r.key));
  const unused = [...app.store.rows.values()].filter((r) => !r.feature.isArchived && !used.has(r.feature.name));
  app.log.info(`Find unused flags: scanned ${scanned} files; ${unused.length} unused: ${unused.map((r) => r.feature.name).join(', ') || 'none'}`);
  if (unused.length === 0) {
    void vscode.window.showInformationMessage(`Every flag in ${app.store.project?.name} is referenced in this workspace (${scanned} files scanned).`);
    return;
  }
  const active = app.store.activeEnvironment;
  const pick = await vscode.window.showQuickPick(
    unused.map((r) => ({ label: r.feature.name, description: active ? `${active.name}: ${stateShort(r.states.get(active.id))}` : '', detail: r.feature.description || undefined, key: r.feature.name })),
    { title: `${unused.length} flag${unused.length === 1 ? '' : 's'} not referenced in ${scanned} files: candidates for clean-up`, placeHolder: 'Select one to open it in Flagsmith' },
  );
  if (pick) await openInDashboardCommand(app, pick.key);
}
