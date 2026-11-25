import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describeEvent, isLocalApiUrl, isRelevant, parseOwnWebhook, signatureMatches, webhookUrl } from '../src/core/webhook';

// Shapes copied from a self-hosted Flagsmith 2.295.2 organisation webhook (trimmed).
const flagUpdated = {
  event_type: 'FLAG_UPDATED',
  data: {
    changed_by: 'flaglens-dev',
    new_state: { enabled: false, environment: { id: 3, name: 'Production' }, feature: { id: 5, name: 'dark_mode', project: { id: 1, name: 'Demo Shop' } } },
    previous_state: { enabled: true, environment: { id: 3, name: 'Production' }, feature: { id: 5, name: 'dark_mode', project: { id: 1, name: 'Demo Shop' } } },
  },
};
const auditLog = {
  event_type: 'AUDIT_LOG_CREATED',
  data: { log: 'Flag state updated for feature: dark_mode', environment: { id: 3, name: 'Production', project: 1 }, project: { id: 1, name: 'Demo Shop' } },
};

describe('webhook signatures', () => {
  const body = JSON.stringify(flagUpdated);
  const sign = (b: string, k: string) => createHmac('sha256', k).update(b).digest('hex');

  it('accepts the HMAC-SHA256 of the raw body, as Flagsmith computes it', () => {
    expect(signatureMatches(body, 's3cret', sign(body, 's3cret'))).toBe(true);
    expect(signatureMatches(Buffer.from(body), 's3cret', sign(body, 's3cret').toUpperCase())).toBe(true);
  });

  it('rejects a wrong secret, a changed body, and missing or malformed headers', () => {
    expect(signatureMatches(body, 's3cret', sign(body, 'other'))).toBe(false);
    expect(signatureMatches(body + ' ', 's3cret', sign(body, 's3cret'))).toBe(false);
    expect(signatureMatches(body, 's3cret', undefined)).toBe(false);
    expect(signatureMatches(body, 's3cret', 'abc')).toBe(false);
    expect(signatureMatches(body, 's3cret', [sign(body, 's3cret')])).toBe(false);
  });
});

describe('webhook URLs', () => {
  it('builds and recognises FlagLens webhook URLs for the callback host only', () => {
    const url = webhookUrl('host.docker.internal', 51234, 'a1b2c3d4e5f60718');
    expect(url).toBe('http://host.docker.internal:51234/flaglens/a1b2c3d4e5f60718');
    expect(parseOwnWebhook(url, 'host.docker.internal')).toEqual({ port: 51234, token: 'a1b2c3d4e5f60718' });
    expect(parseOwnWebhook(url, '192.168.1.5')).toBeUndefined();
    expect(parseOwnWebhook('http://host.docker.internal:51234/hooks/slack', 'host.docker.internal')).toBeUndefined();
    expect(parseOwnWebhook('https://host.docker.internal:51234/flaglens/a1b2c3d4e5f60718', 'host.docker.internal')).toBeUndefined();
    expect(parseOwnWebhook('not a url', 'host.docker.internal')).toBeUndefined();
  });

  it('brackets IPv6 callback hosts', () => {
    expect(webhookUrl('fd00::1', 80, 'a1b2c3d4e5f60718')).toBe('http://[fd00::1]:80/flaglens/a1b2c3d4e5f60718');
    expect(parseOwnWebhook('http://[fd00::1]:80/flaglens/a1b2c3d4e5f60718', 'fd00::1')).toEqual({ port: 80, token: 'a1b2c3d4e5f60718' });
  });

  it('knows when Flagsmith runs on this machine', () => {
    expect(isLocalApiUrl('http://localhost:8000')).toBe(true);
    expect(isLocalApiUrl('http://127.0.0.1:8080/api/v1/')).toBe(true);
    expect(isLocalApiUrl('http://[::1]:8000')).toBe(true);
    expect(isLocalApiUrl('http://flagsmith.localhost')).toBe(true);
    expect(isLocalApiUrl('https://edge.api.flagsmith.com')).toBe(false);
    expect(isLocalApiUrl('http://10.0.0.4:8000')).toBe(false);
    expect(isLocalApiUrl('nonsense')).toBe(false);
  });
});

describe('webhook events', () => {
  it('reads the flag, environment and project of a flag change', () => {
    expect(describeEvent(flagUpdated)).toEqual({ type: 'FLAG_UPDATED', projectId: 1, feature: 'dark_mode', environment: 'Production', summary: 'FLAG_UPDATED dark_mode in Production' });
  });

  it('reads audit-log events (segments and everything else)', () => {
    const e = describeEvent(auditLog);
    expect(e).toMatchObject({ type: 'AUDIT_LOG_CREATED', projectId: 1, environment: 'Production' });
    expect(e.summary).toBe('AUDIT_LOG_CREATED Flag state updated for feature: dark_mode in Production');
  });

  it('ignores other projects but refreshes when it cannot tell', () => {
    expect(isRelevant(describeEvent(flagUpdated), 1)).toBe(true);
    expect(isRelevant(describeEvent(flagUpdated), 2)).toBe(false);
    expect(isRelevant(describeEvent({ event_type: 'FLAG_DELETED', data: {} }), 2)).toBe(true);
    expect(describeEvent('garbage')).toMatchObject({ type: 'UNKNOWN', summary: 'UNKNOWN' });
  });
});
