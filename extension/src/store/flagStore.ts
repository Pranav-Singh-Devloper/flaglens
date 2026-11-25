// Holds the live feature × environment matrix for the connected project and keeps it fresh by polling.
//
// One refresh = 1 call for features + 1 for tags + 1 feature-states call per environment (+ experiments, beta).
// Change events fire only when something visible changed, so the editor doesn't flicker every poll.
// If Flagsmith goes away, the last known data stays on screen, marked as stale, and polling backs off.

import * as vscode from 'vscode';
import { ApiError, AuthError, FlagsmithClient, NotFoundError } from '../api/client';
import type { ApiExperiment, ApiFeatureHealthEvent, ApiFeatureState, ApiProject } from '../api/types';
import type { FlagFacts } from '../core/deadcode';
import { dependenciesOf, evaluateFlags, uniformity, type EnvironmentDocument, type Evaluated, type Persona } from '../core/engine';
import { analyseRules, type RuleFinding } from '../core/rules';
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

  /** Environment documents by environment id: segments, overrides, splits. Used for previews and exact greying. */
  documents = new Map<number, EnvironmentDocument>();
  /** The user flags are being previewed as, or undefined for "no identity" (environment defaults). */
  persona: Persona | undefined;

  private signatures = new Map<string, string>();
  private documentSignatures = new Map<number, string>();
  private evaluations = new Map<number, Map<string, Evaluated>>();
  private findings: RuleFinding[] | undefined;
  /** Older or restricted servers may not serve the document; then previews are off and greying is conservative. */
  private documentsSupported = true;
  /** Latest Feature Health event per "featureId:envId" (envId 0 = all environments). */
  private health = new Map<string, ApiFeatureHealthEvent>();
  private healthSupported = true;
  private healthSignature = '';
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
    this.documentsSupported = true;
    this.healthSupported = true;
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
    // Lifecycle stages and override counts are per environment: reload them for the new one.
    if (this.connected) void this.refresh();
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
    this.documents = new Map();
    this.documentSignatures = new Map();
    this.evaluations = new Map();
    this.findings = undefined;
    this.health = new Map();
    this.healthSignature = '';
    this.status = 'disconnected';
    this.lastError = undefined;
    this.lastRefresh = undefined;
    this.failures = 0;
    if (fire) this.changeEmitter.fire();
  }

  /**
   * Refreshes because Flagsmith reported a change (real-time webhook). A refresh already in flight may have read the
   * old state, so this one waits for it and then reads again.
   */
  refreshAfterChange(): Promise<void> {
    return this.refreshing ? this.refreshing.then(() => this.refresh()) : this.refresh();
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
        client.listFeatures(project.id, this.activeEnvironment?.id),
        client.listTags(project.id),
        ...this.environments.map((e) => client.listFeatureStates(e.apiKey)),
      ]);
      const [experiments, documents, health] = await Promise.all([this.loadExperiments(client), this.loadDocuments(client), this.loadHealth(client, project.id)]);
      if (generation !== this.generation) return;

      const statesByEnv = new Map<number, ApiFeatureState[]>();
      this.environments.forEach((e, i) => statesByEnv.set(e.id, perEnv[i] ?? []));
      const rows = buildRows(features, tags, statesByEnv, experiments);

      const signatures = new Map([...rows].map(([k, r]) => [k, rowSignature(r)]));
      const documentSignatures = new Map([...documents].map(([id, d]) => [id, JSON.stringify(d)]));
      const documentsChanged =
        documentSignatures.size !== this.documentSignatures.size || [...documentSignatures].some(([id, sig]) => this.documentSignatures.get(id) !== sig);
      if (documentsChanged) {
        this.documents = documents;
        this.documentSignatures = documentSignatures;
        this.evaluations.clear();
        this.findings = undefined;
      }
      const healthSignature = JSON.stringify([...health]);
      const healthChanged = healthSignature !== this.healthSignature;
      this.health = health;
      this.healthSignature = healthSignature;
      const changed =
        this.status !== 'ok' ||
        envsChanged ||
        documentsChanged ||
        healthChanged ||
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

  private async loadDocuments(client: FlagsmithClient): Promise<Map<number, EnvironmentDocument>> {
    const result = new Map<number, EnvironmentDocument>();
    if (!this.documentsSupported) return result;
    try {
      const docs = await Promise.all(this.environments.map((e) => client.getEnvironmentDocument(e.apiKey)));
      this.environments.forEach((e, i) => docs[i] && result.set(e.id, docs[i]!));
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof AuthError || (e instanceof ApiError && e.status < 500)) {
        this.documentsSupported = false;
        this.log.info(`Environment documents not available (${(e as Error).message}); "Preview as" is off and greying out is conservative.`);
      } else {
        // A network blip: keep the documents we had.
        return this.documents;
      }
    }
    return result;
  }

  private async loadHealth(client: FlagsmithClient, projectId: number): Promise<Map<string, ApiFeatureHealthEvent>> {
    const latest = new Map<string, ApiFeatureHealthEvent>();
    if (!this.healthSupported) return latest;
    try {
      const events = await client.listFeatureHealthEvents(projectId);
      for (const e of events) {
        const k = `${e.feature}:${e.environment ?? 0}`;
        const cur = latest.get(k);
        if (!cur || e.created_at > cur.created_at) latest.set(k, e);
      }
    } catch (e) {
      if (e instanceof NotFoundError || (e instanceof ApiError && e.status < 500)) {
        this.healthSupported = false;
        this.log.info('Feature Health API not available on this Flagsmith; health badges disabled.');
      } else return this.health;
    }
    return latest;
  }

  /**
   * Re-reads only the Feature Health events (one request) and refreshes everything if they changed. Health events
   * don't trigger Flagsmith webhooks, so while real-time updates slow polling down, this keeps alerts prompt.
   */
  async checkHealth(): Promise<void> {
    const conn = this.connection;
    if (!conn || this.status !== 'ok' || !this.healthSupported || this.refreshing) return;
    const latest = await this.loadHealth(conn.client, conn.project.id);
    if (conn === this.connection && JSON.stringify([...latest]) !== this.healthSignature) await this.refresh();
  }

  /** Environments where Flagsmith Feature Health currently reports this flag UNHEALTHY, with the event. */
  unhealthy(featureId: number): { env: FsEnvironment | undefined; event: ApiFeatureHealthEvent }[] {
    const out: { env: FsEnvironment | undefined; event: ApiFeatureHealthEvent }[] = [];
    for (const [k, e] of this.health) {
      const [fid, envId] = k.split(':').map(Number);
      if (fid !== featureId || e.type !== 'UNHEALTHY') continue;
      out.push({ env: envId ? this.environment(envId!) : undefined, event: e });
    }
    return out;
  }

  /**
   * Flag dependencies of `key` per environment, from the environment documents: which flags it requires, and whether
   * that leaves it served OFF to everyone (evaluated with no identity, as Flagsmith's environment flags are).
   */
  dependencies(key: string): { env: FsEnvironment; requires: string[]; blocked: boolean }[] {
    const out: { env: FsEnvironment; requires: string[]; blocked: boolean }[] = [];
    for (const env of this.environments) {
      const doc = this.documents.get(env.id);
      if (!doc) continue;
      const requires = dependenciesOf(doc).filter((d) => d.flag === key).map((d) => d.requires);
      if (!requires.length) continue;
      const own = doc.feature_states.find((f) => f.feature.name === key)?.enabled ?? false;
      const served = evaluateFlags(doc).get(key)?.enabled ?? false;
      out.push({ env, requires, blocked: own && !served });
    }
    return out;
  }

  get previewSupported(): boolean {
    return this.documentsSupported && this.documents.size > 0;
  }

  /** Previews every flag as `persona` (undefined = no identity). */
  setPersona(persona: Persona | undefined): void {
    this.persona = persona;
    this.evaluations.clear();
    this.changeEmitter.fire();
  }

  /** Every flag evaluated for the current persona in one environment, or undefined without a persona or document. */
  evaluation(envId: number): Map<string, Evaluated> | undefined {
    if (!this.persona) return undefined;
    const doc = this.documents.get(envId);
    if (!doc) return undefined;
    let hit = this.evaluations.get(envId);
    if (!hit) {
      hit = evaluateFlags(doc, this.persona);
      this.evaluations.set(envId, hit);
    }
    return hit;
  }

  /**
   * What is certain about a flag in an environment, for greying out code. With a persona: exactly what that user
   * gets. Without one: the environment default, but only the parts no segment, identity override or split can change.
   * Keys that don't exist in Flagsmith get the SDKs' default flag (disabled).
   */
  flagFacts(key: string, envId: number): FlagFacts | undefined {
    const row = this.rows.get(key);
    if (!row) return this.rows.size ? { enabled: false, valueKnown: false } : undefined;
    const evaluated = this.evaluation(envId)?.get(key);
    if (evaluated) return { enabled: evaluated.enabled, value: evaluated.value, valueKnown: true };
    const state = row.states.get(envId);
    if (!state) return undefined;
    // Without the document we can't see segment overrides (the features list only counts them per environment),
    // so nothing is certain and nothing gets greyed out.
    const doc = this.documents.get(envId);
    if (!doc) return { valueKnown: false };
    const uniform = uniformity(doc, key);
    return { enabled: uniform.enabled ? state.enabled : undefined, value: state.value, valueKnown: uniform.value };
  }

  /**
   * Problems in segment overrides (shadowed, redundant, matching nobody, unreachable default) in every environment,
   * computed from the environment documents and cached until they change.
   */
  ruleFindings(): RuleFinding[] {
    if (!this.findings) {
      this.findings = this.environments.flatMap((e) => {
        const doc = this.documents.get(e.id);
        return doc ? analyseRules(doc) : [];
      });
    }
    return this.findings;
  }

  findingsFor(key: string): RuleFinding[] {
    return this.ruleFindings().filter((f) => f.flag === key);
  }

  /** Segment overrides of a flag, per environment name, read from the environment documents (exact). */
  segmentOverrides(key: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const env of this.environments) {
      const doc = this.documents.get(env.id);
      const names = doc?.project.segments.filter((s) => s.feature_states.some((fs) => fs.feature.name === key)).map((s) => s.name) ?? [];
      if (names.length) out.set(env.name, names);
    }
    return out;
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
