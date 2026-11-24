import * as vscode from 'vscode';
import { suggestKey } from '../core/analysis';
import { flagMarkdown, unknownFlagMarkdown, type Ctx } from '../present';
import { rangeOf, type ReferenceIndex } from '../references';

/** Hover card with every environment's state, value, variants, overrides and one-click actions. */
export class FlagHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly ctx: Ctx,
    private readonly refs: ReferenceIndex,
  ) {}

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const { store } = this.ctx;
    if (store.status === 'disconnected' || store.rows.size === 0) return undefined;
    const ref = this.refs.at(doc, pos);
    if (!ref) return undefined;
    const row = store.row(ref.key);
    const md = row ? flagMarkdown(this.ctx, row) : unknownFlagMarkdown(this.ctx, ref.key, suggestKey(ref.key, store.rows.keys()));
    if (store.status === 'offline') md.appendMarkdown(`\n\n$(debug-disconnect) *Flagsmith is unreachable; showing the last known state.*`);
    return new vscode.Hover(md, rangeOf(ref));
  }
}
