import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bearerToken,
  classOfRoles,
  precheckSupabaseJwt,
  resetSupabaseJwksCache,
  resetSupabaseJwtCache,
  verifySupabaseJwt,
  verifySupabaseJwtWithJwks,
} from '../../src/auth/supabase-jwt';
import { es256KeyPair, jwksBody, mintProjectKeyShape, mintSupabaseJwt, mintSupabaseJwtWithKey, nowSec } from '../helpers/jwt';

const SUPABASE_URL = 'https://project.supabase.test';
const ANON = ['anon', 'key', 'test', 'value'].join('-');
const UID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

beforeEach(() => {
  resetSupabaseJwtCache();
  resetSupabaseJwksCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Yields to the event loop (real time) until `condition` holds; the test timeout is the only bound. */
async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
}

/** Wraps a fetch so that the test can tell when the first request has started. */
function withStartSignal(fetchImpl: typeof fetch): { fetchImpl: typeof fetch; started: Promise<void> } {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const wrapped = ((url: string, init?: RequestInit) => {
    markStarted();
    return fetchImpl(url, init);
  }) as unknown as typeof fetch;
  return { fetchImpl: wrapped, started };
}

interface Stub {
  user?: { status: number; body?: unknown } | 'network' | 'hang';
  roles?: { status: number; body?: unknown } | 'network';
}

function fakeSupabase(stub: Stub = {}) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetchImpl = ((url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: new Headers(init.headers) });
    const path = new URL(url).pathname;
    const answer = path === '/auth/v1/user'
      ? stub.user ?? { status: 200, body: { id: UID, email: 'staff@example.test' } }
      : stub.roles ?? { status: 200, body: [{ role: 'sales_rep' }] };
    if (answer === 'network') return Promise.reject(new TypeError('fetch failed'));
    if (answer === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return Promise.resolve(new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('bearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc.def.ghi', 'abc.def.ghi'],
    ['BEARER   abc.def.ghi  ', 'abc.def.ghi'],
    ['Basic abc', null],
    ['Bearer', null],
    ['Bearer a b', null],
    ['abc.def.ghi', null],
  ])('%j -> %j', (value, expected) => {
    expect(bearerToken(new Headers({ authorization: value }))).toBe(expected);
  });

  it('is null without an Authorization header (cookies are ignored)', () => {
    expect(bearerToken(new Headers({ cookie: 'sb-access-token=abc.def.ghi' }))).toBeNull();
  });
});

describe('precheckSupabaseJwt', () => {
  it('accepts a user token shape', async () => {
    const exp = nowSec() + 600;
    const token = await mintSupabaseJwt({ sub: UID, exp });
    expect(precheckSupabaseJwt(token, nowSec())).toEqual({ ok: true, sub: UID, exp });
  });

  it('rejects the project API key shape (role is not authenticated)', async () => {
    expect(precheckSupabaseJwt(await mintProjectKeyShape('anon'), nowSec())).toEqual({ ok: false });
    expect(precheckSupabaseJwt(await mintProjectKeyShape('service_role'), nowSec())).toEqual({ ok: false });
  });

  it('rejects a user-shaped token whose role is not authenticated', async () => {
    for (const role of ['anon', 'service_role', 'supabase_admin']) {
      expect(precheckSupabaseJwt(await mintSupabaseJwt({ sub: UID, role }), nowSec())).toEqual({ ok: false });
    }
  });

  it('rejects an expired token', async () => {
    const token = await mintSupabaseJwt({ sub: UID, exp: nowSec() - 1 });
    expect(precheckSupabaseJwt(token, nowSec())).toEqual({ ok: false });
  });

  it('rejects a non-UUID sub', async () => {
    expect(precheckSupabaseJwt(await mintSupabaseJwt({ sub: 'user-1' }), nowSec())).toEqual({ ok: false });
  });

  it('rejects another audience', async () => {
    expect(precheckSupabaseJwt(await mintSupabaseJwt({ sub: UID, aud: 'other' }), nowSec())).toEqual({ ok: false });
  });

  it.each(['', 'a.b', 'a.b.c.d', 'x.%%%.y', `x.${btoa('not json')}.y`, `x.${btoa('[1]')}.y`])('rejects malformed %j', (token) => {
    expect(precheckSupabaseJwt(token, nowSec())).toEqual({ ok: false });
  });
});

