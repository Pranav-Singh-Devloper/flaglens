// FlagLens: a community VS Code extension for self-hosted Flagsmith.
// activate() wires the store (live Flagsmith data), the reference index (flag keys in open files) and the UI.

import * as vscode from 'vscode';
import type { App } from './app';
import { autoConnect, connectCommand, selectEnvironmentCommand, selectProjectCommand, signOutCommand } from './commands/connection';
import {
  copyDiffMarkdownCommand,
  copyKeyCommand,
  createFlagCommand,
  findUnusedFlagsCommand,
  flagActionsCommand,
  openInDashboardCommand,
  setValueCommand,
  showHistoryCommand,
  toggleCommand,
} from './commands/flags';
import { previewAsCommand, restorePersona, toggleDimmingCommand } from './commands/persona';
import { publishCodeReferencesCommand } from './commands/codeReferences';
import { userOverrideCommand } from './commands/overrides';
import { segmentOverridesCommand } from './commands/segmentOverrides';
import { refreshExperimentsCommand, showExperimentsCommand } from './commands/experiments';
import { checkRulesCommand, testPlanCommand } from './commands/rules';
import { ApiKeyStore, readSettings } from './config';
import { createLogger } from './log';
import { FlagCodeLensProvider } from './providers/codeLens';
import { FlagCompletionProvider } from './providers/completion';
import { DeadCodeDecorator } from './providers/deadCode';
import { FlagCodeActions, FlagDiagnostics } from './providers/diagnostics';
import { FlagHoverProvider } from './providers/hover';
import { HealthAlerts } from './healthAlerts';
import { FlagsmithMcp } from './mcp';
import { RealtimeSync } from './realtime';
import { ReferenceIndex } from './references';
import { confirmWrite, WriteJournal } from './safety';
import { FlagStore } from './store/flagStore';
import { FlagsTreeProvider } from './views/flagsTree';
import { StatusBar } from './views/statusBar';

const SELECTOR: vscode.DocumentSelector = [{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'vscode-notebook-cell' }];

