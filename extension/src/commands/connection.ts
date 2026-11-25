// Connecting FlagLens to a Flagsmith project.
//
// Zero-click path (the dev kit): the workspace has flagsmith.json (Flagsmith CLI v2 format) and a .env with
// FLAGSMITH_API_KEY. On startup FlagLens offers to use that key once; after that it reconnects silently.
// Manual path: "FlagLens: Connect to Flagsmith" asks for the URL, the Organisation API key and the project.

import * as vscode from 'vscode';
import { AuthError, ConnectionError, FlagsmithClient, isInsecureRemoteUrl, normaliseApiUrl } from '../api/client';
import type { ApiProject } from '../api/types';
import {
  DEFAULT_API_URL,
  findDotenv,
  findFlagsmithJson,
  readSettings,
  resolveApiUrl,
  resolveDashboardUrl,
  type DotenvConfig,
  type FlagsmithJson,
} from '../config';
import type { App } from '../app';

const LAST_API_URL = 'flaglens.lastApiUrl';
const LAST_PROJECT = 'flaglens.lastProjectId';
const LAST_ENV = 'flaglens.lastEnvironment';
const DOTENV_DECLINED = 'flaglens.dotenvDeclined';

interface Discovery {
  fsJson: FlagsmithJson | undefined;
  dotenv: DotenvConfig | undefined;
  apiUrl: string;
}

async function discover(app: App): Promise<Discovery> {
  const settings = readSettings();
  const [fsJson, dotenv] = await Promise.all([findFlagsmithJson(), findDotenv()]);
  const remembered = app.context.workspaceState.get<string>(LAST_API_URL);
  // An explicit setting wins, then what the user picked last time in this workspace, then the files.
  const apiUrl = settings.apiUrl ? normaliseApiUrl(settings.apiUrl) : remembered ?? resolveApiUrl(settings, fsJson, dotenv);
  return { fsJson, dotenv, apiUrl };
}

function dotenvKeyFor(d: Discovery): string | undefined {
  if (!d.dotenv?.apiKey) return undefined;
  return normaliseApiUrl(d.dotenv.apiUrl ?? DEFAULT_API_URL) === d.apiUrl ? d.dotenv.apiKey : undefined;
}

/** Called on activation. Never prompts with modals; at most one notification. */
export async function autoConnect(app: App): Promise<void> {
  const d = await discover(app);
  const saved = await app.keys.get(d.apiUrl);
  if (saved) {
    await connectWith(app, d, saved, { interactive: false });
    return;
  }
  const envKey = dotenvKeyFor(d);
  if (envKey && !app.context.workspaceState.get<boolean>(DOTENV_DECLINED)) {
    const file = vscode.workspace.asRelativePath(d.dotenv!.file);
    const choice = await vscode.window.showInformationMessage(
      `FlagLens found a Flagsmith Organisation API key in ${file} for ${d.apiUrl}. Connect with it?`,
      { detail: 'The key will be copied into VS Code SecretStorage. It is never written to settings or logs.' },
      'Connect',
      'Not now',
    );
    if (choice === 'Connect') await connectWith(app, d, envKey, { interactive: true });
    else if (choice === 'Not now') await app.context.workspaceState.update(DOTENV_DECLINED, true);
    return;
  }
  if (d.fsJson) {
    const choice = await vscode.window.showInformationMessage('This workspace uses Flagsmith (flagsmith.json). Connect FlagLens to see live flag states?', 'Connect');
    if (choice === 'Connect') await vscode.commands.executeCommand('flaglens.connect');
  }
}

