// Caches flag references per open document (by version) and tells listeners when a document's references change.
// Only open documents are scanned, like a linter; `Find Unused Flags` scans the whole workspace on demand.

import * as vscode from 'vscode';
import { compilePatterns, findFlagReferences, type CompiledPatterns, type FlagReference } from './core/scanner';
import type { Logger } from './log';

/** Skip documents that are not code we should annotate (output panels, git diffs of other schemes, huge files…). */
export function isScannable(doc: vscode.TextDocument): boolean {
  if (!['file', 'untitled', 'vscode-notebook-cell'].includes(doc.uri.scheme)) return false;
  if (doc.lineCount > 50_000) return false;
  return !/(^|[\\/])(node_modules|dist|out|\.git)[\\/]/.test(doc.uri.fsPath) && !doc.fileName.endsWith('.env');
}

export class ReferenceIndex implements vscode.Disposable {
  private readonly cache = new Map<string, { version: number; refs: FlagReference[] }>();
  private patterns: CompiledPatterns;
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | undefined>();
  /** Fires with a document URI when its references may have changed, or undefined when all may have. */
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly log: Logger,
    private extraPatterns: string[],
  ) {
    this.patterns = this.compile(extraPatterns);
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.debounce(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.cache.delete(d.uri.toString())),
      vscode.workspace.onDidOpenTextDocument((d) => this.emitter.fire(d.uri)),
    );
  }

  private compile(extra: string[]): CompiledPatterns {
    const compiled = compilePatterns(extra);
    for (const err of compiled.errors) this.log.warn(`flaglens.extraPatterns: ${err}`);
    return compiled;
  }

  setExtraPatterns(extra: string[]): void {
    if (JSON.stringify(extra) === JSON.stringify(this.extraPatterns)) return;
    this.extraPatterns = extra;
    this.patterns = this.compile(extra);
    this.cache.clear();
    this.emitter.fire(undefined);
  }

  get compiled(): CompiledPatterns {
    return this.patterns;
  }

  /** References in a document, recomputed only when the document version changes. */
  get(doc: vscode.TextDocument): FlagReference[] {
    if (!isScannable(doc)) return [];
    const id = doc.uri.toString();
    const hit = this.cache.get(id);
    if (hit && hit.version === doc.version) return hit.refs;
    const refs = findFlagReferences(doc.getText(), this.patterns);
    this.cache.set(id, { version: doc.version, refs });
    return refs;
  }

  /** The reference under a position, if any. */
  at(doc: vscode.TextDocument, pos: vscode.Position): FlagReference | undefined {
    return this.get(doc).find((r) => r.line === pos.line && pos.character >= r.startCol - 1 && pos.character <= r.endCol + 1);
  }

  private debounce(doc: vscode.TextDocument): void {
    const id = doc.uri.toString();
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.emitter.fire(doc.uri);
      }, 250),
    );
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
}

export function rangeOf(ref: FlagReference): vscode.Range {
  return new vscode.Range(ref.line, ref.startCol, ref.line, ref.endCol);
}
