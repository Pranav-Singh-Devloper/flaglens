// Holds the live feature × environment matrix for the connected project and keeps it fresh by polling.
//
// One refresh = 1 call for features + 1 for tags + 1 feature-states call per environment (+ experiments, beta).
// Change events fire only when something visible changed, so the editor doesn't flicker every poll.
// If Flagsmith goes away, the last known data stays on screen, marked as stale, and polling backs off.

import * as vscode from 'vscode';
import { ApiError, AuthError, FlagsmithClient, NotFoundError } from '../api/client';
import type { ApiExperiment, ApiFeatureState, ApiProject } from '../api/types';
import { buildRows, compileProtectedPattern, rowSignature, toEnvironment, type FlagRow, type FsEnvironment, type FsState } from '../core/model';
import type { Logger } from '../log';

export type StoreStatus = 'disconnected' | 'loading' | 'ok' | 'offline' | 'error';

export interface ConnectionInfo {
  client: FlagsmithClient;
  project: ApiProject;
  dashboardUrl: string;
}

export class FlagStore implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires when flags, environments, the active environment or the status change. */
  readonly onDidChange = this.changeEmitter.event;

  connection: ConnectionInfo | undefined;
  environments: FsEnvironment[] = [];
  rows = new Map<string, FlagRow>();
  status: StoreStatus = 'disconnected';
  lastError: string | undefined;
  lastRefresh: number | undefined;
  activeEnvironmentId: number | undefined;

  private signatures = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private refreshing: Promise<void> | undefined;
  /** Experiments are a beta API; stop asking if this server doesn't have it. */
  private experimentsSupported = true;
  private generation = 0;

  constructor(
    private readonly log: Logger,
    private readonly getIntervalMs: () => number,
    private readonly getProtectedPattern: () => string,
  ) {}

  get connected(): boolean {
    return this.connection !== undefined;
  }

  get project(): ApiProject | undefined {
    return this.connection?.project;
  }

  get activeEnvironment(): FsEnvironment | undefined {
    return this.environments.find((e) => e.id === this.activeEnvironmentId) ?? this.environments[0];
  }

  row(key: string): FlagRow | undefined {
    return this.rows.get(key);
  }

  environment(id: number): FsEnvironment | undefined {
    return this.environments.find((e) => e.id === id);
  }

  /**
   * Starts loading and polling a project. Network problems don't throw: they show up as status 'offline' and the
   * store keeps retrying, so FlagLens recovers by itself when Flagsmith comes back.
   */
  async connect(conn: ConnectionInfo, preferredEnvironment?: string): Promise<void> {
    this.disconnect(false);
    this.connection = conn;
    this.preferredEnvironment = preferredEnvironment;
    this.status = 'loading';
    this.experimentsSupported = true;
    this.changeEmitter.fire();
    this.log.info(`Connecting to ${conn.client.baseUrl}, project "${conn.project.name}" (id ${conn.project.id})`);
    await this.refresh();
  }

  private preferredEnvironment: string | undefined;

  /** Name or client key → environment. Falls back to a "Development"-like one, then the first. */
  pickEnvironment(nameOrKey?: string): FsEnvironment | undefined {
    if (nameOrKey) {
      const wanted = nameOrKey.toLowerCase();
      const hit = this.environments.find((e) => e.name.toLowerCase() === wanted || e.apiKey === nameOrKey);
      if (hit) return hit;
    }
    return this.environments.find((e) => /^dev/i.test(e.name)) ?? this.environments[0];
  }

  setActiveEnvironment(id: number): void {
    if (this.activeEnvironmentId === id) return;
    this.activeEnvironmentId = id;
    this.changeEmitter.fire();
  }

  /** Re-applies the protected-environment setting without reconnecting. */
  reapplyProtection(): void {
    const pattern = compileProtectedPattern(this.getProtectedPattern());
    this.environments = this.environments.map((e) => ({ ...e, protected: pattern ? pattern.test(e.name) : false }));
    this.changeEmitter.fire();
  }

  disconnect(fire = true): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.connection = undefined;
    this.environments = [];
    this.rows = new Map();
    this.signatures = new Map();
    this.status = 'disconnected';
    this.lastError = undefined;
    this.lastRefresh = undefined;
    this.failures = 0;
    if (fire) this.changeEmitter.fire();
  }

  /** Refreshes now. Concurrent calls share one request round. */
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const conn = this.connection;
    if (!conn) return;
    const generation = this.generation;
    if (this.timer) clearTimeout(this.timer);

    try {
      const { client, project } = conn;
      // Environments are re-read every time: cheap, and new environments appear without reconnecting.
      const pattern = compileProtectedPattern(this.getProtectedPattern());
      const environments = (await client.listEnvironments(project.id)).map((e) => toEnvironment(e, pattern));
      if (generation !== this.generation) return;
      const envsChanged = JSON.stringify(environments) !== JSON.stringify(this.environments);
      this.environments = environments;
      if (!this.environments.some((e) => e.id === this.activeEnvironmentId)) {
        this.activeEnvironmentId = this.pickEnvironment(this.preferredEnvironment)?.id;
      }

      const [features, tags, ...perEnv] = await Promise.all([
        client.listFeatures(project.id),
        client.listTags(project.id),
        ...this.environments.map((e) => client.listFeatureStates(e.apiKey)),
      ]);
      const experiments = await this.loadExperiments(client);
      if (generation !== this.generation) return;

      const statesByEnv = new Map<number, ApiFeatureState[]>();
      this.environments.forEach((e, i) => statesByEnv.set(e.id, perEnv[i] ?? []));
      const rows = buildRows(features, tags, statesByEnv, experiments);

      const signatures = new Map([...rows].map(([k, r]) => [k, rowSignature(r)]));
      const changed =
        this.status !== 'ok' ||
        envsChanged ||
        signatures.size !== this.signatures.size ||
        [...signatures].some(([k, s]) => this.signatures.get(k) !== s);

      this.rows = rows;
      this.signatures = signatures;
      this.status = 'ok';
      this.lastError = undefined;
      if (this.failures > 0) this.log.info('Flagsmith is reachable again');
      if (!this.lastRefresh) this.log.info(`Loaded ${rows.size} flags in ${environments.length} environments`);
      this.lastRefresh = Date.now();
      this.failures = 0;
      if (changed) this.changeEmitter.fire();
    } catch (e) {
      if (generation !== this.generation) return;
      this.failures++;
      const message = (e as Error).message;
      const wasOk = this.status === 'ok';
      this.status = e instanceof AuthError || e instanceof NotFoundError ? 'error' : 'offline';
      if (message !== this.lastError) this.log.warn(`Refresh failed: ${message}`);
      this.lastError = message;
      if (wasOk || this.failures === 1) this.changeEmitter.fire();
    } finally {
      if (generation === this.generation) this.schedule();
    }
  }

  private async loadExperiments(client: FlagsmithClient): Promise<Map<number, ApiExperiment[]>> {
    const result = new Map<number, ApiExperiment[]>();
    if (!this.experimentsSupported) return result;
    try {
      const lists = await Promise.all(this.environments.map((e) => client.listExperiments(e.apiKey)));
      this.environments.forEach((e, i) => result.set(e.id, lists[i] ?? []));
    } catch (e) {
      if (e instanceof NotFoundError || (e instanceof ApiError && e.status < 500)) {
        this.experimentsSupported = false;
        this.log.info('Experiments API not available on this Flagsmith; experiment badges disabled.');
      }
    }
    return result;
  }

  /** Polls at the configured interval; after failures backs off exponentially up to 2 minutes. */
  private schedule(): void {
    const base = this.getIntervalMs();
    const delay = this.failures === 0 ? base : Math.min(base * 2 ** Math.min(this.failures, 4), 120_000);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  /** Shows a write immediately, before the next refresh confirms it. */
  applyLocalState(key: string, envId: number, state: Partial<FsState>): void {
    const row = this.rows.get(key);
    const current = row?.states.get(envId);
    if (!row || !current) return;
    row.states.set(envId, { ...current, ...state });
    this.signatures.set(key, rowSignature(row));
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.disconnect(false);
    this.changeEmitter.dispose();
  }
}
