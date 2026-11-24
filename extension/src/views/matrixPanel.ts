// Environment Matrix: every flag × every environment in one grid, with differences highlighted.
// Clicking a cell runs the normal toggle command, so the same confirmations apply.

import * as vscode from 'vscode';
import { differsAcross } from '../core/analysis';
import { formatValue, writeBlockReason } from '../core/model';
import type { App } from '../app';
import { copyDiffMarkdownCommand, openInDashboardCommand, setValueCommand, toggleCommand } from '../commands/flags';
import { badgesFor, driftOf, staleFor } from '../present';

interface MatrixData {
  project: string;
  source: string;
  status: string;
  activeEnvId: number | undefined;
  focus?: string;
  envs: { id: number; name: string; protected: boolean; readOnly: boolean }[];
  rows: {
    key: string;
    description: string;
    archived: boolean;
    differs: boolean;
    drift: boolean;
    stale: boolean;
    badges: { label: string; detail: string }[];
    cells: Record<number, { enabled: boolean; value: string; blocked?: string } | null>;
  }[];
}

type Inbound =
  | { type: 'ready' }
  | { type: 'toggle'; key: string; envId: number }
  | { type: 'setValue'; key: string; envId: number }
  | { type: 'open'; key: string; envId?: number }
  | { type: 'copyDiff'; a: number; b: number }
  | { type: 'refresh' };

export class MatrixPanel {
  private static current: MatrixPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(app: App, focus?: string): void {
    if (MatrixPanel.current) {
      MatrixPanel.current.focus = typeof focus === 'string' ? focus : undefined;
      MatrixPanel.current.panel.reveal(vscode.ViewColumn.Active);
      MatrixPanel.current.post();
      return;
    }
    MatrixPanel.current = new MatrixPanel(app, typeof focus === 'string' ? focus : undefined);
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    private readonly app: App,
    private focus: string | undefined,
  ) {
    const media = vscode.Uri.joinPath(app.context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('flaglens.matrix', 'Flagsmith Environment Matrix', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [media],
      retainContextWhenHidden: true,
    });
    this.panel.iconPath = vscode.Uri.joinPath(media, 'activitybar.svg');
    this.panel.webview.html = this.html(media);
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m: Inbound) => void this.onMessage(m)),
      app.store.onDidChange(() => this.post()),
    );
  }

  private async onMessage(m: Inbound): Promise<void> {
    const { app } = this;
    try {
      switch (m.type) {
        case 'ready':
          return this.post();
        case 'toggle':
          return await toggleCommand(app, m.key, m.envId);
        case 'setValue':
          return await setValueCommand(app, m.key, m.envId);
        case 'open':
          return await openInDashboardCommand(app, m.key, m.envId);
        case 'copyDiff':
          await copyDiffMarkdownCommand(app, m.a, m.b);
          return;
        case 'refresh':
          return await app.store.refresh();
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`FlagLens: ${(e as Error).message}`);
    }
  }

  private data(): MatrixData {
    const { store } = this.app;
    const envIds = store.environments.map((e) => e.id);
    return {
      project: store.project?.name ?? '',
      source: store.connection?.client.baseUrl ?? '',
      status: store.status === 'offline' ? `Offline: showing last known state. ${store.lastError ?? ''}` : store.status === 'ok' ? '' : store.status,
      activeEnvId: store.activeEnvironment?.id,
      focus: this.focus,
      envs: store.environments.map((e) => ({ id: e.id, name: e.name, protected: e.protected, readOnly: e.v2Versioning })),
      rows: [...store.rows.values()]
        .sort((a, b) => Number(a.feature.isArchived) - Number(b.feature.isArchived) || a.feature.name.localeCompare(b.feature.name))
        .map((row) => {
          const cells: MatrixData['rows'][number]['cells'] = {};
          for (const env of store.environments) {
            const s = row.states.get(env.id);
            cells[env.id] = s
              ? { enabled: s.enabled, value: formatValue(s.value, 40), blocked: row.feature.isArchived ? 'Archived' : writeBlockReason(row, env) }
              : null;
          }
          return {
            key: row.feature.name,
            description: row.feature.description,
            archived: row.feature.isArchived,
            differs: differsAcross(row, envIds),
            drift: driftOf(this.app, row).drifted,
            stale: staleFor(this.app, row).stale,
            badges: badgesFor(this.app, row).map((b) => ({ label: b.label, detail: b.detail })),
            cells,
          };
        }),
    };
  }

  private post(): void {
    void this.panel.webview.postMessage({ type: 'data', data: this.data() });
  }

  private html(media: vscode.Uri): string {
    const webview = this.panel.webview;
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'matrix.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'matrix.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>Environment Matrix</title>
</head>
<body>
  <header>
    <div class="title"><h1>Environment Matrix</h1><span id="project"></span></div>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Filter flags…" aria-label="Filter flags">
      <label><input type="checkbox" id="onlyDiff"> Only differences</label>
      <label><input type="checkbox" id="onlyStale"> Only stale</label>
      <label><input type="checkbox" id="showArchived"> Archived</label>
      <span class="spacer"></span>
      <select id="diffA" aria-label="Compare from"></select><span class="arrow">→</span><select id="diffB" aria-label="Compare to"></select>
      <button id="copyDiff" title="Copy the differences between the two environments as a Markdown table">Copy diff as Markdown</button>
      <button id="refresh" class="secondary" title="Refresh from Flagsmith">↻</button>
    </div>
    <div id="status" class="status" hidden></div>
  </header>
  <main><table id="matrix"><thead></thead><tbody></tbody></table><p id="empty" hidden>No flags match.</p></main>
  <footer>Click a cell to toggle it (with confirmation). Protected environments ⛨ ask you to type the flag name. Highlighted rows differ between environments.</footer>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    MatrixPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}
