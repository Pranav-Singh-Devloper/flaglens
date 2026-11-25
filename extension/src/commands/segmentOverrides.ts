// Segment overrides from the editor: list a flag's overrides in one environment in priority order, then add one for a
// segment, turn one on or off, change its value, move it up or down, or remove it. After each change FlagLens re-runs
// the targeting-rule check and says if the change left an override that can never apply or changes nothing.

import * as vscode from 'vscode';
import { untypedValue } from '../api/client';
import type { ApiFeatureSegment, ApiTypedFeatureState, FlagValue } from '../api/types';
import type { App } from '../app';
import { formatValue, writeBlockReason, type FlagRow, type FsEnvironment } from '../core/model';
import { envFrom, keyFrom, parseValue, pickEnvironment, pickFlag, requireConnected, type Target } from './flags';

interface Override {
  link: ApiFeatureSegment;
  state: ApiTypedFeatureState;
  enabled: boolean;
  value: FlagValue;
}

/** Scripted steps for integration tests and command links; each skips one menu. */
export type SegmentOverrideStep =
  | { op: 'add'; segment: string; enabled: boolean; value?: FlagValue }
  | { op: 'set'; segment: string; enabled: boolean; value?: FlagValue }
  | { op: 'move'; segment: string; to: number }
  | { op: 'remove'; segment: string };

const fsId = (fs: ApiTypedFeatureState['feature_segment']) => (fs && typeof fs === 'object' ? fs.id : fs);

async function loadOverrides(app: App, row: FlagRow, env: FsEnvironment): Promise<Override[]> {
  const client = app.store.connection!.client;
  const [links, states] = await Promise.all([client.listFeatureSegments(row.feature.id, env.id), client.listFeatureStatesTyped(row.feature.id, env.id)]);
  return links
    .filter((l) => !l.is_system_segment)
    .sort((a, b) => a.priority - b.priority)
    .flatMap((link) => {
      const state = states.find((s) => fsId(s.feature_segment) === link.id);
      return state ? [{ link, state, enabled: state.enabled, value: untypedValue(state.feature_state_value) }] : [];
    });
}

const describe = (o: { enabled: boolean; value: FlagValue }) => `${o.enabled ? 'on' : 'off'}${formatValue(o.value) ? ` ${formatValue(o.value)}` : ''}`;

