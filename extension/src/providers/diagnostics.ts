// Squiggles for flag keys that don't exist (typos), archived flags still in use, and stale flags,
// plus quick fixes: replace with the closest key, or create the flag in Flagsmith.

import * as vscode from 'vscode';
import { suggestKey } from '../core/analysis';
import { staleFor, staleSentence, type Ctx } from '../present';
import { isScannable, rangeOf, type ReferenceIndex } from '../references';

export const DIAGNOSTIC_SOURCE = 'FlagLens';

export const Code = {
  Unknown: 'unknown-flag',
  Archived: 'archived-flag',
  Stale: 'stale-flag',
  Rules: 'rule-issue',
} as const;

/** Data attached to diagnostics so code actions don't need to recompute it. */
const meta = new WeakMap<vscode.Diagnostic, { key: string; suggestion?: string }>();

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
} as const;

export class FlagDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('flaglens');

  constructor(
    private readonly ctx: Ctx,
    private readonly refs: ReferenceIndex,
  ) {}

  /** Recomputes diagnostics for one document, or every open document. */
  update(doc?: vscode.TextDocument): void {
    if (!doc) {
      this.collection.clear();
      for (const d of vscode.workspace.textDocuments) this.update(d);
      return;
    }
    if (!isScannable(doc)) return;
    const { store } = this.ctx;
    // No data (disconnected, or first load failed): clear rather than call every key unknown.
    if (store.status === 'disconnected' || store.rows.size === 0) {
      this.collection.delete(doc.uri);
      return;
    }
    const settings = this.ctx.settings();
    const projectName = store.project?.name ?? 'this project';
    const diagnostics: vscode.Diagnostic[] = [];

    for (const ref of this.refs.get(doc)) {
      const row = store.row(ref.key);
      const range = rangeOf(ref);
      if (!row) {
        if (settings.unknownFlagSeverity === 'off') continue;
        const suggestion = suggestKey(ref.key, store.rows.keys());
        const d = new vscode.Diagnostic(
          range,
          `Flag "${ref.key}" doesn't exist in Flagsmith project "${projectName}".${suggestion ? ` Did you mean "${suggestion}"?` : ''} SDKs return the default value for unknown flags.`,
          SEVERITY[settings.unknownFlagSeverity],
        );
        d.code = Code.Unknown;
        d.source = DIAGNOSTIC_SOURCE;
        meta.set(d, { key: ref.key, suggestion });
        diagnostics.push(d);
        continue;
      }
      if (row.feature.isArchived) {
        const d = new vscode.Diagnostic(
          range,
          `Flag "${ref.key}" is archived in Flagsmith but still used here. Archived flags may stop being served; remove this code path.`,
          vscode.DiagnosticSeverity.Warning,
        );
        d.code = Code.Archived;
        d.source = DIAGNOSTIC_SOURCE;
        d.tags = [vscode.DiagnosticTag.Deprecated];
        meta.set(d, { key: ref.key });
        diagnostics.push(d);
        continue;
      }
      // Problems in the flag's segment overrides (shadowed, redundant…): one diagnostic listing them all.
      const findings = store.findingsFor(ref.key);
      if (findings.length) {
        const serious = findings.some((f) => f.kind === 'shadowed' || f.kind === 'matches-nobody');
        const d = new vscode.Diagnostic(range, findings.map((f) => f.message).join('\n'), serious ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
        d.code = Code.Rules;
        d.source = DIAGNOSTIC_SOURCE;
        meta.set(d, { key: ref.key });
        diagnostics.push(d);
      }
      if (settings.staleDiagnostics) {
        const stale = staleFor(this.ctx, row);
        if (stale.stale) {
          const d = new vscode.Diagnostic(range, staleSentence(ref.key, stale), vscode.DiagnosticSeverity.Information);
          d.code = Code.Stale;
          d.source = DIAGNOSTIC_SOURCE;
          meta.set(d, { key: ref.key });
          diagnostics.push(d);
        }
      }
    }
    this.collection.set(doc.uri, diagnostics);
  }

  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }
}

export class FlagCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of context.diagnostics) {
      if (d.source !== DIAGNOSTIC_SOURCE) continue;
      const m = meta.get(d);
      if (!m) continue;
      if (d.code === Code.Unknown) {
        if (m.suggestion) {
          const fix = new vscode.CodeAction(`Replace with "${m.suggestion}"`, vscode.CodeActionKind.QuickFix);
          fix.edit = new vscode.WorkspaceEdit();
          fix.edit.replace(doc.uri, d.range, m.suggestion);
          fix.diagnostics = [d];
          fix.isPreferred = true;
          actions.push(fix);
        }
        const create = new vscode.CodeAction(`Create flag "${m.key}" in Flagsmith…`, vscode.CodeActionKind.QuickFix);
        create.command = { command: 'flaglens.createFlag', title: 'Create flag', arguments: [m.key] };
        create.diagnostics = [d];
        actions.push(create);
      } else {
        const open = new vscode.CodeAction(`Open "${m.key}" in Flagsmith`, vscode.CodeActionKind.QuickFix);
        open.command = { command: 'flaglens.openInDashboard', title: 'Open in Flagsmith', arguments: [m.key] };
        open.diagnostics = [d];
        actions.push(open);
      }
    }
    return actions;
  }
}
