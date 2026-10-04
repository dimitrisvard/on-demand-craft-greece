// T2: gate decisions over real workerd (wrangler dev with both Worker configs and the local upstream stub of
// test/integration/harness.mjs). Run with `npm run test:integration -- gates.t2`.
//   - 401 / 403 / 415 / 429 answer shapes, with the parity CORS headers of every /api answer
//   - a machine caller (Access assertion minted at the stub) on the localhost preview host
//   - Turnstile test-key mode against the real siteverify (Cloudflare test secret + dummy token: the gate passes and
//     the handler answers 400 for the missing message; no token: 403); skipped when siteverify cannot be reached
// The stub client (test/integration/stub-client.ts) is loaded at run time, so this file type-checks on its own.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

interface StubRoute { method: string; path: string; status: number; headers?: Record<string, string>; body?: unknown }
interface StubClient {
  stubRoute(route: StubRoute): Promise<void>;
  stubReset(): Promise<void>;
  stubCalls(): Promise<Array<{ method: string; path: string; headers?: Record<string, string> }>>;
  mintSupabaseJwt(claims: { sub: string; email?: string; exp?: number }): Promise<string>;
  mintAccessJwt(claims: { commonName: string }): Promise<string>;
}

const SITE = (process.env.T2_SITE_URL as string | undefined) ?? '';
// Client id the harness maps to the collector machine in its generated ACCESS_MACHINE_CLIENT_IDS.
const COLLECTOR_CLIENT_ID = (process.env.T2_COLLECTOR_CLIENT_ID as string | undefined) ?? 't2-collector';
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const CORS_ORIGIN = ['Access-Control-Allow-Origin', '*'] as const;
const UID = '0f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

let stub: StubClient;

async function loadStubClient(): Promise<StubClient> {
  const specifier = './stub-client';
  return (await import(/* @vite-ignore */ specifier)) as StubClient;
}

async function asUser(roles: string[]): Promise<string> {
  const token = await stub.mintSupabaseJwt({ sub: UID, email: 't2-user@example.test', exp: Math.floor(Date.now() / 1000) + 600 });
  await stub.stubRoute({ method: 'GET', path: '^/auth/v1/user$', status: 200, body: { id: UID, email: 't2-user@example.test' } });
  await stub.stubRoute({ method: 'GET', path: '^/rest/v1/user_roles', status: 200, body: roles.map((role) => ({ role })) });
  return token;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SITE}${path}`, { redirect: 'manual', ...init });
}

async function expectError(response: Response, status: number, error: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get(CORS_ORIGIN[0])).toBe(CORS_ORIGIN[1]);
  expect(await response.json()).toEqual({ error });
}

beforeAll(async () => {
  expect(SITE, 'T2_SITE_URL is set by the T2 harness (vitest.t2.config.ts globalSetup)').not.toBe('');
  stub = await loadStubClient();
});

beforeEach(async () => {
  await stub.stubReset();
});

describe('gate answer shapes', () => {
  it('401: a staff endpoint without a credential', async () => {
    await expectError(await api('/api/tenders?stats_only=true'), 401, 'unauthorized');
  });

  it('401: a project API key shape as bearer is refused before any Supabase call', async () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '');
    const payload = btoa(JSON.stringify({ role: 'anon', iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 600 })).replace(/=+$/, '');
    await expectError(await api('/api/tenders?stats_only=true', { headers: { authorization: `Bearer ${header}.${payload}.c2ln` } }), 401, 'unauthorized');
    const calls = await stub.stubCalls();
    expect(calls.some((c) => c.path.startsWith('/auth/v1/user'))).toBe(false);
  });

  it('403: a customer JWT on a staff endpoint', async () => {
    const token = await asUser(['customer']);
    await expectError(await api('/api/tenders?stats_only=true', { headers: { authorization: `Bearer ${token}` } }), 403, 'forbidden');
  });

  it('415: a form-urlencoded body on /api/emails', async () => {
    const response = await api('/api/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Turnstile-Token': DUMMY_TOKEN },
      body: 'name=a&email=a%40example.test&message=hi',
    });
    await expectError(response, 415, 'unsupported_media_type');
  });

  it('429: the 31st OAuth callback from one client within a minute', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) {
      last = await api('/api/marketing?action=google-auth&step=callback&code=c&state=invalid', { headers: { 'CF-Connecting-IP': '198.51.100.77' } });
      if (i < 30) expect(last.status).not.toBe(429);
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Retry-After')).toBe('60');
  });
});

describe('machine caller on the localhost preview host', () => {
  it('a collector assertion passes the gate on /api/tender-scan (the handler validates the country)', async () => {
    const assertion = await stub.mintAccessJwt({ commonName: COLLECTOR_CLIENT_ID });
    const response = await api('/api/tender-scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Cf-Access-Jwt-Assertion': assertion },
      body: JSON.stringify({ country_code: 'ZZ' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'No connector for country: ZZ' });
  });

  it('an unmapped Access identity is not an API credential -> 401', async () => {
    const assertion = await stub.mintAccessJwt({ commonName: 't2-ci-token' });
    const response = await api('/api/tender-scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Cf-Access-Jwt-Assertion': assertion },
      body: JSON.stringify({ country_code: 'GR' }),
    });
    await expectError(response, 401, 'unauthorized');
  });
});

describe('Turnstile test-key mode against the real siteverify', () => {
  const body = JSON.stringify({ name: 'T2', email: 't2@example.test' }); // no message: the handler answers 400, no mail

  it('no token -> 403 turnstile_failed', async () => {
    await expectError(await api('/api/emails', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), 403, 'turnstile_failed');
  });

  it('the dummy token passes the gate; the handler answers 400 for the missing message', async (ctx) => {
    const response = await api('/api/emails', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Turnstile-Token': DUMMY_TOKEN }, body });
    if (response.status === 503) {
      const answer = (await response.json()) as { error?: string };
      if (answer.error === 'turnstile_unavailable') {
        console.warn('[gates.t2] siteverify not reachable from workerd: test skipped');
        ctx.skip();
      }
    }
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Missing required fields: name, email, and message are required' });
  });
});