describe('verifySupabaseJwt', () => {
  it('verifies with /auth/v1/user (anon apikey + caller bearer) and reads roles as an array', async () => {
    const token = await mintSupabaseJwt({ sub: UID });
    const { calls, fetchImpl } = fakeSupabase({ roles: { status: 200, body: [{ role: 'customer' }, { role: 'admin' }] } });
    const result = await verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl });
    expect(result).toEqual({ ok: true, user: { uid: UID, email: 'staff@example.test', roles: ['customer', 'admin'] } });
    expect(calls.map((c) => c.url)).toEqual([
      `${SUPABASE_URL}/auth/v1/user`,
      `${SUPABASE_URL}/rest/v1/user_roles?select=role&user_id=eq.${UID}`,
    ]);
    for (const c of calls) {
      expect(c.headers.get('apikey')).toBe(ANON);
      expect(c.headers.get('authorization')).toBe(`Bearer ${token}`);
    }
  });

  it('makes no network call when the pre-check fails', async () => {
    const { calls, fetchImpl } = fakeSupabase();
    expect(await verifySupabaseJwt(await mintProjectKeyShape(), { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl }))
      .toEqual({ ok: false, status: 401, code: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ status: 401, body: { msg: 'invalid JWT' } }, { ok: false, status: 401, code: 'unauthorized' }],
    [{ status: 403, body: { msg: 'session not found' } }, { ok: false, status: 401, code: 'unauthorized' }],
    [{ status: 500, body: {} }, { ok: false, status: 503, code: 'auth_unavailable' }],
    [{ status: 503 }, { ok: false, status: 503, code: 'auth_unavailable' }],
    ['network' as const, { ok: false, status: 503, code: 'auth_unavailable' }],
  ])('auth answer %j -> %j', async (user, expected) => {
    const token = await mintSupabaseJwt({ sub: UID });
    const { fetchImpl } = fakeSupabase({ user });
    expect(await verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl })).toEqual(expected);
  });

  it('answers 503 when Supabase Auth does not answer within 5 s', async () => {
    const token = await mintSupabaseJwt({ sub: UID });
    const { fetchImpl, started } = withStartSignal(fakeSupabase({ user: 'hang' }).fetchImpl);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let settled = false;
    const pending = verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl }).finally(() => { settled = true; });
    // The token digest before the request completes in real time; the 5 s deadline is armed before the request
    // starts, so fake time is advanced only once the request is open.
    await started;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, status: 503, code: 'auth_unavailable' });
  });

  it('refuses a token whose user id differs from sub', async () => {
    const token = await mintSupabaseJwt({ sub: UID });
    const { fetchImpl } = fakeSupabase({ user: { status: 200, body: { id: '00000000-0000-4000-8000-000000000000' } } });
    expect(await verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl }))
      .toEqual({ ok: false, status: 401, code: 'unauthorized' });
  });

  it('answers 503 when the role read fails', async () => {
    const token = await mintSupabaseJwt({ sub: UID });
    for (const roles of [{ status: 500 }, 'network' as const]) {
      resetSupabaseJwtCache();
      const { fetchImpl } = fakeSupabase({ roles });
      expect(await verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl }))
        .toEqual({ ok: false, status: 503, code: 'auth_unavailable' });
    }
  });

  it('answers 401 when the role read refuses the token (401 or 403); another 4xx -> 503', async () => {
    const token = await mintSupabaseJwt({ sub: UID });
    for (const status of [401, 403]) {
      resetSupabaseJwtCache();
      const { fetchImpl } = fakeSupabase({ roles: { status, body: { message: 'JWT expired' } } });
      expect(await verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl }))
        .toEqual({ ok: false, status: 401, code: 'unauthorized' });
    }
    resetSupabaseJwtCache();
    const { fetchImpl } = fakeSupabase({ roles: { status: 400, body: { code: 'PGRST100' } } });
    expect(await verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl }))
      .toEqual({ ok: false, status: 503, code: 'auth_unavailable' });
  });

  it('caches a verified token for 60 s, not longer', async () => {
    let now = Date.now();
    const token = await mintSupabaseJwt({ sub: UID, exp: Math.floor(now / 1000) + 3600 });
    const { calls, fetchImpl } = fakeSupabase();
    const cfg = { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl, nowMs: () => now };
    expect((await verifySupabaseJwt(token, cfg)).ok).toBe(true);
    expect(calls).toHaveLength(2);
    now += 59_000;
    expect((await verifySupabaseJwt(token, cfg)).ok).toBe(true);
    expect(calls).toHaveLength(2);
    now += 1_000;
    expect((await verifySupabaseJwt(token, cfg)).ok).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it('never serves a token from the cache after its exp', async () => {
    let now = Date.now();
    const exp = Math.floor(now / 1000) + 20;
    const token = await mintSupabaseJwt({ sub: UID, exp });
    const { calls, fetchImpl } = fakeSupabase();
    const cfg = { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl, nowMs: () => now };
    expect((await verifySupabaseJwt(token, cfg)).ok).toBe(true);
    now = exp * 1000;
    expect(await verifySupabaseJwt(token, cfg)).toEqual({ ok: false, status: 401, code: 'unauthorized' });
    expect(calls).toHaveLength(2);
  });

  it('does not cache failures', async () => {
    const token = await mintSupabaseJwt({ sub: UID });
    const down = fakeSupabase({ user: { status: 503 } });
    expect((await verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl: down.fetchImpl })).ok).toBe(false);
    const up = fakeSupabase();
    expect((await verifySupabaseJwt(token, { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl: up.fetchImpl })).ok).toBe(true);
  });

  it('shares one verification between concurrent requests with the same token', async () => {
    const token = await mintSupabaseJwt({ sub: UID });
    const { calls, fetchImpl } = fakeSupabase();
    const cfg = { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl };
    const results = await Promise.all(Array.from({ length: 10 }, () => verifySupabaseJwt(token, cfg)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls.filter((c) => c.url.endsWith('/auth/v1/user'))).toHaveLength(1);
  });

  it('a request arriving while the same token is being verified joins that verification', async () => {
    const token = await mintSupabaseJwt({ sub: UID });
    const upstream = fakeSupabase();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    // Supabase Auth answers only when the test releases it, so both requests overlap.
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/auth/v1/user') await held;
      return upstream.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const realDigest = crypto.subtle.digest.bind(crypto.subtle);
    let digests = 0;
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args: Parameters<SubtleCrypto['digest']>) => {
      const out = await realDigest(...args);
      digests += 1;
      return out;
    });
    const cfg = { supabaseUrl: SUPABASE_URL, anonKey: ANON, fetchImpl };
    const first = verifySupabaseJwt(token, cfg);
    const second = verifySupabaseJwt(token, cfg);
    // Both requests have hashed the token and passed the cache lookup before Supabase Auth answers.
    await until(() => digests === 2);
    await new Promise((resolve) => setImmediate(resolve));
    release();
    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      { ok: true, user: { uid: UID, email: 'staff@example.test', roles: ['sales_rep'] } },
      { ok: true, user: { uid: UID, email: 'staff@example.test', roles: ['sales_rep'] } },
    ]);
    expect(upstream.calls.filter((c) => c.url.endsWith('/auth/v1/user'))).toHaveLength(1);
  });
});

