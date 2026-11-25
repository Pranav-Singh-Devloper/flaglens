// Identity overrides from the editor: while previewing as a user, "Set flag for this user…" turns a flag on or off
// (or sets its value) for that one identity in Flagsmith, or removes the override again. Same safety as every write:
// a confirmation that says who is affected, the typed confirmation for protected environments, Undo and the journal.

import * as vscode from 'vscode';
import type { FlagValue } from '../api/types';
import type { App } from '../app';
import type { Persona } from '../core/engine';
import { formatValue, type FlagRow, type FsEnvironment } from '../core/model';
import { personaName } from '../present';
import { envFrom, keyFrom, parseValue, pickEnvironment, pickFlag, requireConnected, type Target } from './flags';

interface OverrideState {
  enabled: boolean;
  value: FlagValue;
}

/** The persona's current override of `key` in `env`, read from the environment document. */
function currentOverride(app: App, env: FsEnvironment, key: string, persona: Persona): OverrideState | undefined {
  const identity = (app.store.documents.get(env.id)?.identity_overrides ?? []).find((i) => i.identifier === persona.identifier);
  const fs = identity?.identity_features.find((f) => f.feature.name === key);
  return fs ? { enabled: fs.enabled, value: (fs.feature_state_value ?? null) as FlagValue } : undefined;
}

/**
 * `preset` skips the menu (integration tests and command links): an override to set, or 'remove'. Everything after
 * the menu, including the confirmation, still runs.
 */
export async function userOverrideCommand(app: App, arg?: Target, envArg?: unknown, preset?: OverrideState | 'remove'): Promise<void> {
  if (!requireConnected(app)) return;
  const { store } = app;
  if (!store.persona) {
    const choice = await vscode.window.showInformationMessage('Pick the user first: FlagLens sets the flag for the user you are previewing as.', 'Preview as…');
    if (!choice) return;
    await vscode.commands.executeCommand('flaglens.previewAs');
    if (!store.persona) return;
  }
  const persona = store.persona!;
  const who = personaName(persona);

  const key = keyFrom(arg) ?? (await pickFlag(app, `Set a flag for ${who}`));
  const row = key ? store.row(key) : undefined;
  if (!key || !row) return;
  const envId = envFrom(arg, envArg);
  const env = envId !== undefined ? store.environment(envId) : await pickEnvironment(app, row, `Set ${key} for ${who}`);
  if (!env) return;
  if (row.feature.isArchived) return void vscode.window.showWarningMessage(`${key} is archived in Flagsmith. Unarchive it in the dashboard first.`);

  const existing = currentOverride(app, env, key, persona);
  const effective = store.evaluation(env.id)?.get(key);
  const now = effective ? `${effective.enabled ? 'on' : 'off'}${formatValue(effective.value) ? ` (${formatValue(effective.value)})` : ''}` : 'unknown';

  type Item = vscode.QuickPickItem & { run: () => Promise<OverrideState | null | undefined> };
  const keepValue = existing?.value ?? row.states.get(env.id)?.value ?? null;
  const items: Item[] = [
    { label: `$(pass-filled) Turn ON for ${who}`, run: async () => ({ enabled: true, value: keepValue }) },
    { label: `$(circle-large-outline) Turn OFF for ${who}`, run: async () => ({ enabled: false, value: keepValue }) },
    { label: `$(edit) Set value for ${who}…`, run: () => askValue(row, env, who, existing) },
    ...(existing ? [{ label: `$(trash) Remove ${who}'s override`, description: 'back to segments and defaults', run: async () => null }] : []),
  ];
  const pick = preset !== undefined ? { run: async () => (preset === 'remove' ? null : preset) } : await vscode.window.showQuickPick(items, {
    title: `${key} for ${who} in ${env.name}`,
    placeHolder: `${who} gets: ${now}${effective ? `, because of ${effective.reason.kind === 'identity' ? 'their own override' : effective.reason.kind === 'segment' ? `segment ${effective.reason.segment}` : 'the environment default'}` : ''}`,
  });
  if (!pick) return;
  const next = await pick.run();
  if (next === undefined) return;
  if (next && existing && next.enabled === existing.enabled && JSON.stringify(next.value) === JSON.stringify(existing.value)) return;

  const action = next === null ? `Remove override for ${who}` : `${next.enabled ? 'Turn ON' : 'Turn OFF'}${next.value !== keepValue ? ` with value ${JSON.stringify(next.value)}` : ''} for ${who}`;
  const ok = await app.confirm({
    flag: key,
    env,
    action,
    scope: `${persona.identifier} only`,
    detail: `${who} gets ${now} now.${existing ? ` They already have an override (${existing.enabled ? 'on' : 'off'}).` : ''} Identity overrides beat segments and the default.`,
  });
  if (!ok) return;
  await writeOverride(app, row, env, persona, next, action, existing ?? null);
}