export async function segmentOverridesCommand(app: App, arg?: Target, envArg?: unknown, step?: SegmentOverrideStep): Promise<void> {
  if (!requireConnected(app)) return;
  const { store } = app;
  const key = keyFrom(arg) ?? (await pickFlag(app, 'Edit segment overrides'));
  const row = key ? store.row(key) : undefined;
  if (!key || !row) return;
  const envId = envFrom(arg, envArg);
  const env = envId !== undefined ? store.environment(envId) : await pickEnvironment(app, row, `Segment overrides of ${key}`);
  if (!env) return;
  const blocked = row.feature.isArchived ? `${key} is archived in Flagsmith.` : writeBlockReason(row, env, 'segments');
  if (blocked) return void vscode.window.showWarningMessage(blocked);

  const overrides = await loadOverrides(app, row, env);
  const plan = step ?? (await chooseStep(app, row, env, overrides));
  if (!plan) return;
  const target = 'segment' in plan ? overrides.find((o) => o.link.segment_name === plan.segment) : undefined;
  if (plan.op !== 'add' && !target) throw new Error(`${key} has no override for segment "${plan.segment}" in ${env.name}`);

  const client = store.connection!.client;
  const current = row.states.get(env.id);
  let action: string;
  let write: () => Promise<unknown>;
  switch (plan.op) {
    case 'add': {
      const segment = (await client.listSegments(store.project!.id)).find((s) => s.name === plan.segment);
      if (!segment) throw new Error(`No segment "${plan.segment}" in ${store.project!.name}`);
      if (overrides.some((o) => o.link.segment === segment.id)) throw new Error(`${key} already has an override for ${plan.segment} in ${env.name}`);
      const value = plan.value !== undefined ? plan.value : (current?.value ?? null);
      action = `Add override for ${plan.segment}: ${describe({ enabled: plan.enabled, value })}`;
      write = async () => {
        await client.createSegmentOverride(env.apiKey, row.feature.id, {
          segment: segment.id,
          priority: overrides.length,
          enabled: plan.enabled,
          value,
          zeroVariants: plan.value !== undefined ? row.feature.variants.map((v) => v.id) : undefined,
        });
        // Append at the end: renumber so the new one has the lowest priority.
        const links = await client.listFeatureSegments(row.feature.id, env.id);
        const added = links.find((l) => l.segment === segment.id);
        if (added) await client.reorderSegmentOverrides([...overrides.map((o) => o.link.id), added.id]);
      };
      break;
    }
    case 'set': {
      const next = { enabled: plan.enabled, value: plan.value !== undefined ? plan.value : target!.value };
      action = `Set ${plan.segment}'s override: ${describe(next)}`;
      write = () => client.updateSegmentOverride({ id: target!.state.id, feature: row.feature.id, environment: env.id, feature_segment: target!.link.id }, next);
      break;
    }
    case 'move': {
      const order = overrides.filter((o) => o !== target).map((o) => o.link.id);
      const to = Math.max(0, Math.min(plan.to, order.length));
      order.splice(to, 0, target!.link.id);
      action = `Move ${plan.segment} to position ${to + 1} of ${overrides.length}`;
      write = () => client.reorderSegmentOverrides(order);
      break;
    }
    case 'remove':
      action = `Remove the override for ${plan.segment}`;
      write = () => client.deleteSegmentOverride(target!.link.id);
      break;
  }

  const order = overrides.map((o, i) => `${i + 1}. ${o.link.segment_name}: ${describe(o)}`).join('\n') || '(none)';
  const ok = await app.confirm({ flag: key, env, action, scope: `the users these segments match`, detail: `Overrides now, first match wins:\n${order}` });
  if (!ok) return;

  const conn = store.connection!;
  const journal = (result: 'ok' | 'failed') =>
    app.journal.add({ at: new Date().toISOString(), flag: key, env: env.name, action, apiUrl: conn.client.baseUrl, projectId: conn.project.id, result });
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${action}: ${key} in ${env.name}…` }, write);
  } catch (e) {
    app.log.error(`${action} (${key} in ${env.name}) FAILED: ${(e as Error).message}`);
    await journal('failed');
    void vscode.window.showErrorMessage(`FlagLens: ${action} failed. ${(e as Error).message}`);
    return;
  }
  app.log.info(`${action}: ${key} in ${env.name}`);
  await journal('ok');
  await store.refresh();

  // The rule check runs on the new documents: point out a mistake the change introduced or left behind.
  const problems = store.findingsFor(key).filter((f) => f.environment === env.name);
  const note = problems.length ? ` Rule check: ${problems.map((p) => p.message).join(' ')}` : '';
  void (problems.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(`✓ ${action} (${key} in ${env.name}).${note}`);
}

async function chooseStep(app: App, row: FlagRow, env: FsEnvironment, overrides: Override[]): Promise<SegmentOverrideStep | undefined> {
  type Item = vscode.QuickPickItem & { override?: Override; add?: true };
  const items: Item[] = [
    ...overrides.map((o, i) => ({ label: `${i + 1}. $(person) ${o.link.segment_name}`, description: describe(o), override: o })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(add) Add an override for a segment…', add: true as const },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: `Segment overrides of ${row.feature.name} in ${env.name}`,
    placeHolder: overrides.length ? 'First match wins (1 applies first). Pick one to change it.' : 'No overrides yet',
  });
  if (!pick) return undefined;

  if (pick.add) {
    const used = new Set(overrides.map((o) => o.link.segment));
    const segments = (await app.store.connection!.client.listSegments(app.store.project!.id)).filter((s) => !used.has(s.id) && !s.is_system_segment && (!s.feature || s.feature === row.feature.id));
    const seg = await vscode.window.showQuickPick(
      segments.map((s) => ({ label: s.name, description: s.description ?? undefined })),
      { title: `Add an override of ${row.feature.name} in ${env.name} for…`, placeHolder: segments.length ? 'Segment' : 'Every segment already has an override' },
    );
    if (!seg) return undefined;
    const state = await askState(row, env, seg.label, row.states.get(env.id)?.value ?? null, true);
    return state && { op: 'add', segment: seg.label, ...state };
  }

  const o = pick.override!;
  const name = o.link.segment_name;
  const index = overrides.indexOf(o);
  type Action = vscode.QuickPickItem & { step: () => Promise<SegmentOverrideStep | undefined> };
  const actions: Action[] = [
    { label: o.enabled ? '$(circle-large-outline) Turn off' : '$(pass-filled) Turn on', step: async () => ({ op: 'set', segment: name, enabled: !o.enabled }) },
    {
      label: '$(edit) Set value…',
      step: async () => {
        const s = await askState(row, env, name, o.value, o.enabled);
        return s && { op: 'set', segment: name, ...s };
      },
    },
    ...(index > 0 ? [{ label: '$(arrow-up) Move up (applies earlier)', step: async () => ({ op: 'move' as const, segment: name, to: index - 1 }) }] : []),
    ...(index < overrides.length - 1 ? [{ label: '$(arrow-down) Move down', step: async () => ({ op: 'move' as const, segment: name, to: index + 1 }) }] : []),
    { label: '$(trash) Remove this override', step: async () => ({ op: 'remove', segment: name }) },
  ];
  const act = await vscode.window.showQuickPick(actions, { title: `${name}'s override of ${row.feature.name} in ${env.name}: ${describe(o)}` });
  return act?.step();
}

async function askState(row: FlagRow, env: FsEnvironment, segment: string, base: FlagValue, enabled: boolean): Promise<{ enabled: boolean; value: FlagValue } | undefined> {
  const on = await vscode.window.showQuickPick(
    [
      { label: '$(pass-filled) On', enabled: true },
      { label: '$(circle-large-outline) Off', enabled: false },
    ].sort((a) => (a.enabled === enabled ? -1 : 1)),
    { title: `${row.feature.name} for ${segment} in ${env.name}` },
  );
  if (!on) return undefined;
  const kind = typeof base === 'number' ? 'integer' : typeof base === 'boolean' ? 'boolean' : 'string';
  const input = await vscode.window.showInputBox({
    title: `Value of ${row.feature.name} for ${segment} (${kind}; leave as is to keep it)`,
    value: base === null ? '' : String(base),
    validateInput: (v) => (v === '' && base === null ? undefined : parseValue(v, kind) instanceof Error ? (parseValue(v, kind) as Error).message : undefined),
  });
  if (input === undefined) return undefined;
  return { enabled: on.enabled, value: input === '' && base === null ? null : (parseValue(input, kind) as FlagValue) };
}