describe('classOfRoles', () => {
  it.each([
    [['admin'], 'ADMIN'],
    [['customer', 'admin'], 'ADMIN'],
    [['sales_rep'], 'STAFF'],
    [['production_manager'], 'STAFF'],
    [['accountant', 'supplier'], 'STAFF'],
    [['partner_seller'], 'PARTNER'],
    [['supplier'], 'PARTNER'],
    [['customer'], 'CUSTOMER'],
    [[], 'CUSTOMER'],
    [['super_admin', 'tenant_admin'], 'CUSTOMER'],
  ])('%j -> %s', (roles, cls) => {
    expect(classOfRoles(roles)).toBe(cls);
  });
});

describe('verifySupabaseJwtWithJwks (local verification, not used by the gate while the JWKS is empty)', () => {
  function jwksFetch(body: unknown) {
    return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  }

  it('reports no_keys for an empty JWKS', async () => {
    const token = await mintSupabaseJwt({ sub: UID });
    expect(await verifySupabaseJwtWithJwks(token, { supabaseUrl: SUPABASE_URL, fetchImpl: jwksFetch({ keys: [] }) }))
      .toEqual({ ok: false, reason: 'no_keys' });
  });

  it('verifies an ES256 token against the published key', async () => {
    const key = await es256KeyPair();
    const token = await mintSupabaseJwtWithKey(key, { sub: UID, email: 'u@example.test', iss: `${SUPABASE_URL}/auth/v1` });
    const result = await verifySupabaseJwtWithJwks(token, { supabaseUrl: SUPABASE_URL, fetchImpl: jwksFetch(jwksBody(key)) });
    expect(result).toMatchObject({ ok: true, sub: UID, email: 'u@example.test' });
  });

  it('rejects another issuer, another key and a symmetric token', async () => {
    const key = await es256KeyPair();
    const other = await es256KeyPair();
    const fetchImpl = jwksFetch(jwksBody(key));
    const wrongIss = await mintSupabaseJwtWithKey(key, { sub: UID, iss: 'https://elsewhere.test/auth/v1' });
    expect(await verifySupabaseJwtWithJwks(wrongIss, { supabaseUrl: SUPABASE_URL, fetchImpl })).toEqual({ ok: false, reason: 'invalid' });
    resetSupabaseJwksCache();
    const wrongKey = await mintSupabaseJwtWithKey({ ...other, kid: key.kid }, { sub: UID, iss: `${SUPABASE_URL}/auth/v1` });
    expect(await verifySupabaseJwtWithJwks(wrongKey, { supabaseUrl: SUPABASE_URL, fetchImpl })).toEqual({ ok: false, reason: 'invalid' });
    resetSupabaseJwksCache();
    const hs = await mintSupabaseJwt({ sub: UID });
    expect(await verifySupabaseJwtWithJwks(hs, { supabaseUrl: SUPABASE_URL, fetchImpl })).toEqual({ ok: false, reason: 'invalid' });
  });
});
