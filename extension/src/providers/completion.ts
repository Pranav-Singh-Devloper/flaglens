import * as vscode from 'vscode';
import { flagCallPrefix } from '../core/scanner';
import { flagMarkdown, stateShort, type Ctx } from '../present';

/** Suggests flag keys from Flagsmith while typing inside a flag call's quotes, e.g. isFeatureEnabled("|"). */
export class FlagCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly ctx: Ctx) {}

  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
    const { store } = this.ctx;
    if (store.rows.size === 0) return undefined;
    const prefix = flagCallPrefix(doc.lineAt(pos.line).text.slice(0, pos.character));
    if (!prefix) return undefined;

    const range = new vscode.Range(pos.line, pos.character - prefix.partial.length, pos.line, pos.character);
    const active = store.activeEnvironment;
    return [...store.rows.values()]
      .filter((row) => !row.feature.isArchived)
      .map((row) => {
        const item = new vscode.CompletionItem(row.feature.name, vscode.CompletionItemKind.Constant);
        item.range = range;
        item.detail = active ? `${active.name}: ${stateShort(row.states.get(active.id))}` : 'Flagsmith flag';
        item.documentation = flagMarkdown(this.ctx, row);
        item.sortText = row.feature.name;
        return item;
      });
  }
}
