import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  AuthError,
  ConnectionError,
  describeErrorBody,
  FlagsmithClient,
  isInsecureRemoteUrl,
  NotFoundError,
  normaliseApiUrl,
} from '../src/api/client';

type Call = { url: string; init: RequestInit | undefined };

function mockFetch(responses: Array<Response | Error | ((url: string) => Response)>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(url) : next;
  });
  return { fn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = (fetch: (u: string, i?: RequestInit) => Promise<Response>, baseUrl = 'http://localhost:8000') =>
  new FlagsmithClient({ baseUrl, apiKey: ' abc.def ', fetch, timeoutMs: 50 });

describe('FlagsmithClient', () => {
  it('sends the Api-Key header to /api/v1', async () => {
    const { fn, calls } = mockFetch([json({ id: 1, name: 'p' })]);
    await client(fn).getProject(1);
    expect(calls[0]!.url).toBe('http://localhost:8000/api/v1/projects/1/');
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Api-Key abc.def');
  });

  it('follows pagination and rewrites internal hostnames in `next`', async () => {
    const { fn, calls } = mockFetch([
      json({ count: 3, next: 'http://flagsmith:8000/api/v1/projects/1/features/?page=2&page_size=100', previous: null, results: [{ id: 1 }, { id: 2 }] }),
      json({ count: 3, next: null, previous: null, results: [{ id: 3 }] }),
    ]);
    const items = await client(fn, 'https://flags.example.com/').listFeatures(1);
    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(calls[1]!.url).toBe('https://flags.example.com/api/v1/projects/1/features/?page=2&page_size=100');
  });

  it('accepts endpoints that return a plain array', async () => {
    const { fn } = mockFetch([json([{ id: 1, name: 'a' }])]);
    expect(await client(fn).listProjects()).toHaveLength(1);
  });

  it('maps 401 and 403 to AuthError', async () => {
    const { fn } = mockFetch([json({ detail: 'Invalid API key' }, 401)]);
    await expect(client(fn).getProject(1)).rejects.toBeInstanceOf(AuthError);
    const { fn: fn2 } = mockFetch([json({ detail: 'nope' }, 403)]);
    await expect(client(fn2).getProject(1)).rejects.toThrow(/rejected the API key/);
  });

  it('maps 404 to NotFoundError', async () => {
    const { fn } = mockFetch([json({ detail: 'Not found.' }, 404)]);
    await expect(client(fn).getProject(9)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('surfaces the server explanation on other errors', async () => {
    const { fn } = mockFetch([json({ detail: 'This environment uses v2 feature versioning.' }, 400)]);
    const err = await client(fn).updateFeatureState('k', 1, { enabled: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/v2 feature versioning/);
  });

  it('does not leak HTML error pages into messages', async () => {
    const { fn } = mockFetch([new Response('<!doctype html><h1>Server Error (500)</h1>', { status: 500 })]);
    await expect(client(fn).getProject(1)).rejects.toThrow(/^Flagsmith returned HTTP 500 for GET \/projects\/1\/$/);
  });

  it('retries a GET once after a network error', async () => {
    const { fn, calls } = mockFetch([new TypeError('fetch failed'), json({ id: 1 })]);
    await expect(client(fn).getProject(1)).resolves.toEqual({ id: 1 });
    expect(calls).toHaveLength(2);
  });

  it('gives up after the retry with a helpful ConnectionError', async () => {
    const { fn } = mockFetch([new TypeError('fetch failed'), new TypeError('fetch failed')]);
    await expect(client(fn).getProject(1)).rejects.toThrow(ConnectionError);
    const { fn: fn2 } = mockFetch([new TypeError('fetch failed'), new TypeError('fetch failed')]);
    await expect(client(fn2).getProject(1)).rejects.toThrow(/Is it running\?/);
  });

  it('never retries writes', async () => {
    const { fn, calls } = mockFetch([new TypeError('fetch failed')]);
    await expect(client(fn).createFeature(1, { name: 'x' })).rejects.toBeInstanceOf(ConnectionError);
    expect(calls).toHaveLength(1);
  });

  it('times out slow requests', async () => {
    const slow = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    await expect(client(slow).getProject(1)).rejects.toThrow(/timed out/);
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it('PATCHes the state with a raw value, then re-reads it', async () => {
    const { fn, calls } = mockFetch([json({ feature: 1, enabled: true }), json({ id: 5, enabled: true, feature_state_value: 42 })]);
    const s = await client(fn).updateFeatureState('envKey', 5, { enabled: true, value: 42 });
    expect(calls[0]!.init!.method).toBe('PATCH');
    expect(calls[0]!.url).toBe('http://localhost:8000/api/v1/environments/envKey/featurestates/5/');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ enabled: true, feature_state_value: 42 });
    expect(calls[1]!.init!.method).toBe('GET');
    expect(s.feature_state_value).toBe(42);
  });
});

describe('helpers', () => {
  it.each([
    ['localhost:8000', 'http://localhost:8000'],
    ['http://localhost:8000/', 'http://localhost:8000'],
    ['https://flags.example.com/api/v1/', 'https://flags.example.com'],
    ['  https://api.flagsmith.com  ', 'https://api.flagsmith.com'],
  ])('normaliseApiUrl(%s)', (input, expected) => expect(normaliseApiUrl(input)).toBe(expected));

  it('flags plain http to remote hosts only', () => {
    expect(isInsecureRemoteUrl('http://localhost:8000')).toBe(false);
    expect(isInsecureRemoteUrl('http://127.0.0.1:8000')).toBe(false);
    expect(isInsecureRemoteUrl('https://flags.example.com')).toBe(false);
    expect(isInsecureRemoteUrl('http://flags.example.com')).toBe(true);
  });

  it('describes DRF error bodies', () => {
    expect(describeErrorBody({ detail: 'x' })).toBe('x');
    expect(describeErrorBody({ name: ['Feature with that name already exists.'] })).toBe('name: Feature with that name already exists.');
    expect(describeErrorBody({ non_field_errors: ['bad'] })).toBe('bad');
    expect(describeErrorBody(null)).toBe('');
  });
});
