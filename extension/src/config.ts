// Where FlagLens gets its configuration from, in priority order:
//   1. VS Code settings explicitly set by the user (flaglens.*)
//   2. flagsmith.json in the workspace: the Flagsmith CLI v2 config file (project, organisation, environment, apiUrl)
//   3. FLAGSMITH_* variables in the workspace .env (written by the dev kit's `make seed`)
//   4. defaults (http://localhost:8000: the self-hosted dev kit)
// The Organisation API key is only ever stored in VS Code SecretStorage.

import * as vscode from 'vscode';
import { normaliseApiUrl } from './api/client';
import type { Persona } from './core/engine';

export const DEFAULT_API_URL = 'http://localhost:8000';

/** flagsmith.json as written by `flagsmith init` (Flagsmith CLI v2). project/organisation may be an id or a name. */
export interface FlagsmithJson {
  project?: number | string;
  organisation?: number | string;
  /** A client-side environment key or an environment name. */
  environment?: string;
  apiUrl?: string;
  /** Folder that contains the file. */
  folder: vscode.Uri;
}

export interface Settings {
  apiUrl: string | undefined;
  dashboardUrl: string;
  projectId: number | null;
  activeEnvironment: string;
  refreshIntervalSeconds: number;
  protectedEnvironments: string;
  driftEnvironments: string[];
  staleAfterDays: number;
  /** True when staleAfterDays was set explicitly, so it should override the project's stale_flags_limit_days. */
  staleAfterDaysExplicit: boolean;
  permanentTags: string[];
  extraPatterns: string[];
  codeLensEnabled: boolean;
  unknownFlagSeverity: 'error' | 'warning' | 'information' | 'off';
  staleDiagnostics: boolean;
  /** Test users for "Preview as". */
  personas: Persona[];
  /** Grey out code that can't run in the active environment. */
  dimInactiveCode: boolean;
  /** Real-time updates through a Flagsmith webhook (see realtime.ts). */
  realtimeMode: 'auto' | 'on' | 'off';
  realtimeCallbackHost: string;
  /** Flagsmith's MCP server offered to AI assistants; empty = off (see mcp.ts). */
  mcpUrl: string;
}

/** Keeps only well-formed persona entries from settings.json. */
function readPersonas(raw: unknown): Persona[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Persona => !!p && typeof p === 'object' && typeof (p as Persona).identifier === 'string' && (p as Persona).identifier.trim() !== '')
    .map((p) => ({ name: typeof p.name === 'string' ? p.name : undefined, identifier: p.identifier.trim(), traits: p.traits && typeof p.traits === 'object' ? p.traits : {} }));
}

function isExplicit<T>(cfg: vscode.WorkspaceConfiguration, key: string): boolean {
  const i = cfg.inspect<T>(key);
  return !!i && (i.globalValue !== undefined || i.workspaceValue !== undefined || i.workspaceFolderValue !== undefined);
}

export function readSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration('flaglens');
  return {
    apiUrl: isExplicit(cfg, 'apiUrl') ? cfg.get<string>('apiUrl') : undefined,
    dashboardUrl: cfg.get<string>('dashboardUrl', ''),
    projectId: cfg.get<number | null>('projectId', null),
    activeEnvironment: cfg.get<string>('activeEnvironment', ''),
    refreshIntervalSeconds: Math.max(3, cfg.get<number>('refreshIntervalSeconds', 10)),
    protectedEnvironments: cfg.get<string>('protectedEnvironments', 'prod|live|main'),
    driftEnvironments: cfg.get<string[]>('driftEnvironments', ['Staging', 'Production']),
    staleAfterDays: Math.max(0, cfg.get<number>('staleAfterDays', 30)),
    staleAfterDaysExplicit: isExplicit(cfg, 'staleAfterDays'),
    permanentTags: cfg.get<string[]>('permanentTags', ['permanent', 'kill-switch']),
    extraPatterns: cfg.get<string[]>('extraPatterns', []),
    codeLensEnabled: cfg.get<boolean>('codeLens.enabled', true),
    unknownFlagSeverity: cfg.get<Settings['unknownFlagSeverity']>('diagnostics.unknownFlagSeverity', 'warning'),
    staleDiagnostics: cfg.get<boolean>('diagnostics.staleFlags', true),
    personas: readPersonas(cfg.get<unknown>('personas', [])),
    dimInactiveCode: cfg.get<boolean>('dimInactiveCode', true),
    realtimeMode: cfg.get<Settings['realtimeMode']>('realtime.mode', 'auto'),
    realtimeCallbackHost: cfg.get<string>('realtime.callbackHost', 'host.docker.internal').trim() || 'host.docker.internal',
    mcpUrl: cfg.get<string>('mcp.url', 'http://localhost:8002/mcp').trim(),
  };
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/**
 * Finds flagsmith.json: first at the root of each workspace folder, then anywhere in the workspace (outside
 * node_modules). Ignored in untrusted workspaces, because it decides which server we send the API key to.
 */