/** FlagLens: Connect to Flagsmith… */
export async function connectCommand(app: App): Promise<void> {
  const d = await discover(app);
  const url = await vscode.window.showInputBox({
    title: 'Connect to Flagsmith (1/2): API URL',
    prompt: 'Base URL of your Flagsmith API, without /api/v1. Self-hosted dev kit: http://localhost:8000 · Flagsmith Cloud: https://api.flagsmith.com',
    value: d.apiUrl,
    ignoreFocusOut: true,
    validateInput: (v) => {
      try {
        new URL(normaliseApiUrl(v));
        return undefined;
      } catch {
        return 'Enter a URL such as http://localhost:8000';
      }
    },
  });
  if (url === undefined) return;
  d.apiUrl = normaliseApiUrl(url);
  if (isInsecureRemoteUrl(d.apiUrl)) {
    void vscode.window.showWarningMessage(`${d.apiUrl} uses plain HTTP: your API key will cross the network unencrypted. Prefer https:// for remote servers.`);
  }

  const saved = await app.keys.get(d.apiUrl);
  const envKey = dotenvKeyFor(d);
  type KeyPick = vscode.QuickPickItem & { key?: string };
  const picks: KeyPick[] = [];
  if (saved) picks.push({ label: '$(key) Use the saved key', description: 'from VS Code SecretStorage', key: saved });
  if (envKey) picks.push({ label: '$(file) Use the key from .env', description: vscode.workspace.asRelativePath(d.dotenv!.file), key: envKey });
  picks.push({ label: '$(edit) Enter an Organisation API key…' });

  let key: string | undefined;
  if (picks.length > 1) {
    const pick = await vscode.window.showQuickPick(picks, { title: 'Connect to Flagsmith (2/2): API key', ignoreFocusOut: true });
    if (!pick) return;
    key = pick.key;
  }
  if (!key) {
    key = await vscode.window.showInputBox({
      title: 'Connect to Flagsmith (2/2): Organisation API key',
      prompt: 'Organisation Settings → API Keys in the Flagsmith dashboard. Stored in VS Code SecretStorage only.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : 'Paste an Organisation API key'),
    });
    if (!key) return;
  }
  await connectWith(app, d, key.trim(), { interactive: true, askProject: true });
}

async function connectWith(app: App, d: Discovery, key: string, opts: { interactive: boolean; askProject?: boolean }): Promise<boolean> {
  const settings = readSettings();
  const client = new FlagsmithClient({ baseUrl: d.apiUrl, apiKey: key });
  try {
    const project = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'FlagLens: connecting to Flagsmith…' },
      () => resolveProject(app, client, d, !!opts.askProject && opts.interactive, opts.interactive),
    );
    if (!project) return false;
    await app.keys.set(d.apiUrl, key);
    await app.context.workspaceState.update(LAST_API_URL, d.apiUrl === resolveApiUrl(settings, d.fsJson, d.dotenv) ? undefined : d.apiUrl);
    await app.context.workspaceState.update(LAST_PROJECT, project.id);
    const preferredEnv = settings.activeEnvironment || app.context.workspaceState.get<string>(LAST_ENV) || d.fsJson?.environment;
    await app.store.connect({ client, project, dashboardUrl: resolveDashboardUrl(settings, d.apiUrl) }, preferredEnv);
    if (opts.interactive && app.store.status === 'ok') {
      void vscode.window.showInformationMessage(`FlagLens connected to "${project.name}" (${app.store.rows.size} flags, ${app.store.environments.length} environments).`);
    }
    return true;
  } catch (e) {
    const message = (e as Error).message;
    app.log.error(`Connect failed: ${message}`);
    if (e instanceof AuthError && !opts.interactive) {
      // A saved key that stopped working (revoked, or a fresh dev kit after `make reset`).
      await app.keys.delete(d.apiUrl);
    }
    if (opts.interactive || e instanceof AuthError) {
      const retry = await vscode.window.showErrorMessage(
        e instanceof ConnectionError ? message : `FlagLens could not connect: ${message}`,
        'Connect…',
        'Show Log',
      );
      if (retry === 'Connect…') void vscode.commands.executeCommand('flaglens.connect');
      if (retry === 'Show Log') app.log.show();
    } else if (e instanceof ConnectionError && app.autoConnectRetries < 40) {
      // Flagsmith is probably still starting (`make up`); try again quietly for ~10 minutes.
      app.autoConnectRetries++;
      app.log.info('Retrying in 15 s…');
      setTimeout(() => {
        if (!app.store.connected) void autoConnect(app);
      }, 15_000);
    }
    return false;
  }
}

/**
 * Project order: flaglens.projectId setting → last chosen in this workspace → flagsmith.json (id or name) →
 * .env FLAGSMITH_PROJECT_ID → the only project → ask.
 */
