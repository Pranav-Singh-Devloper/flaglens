// Kill switch for Feature Health: when Flagsmith newly reports a flag UNHEALTHY in an environment where it is on, FlagLens
// says so once and offers to turn it off there. Turning it off is the ordinary toggle: the same confirmation (typed
// for protected environments), the same journal and Undo. Each health event is announced at most once.

import * as vscode from 'vscode';
import type { App } from './app';
import { healthReason } from './present';

export class HealthAlerts implements vscode.Disposable {
  /** Events already announced, as "featureId:envId:created_at". */
  private readonly seen = new Set<string>();

  constructor(private readonly app: App) {}

  /** Called after every store change; cheap when nothing is unhealthy. */
  update(): void {
    const { store } = this.app;
    if (store.status !== 'ok') return;
    for (const row of store.rows.values()) {
      for (const { env, event } of store.unhealthy(row.feature.id)) {
        const id = `${row.feature.id}:${env?.id ?? 0}:${event.created_at}`;
        if (this.seen.has(id)) continue;
        this.seen.add(id);
        void this.announce(row.feature.name, env?.id, env?.name, healthReason(event));
      }
    }
  }

  private async announce(key: string, envId: number | undefined, envName: string | undefined, reason: string): Promise<void> {
    const state = envId === undefined ? undefined : this.app.store.row(key)?.states.get(envId);
    const where = envName ? ` in ${envName}` : '';
    const on = state?.enabled;
    const turnOff = envName ? `Turn off in ${envName}` : undefined;
    const message = `Flagsmith Feature Health: ${key} is UNHEALTHY${where}${reason ? ` (${reason})` : ''}.${on ? ` It is ON there.` : state ? ' It is already off there.' : ''}`;
    const buttons = [...(on && turnOff ? [turnOff] : []), 'Show in code'];
    this.app.log.warn(message);
    const choice = await vscode.window.showWarningMessage(message, ...buttons);
    if (choice === turnOff && envId !== undefined) {
      // The ordinary toggle: confirmation (typed for protected environments), journal and Undo.
      await vscode.commands.executeCommand('flaglens.toggleFlag', key, envId);
    } else if (choice === 'Show in code') {
      await this.reveal(key);
    }
  }

  /** Opens the first reference to the flag in the open files, or searches the workspace for it. */
  private async reveal(key: string): Promise<void> {
    for (const doc of vscode.workspace.textDocuments) {
      const i = doc.getText().search(new RegExp(`['"\`]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`));
      if (i >= 0) {
        const pos = doc.positionAt(i + 1);
        await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos.translate(0, key.length)) });
        return;
      }
    }
    await vscode.commands.executeCommand('workbench.action.findInFiles', { query: key, triggerSearch: true, matchWholeWord: true });
  }

  dispose(): void {
    this.seen.clear();
  }
}
