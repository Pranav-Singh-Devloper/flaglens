// Greys out code that cannot run in the active environment (and for the previewed user), like an inactive #ifdef.
// The analysis is in core/deadcode.ts; this file only turns its ranges into editor decorations.

import * as vscode from 'vscode';
import { findDeadCode, languageFamily, type DeadRange } from '../core/deadcode';
import { formatValue } from '../core/model';
import { personaName, type Ctx } from '../present';
import type { ReferenceIndex } from '../references';

export class DeadCodeDecorator implements vscode.Disposable {
  private readonly dim = vscode.window.createTextEditorDecorationType({ opacity: '0.4' });
  private readonly label = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 2em', color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic' },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  /** Last result per document, for tests and the hover. */
  readonly lastRanges = new Map<string, DeadRange[]>();

  constructor(
    private readonly ctx: Ctx,
    private readonly refs: ReferenceIndex,
  ) {}

  /** Re-decorates every visible editor (or only those showing `uri`). */
  update(uri?: vscode.Uri): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (!uri || editor.document.uri.toString() === uri.toString()) this.decorate(editor);
    }
  }

  private decorate(editor: vscode.TextEditor): void {
    const doc = editor.document;
    const ranges = this.compute(doc);
    this.lastRanges.set(doc.uri.toString(), ranges);
    const env = this.ctx.store.activeEnvironment;
    const persona = this.ctx.store.persona && this.ctx.store.previewSupported ? this.ctx.store.persona : undefined;

    const dim: vscode.Range[] = [];
    const labels = new Map<number, Set<string>>();
    for (const r of ranges) {
      const start = doc.positionAt(r.start);
      dim.push(new vscode.Range(start, doc.positionAt(r.end)));
      const why = r.keys.map((k) => this.describe(k)).join(', ');
      // Reason first: if a narrow editor cuts the label off, only the context (also in the status bar) is lost.
      const where = `${env?.name ?? ''}${persona ? ` · ${personaName(persona)}` : ''}`;
      const text = `${why}${r.branch === 'rest' ? ' and returns early' : ''} → never runs (${where})`;
      const set = labels.get(start.line) ?? new Set<string>();
      set.add(text);
      labels.set(start.line, set);
    }
    editor.setDecorations(this.dim, dim);
    editor.setDecorations(
      this.label,
      [...labels].map(([line, texts]) => ({
        range: doc.lineAt(line).range.with({ start: doc.lineAt(line).range.end }),
        renderOptions: { after: { contentText: `⟵ ${[...texts].join(' · ')}` } },
      })),
    );
  }

  /** "new_checkout is off", "banner_text is "Hi"", "new_chekout is not in Flagsmith" */
  private describe(key: string): string {
    const { store } = this.ctx;
    const env = store.activeEnvironment;
    if (!store.row(key)) return `${key} is not in Flagsmith`;
    const facts = env ? store.flagFacts(key, env.id) : undefined;
    // Remote-config flags are described by their value, plain on/off flags by their state.
    if (facts?.valueKnown && facts.value !== null && facts.value !== undefined && facts.value !== '') return `${key} = ${formatValue(facts.value, 24)}`;
    if (facts?.enabled !== undefined) return `${key} is ${facts.enabled ? 'on' : 'off'}`;
    return key;
  }

  private compute(doc: vscode.TextDocument): DeadRange[] {
    const { store } = this.ctx;
    const settings = this.ctx.settings();
    const env = store.activeEnvironment;
    const family = languageFamily(doc.languageId);
    if (!settings.dimInactiveCode || !family || !env || store.status === 'disconnected' || store.rows.size === 0) return [];
    const refs = this.refs.get(doc);
    if (refs.length === 0) return [];
    try {
      return findDeadCode(doc.getText(), refs, family, (key) => store.flagFacts(key, env.id));
    } catch {
      return []; // never let a parsing corner case break the editor
    }
  }

  dispose(): void {
    this.dim.dispose();
    this.label.dispose();
  }
}
