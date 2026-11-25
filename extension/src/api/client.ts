// Typed client for the Flagsmith Management API. No dependencies: only the global fetch (Node 18+ / VS Code ≥ 1.82).
//
// - Authenticates with an Organisation API key: `Authorization: Api-Key <key>`.
// - Follows pagination (`next`) and rewrites its host if the server reports an internal hostname.
// - Times out every request (8 s by default) and retries a GET once after a network error. Writes are never retried.
// - Turns failures into a few typed errors with messages a human can act on.

import type {
  ApiEnvironment,
  ApiExperiment,
  ApiFeature,
  ApiFeatureState,
  ApiIdentity,
  ApiIdentityFeatureState,
  ApiOrganisation,
  ApiProject,
  ApiFeatureSegment,
  ApiSegment,
  ApiTypedFeatureState,
  ApiTag,
  ApiWebhook,
  ApiFeatureHealthEvent,
  CodeReferencesScan,
  CreateFeatureBody,
  FlagValue,
  Paginated,
} from './types';
import type { EnvironmentDocument } from '../core/engine';

export class FlagsmithError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
/** The server could not be reached (refused, DNS, timeout). */
export class ConnectionError extends FlagsmithError {}
/** 401/403: missing, wrong or revoked API key. */
export class AuthError extends FlagsmithError {}
/** 404: the project, environment or flag doesn't exist (or the key can't see it). */
export class NotFoundError extends FlagsmithError {}
/** Any other non-2xx response. `detail` is the server's own explanation when it gave one. */
export class ApiError extends FlagsmithError {
  constructor(
    readonly status: number,
    readonly detail: string,
    message: string,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** Base URL without /api/v1, e.g. http://localhost:8000 */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

/** Normalises user input like "localhost:8000/api/v1/" to "http://localhost:8000". */
export function normaliseApiUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/api\/v1$/i, '');
  return url.replace(/\/+$/, '');
}

