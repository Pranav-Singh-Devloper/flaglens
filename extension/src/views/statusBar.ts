import * as vscode from 'vscode';
import { personaName, traitsText } from '../present';
import type { FlagStore } from '../store/flagStore';

/** "⚑ Demo Shop · Development" in the status bar. Click to switch environment (or connect). */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('flaglens.status', vscode.StatusBarAlignment.Left, 50);
  /** "$(person) Beta tester": who flags are being previewed as. Next to the environment. */
  private readonly persona = vscode.window.createStatusBarItem('flaglens.persona', vscode.StatusBarAlignment.Left, 49);

  constructor(private readonly store: FlagStore) {
    this.item.name = 'FlagLens';
    this.update();
    this.item.show();
  }

  update(): void {
    this.updatePersona();
    const { store, item } = this;
    const project = store.project?.name ?? '';
    const env = store.activeEnvironment;
    item.backgroundColor = undefined;
    switch (store.status) {
      case 'disconnected':
        item.text = '$(flag) FlagLens: Connect';
        item.tooltip = 'Connect to Flagsmith';
        item.command = 'flaglens.connect';
        return;
      case 'loading':
        item.text = `$(sync~spin) ${project}`;
        item.tooltip = 'Loading flags from Flagsmith…';
        item.command = 'flaglens.showOutput';
        return;
      case 'offline':
      case 'error':
        item.text = `$(warning) ${project} · ${env?.name ?? ''}`;
        item.tooltip = `${store.status === 'offline' ? 'Showing last known flags (stale data). ' : ''}${store.lastError ?? ''}\nClick to retry.`;
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        item.command = 'flaglens.refresh';
        return;
      case 'ok': {
        item.text = `$(flag) ${project} · ${env?.name ?? '—'}${env?.protected ? ' $(shield)' : ''}`;
        const md = new vscode.MarkdownString(
          `**FlagLens** · ${store.connection?.client.baseUrl}\n\nProject **${project}**, ${store.rows.size} flags, ${store.environments.length} environments.\n\nActive environment: **${env?.name}**${env?.protected ? ' (protected)' : ''}\n\nClick to switch environment.`,
        );
        item.tooltip = md;
        item.command = 'flaglens.selectEnvironment';
        if (env?.protected) item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        return;
      }
    }
  }

  private updatePersona(): void {
    const { store, persona } = this;
    if (!store.previewSupported || (store.status !== 'ok' && store.status !== 'offline')) {
      persona.hide();
      return;
    }
    const p = store.persona;
    persona.name = 'FlagLens preview';
    persona.text = p ? `$(person) ${personaName(p)}` : '$(globe) Everyone';
    persona.tooltip = p
      ? new vscode.MarkdownString(`**Previewing flags as ${personaName(p)}**\n\nIdentifier \`${p.identifier}\`${traitsText(p) ? `\n\nTraits: ${traitsText(p)}` : ''}\n\nEvaluated locally with Flagsmith's rules. Click to change.`)
      : 'Showing environment defaults. Click to preview flags as a specific user.';
    persona.command = 'flaglens.previewAs';
    persona.backgroundColor = p ? new vscode.ThemeColor('statusBarItem.prominentBackground') : undefined;
    persona.show();
  }

  dispose(): void {
    this.persona.dispose();
    this.item.dispose();
  }
}
