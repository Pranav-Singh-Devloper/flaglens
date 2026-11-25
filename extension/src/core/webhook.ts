// Pure helpers for FlagLens's real-time updates through a Flagsmith organisation webhook (see ../realtime.ts).
// Verified on self-hosted Flagsmith 2.295.2:
//   - Flagsmith POSTs {"event_type": ..., "data": ...} with the header X-Flagsmith-Signature = hex HMAC-SHA256 of the
//     raw body, keyed with the webhook's secret.
//   - An organisation webhook receives FLAG_UPDATED / FLAG_DELETED for every environment and AUDIT_LOG_CREATED for
//     every change (segments, flags, environments), so one registration covers the whole project.
//   - Webhook URLs on private addresses are rejected unless the host is in Flagsmith's SSRF_ALLOWED_HOSTS.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-flagsmith-signature';
const PATH_PREFIX = '/flaglens/';

/** True when `header` is the HMAC-SHA256 (hex) of `body` with `secret`. Constant-time comparison. */
export function signatureMatches(body: string | Buffer, secret: string, header: string | string[] | undefined): boolean {
  if (typeof header !== 'string' || !/^[0-9a-f]{64}$/i.test(header)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(header, 'hex'));
}

export function webhookPath(token: string): string {
  return `${PATH_PREFIX}${token}`;
}

/** The URL Flagsmith calls: http://<callbackHost>:<port>/flaglens/<token>. */
export function webhookUrl(callbackHost: string, port: number, token: string): string {
  const host = callbackHost.includes(':') && !callbackHost.startsWith('[') ? `[${callbackHost}]` : callbackHost;
  return `http://${host}:${port}${webhookPath(token)}`;
}

/** Recognises a webhook registered by FlagLens (any window) for this callback host, so stale ones can be removed. */
export function parseOwnWebhook(url: string, callbackHost: string): { port: number; token: string } | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const m = /^\/flaglens\/([0-9a-f]{16,})$/.exec(u.pathname);
  if (u.protocol !== 'http:' || host !== callbackHost.replace(/^\[|\]$/g, '') || !m) return undefined;
  return { port: Number(u.port || 80), token: m[1]! };
}

/** Flagsmith running on this machine (the only case where its webhooks can reach the editor without set-up). */
export function isLocalApiUrl(apiUrl: string): boolean {
  try {
    const host = new URL(apiUrl).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || host.endsWith('.localhost') || /^127\./.test(host);
  } catch {
    return false;
  }
}

export interface WebhookEvent {
  type: string;
  /** Project the change belongs to, when the payload says (organisation webhooks cover every project). */
  projectId?: number;
  feature?: string;
  environment?: string;
  /** One line for the log, e.g. "FLAG_UPDATED dark_mode in Production". */
  summary: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Reads what changed from a webhook payload. Unknown shapes still produce an event (FlagLens then just refreshes). */
export function describeEvent(payload: unknown): WebhookEvent {
  const p = obj(payload) ?? {};
  const type = str(p.event_type) ?? 'UNKNOWN';
  const data = obj(p.data) ?? {};
  const state = obj(data.new_state) ?? obj(data.previous_state);
  const featureObj = obj(state?.feature);
  const feature = str(featureObj?.name);
  const environment = str(obj(state?.environment)?.name) ?? str(obj(data.environment)?.name);
  const projectId = num(obj(featureObj?.project)?.id) ?? num(obj(data.project)?.id) ?? num(obj(data.environment)?.project);
  const what = type === 'AUDIT_LOG_CREATED' ? str(data.log) : feature;
  const summary = [type, what, environment && `in ${environment}`].filter(Boolean).join(' ');
  return { type, projectId, feature, environment, summary };
}

/** Whether an event can change what the editor shows for `projectId`. */
export function isRelevant(event: WebhookEvent, projectId: number): boolean {
  return event.projectId === undefined || event.projectId === projectId;
}