async function askValue(row: FlagRow, env: FsEnvironment, who: string, existing: OverrideState | undefined): Promise<OverrideState | undefined> {
  const base = existing?.value ?? row.states.get(env.id)?.value ?? null;
  const kind = typeof base === 'number' ? 'integer' : typeof base === 'boolean' ? 'boolean' : 'string';
  const input = await vscode.window.showInputBox({
    title: `Value of ${row.feature.name} for ${who} in ${env.name} (${kind})`,
    value: base === null ? '' : String(base),
    validateInput: (v) => {
      const parsed = parseValue(v, kind);
      return parsed instanceof Error ? parsed.message : undefined;
    },
  });
  if (input === undefined) return undefined;
  return { enabled: existing?.enabled ?? true, value: parseValue(input, kind) as FlagValue };
}

/** Writes (or with `next` null, removes) the override, then offers Undo back to `previous`. */
async function writeOverride(app: App, row: FlagRow, env: FsEnvironment, persona: Persona, next: OverrideState | null, label: string, previous: OverrideState | null): Promise<void> {
  const conn = app.store.connection!;
  const key = row.feature.name;
  const journal = (result: 'ok' | 'failed') =>
    app.journal.add({ at: new Date().toISOString(), flag: key, env: env.name, action: label, apiUrl: conn.client.baseUrl, projectId: conn.project.id, result });
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${label}: ${key} in ${env.name}…` }, async () => {
      const client = conn.client;
      let identity = await client.findIdentity(env.apiKey, persona.identifier);
      if (!identity && next === null) return;
      identity ??= await client.createIdentity(env.apiKey, persona.identifier);
      const fs = (await client.listIdentityFeatureStates(env.apiKey, identity.id)).find((s) => s.feature === row.feature.id);
      if (next === null) {
        if (fs) await client.deleteIdentityOverride(env.apiKey, identity.id, fs.id);
      } else {
        await client.setIdentityOverride(env.apiKey, identity.id, row.feature.id, next, fs?.id);
      }
    });
  } catch (e) {
    app.log.error(`${label} ${key} in ${env.name} FAILED: ${(e as Error).message}`);
    await journal('failed');
    void vscode.window.showErrorMessage(`FlagLens: could not change ${key} for ${personaName(persona)} in ${env.name}. ${(e as Error).message}`);
    return;
  }
  app.log.info(`${label}: ${key} in ${env.name} (identity ${persona.identifier})`);
  await journal('ok');
  await app.store.refresh();

  void vscode.window.showInformationMessage(`✓ ${label}: ${key} in ${env.name}.`, 'Undo').then(async (choice) => {
    if (choice !== 'Undo') return;
    const undoLabel = previous ? `Restore ${personaName(persona)}'s override` : `Remove override for ${personaName(persona)}`;
    if (env.protected && !(await app.confirm({ flag: key, env, action: undoLabel, scope: `${persona.identifier} only`, detail: 'Undo of your last change' }))) return;
    await writeOverride(app, row, env, persona, previous, `Undo (${undoLabel})`, null);
  });
}
