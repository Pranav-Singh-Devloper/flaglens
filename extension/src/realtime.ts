// Real-time updates: FlagLens registers a Flagsmith organisation webhook that points at a small HTTP listener inside
// the editor, so a change made anywhere (dashboard, API, another developer) shows up within a few seconds instead
// of at the next poll. Polling continues as a fallback, at a slower pace while the webhook works.
//
// The listener accepts only POSTs to /flaglens/<random token> signed with a random secret (HMAC-SHA256, checked in
// constant time), and a signed event only triggers a refresh: nothing in the payload is trusted beyond "something
// changed". The webhook is removed when the editor disconnects or closes; webhooks left behind by a crashed window are
// detected (their listener no longer answers) and removed on the next start.

import { randomBytes } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as vscode from 'vscode';
import type { FlagsmithClient } from './api/client';
import { describeEvent, isLocalApiUrl, isRelevant, parseOwnWebhook, SIGNATURE_HEADER, signatureMatches, webhookPath, webhookUrl, type WebhookEvent } from './core/webhook';
import type { Logger } from './log';
import type { FlagStore } from './store/flagStore';

export type RealtimeMode = 'auto' | 'on' | 'off';
export type RealtimeState = 'off' | 'starting' | 'live' | 'unavailable';

export interface RealtimeSettings {
  mode: RealtimeMode;
  /** Host name Flagsmith uses to reach this machine. From Docker: host.docker.internal. */
  callbackHost: string;
}

const MAX_BODY = 1_000_000;
const ALIVE = 'flaglens';

export class RealtimeSync implements vscode.Disposable {
  state: RealtimeState = 'off';
  /** Why real-time updates are off or unavailable, for the status bar and the log. */
  reason: string | undefined;
  events = 0;
  lastEvent: WebhookEvent | undefined;

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private server: http.Server | undefined;
  private registration: { client: FlagsmithClient; organisationId: number; id: number } | undefined;
  private token = '';
  private secret = '';
  private projectId = 0;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  /** Incremented by every start/stop, so a slow start can tell it was superseded. */
  private generation = 0;

  constructor(
    private readonly log: Logger,
    private readonly store: FlagStore,
  ) {}

  get live(): boolean {
    return this.state === 'live';
  }

  /** (Re)starts for the store's current connection. Never throws: failures leave polling in charge. */
  async start(settings: RealtimeSettings): Promise<void> {
    await this.stop();
    const generation = ++this.generation;
    const conn = this.store.connection;
    if (!conn) return;
    if (settings.mode === 'off') return this.setState('off', 'turned off (flaglens.realtime.mode)');
    if (settings.mode === 'auto' && !isLocalApiUrl(conn.client.baseUrl)) {
      return this.setState('off', 'Flagsmith is not on this machine, so its webhooks cannot reach the editor. Set flaglens.realtime.mode to "on" if it can.');
    }
    this.setState('starting');
    try {
      this.token = randomBytes(16).toString('hex');
      this.secret = randomBytes(32).toString('hex');
      this.projectId = conn.project.id;
      const port = await this.listen();
      if (generation !== this.generation) return;

      const organisationId = conn.project.organisation;
      await this.removeStale(conn.client, organisationId, settings.callbackHost);
      const url = webhookUrl(settings.callbackHost, port, this.token);
      const created = await conn.client.createOrganisationWebhook(organisationId, { url, secret: this.secret, enabled: true });
      this.registration = { client: conn.client, organisationId, id: created.id };
      if (generation !== this.generation) {
        await this.stop();
        return;
      }
      this.log.info(`Real-time updates on: Flagsmith calls ${url.replace(this.token, '…')} when anything changes`);
      this.setState('live');
    } catch (e) {
      if (generation !== this.generation) return;
      const message = (e as Error).message;
      const hint = /internal|private/i.test(message)
        ? ` Flagsmith refuses webhooks to private addresses unless the host is in its SSRF_ALLOWED_HOSTS setting (the dev kit sets ${settings.callbackHost}).`
        : '';
      this.log.warn(`Real-time updates unavailable, polling instead: ${message}${hint}`);
      await this.closeServer();
      this.setState('unavailable', `${message}${hint}`);
    }
  }

  /** Removes the webhook and closes the listener. */
  async stop(): Promise<void> {
    this.generation++;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = undefined;
    const reg = this.registration;
    this.registration = undefined;
    if (reg) {
      try {
        await reg.client.deleteOrganisationWebhook(reg.organisationId, reg.id);
      } catch (e) {
        this.log.warn(`Could not remove the real-time webhook: ${(e as Error).message}`);
      }
    }
    await this.closeServer();
    if (this.state !== 'off') this.setState('off');
  }

  dispose(): void {
    void this.stop();
    this.changeEmitter.dispose();
  }

  private setState(state: RealtimeState, reason?: string): void {
    this.state = state;
    this.reason = reason;
    this.changeEmitter.fire();
  }

  /**
   * Docker Desktop (macOS, Windows) forwards host.docker.internal to the host's loopback, so the listener stays
   * private. On Linux, host.docker.internal is the Docker bridge gateway, which loopback doesn't receive; there the
   * listener has to accept non-local connections, and the random path token plus the signature keep it closed.
   */
  private listen(): Promise<number> {
    const host = process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1';
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.once('error', reject);
      server.listen(0, host, () => {
        this.server = server;
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  private closeServer(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url !== webhookPath(this.token)) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'GET') {
      // Liveness probe, used by other windows to tell a live webhook from a stale one.
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(ALIVE);
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (!signatureMatches(body, this.secret, req.headers[SIGNATURE_HEADER])) {
        this.log.warn('Ignored a webhook call with a missing or wrong signature');
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200).end();
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        payload = undefined;
      }
      const event = describeEvent(payload);
      if (!isRelevant(event, this.projectId)) return;
      this.events++;
      this.lastEvent = event;
      this.log.info(`Flagsmith webhook: ${event.summary}`);
      // One change produces several calls (FLAG_UPDATED + AUDIT_LOG_CREATED): refresh once for the burst.
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.debounce = undefined;
        void this.store.refreshAfterChange();
      }, 150);
    });
  }

  /** Deletes FlagLens webhooks for this callback host whose listener no longer answers (crashed or closed windows). */
  private async removeStale(client: FlagsmithClient, organisationId: number, callbackHost: string): Promise<void> {
    let hooks;
    try {
      hooks = await client.listOrganisationWebhooks(organisationId);
    } catch (e) {
      this.log.warn(`Could not list webhooks: ${(e as Error).message}`);
      return;
    }
    await Promise.all(
      hooks.map(async (h) => {
        const own = parseOwnWebhook(h.url, callbackHost);
        if (!own || (await isAlive(own.port, own.token))) return;
        try {
          await client.deleteOrganisationWebhook(organisationId, h.id);
          this.log.info(`Removed a stale FlagLens webhook (port ${own.port})`);
        } catch {
          // Someone else removed it first.
        }
      }),
    );
  }
}

function isAlive(port: number, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: webhookPath(token), timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve(res.statusCode === 200 && body === ALIVE));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}
