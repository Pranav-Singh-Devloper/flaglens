// Every change to Flagsmith goes through confirmWrite():
//   - a modal confirmation that names the flag, the environment and the change;
//   - for protected environments (flaglens.protectedEnvironments, default prod|live|main) the user must also type
//     the flag's name, like GitHub's "type the repository name to delete it".

import * as vscode from 'vscode';
import type { FsEnvironment } from './core/model';

export interface WriteIntent {
  flag: string;
  env: FsEnvironment;
  /** e.g. "Turn ON", "Set value to 100" */
  action: string;
  /** Optional extra line, e.g. "Current: off" */
  detail?: string;
  /** Who the change affects, when not everyone, e.g. "alice@demo-shop.dev only" or "users in segment pro_plan". */
  scope?: string;
}

export async function confirmWrite(intent: WriteIntent): Promise<boolean> {
  const { flag, env, action, detail, scope } = intent;
  const protectedNote = env.protected ? `\n\n${env.name} is a protected environment: you will be asked to type the flag name.` : '';
  const choice = await vscode.window.showWarningMessage(
    `${action}: "${flag}" in ${env.name}?`,
    { modal: true, detail: `${detail ? `${detail}\n` : ''}This changes Flagsmith immediately for ${scope ? `${scope} in ${env.name}` : `every app using ${env.name}`}.${protectedNote}` },
    action,
  );
  if (choice !== action) return false;
  if (!env.protected) return true;

  const typed = await vscode.window.showInputBox({
    title: `Protected environment: ${env.name}`,
    prompt: `Type "${flag}" to confirm: ${action} in ${env.name}`,
    placeHolder: flag,
    ignoreFocusOut: true,
    validateInput: (v) => (v === flag || v === '' ? undefined : `Type exactly: ${flag}`),
  });
  return typed === flag;
}

export interface JournalEntry {
  at: string;
  flag: string;
  env: string;
  action: string;
  apiUrl: string;
  projectId: number;
  result: 'ok' | 'failed' | 'undone';
}

/**
 * FlagLens keeps its own log of the changes it made. On open-source self-hosted Flagsmith the audit-log API returns
 * nothing (audit visibility is a licensed feature), so this journal is what "Show history" can always show.
 */
export class WriteJournal {
  private static readonly KEY = 'flaglens.journal';
  constructor(private readonly memento: vscode.Memento) {}

  all(): JournalEntry[] {
    return this.memento.get<JournalEntry[]>(WriteJournal.KEY, []);
  }

  async add(entry: JournalEntry): Promise<void> {
    const entries = [entry, ...this.all()].slice(0, 500);
    await this.memento.update(WriteJournal.KEY, entries);
  }

  forFlag(apiUrl: string, projectId: number, flag: string): JournalEntry[] {
    return this.all().filter((e) => e.apiUrl === apiUrl && e.projectId === projectId && e.flag === flag);
  }
}