export async function findFlagsmithJson(): Promise<FlagsmithJson | undefined> {
  if (!vscode.workspace.isTrusted) return undefined;
  const candidates: vscode.Uri[] = (vscode.workspace.workspaceFolders ?? []).map((f) => vscode.Uri.joinPath(f.uri, 'flagsmith.json'));
  for (const uri of candidates) {
    const parsed = await parseFlagsmithJson(uri);
    if (parsed) return parsed;
  }
  const found = await vscode.workspace.findFiles('**/flagsmith.json', '**/node_modules/**', 1);
  return found[0] ? parseFlagsmithJson(found[0]) : undefined;
}

async function parseFlagsmithJson(uri: vscode.Uri): Promise<FlagsmithJson | undefined> {
  const text = await readText(uri);
  if (!text) return undefined;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const idOrName = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim()) ? (v as number | string) : undefined);
    return {
      project: idOrName(raw.project),
      organisation: idOrName(raw.organisation),
      environment: typeof raw.environment === 'string' && !raw.environment.startsWith('ser.') ? raw.environment : undefined,
      apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl : undefined,
      folder: vscode.Uri.joinPath(uri, '..'),
    };
  } catch {
    return undefined;
  }
}

/** Parses a .env file (same rules as devkit/lib.mjs). */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    const quoted = /^(['"])(.*)\1$/.exec(m[2]);
    out[m[1]] = quoted?.[2] ?? m[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}

export interface DotenvConfig {
  apiUrl?: string;
  apiKey?: string;
  projectId?: number;
  file: vscode.Uri;
}

/** Reads FLAGSMITH_* values from .env at the root of a workspace folder (the dev kit writes one there). */
export async function findDotenv(): Promise<DotenvConfig | undefined> {
  if (!vscode.workspace.isTrusted) return undefined;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const file = vscode.Uri.joinPath(folder.uri, '.env');
    const text = await readText(file);
    if (!text) continue;
    const env = parseDotenv(text);
    if (!env.FLAGSMITH_API_KEY && !env.FLAGSMITH_API_URL) continue;
    const projectId = Number(env.FLAGSMITH_PROJECT_ID);
    return {
      apiUrl: env.FLAGSMITH_API_URL || undefined,
      apiKey: env.FLAGSMITH_API_KEY || undefined,
      projectId: Number.isInteger(projectId) && projectId > 0 ? projectId : undefined,
      file,
    };
  }
  return undefined;
}

/** Resolves the API URL from settings, flagsmith.json, .env, then the dev-kit default. */
export function resolveApiUrl(settings: Settings, fsJson: FlagsmithJson | undefined, dotenv: DotenvConfig | undefined): string {
  return normaliseApiUrl(settings.apiUrl || fsJson?.apiUrl || dotenv?.apiUrl || process.env.FLAGSMITH_API_URL || DEFAULT_API_URL);
}

/** Dashboard links: explicit setting, else the API host (true for the self-hosted image), with Cloud special-cased. */
export function resolveDashboardUrl(settings: Settings, apiUrl: string): string {
  if (settings.dashboardUrl) return settings.dashboardUrl.replace(/\/+$/, '');
  if (/^https:\/\/(edge\.)?api\.flagsmith\.com$/i.test(apiUrl)) return 'https://app.flagsmith.com';
  return apiUrl;
}

/** SecretStorage holds one key per API URL, so switching servers never sends a key to the wrong host. */
export class ApiKeyStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}
  private id(apiUrl: string) {
    return `flaglens.apiKey:${normaliseApiUrl(apiUrl)}`;
  }
  get(apiUrl: string) {
    return this.secrets.get(this.id(apiUrl));
  }
  set(apiUrl: string, key: string) {
    return this.secrets.store(this.id(apiUrl), key.trim());
  }
  delete(apiUrl: string) {
    return this.secrets.delete(this.id(apiUrl));
  }
}
