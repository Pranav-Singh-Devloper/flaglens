// Flagsmith's MCP server for the editor's AI assistants. While FlagLens is connected and the server answers, FlagLens
// offers it to VS Code (Copilot agent mode and any assistant that uses VS Code's MCP support) as "Flagsmith", so the
// assistant can list flags, read experiment results or draft a change through Flagsmith's own tools.
//
// The organisation key never leaves SecretStorage until VS Code starts the server: the listed definition has no
// headers, and resolveMcpServerDefinition adds `Authorization: Api-Key …` at start. VS Code asks the user before each
// tool call that is not marked read-only, so writes stay behind a confirmation.
//
// VS Code added this API in 1.101; FlagLens supports 1.95, so it is declared here and feature-detected at runtime.

import * as vscode from 'vscode';
import type { Logger } from './log';
import type { ApiKeyStore } from './config';
import type { FlagStore } from './store/flagStore';

export const MCP_PROVIDER_ID = 'flaglens.flagsmith';

interface McpHttpServerDefinition {
  label: string;
  uri: vscode.Uri;
  headers: Record<string, string>;
  version?: string;
}
interface McpApi {
  lm?: {
    registerMcpServerDefinitionProvider?: (
      id: string,
      provider: {
        onDidChangeMcpServerDefinitions?: vscode.Event<void>;
        provideMcpServerDefinitions(token: vscode.CancellationToken): Promise<McpHttpServerDefinition[]>;
        resolveMcpServerDefinition?(server: McpHttpServerDefinition, token: vscode.CancellationToken): Promise<McpHttpServerDefinition | undefined>;
      },
    ) => vscode.Disposable;
  };
  McpHttpServerDefinition?: new (label: string, uri: vscode.Uri, headers?: Record<string, string>, version?: string) => McpHttpServerDefinition;
}

export class FlagsmithMcp implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private registration: vscode.Disposable | undefined;
  private signature = '';
  /** The server did not answer last time; ask VS Code to look again on the next change (e.g. after `make mcp`). */
  private waiting = false;

  constructor(
    private readonly log: Logger,
    private readonly store: FlagStore,
    private readonly keys: ApiKeyStore,
    private readonly url: () => string,
  ) {}

  /** True when this VS Code has the MCP API (1.101+). */
  get supported(): boolean {
    const api = vscode as unknown as McpApi;
    return !!api.lm?.registerMcpServerDefinitionProvider && !!api.McpHttpServerDefinition;
  }

  register(): void {
    const api = vscode as unknown as McpApi;
    if (!this.supported || this.registration) return;
    this.registration = api.lm!.registerMcpServerDefinitionProvider!(MCP_PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: this.changed.event,
      provideMcpServerDefinitions: () => this.definitions(),
      resolveMcpServerDefinition: (server) => this.resolve(server),
    });
    this.log.info('Flagsmith MCP server offered to AI assistants (when connected and reachable)');
  }

  /** Call when the connection or the setting changes; VS Code then asks for the definitions again. */
  update(): void {
    const conn = this.store.connection;
    const signature = conn ? `${conn.client.baseUrl}|${this.url()}` : '';
    if (signature === this.signature && !this.waiting) return;
    this.signature = signature;
    this.waiting = false;
    this.changed.fire();
  }

  /** The server VS Code lists: none when disconnected, switched off, or not answering. No secrets in here. */
  async definitions(): Promise<McpHttpServerDefinition[]> {
    const conn = this.store.connection;
    const url = this.url();
    const Definition = (vscode as unknown as McpApi).McpHttpServerDefinition;
    if (!conn || !url || !Definition) return [];
    if (!(await reachable(url))) {
      this.waiting = true;
      this.log.info(`Flagsmith MCP server not reachable at ${url} (start it with: make mcp)`);
      return [];
    }
    return [new Definition('Flagsmith', vscode.Uri.parse(url))];
  }

  /** Adds the organisation key just before VS Code starts the server. */
  async resolve(server: McpHttpServerDefinition): Promise<McpHttpServerDefinition | undefined> {
    const conn = this.store.connection;
    const key = conn && (await this.keys.get(conn.client.baseUrl));
    if (!key) {
      void vscode.window.showWarningMessage('FlagLens: connect to Flagsmith first, so the MCP server can use your organisation API key.');
      return undefined;
    }
    server.headers = { ...server.headers, Authorization: `Api-Key ${key}` };
    return server;
  }

  dispose(): void {
    this.registration?.dispose();
    this.changed.dispose();
  }
}

/** Any HTTP answer counts (the MCP endpoint answers 401 or 405 to a plain GET); only a network error does not. */
async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