/** Returns the internal app object; only the integration tests use it. */
export function activate(context: vscode.ExtensionContext): App {
  const log = createLogger();
  let settings = readSettings();
  // While the webhook delivers changes, polling is only a safety net, so it slows down to at least every 30 s.
  const store: FlagStore = new FlagStore(
    log,
    (): number => (realtime.live ? Math.max(30, settings.refreshIntervalSeconds) : settings.refreshIntervalSeconds) * 1000,
    () => settings.protectedEnvironments,
  );
  const realtime: RealtimeSync = new RealtimeSync(log, store);
  current = realtime;
  const refs = new ReferenceIndex(log, settings.extraPatterns);
  const app: App = {
    context,
    log,
    store,
    refs,
    settings: () => settings,
    keys: new ApiKeyStore(context.secrets),
    journal: new WriteJournal(context.globalState),
    autoConnectRetries: 0,
    confirm: confirmWrite,
    realtime,
  };
  const mcp = new FlagsmithMcp(log, store, app.keys, () => settings.mcpUrl);
  app.mcp = mcp;
  mcp.register();

  const statusBar = new StatusBar(store, realtime);
  const codeLens = new FlagCodeLensProvider(app, refs);
  const diagnostics = new FlagDiagnostics(app, refs);
  const deadCode = new DeadCodeDecorator(app, refs);
  app.deadCode = deadCode;
  restorePersona(app);
  const tree = new FlagsTreeProvider(app);
  const treeView = vscode.window.createTreeView('flaglens.flags', { treeDataProvider: tree, showCollapseAll: true });

  // Restart the webhook whenever the connection (server, project or key) changes.
  let realtimeKey = '';
  const restartRealtime = (force = false) => {
    const conn = store.connection;
    const key = conn ? `${conn.client.baseUrl}|${conn.project.id}|${settings.realtimeMode}|${settings.realtimeCallbackHost}` : '';
    if (key === realtimeKey && !force) return;
    realtimeKey = key;
    if (conn) void realtime.start({ mode: settings.realtimeMode, callbackHost: settings.realtimeCallbackHost });
    else void realtime.stop();
  };

  const healthAlerts = new HealthAlerts(app);
  const onStoreChange = () => {
    restartRealtime();
    healthAlerts.update();
    mcp.update();
    void vscode.commands.executeCommand('setContext', 'flaglens.connected', store.connected);
    statusBar.update();
    codeLens.refresh();
    tree.refresh();
    diagnostics.update();
    deadCode.update();
    treeView.message = store.status === 'ok' && store.project ? `${store.project.name} · active: ${store.activeEnvironment?.name ?? '—'}` : undefined;
  };

  const register = (id: string, fn: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(id, async (...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args);
      } catch (e) {
        log.error(`${id} failed: ${(e as Error).stack ?? e}`);
        void vscode.window.showErrorMessage(`FlagLens: ${(e as Error).message}`);
      }
    });

  context.subscriptions.push(
    log,
    store,
    refs,
    statusBar,
    healthAlerts,
    realtime,
    mcp,
    realtime.onDidChange(() => statusBar.update()),
    diagnostics,
    deadCode,
    treeView,
    vscode.window.onDidChangeVisibleTextEditors(() => deadCode.update()),
    store.onDidChange(onStoreChange),
    refs.onDidChange((uri) => {
      codeLens.refresh();
      const doc = uri && vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (uri && doc) diagnostics.update(doc);
      else if (!uri) diagnostics.update();
      deadCode.update(uri);
    }),
    vscode.languages.registerCodeLensProvider(SELECTOR, codeLens),
    vscode.languages.registerHoverProvider(SELECTOR, new FlagHoverProvider(app, refs)),
    vscode.languages.registerCompletionItemProvider(SELECTOR, new FlagCompletionProvider(app), '"', "'"),
    vscode.languages.registerCodeActionsProvider(SELECTOR, new FlagCodeActions(), { providedCodeActionKinds: FlagCodeActions.kinds }),

    register('flaglens.connect', () => connectCommand(app)),
    register('flaglens.signOut', () => signOutCommand(app)),
    register('flaglens.refresh', async () => {
      if (!store.connected) return autoConnect(app);
      await store.refresh();
      if (store.status === 'ok') void vscode.window.setStatusBarMessage(`$(check) FlagLens: ${store.rows.size} flags refreshed`, 2500);
    }),
    register('flaglens.selectEnvironment', () => selectEnvironmentCommand(app)),
    register('flaglens.selectProject', () => selectProjectCommand(app)),
    register('flaglens.toggleFlag', (arg?: never, env?: never) => toggleCommand(app, arg, env)),
    register('flaglens.setValue', (arg?: never, env?: never) => setValueCommand(app, arg, env)),
    register('flaglens.createFlag', (key?: never) => createFlagCommand(app, key)),
    register('flaglens.openInDashboard', (arg?: never, env?: never) => openInDashboardCommand(app, arg, env)),
    register('flaglens.showHistory', (arg?: never) => showHistoryCommand(app, arg)),
    register('flaglens.flagActions', (arg?: never) => flagActionsCommand(app, arg)),
    register('flaglens.copyKey', (arg?: never) => copyKeyCommand(app, arg)),
    register('flaglens.copyDiffMarkdown', (a?: never, b?: never) => copyDiffMarkdownCommand(app, a, b)),
    register('flaglens.findUnusedFlags', () => findUnusedFlagsCommand(app)),
    register('flaglens.openMatrix', async (focus?: never) => {
      // Loaded on demand so the webview code costs nothing at startup.
      const { MatrixPanel } = await import('./views/matrixPanel');
      MatrixPanel.show(app, focus);
    }),
    register('flaglens.showOutput', () => log.show()),
    register('flaglens.previewAs', (persona?: never) => previewAsCommand(app, persona)),
    register('flaglens.toggleDimming', () => toggleDimmingCommand()),
    register('flaglens.checkRules', (opts?: never) => checkRulesCommand(app, opts)),
    register('flaglens.setUserOverride', (arg?: never, env?: never, preset?: never) => userOverrideCommand(app, arg, env, preset)),
    register('flaglens.showExperiments', (opts?: never) => showExperimentsCommand(app, opts)),
    register('flaglens.refreshExperiments', () => refreshExperimentsCommand(app)),
    register('flaglens.editSegmentOverrides', (arg?: never, env?: never, step?: never) => segmentOverridesCommand(app, arg, env, step)),
    register('flaglens.publishCodeReferences', (opts?: never) => publishCodeReferencesCommand(app, opts)),
    register('flaglens.testPlan', (keys?: never, mode?: never, opts?: never) => testPlanCommand(app, keys, mode, opts)),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('flaglens')) return;
      const before = settings;
      settings = readSettings();
      refs.setExtraPatterns(settings.extraPatterns);
      if (before.protectedEnvironments !== settings.protectedEnvironments) store.reapplyProtection();
      if (e.affectsConfiguration('flaglens.realtime')) restartRealtime(true);
      if (e.affectsConfiguration('flaglens.apiUrl') || e.affectsConfiguration('flaglens.projectId')) {
        store.disconnect();
        void autoConnect(app);
      }
      onStoreChange();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => void autoConnect(app)),
  );

  // Feature Health events don't arrive through the webhook: while it is live, check them at the normal pace.
  const healthTimer = setInterval(() => {
    if (realtime.live) void store.checkHealth().catch(() => undefined);
  }, settings.refreshIntervalSeconds * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(healthTimer) });

  onStoreChange();
  void autoConnect(app).catch((e) => log.error(`Auto-connect failed: ${(e as Error).message}`));
  return app;
}

let current: RealtimeSync | undefined;

/** Removes the real-time webhook before the window closes; everything else is disposed through context.subscriptions. */
export function deactivate(): Promise<void> | undefined {
  return current?.stop();
}