async function resolveProject(app: App, client: FlagsmithClient, d: Discovery, forceAsk: boolean, canAsk: boolean): Promise<ApiProject | undefined> {
  const settings = readSettings();
  const candidates: Array<number | string | undefined> = forceAsk
    ? []
    : [settings.projectId ?? undefined, app.context.workspaceState.get<number>(LAST_PROJECT), d.fsJson?.project, d.dotenv?.projectId];

  // Listing projects also validates the key; fall back to direct lookups if listing is restricted.
  const projects = await client.listProjects();
  for (const c of candidates) {
    if (c === undefined) continue;
    const hit = projects.find((p) => p.id === Number(c) || (typeof c === 'string' && p.name.toLowerCase() === c.toLowerCase()));
    if (hit) return client.getProject(hit.id);
  }
  if (forceAsk && projects.length > 0) {
    // Pre-select what the workspace config points at, but let the user choose.
    const preferred = [d.fsJson?.project, d.dotenv?.projectId, settings.projectId].find((c) => c !== undefined && c !== null);
    return pickProject(client, projects, preferred ?? undefined);
  }
  if (projects.length === 1) return client.getProject(projects[0]!.id);
  if (projects.length === 0) {
    throw new Error('This API key can see no projects. Create one in the Flagsmith dashboard, or run `make seed` for the demo.');
  }
  if (!canAsk) {
    const choice = await vscode.window.showInformationMessage('FlagLens: choose which Flagsmith project this workspace uses.', 'Choose Project');
    if (choice !== 'Choose Project') return undefined;
  }
  return pickProject(client, projects);
}

async function pickProject(client: FlagsmithClient, projects: ApiProject[], preferred?: number | string): Promise<ApiProject | undefined> {
  const orgs = await client.listOrganisations().catch(() => []);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const items = projects.map((p) => ({
    label: p.name,
    description: `${orgName.get(p.organisation) ?? `org ${p.organisation}`} · id ${p.id}`,
    project: p,
    picked: preferred !== undefined && (p.id === Number(preferred) || p.name === preferred),
  }));
  items.sort((a, b) => Number(b.picked) - Number(a.picked));
  const pick = await vscode.window.showQuickPick(items, { title: 'Choose a Flagsmith project', ignoreFocusOut: true });
  return pick ? client.getProject(pick.project.id) : undefined;
}

export async function selectProjectCommand(app: App): Promise<void> {
  const conn = app.store.connection;
  if (!conn) return void vscode.commands.executeCommand('flaglens.connect');
  const projects = await conn.client.listProjects();
  const project = await pickProject(conn.client, projects, conn.project.id);
  if (!project) return;
  await app.context.workspaceState.update(LAST_PROJECT, project.id);
  await app.context.workspaceState.update(LAST_ENV, undefined);
  await app.store.connect({ ...conn, project });
}

export async function selectEnvironmentCommand(app: App): Promise<void> {
  const { store } = app;
  if (!store.connected) return void vscode.commands.executeCommand('flaglens.connect');
  const items = store.environments.map((e) => ({
    label: `${e.id === store.activeEnvironment?.id ? '$(check) ' : ''}${e.name}`,
    description: [e.protected ? '$(shield) protected' : '', e.v2Versioning ? '$(versions) feature versioning (v2)' : ''].filter(Boolean).join('  '),
    env: e,
  }));
  const pick = await vscode.window.showQuickPick(items, { title: 'Active Flagsmith environment', placeHolder: 'Used by the status bar, tree and autocomplete' });
  if (!pick) return;
  store.setActiveEnvironment(pick.env.id);
  await app.context.workspaceState.update(LAST_ENV, pick.env.name);
}

export async function signOutCommand(app: App): Promise<void> {
  const conn = app.store.connection;
  const d = await discover(app);
  const apiUrl = conn?.client.baseUrl ?? d.apiUrl;
  await app.keys.delete(apiUrl);
  await app.context.workspaceState.update(LAST_PROJECT, undefined);
  await app.context.workspaceState.update(LAST_API_URL, undefined);
  await app.context.workspaceState.update(DOTENV_DECLINED, true);
  app.store.disconnect();
  app.log.info(`Signed out of ${apiUrl}; API key removed from SecretStorage.`);
  void vscode.window.showInformationMessage(`FlagLens forgot the API key for ${apiUrl}.`);
}