/** True for plain-HTTP URLs that are not on this machine: keys would cross the network unencrypted. */
export function isInsecureRemoteUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'http:') return false;
    return !['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Builds a readable sentence out of DRF error bodies such as {"detail": "..."} or {"name": ["..."]}. */
export function describeErrorBody(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body.includes('<html') || body.includes('<!doctype') ? '' : body.slice(0, 300);
  if (Array.isArray(body)) return body.map(describeErrorBody).filter(Boolean).join(' ');
  if (typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (typeof obj.detail === 'string') return obj.detail;
    return Object.entries(obj)
      .map(([field, v]) => {
        const text = describeErrorBody(v);
        return field === 'non_field_errors' ? text : `${field}: ${text}`;
      })
      .filter(Boolean)
      .join('; ');
  }
  return String(body);
}

export class FlagsmithClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(opts: ClientOptions) {
    this.baseUrl = normaliseApiUrl(opts.baseUrl);
    this.apiKey = opts.apiKey.trim();
    this.timeoutMs = opts.timeoutMs ?? 8_000;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  // --- discovery -------------------------------------------------------------------------------------------------

  listOrganisations(): Promise<ApiOrganisation[]> {
    return this.listAll<ApiOrganisation>('/organisations/');
  }

  /** Note: /projects/ returns a plain array, not a paginated object. listAll handles both. */
  listProjects(organisationId?: number): Promise<ApiProject[]> {
    return this.listAll<ApiProject>(organisationId ? `/projects/?organisation=${organisationId}` : '/projects/');
  }

  getProject(projectId: number): Promise<ApiProject> {
    return this.request<ApiProject>('GET', `/projects/${projectId}/`);
  }

  listEnvironments(projectId: number): Promise<ApiEnvironment[]> {
    return this.listAll<ApiEnvironment>(`/environments/?project=${projectId}`);
  }

  // --- flags -----------------------------------------------------------------------------------------------------

  /**
   * With an environment id the list also carries that environment's lifecycle stage and override counts
   * (verified on 2.295.2: without it, num_segment_overrides is always 0 and lifecycle_stage is missing).
   */
  listFeatures(projectId: number, environmentId?: number): Promise<ApiFeature[]> {
    return this.listAll<ApiFeature>(`/projects/${projectId}/features/?page_size=100${environmentId ? `&environment=${environmentId}` : ''}`);
  }

  /** Feature Health events for the project (open-source Flagsmith: Webhook and Grafana providers). */
  listFeatureHealthEvents(projectId: number): Promise<ApiFeatureHealthEvent[]> {
    return this.listAll<ApiFeatureHealthEvent>(`/projects/${projectId}/feature-health/events/`);
  }

  // --- identity overrides ----------------------------------------------------------------------------------------
  // Verified on 2.295.2 (core identities, not Edge): ?q= is a substring search, so callers filter for an exact match.

  async findIdentity(environmentKey: string, identifier: string): Promise<ApiIdentity | undefined> {
    const env = encodeURIComponent(environmentKey);
    const hits = await this.listAll<ApiIdentity>(`/environments/${env}/identities/?q=${encodeURIComponent(identifier)}`);
    return hits.find((i) => i.identifier === identifier);
  }

  createIdentity(environmentKey: string, identifier: string): Promise<ApiIdentity> {
    return this.request<ApiIdentity>('POST', `/environments/${encodeURIComponent(environmentKey)}/identities/`, { identifier });
  }

  listIdentityFeatureStates(environmentKey: string, identityId: number): Promise<ApiIdentityFeatureState[]> {
    return this.listAll<ApiIdentityFeatureState>(`/environments/${encodeURIComponent(environmentKey)}/identities/${identityId}/featurestates/`);
  }

  /** Creates or changes one identity override. Values are sent raw, as for environment defaults. */
  async setIdentityOverride(
    environmentKey: string,
    identityId: number,
    featureId: number,
    state: { enabled: boolean; value: FlagValue },
    existingId?: number,
  ): Promise<ApiIdentityFeatureState> {
    const base = `/environments/${encodeURIComponent(environmentKey)}/identities/${identityId}/featurestates/`;
    const body = { enabled: state.enabled, feature_state_value: state.value };
    return existingId === undefined
      ? this.request<ApiIdentityFeatureState>('POST', base, { feature: featureId, ...body })
      : this.request<ApiIdentityFeatureState>('PATCH', `${base}${existingId}/`, body);
  }

  deleteIdentityOverride(environmentKey: string, identityId: number, featureStateId: number): Promise<unknown> {
    return this.request('DELETE', `/environments/${encodeURIComponent(environmentKey)}/identities/${identityId}/featurestates/${featureStateId}/`);
  }

  // --- segment overrides -----------------------------------------------------------------------------------------
  // Verified on 2.295.2. Values go in the typed form here ({type, string_value | integer_value | boolean_value}), and an
  // override is changed with PUT and the full body: PATCH /features/featurestates/{id}/ fails with HTTP 500
  // (KeyError 'environment'). Priority 0 is the highest; update-priorities renumbers a feature's overrides.

  listSegments(projectId: number): Promise<ApiSegment[]> {
    return this.listAll<ApiSegment>(`/projects/${projectId}/segments/?page_size=100`);
  }

  listFeatureSegments(featureId: number, environmentId: number): Promise<ApiFeatureSegment[]> {
    return this.listAll<ApiFeatureSegment>(`/features/feature-segments/?feature=${featureId}&environment=${environmentId}`);
  }

  /** Every state of a feature in an environment: the default (feature_segment null) and each segment override. */
  listFeatureStatesTyped(featureId: number, environmentId: number): Promise<ApiTypedFeatureState[]> {
    return this.listAll<ApiTypedFeatureState>(`/features/featurestates/?feature=${featureId}&environment=${environmentId}`);
  }

  createSegmentOverride(
    environmentKey: string,
    featureId: number,
    body: { segment: number; priority: number; enabled: boolean; value: FlagValue; zeroVariants?: number[] },
  ): Promise<ApiTypedFeatureState> {
    return this.request<ApiTypedFeatureState>('POST', `/environments/${encodeURIComponent(environmentKey)}/features/${featureId}/create-segment-override/`, {
      enabled: body.enabled,
      feature_state_value: typedValue(body.value),
      feature_segment: { segment: body.segment, priority: body.priority },
      // An override of a multivariate flag copies the flag's split unless every variant is set to 0%.
      ...(body.zeroVariants?.length && { multivariate_feature_state_values: body.zeroVariants.map((id) => ({ multivariate_feature_option: id, percentage_allocation: 0 })) }),
    });
  }

  updateSegmentOverride(state: { id: number; feature: number; environment: number; feature_segment: number }, next: { enabled: boolean; value: FlagValue }): Promise<ApiTypedFeatureState> {
    return this.request<ApiTypedFeatureState>('PUT', `/features/featurestates/${state.id}/`, {
      feature: state.feature,
      environment: state.environment,
      feature_segment: state.feature_segment,
      enabled: next.enabled,
      feature_state_value: typedValue(next.value),
    });
  }

  deleteSegmentOverride(featureSegmentId: number): Promise<unknown> {
    return this.request('DELETE', `/features/feature-segments/${featureSegmentId}/`);
  }

  /** Sets the order of a feature's overrides in one environment: ids[0] gets priority 0 (applies first). */
  reorderSegmentOverrides(featureSegmentIds: number[]): Promise<unknown> {
    return this.request('POST', '/features/feature-segments/update-priorities/', featureSegmentIds.map((id, priority) => ({ id, priority })));
  }

  // --- webhooks (real-time updates) -------------------------------------------------------------------------------

  listOrganisationWebhooks(organisationId: number): Promise<ApiWebhook[]> {
    return this.listAll<ApiWebhook>(`/organisations/${organisationId}/webhooks/`);
  }

  createOrganisationWebhook(organisationId: number, webhook: { url: string; secret: string; enabled: boolean }): Promise<ApiWebhook> {
    return this.request<ApiWebhook>('POST', `/organisations/${organisationId}/webhooks/`, webhook);
  }

  deleteOrganisationWebhook(organisationId: number, id: number): Promise<unknown> {
    return this.request('DELETE', `/organisations/${organisationId}/webhooks/${id}/`);
  }

  /** Uploads code references in the format of Flagsmith's own CI scanner; the dashboard shows them per flag. */
  publishCodeReferences(projectId: number, scan: CodeReferencesScan): Promise<unknown> {
    return this.request('POST', `/projects/${projectId}/code-references/`, scan);
  }

  listTags(projectId: number): Promise<ApiTag[]> {
    return this.listAll<ApiTag>(`/projects/${projectId}/tags/`);
  }

  /**
   * Every feature state in one environment: the environment defaults plus segment/identity overrides.
   * One call per environment gives enabled, value, updated_at and variant weights for every flag.
   */
  listFeatureStates(environmentKey: string, featureId?: number): Promise<ApiFeatureState[]> {
    const q = featureId ? `?feature=${featureId}` : '';
    return this.listAll<ApiFeatureState>(`/environments/${encodeURIComponent(environmentKey)}/featurestates/${q}`);
  }

  /**
   * Changes a flag's default in a v2-versioned environment: creates a version with the new state and publishes it in
   * one call (verified on 2.295.2; variant weights are kept). Returns the new live default state.
   */
  async publishFeatureVersion(
    environment: { id: number; apiKey: string },
    featureId: number,
    state: { enabled: boolean; value: FlagValue },
    description: string,
  ): Promise<ApiFeatureState> {
    await this.request('POST', `/environments/${environment.id}/features/${featureId}/versions/`, {
      description,
      publish_immediately: true,
      feature_states_to_update: [{ feature_segment: null, enabled: state.enabled, feature_state_value: typedValue(state.value) }],
    });
    const live = (await this.listFeatureStates(environment.apiKey, featureId)).find((s) => s.feature_segment === null && s.identity === null);
    if (!live) throw new Error('The new version was published, but its state could not be read back');
    return live;
  }

  getFeatureState(environmentKey: string, featureStateId: number): Promise<ApiFeatureState> {
    return this.request<ApiFeatureState>('GET', `/environments/${encodeURIComponent(environmentKey)}/featurestates/${featureStateId}/`);
  }

  /**
   * Changes a v1 environment's default state for a flag. Verified on 2.295.2: the response body only contains
   * {feature, enabled}, so we re-read the state afterwards. v2-versioned environments reject this with HTTP 400.
   */
  async updateFeatureState(
    environmentKey: string,
    featureStateId: number,
    patch: { enabled?: boolean; value?: FlagValue },
  ): Promise<ApiFeatureState> {
    const body: Record<string, unknown> = {};
    if (patch.enabled !== undefined) body.enabled = patch.enabled;
    // A raw JSON value keeps its type (string, int or bool); the typed-object form is rejected by the API.
    if (patch.value !== undefined) body.feature_state_value = patch.value;
    await this.request('PATCH', `/environments/${encodeURIComponent(environmentKey)}/featurestates/${featureStateId}/`, body);
    return this.getFeatureState(environmentKey, featureStateId);
  }

  createFeature(projectId: number, body: CreateFeatureBody): Promise<ApiFeature> {
    return this.request<ApiFeature>('POST', `/projects/${projectId}/features/`, body);
  }

  /**
   * The environment document: every flag's default, every segment with its rules and overrides, and identity
   * overrides. The same document server-side SDKs use for local evaluation. Readable with an Organisation API key
   * (verified on 2.295.2), so no server-side environment key is needed.
   */
  getEnvironmentDocument(environmentKey: string): Promise<EnvironmentDocument> {
    return this.request<EnvironmentDocument>('GET', `/environments/${encodeURIComponent(environmentKey)}/document/`);
  }

  // --- experiments (beta) ----------------------------------------------------------------------------------------

  async listExperiments(environmentKey: string): Promise<ApiExperiment[]> {
    return this.listAll<ApiExperiment>(`/environments/${encodeURIComponent(environmentKey)}/experiments/`);
  }

  // --- plumbing --------------------------------------------------------------------------------------------------

  /** Follows `next` links until every page is loaded. Accepts endpoints that return a plain array. */
  async listAll<T>(path: string): Promise<T[]> {
    const first = await this.request<Paginated<T> | T[]>('GET', path);
    if (Array.isArray(first)) return first;
    const items = [...first.results];
    let next = first.next;
    let guard = 0;
    while (next && guard++ < 1000) {
      const page = await this.request<Paginated<T>>('GET', this.toRelativePath(next));
      items.push(...page.results);
      next = page.next;
    }
    return items;
  }

  /**
   * `next` is an absolute URL built from the server's own view of its hostname, which can be an internal name
   * (e.g. http://flagsmith:8000 behind a proxy). We keep only the path and query and resend them to our base URL.
   */
  private toRelativePath(next: string): string {
    const u = new URL(next, this.baseUrl);
    return u.pathname.replace(/^.*?\/api\/v1/, '') + u.search;
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const attempts = method === 'GET' ? 2 : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.once<T>(method, path, body);
      } catch (e) {
        lastError = e;
        if (!(e instanceof ConnectionError)) throw e;
      }
    }
    throw lastError;
  }

  private async once<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const reason = controller.signal.aborted ? `timed out after ${this.timeoutMs / 1000}s` : (e as Error).message;
      throw new ConnectionError(`Can't reach Flagsmith at ${this.baseUrl} (${reason}). Is it running? For the dev kit: make up`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (res.ok) return json as T;

    const detail = describeErrorBody(json);
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(
        `Flagsmith rejected the API key (HTTP ${res.status}${detail ? `: ${detail}` : ''}). ` +
          'Use an Organisation API key from Organisation Settings → API Keys.',
      );
    }
    if (res.status === 404) throw new NotFoundError(`Not found: ${method} ${path}${detail ? ` (${detail})` : ''}`);
    throw new ApiError(res.status, detail, `Flagsmith returned HTTP ${res.status} for ${method} ${path}${detail ? `: ${detail}` : ''}`);
  }
}

/** The typed value form the segment-override endpoints expect. */
export function typedValue(value: FlagValue): { type: 'unicode' | 'int' | 'bool'; string_value?: string | null; integer_value?: number; boolean_value?: boolean } {
  if (typeof value === 'number') return { type: 'int', integer_value: value };
  if (typeof value === 'boolean') return { type: 'bool', boolean_value: value };
  return { type: 'unicode', string_value: value };
}

/** The value of a typed feature state value, as FlagLens uses it elsewhere. */
export function untypedValue(v: ApiTypedFeatureState['feature_state_value']): FlagValue {
  if (!v || typeof v !== 'object') return (v ?? null) as FlagValue;
  if (v.type === 'int') return v.integer_value ?? null;
  if (v.type === 'bool') return v.boolean_value ?? null;
  return v.string_value ?? null;
}
