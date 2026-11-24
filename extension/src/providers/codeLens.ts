// "⚑ new_checkout   Development ● on · Staging ● on · Production ○ off   ⚠ drift" above each line that uses a flag.

import * as vscode from 'vscode';
import { suggestKey } from '../core/analysis';
import { badgesFor, LENS_GAP, lensSummary, type Ctx } from '../present';
import type { ReferenceIndex } from '../references';

export class FlagCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(
    private readonly ctx: Ctx,
    private readonly refs: ReferenceIndex,
  ) {}

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const { store } = this.ctx;
    if (!this.ctx.settings().codeLensEnabled || store.status === 'disconnected' || store.rows.size === 0) return [];

    const lenses: vscode.CodeLens[] = [];
    const seen = new Set<string>();
    for (const ref of this.refs.get(doc)) {
      const id = `${ref.line}:${ref.key}`;
      if (seen.has(id)) continue; // one lens per key per line
      seen.add(id);
      const range = new vscode.Range(ref.line, 0, ref.line, 0);
      const row = store.row(ref.key);
      if (!row) {
        const suggestion = suggestKey(ref.key, store.rows.keys());
        lenses.push(
          new vscode.CodeLens(range, {
            title: `$(warning) ${ref.key}: not in Flagsmith${suggestion ? ` (did you mean ${suggestion}?)` : ''}`,
            tooltip: 'This key does not exist in the connected Flagsmith project. Click to create it.',
            command: 'flaglens.createFlag',
            arguments: [ref.key],
          }),
        );
        continue;
      }
      const badges = badgesFor(this.ctx, row)
        .map((b) => `${b.icon} ${b.label}`)
        .join(LENS_GAP);
      const offline = store.status === 'offline' ? `${LENS_GAP}$(debug-disconnect) offline` : '';
      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(flag) ${ref.key}${LENS_GAP}${lensSummary(this.ctx, row)}${badges ? `${LENS_GAP}${badges}` : ''}${offline}`,
          tooltip: 'Live state from Flagsmith. Click for actions (toggle, set value, history, dashboard).',
          command: 'flaglens.flagActions',
          arguments: [ref.key],
        }),
      );
    }
    return lenses;
  }
}
