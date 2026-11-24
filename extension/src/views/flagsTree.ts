// Sidebar: every flag in the project, each expandable into its per-environment states.

import * as vscode from 'vscode';
import { writeBlockReason, type FlagRow, type FsEnvironment } from '../core/model';
import { badgesFor, flagMarkdown, stateShort, type Ctx } from '../present';

export type FlagNode = { kind: 'flag'; key: string } | { kind: 'state'; key: string; envId: number } | { kind: 'message'; text: string; icon: string };

export class FlagsTreeProvider implements vscode.TreeDataProvider<FlagNode> {
  private readonly emitter = new vscode.EventEmitter<FlagNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly ctx: Ctx) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getChildren(node?: FlagNode): FlagNode[] {
    const { store } = this.ctx;
    if (!node) {
      if (store.status === 'disconnected') return []; // the welcome view shows the Connect button
      if (store.status === 'loading' && store.rows.size === 0) return [{ kind: 'message', text: 'Loading flags from Flagsmith…', icon: 'loading~spin' }];
      if (store.rows.size === 0) {
        return store.lastError
          ? [{ kind: 'message', text: store.lastError, icon: 'error' }]
          : [{ kind: 'message', text: 'No flags in this project yet.', icon: 'info' }];
      }
      const rows = [...store.rows.values()].sort(
        (a, b) => Number(a.feature.isArchived) - Number(b.feature.isArchived) || a.feature.name.localeCompare(b.feature.name),
      );
      const out: FlagNode[] = rows.map((r) => ({ kind: 'flag', key: r.feature.name }));
      if (store.status === 'offline') out.unshift({ kind: 'message', text: `Offline: ${store.lastError ?? 'Flagsmith unreachable'}`, icon: 'debug-disconnect' });
      return out;
    }
    if (node.kind === 'flag') return store.environments.map((e) => ({ kind: 'state', key: node.key, envId: e.id }));
    return [];
  }

  getTreeItem(node: FlagNode): vscode.TreeItem {
    const { store } = this.ctx;
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.text);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.tooltip = node.text;
      return item;
    }
    const row = store.row(node.key);
    if (!row) return new vscode.TreeItem(node.key);
    return node.kind === 'flag' ? this.flagItem(row) : this.stateItem(row, store.environment(node.envId));
  }

  private flagItem(row: FlagRow): vscode.TreeItem {
    const { store } = this.ctx;
    const item = new vscode.TreeItem(row.feature.name, vscode.TreeItemCollapsibleState.Collapsed);
    const active = store.activeEnvironment;
    const badges = badgesFor(this.ctx, row);
    item.description = [active ? stateShort(row.states.get(active.id), 20) : '', ...badges.map((b) => `${b.label}`)].filter(Boolean).join('  ·  ');
    const enabled = active ? row.states.get(active.id)?.enabled : undefined;
    const color = row.feature.isArchived
      ? new vscode.ThemeColor('disabledForeground')
      : badges.some((b) => b.label === 'drift')
        ? new vscode.ThemeColor('problemsWarningIcon.foreground')
        : enabled
          ? new vscode.ThemeColor('testing.iconPassed')
          : undefined;
    item.iconPath = new vscode.ThemeIcon(row.feature.isArchived ? 'archive' : enabled ? 'pass-filled' : 'circle-large-outline', color);
    item.tooltip = flagMarkdown(this.ctx, row);
    item.contextValue = 'flag';
    item.id = `flag:${row.feature.id}`;
    return item;
  }

  private stateItem(row: FlagRow, env: FsEnvironment | undefined): vscode.TreeItem {
    if (!env) return new vscode.TreeItem('?');
    const s = row.states.get(env.id);
    const item = new vscode.TreeItem(env.name);
    item.description = stateShort(s, 40);
    const blocked = row.feature.isArchived ? 'Archived' : writeBlockReason(row, env);
    item.iconPath = new vscode.ThemeIcon(
      s?.enabled ? 'pass-filled' : 'circle-large-outline',
      s?.enabled ? new vscode.ThemeColor('testing.iconPassed') : undefined,
    );
    const marks = [env.protected ? 'protected: typed confirmation required' : '', blocked ?? ''].filter(Boolean);
    item.tooltip = `${row.feature.name} in ${env.name}: ${stateShort(s, 200)}${marks.length ? `\n${marks.join('\n')}` : ''}`;
    item.contextValue = blocked ? 'state-readonly' : 'state-writable';
    item.id = `state:${row.feature.id}:${env.id}`;
    return item;
  }

  getParent(node: FlagNode): FlagNode | undefined {
    return node.kind === 'state' ? { kind: 'flag', key: node.key } : undefined;
  }
}
