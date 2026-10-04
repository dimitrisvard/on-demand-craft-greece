import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterValue, restRequest, rowsOf } from '../../src/auth/postgrest';

const CFG = { supabaseUrl: 'https://db.example.test/', apiKey: 'anon-test-value', bearer: 'user-token-test-value' };

afterEach(() => {
  vi.useRealTimers();
});

describe('restRequest', () => {
  it('sends apikey, bearer and accept headers to /rest/v1', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('[{"role":"admin"}]', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await restRequest({ ...CFG, fetchImpl }, 'user_roles?select=role&user_id=eq.x');
    expect(result).toEqual({ kind: 'ok', status: 200, body: [{ role: 'admin' }] });
    expect(calls[0].url).toBe('https://db.example.test/rest/v1/user_roles?select=role&user_id=eq.x');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('apikey')).toBe('anon-test-value');
    expect(headers.get('authorization')).toBe('Bearer user-token-test-value');
    expect(calls[0].init.method).toBe('GET');
  });

  it('serialises a JSON body with its content type and Prefer header', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const result = await restRequest({ ...CFG, fetchImpl }, 't', { method: 'POST', body: { a: 1 }, prefer: 'resolution=merge-duplicates' });
    expect(result).toEqual({ kind: 'ok', status: 204, body: null });
    expect(seen?.body).toBe('{"a":1}');
    expect(new Headers(seen?.headers).get('content-type')).toBe('application/json');
    expect(new Headers(seen?.headers).get('prefer')).toBe('resolution=merge-duplicates');
  });

  it('classifies 4xx as client_error and 5xx as unavailable', async () => {
    const answer = (status: number) => (async () => new Response('{"code":"22P02"}', { status })) as unknown as typeof fetch;
    expect(await restRequest({ ...CFG, fetchImpl: answer(400) }, 't')).toEqual({ kind: 'client_error', status: 400 });
    expect(await restRequest({ ...CFG, fetchImpl: answer(401) }, 't')).toEqual({ kind: 'client_error', status: 401 });
    expect(await restRequest({ ...CFG, fetchImpl: answer(503) }, 't')).toEqual({ kind: 'unavailable', reason: 'server_error', status: 503 });
  });

  it('classifies a network failure and an unreadable body as unavailable', async () => {
    const failing = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect(await restRequest({ ...CFG, fetchImpl: failing }, 't')).toEqual({ kind: 'unavailable', reason: 'network' });
    const garbage = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    expect((await restRequest({ ...CFG, fetchImpl: garbage }, 't')).kind).toBe('unavailable');
  });

  it('times out after timeoutMs', async () => {
    vi.useFakeTimers();
    const hanging = ((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const pending = restRequest({ ...CFG, fetchImpl: hanging, timeoutMs: 3000 }, 't');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toEqual({ kind: 'unavailable', reason: 'timeout' });
  });
});

describe('rowsOf and filterValue', () => {
  it('returns rows of an ok array answer only', () => {
    expect(rowsOf({ kind: 'ok', status: 200, body: [1, 2] })).toEqual([1, 2]);
    expect(rowsOf({ kind: 'ok', status: 200, body: { a: 1 } })).toEqual([]);
    expect(rowsOf({ kind: 'client_error', status: 400 })).toEqual([]);
  });

  it('percent-encodes filter values', () => {
    expect(filterValue('a&b=c,d')).toBe('a%26b%3Dc%2Cd');
  });
});
