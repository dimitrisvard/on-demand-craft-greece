/**
 * /api e2e suite of the Cloudflare migration (Phase 2). Modes, chosen with API_E2E_MODE (tests/e2e/api/env.ts):
 *
 * | Mode      | Run                                                                                               | Tags       |
 * |-----------|---------------------------------------------------------------------------------------------------|------------|
 * | `local`   | `npm --prefix workers/site run t2:up &` then `BASE_URL=$(npm --prefix workers/site run -s t2:wait) API_E2E_MODE=local npx playwright test tests/e2e/api.spec.ts --grep @local` | `@local`   |
 * | `preview` | `BASE_URL=<preview host> API_E2E_MODE=preview E2E_FIXTURES=<json outside git> CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… npm run cf:e2e:api` | `@preview` (`@slow`, `@files`, `@mail` subsets) |
 * | `compare` | as preview plus `VERCEL_BASE_URL`; only from the owner's allow-listed machine                     | `@compare` |
 *
 * | Rule | Detail |
 * |---|---|
 * | Hosts | BASE_URL is never www.micronshub.eu, micronshub.eu or *.vercel.app; without a valid mode the run stops in beforeAll with the guard message (`--list` still lists the suite) |
 * | Credentials | No `extraHTTPHeaders`. `api()` adds one Access service-token pair per call, only for the BASE_URL origin, with `maxRedirects: 0`; `plain()` (no headers) serves every absolute URL of another host |
 * | Retries | 0 for this file: mail, seeded writes and the rate-limit vector are not idempotent |
 * | Data | Database writes of a preview run touch only the rows of tests/e2e/api/seed.sql, except the one queued machine scan (the same tender upserts as a daily collector run); R2 objects the tests upload are deleted by the tests. Re-run the seed's reset block before every preview run and apply cleanup.sql after the gate |
 * | Mail | The only test that sends e-mail needs E2E_SEND_MAIL=1 and sends to Resend's test sink |
 * | Compare | Tracking cases use separate seeded sent events per platform and per case (first hit and repeat hit of open, click and unsubscribe; seed.sql sets `compareWorker` / `compareVercel`), because a subscriber's first hit answers other headers than later hits; the repeat-hit events are primed once on each platform before the comparison |
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkRun, type RunConfig } from './api/env';
import { ApiClient, PlainClient, ciCredentialsFromEnv, type AccessCredentials } from './api/client';
import { accessTokenOf, loadFixtures, machinePair, type E2eFixtures, type TrackingSet } from './api/fixtures';
import {
  OPTIONS_STATUS,
  PARITY_CORS,
  PIXEL_BYTES,
  PIXEL_CACHE_CONTROL,
  PIXEL_SHA256,
  SENTINEL_CASES,
  UNSUBSCRIBE_BYTES,
  UNSUBSCRIBE_SHA256,
  anonKeyShapedToken,
  pickHeaders,
  randomUuid,
  sha256Hex,
  svixHeaders,
} from './api/vectors';
import * as stub from '../../workers/site/test/integration/stub-client';

const GUARD = checkRun(process.env);
const RUN: RunConfig | null = GUARD.ok ? GUARD.config : null;
const MODE = RUN?.mode ?? null;
/** Skip a block when the guard passed for another mode; never skip when the guard failed (beforeAll then aborts). */
const notIn = (...modes: Array<NonNullable<typeof MODE>>): boolean => MODE !== null && !modes.includes(MODE);

const SLOW_TIMEOUT_MS = 330_000;
const DUMMY_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const JSON_TYPE = 'application/json; charset=utf-8';
const RUN_ID = randomUuid().slice(0, 8);

test.describe.configure({ retries: 0 });

let apiCtx: APIRequestContext | undefined;
let plainCtx: APIRequestContext | undefined;
let client: ApiClient;
let plainClient: PlainClient;
let fixtures: E2eFixtures | undefined;

test.beforeAll(async () => {
  if (!GUARD.ok) throw new Error(GUARD.message);
  const run = GUARD.config;
  fixtures = run.fixturesPath ? loadFixtures(run.fixturesPath) : undefined;
  const credentials: AccessCredentials = {
    ci: ciCredentialsFromEnv(),
    collector: machinePair(fixtures?.machine?.collector),
    mcp: machinePair(fixtures?.machine?.mcp),
  };
  apiCtx = await playwrightRequest.newContext({ baseURL: run.baseURL });
  plainCtx = await playwrightRequest.newContext();
  client = new ApiClient(apiCtx, run.baseURL, credentials);
  plainClient = new PlainClient(plainCtx, run.baseURL);
});

test.afterAll(async () => {
  await apiCtx?.dispose();
  await plainCtx?.dispose();
});

// ----- helpers -----

function api(path: string, init: Parameters<ApiClient['fetch']>[1] = {}): Promise<APIResponse> {
  return client.fetch(path, init);
}

function plain(url: string, init: Parameters<PlainClient['fetch']>[1] = {}): Promise<APIResponse> {
  return plainClient.fetch(url, init);
}

function fx(): E2eFixtures {
  if (!fixtures) throw new Error('E2E_FIXTURES is required for this test');
  return fixtures;
}

function siteOrigin(): string {
  return (fixtures?.siteOrigin ?? 'https://www.micronshub.eu').replace(/\/+$/, '');
}

async function bearer(label: 'staff' | 'customer' | 'admin'): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await accessTokenOf(plainClient, fx(), label)}` };
}

function expectParityCors(res: APIResponse): void {
  const headers = res.headers();
  for (const [name, value] of Object.entries(PARITY_CORS)) expect(headers[name], name).toBe(value);
}

async function expectError(res: APIResponse, status: number, code: string): Promise<void> {
  expect(res.status(), `status for ${code}`).toBe(status);
  expect(res.headers()['content-type']).toBe(JSON_TYPE);
  expectParityCors(res);
  expect(await res.json()).toEqual({ error: code });
}

function track(query: string, alias = false): Promise<APIResponse> {
  return api(alias ? `/api/track?${query}` : `/api/marketing?action=track&${query}`);
}

async function upstreamCalls(): Promise<Array<{ method: string; path: string }>> {
  return stub.stubCalls();
}

/** The T2 stub records every upstream call; local tests start from an empty record. */
async function resetStubIfLocal(): Promise<void> {
  if (MODE === 'local') await stub.stubReset();
}

// =====================================================================================================
// Helper self-tests (no Worker involved): credentials stay on the BASE_URL origin, redirects are not followed
// =====================================================================================================

test.describe('request helpers', () => {
  test.skip(notIn('local'), 'runs with the local suite');

  test('the run guard refuses production hosts, a missing mode and a non-local host in local mode', { tag: '@local' }, () => {
    const ok = (env: Record<string, string>) => checkRun(env).ok;
    expect(ok({ API_E2E_MODE: 'local', BASE_URL: 'http://127.0.0.1:8787' })).toBe(true);
    expect(ok({ BASE_URL: 'http://127.0.0.1:8787' })).toBe(false);
    expect(ok({ API_E2E_MODE: 'local' })).toBe(false);
    expect(ok({ API_E2E_MODE: 'local', BASE_URL: 'https://preview.example.workers.dev' })).toBe(false);
    for (const host of ['https://www.micronshub.eu', 'https://micronshub.eu', 'https://WWW.MICRONSHUB.EU.', 'https://on-demand-craft-greece.vercel.app']) {
      expect(ok({ API_E2E_MODE: 'preview', BASE_URL: host, E2E_FIXTURES: '/tmp/x.json' }), host).toBe(false);
    }
    expect(ok({ API_E2E_MODE: 'preview', BASE_URL: 'https://microns-site.example.workers.dev' })).toBe(false);
    expect(ok({ API_E2E_MODE: 'preview', BASE_URL: 'https://microns-site.example.workers.dev', E2E_FIXTURES: '/tmp/x.json' })).toBe(true);
    expect(ok({ API_E2E_MODE: 'compare', BASE_URL: 'https://microns-site.example.workers.dev', E2E_FIXTURES: '/tmp/x.json' })).toBe(false);
  });

  test('api() sends the Access pair only to BASE_URL, refuses other origins and never follows a redirect', { tag: '@local' }, async () => {
    const seen: Array<{ server: 'base' | 'other'; path: string; headers: http.IncomingHttpHeaders }> = [];
    const other = http.createServer((req, res) => { seen.push({ server: 'other', path: req.url ?? '', headers: req.headers }); res.end('other'); });
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    const base = http.createServer((req, res) => {
      seen.push({ server: 'base', path: req.url ?? '', headers: req.headers });
      if (req.url === '/redirect') { res.writeHead(302, { Location: `${otherOrigin}/landing` }); res.end(); return; }
      res.end('base');
    });
    await new Promise<void>((resolve) => base.listen(0, '127.0.0.1', resolve));
    const baseOrigin = `http://127.0.0.1:${(base.address() as AddressInfo).port}`;
    const ctx = await playwrightRequest.newContext();
    try {
      const pair = { id: 'self-test-id', secret: 'self-test-value' };
      const own = new ApiClient(ctx, baseOrigin, { ci: pair });
      const free = new PlainClient(ctx, baseOrigin);

      expect((await own.fetch('/echo', { headers: { 'CF-Access-Client-Secret': 'caller-supplied' } })).status()).toBe(200);
      const echoed = seen.at(-1)!;
      expect(echoed.server).toBe('base');
      expect(echoed.headers['cf-access-client-id']).toBe(pair.id);
      expect(echoed.headers['cf-access-client-secret']).toBe(pair.secret);

      const redirected = await own.fetch('/redirect');
      expect(redirected.status()).toBe(302);
      expect(seen.some((s) => s.server === 'other')).toBe(false);

      await expect(own.fetch(`${otherOrigin}/x`)).rejects.toThrow(/not the BASE_URL origin/);
      await expect(own.fetch(`//127.0.0.1:${(other.address() as AddressInfo).port}/x`)).rejects.toThrow(/not the BASE_URL origin/);
      await expect(own.fetch('/x', { access: 'collector' })).rejects.toThrow(/no Access credentials/);
      expect(seen.some((s) => s.server === 'other')).toBe(false);

      expect((await free.fetch(`${otherOrigin}/plain`, { headers: { 'CF-Access-Client-Id': 'caller-supplied' } })).status()).toBe(200);
      const plainCall = seen.at(-1)!;
      expect(plainCall.server).toBe('other');
      expect(plainCall.headers['cf-access-client-id']).toBeUndefined();
      expect(plainCall.headers['cf-access-client-secret']).toBeUndefined();
      await expect(free.fetch(`${baseOrigin}/x`)).rejects.toThrow(/go through api\(\)/);
      await expect(free.fetch('/relative')).rejects.toThrow(/not an absolute URL/);

      const none = await own.fetch('/no-access', { access: 'none', headers: { 'cf-access-client-id': 'caller-supplied', 'cf-access-client-secret': 'caller-supplied' } });
      expect(none.status()).toBe(200);
      expect(seen.at(-1)!.headers['cf-access-client-id']).toBeUndefined();
      expect(seen.at(-1)!.headers['cf-access-client-secret']).toBeUndefined();
    } finally {
      await ctx.dispose();
      await new Promise((resolve) => base.close(resolve));
      await new Promise((resolve) => other.close(resolve));
    }
  });
});

// =====================================================================================================
// Local harness and preview: OPTIONS, sentinels, gate refusals, tracking byte fixtures
// =====================================================================================================

test.describe('OPTIONS is answered by each handler', () => {
  test.skip(notIn('local', 'preview'), 'local and preview modes');

  for (const [path, status] of OPTIONS_STATUS) {
    test(`OPTIONS ${path} -> ${status} with the /api CORS headers`, { tag: ['@local', '@preview'] }, async () => {
      await resetStubIfLocal();
      const res = await api(path, { method: 'OPTIONS' });
      expect(res.status()).toBe(status);
      expectParityCors(res);
      expect(res.headers()['x-robots-tag']).toBe('noindex');
      if (MODE === 'local') expect(await upstreamCalls()).toEqual([]);
    });
  }
});

test.describe('requests the handlers answer before any side effect', () => {
  test.skip(notIn('local', 'preview'), 'local and preview modes');

  for (const c of SENTINEL_CASES) {
    test(`${c.name} -> ${c.status}`, { tag: ['@local', '@preview'] }, async () => {
      await resetStubIfLocal();
      const res = await api(c.path, { method: c.method, headers: c.contentType ? { 'Content-Type': c.contentType } : {}, body: c.body });
      expect(res.status()).toBe(c.status);
      expectParityCors(res);
      expect(await res.json()).toEqual(c.json);
      if (MODE === 'local') expect(await upstreamCalls()).toEqual([]);
    });
  }

  test('invalid JSON on /api/emails -> 500 from the handler, no mail', { tag: ['@local', '@preview'] }, async () => {
    const res = await api('/api/emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":' });
    expect(res.status()).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'Failed to process email request', success: false });
  });
});

test.describe('requests without a sufficient credential are refused', () => {
  test.skip(notIn('local', 'preview'), 'local and preview modes');

  const STAFF_REQUESTS: ReadonlyArray<{ id: string; path: string; method: string; json?: unknown; headers?: Record<string, string> }> = [
    { id: 'EM-4', path: '/api/emails', method: 'POST', json: { action: 'rfq-pdf' } },
    { id: 'S3-2', path: '/api/s3?action=presign-download', method: 'POST', json: { key: 'RFQ-01011970-1/a.step' } },
    { id: 'S3-3', path: '/api/s3?action=delete', method: 'POST', json: { key: 'RFQ-01011970-1/a.step' } },
    { id: 'S3-4', path: '/api/s3?action=delete-folder', method: 'POST', json: { prefix: 'RFQ-01011970-1' } },
    { id: 'S3-5', path: '/api/s3?action=list', method: 'POST', json: { prefix: 'RFQ-01011970-1/' } },
    { id: 'S3-6', path: '/api/s3?action=list&scope=articles', method: 'POST', json: {} },
    { id: 'MK-3', path: '/api/marketing?action=google-auth&step=authorize', method: 'GET', headers: { Accept: 'application/json' } },
    { id: 'MK-5', path: '/api/marketing?action=google-auth&step=refresh&account_id=x', method: 'GET' },
    { id: 'MK-7', path: '/api/marketing?action=apollo-enrich', method: 'POST', json: { companies: ['x'], titles: ['y'] } },
    { id: 'NT-1', path: '/api/notifications', method: 'POST', json: { action: 'partner' } },
    { id: 'NT-2', path: '/api/notifications', method: 'POST', json: { action: 'production-status' } },
    { id: 'NT-3', path: '/api/notifications', method: 'POST', json: { action: 'nest' } },
    { id: 'NT-4', path: '/api/notifications?action=inv-materials', method: 'GET' },
    { id: 'NT-5', path: '/api/notifications?action=inv-label&stockItemId=00000000-0000-4000-8000-000000000000', method: 'GET' },
    { id: 'NT-6', path: '/api/notifications?action=inv-stock-scan&qrCode=x', method: 'GET' },
    { id: 'NT-7', path: '/api/notifications?action=inv-cron-batch', method: 'GET' },
    { id: 'GS-1', path: '/api/gsc?action=submit-indexing', method: 'GET' },
    { id: 'TD-1', path: '/api/tenders?stats_only=true', method: 'GET' },
    { id: 'TD-1 alias', path: '/api/connector-status', method: 'GET' },
    { id: 'TD-2', path: '/api/tenders', method: 'PATCH', json: { id: 'x' } },
    { id: 'TS-1', path: '/api/tender-scan', method: 'POST', json: { country_code: 'GR' } },
    { id: 'FS-1', path: '/api/funded-startups?action=stats', method: 'GET' },
    { id: 'FS-2', path: '/api/funded-startups', method: 'POST', json: { priority: 1 } },
    { id: 'FS-3', path: '/api/funded-startups', method: 'PATCH', json: { id: 'x' } },
    { id: 'SC-1', path: '/api/scrape-website', method: 'POST', json: { urls: ['https://example.org'] } },
    { id: 'SC-2', path: '/api/scrape-company-profile', method: 'POST', json: { url: 'https://www.europages.co.uk/x', source: 'europages' } },
    { id: 'SC-3', path: '/api/scan-directory', method: 'POST', json: { url: 'https://www.europages.co.uk/x' } },
  ];

  for (const r of STAFF_REQUESTS) {
    test(`${r.id}: no API credential -> 401`, { tag: ['@local', '@preview'] }, async () => {
      await resetStubIfLocal();
      await expectError(await api(r.path, { method: r.method, json: r.json, headers: r.headers }), 401, 'unauthorized');
      if (MODE === 'local') {
        const calls = await upstreamCalls();
        expect(calls.filter((c) => !c.path.startsWith('/cdn-cgi/access/certs'))).toEqual([]);
      }
    });
  }

  test('a token shaped like the public anon key is refused before any Supabase call -> 401', { tag: ['@local', '@preview'] }, async () => {
    await resetStubIfLocal();
    const token = MODE === 'preview' ? fx().supabase.anonKey : anonKeyShapedToken();
    await expectError(await api('/api/tenders?stats_only=true', { headers: { Authorization: `Bearer ${token}` } }), 401, 'unauthorized');
    if (MODE === 'local') expect((await upstreamCalls()).some((c) => c.path.startsWith('/auth/v1/user'))).toBe(false);
  });

  test('public form mail without a Turnstile token -> 403 turnstile_failed', { tag: ['@local', '@preview'] }, async () => {
    const res = await api('/api/emails', { method: 'POST', json: { name: 'E2E', email: 'delivered@resend.dev', message: 'e2e' } });
    await expectError(res, 403, 'turnstile_failed');
  });

  test('an unknown e-mail action is the default action and needs a Turnstile token -> 403', { tag: ['@local', '@preview'] }, async () => {
    const res = await api('/api/emails?action=unknown', { method: 'POST', json: { action: 'unknown', name: 'E2E', email: 'delivered@resend.dev', message: 'e2e' } });
    await expectError(res, 403, 'turnstile_failed');
  });

  test('form mail accepts only a JSON body -> 415', { tag: ['@local', '@preview'] }, async () => {
    const res = await api('/api/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Turnstile-Token': DUMMY_TURNSTILE_TOKEN },
      body: 'name=E2E&email=delivered%40resend.dev&message=e2e',
    });
    await expectError(res, 415, 'unsupported_media_type');
  });

  test('form mail accepts only string fields -> 400 invalid_field', { tag: ['@local', '@preview'] }, async () => {
    const res = await api('/api/emails', {
      method: 'POST',
      headers: { 'X-Turnstile-Token': DUMMY_TURNSTILE_TOKEN },
      json: { name: ['E2E'], email: 'delivered@resend.dev', message: 'e2e' },
    });
    await expectError(res, 400, 'invalid_field');
  });

  test('the Resend webhook needs a Svix signature -> 401', { tag: ['@local', '@preview'] }, async () => {
    const res = await api('/api/marketing?action=webhook', { method: 'POST', json: { type: 'email.delivered', data: { email_id: randomUuid() } } });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid signature' });
  });

  test('a customer JWT on a staff endpoint -> 403 (stubbed Supabase Auth)', { tag: '@local' }, async () => {
    test.skip(MODE !== 'local', 'needs the T2 stub');
    await stub.stubReset();
    const uid = randomUuid();
    const token = await stub.mintSupabaseJwt({ sub: uid, email: 'e2e-customer@example.test', exp: Math.floor(Date.now() / 1000) + 600 });
    await stub.stubRoute({ method: 'GET', path: '^/auth/v1/user$', status: 200, body: { id: uid, email: 'e2e-customer@example.test' } });
    await stub.stubRoute({ method: 'GET', path: '^/rest/v1/user_roles', status: 200, body: [{ role: 'customer' }] });
    await expectError(await api('/api/tenders?stats_only=true', { headers: { Authorization: `Bearer ${token}` } }), 403, 'forbidden');
    expect((await upstreamCalls()).some((c) => c.path.startsWith('/rest/v1/tenders'))).toBe(false);
  });

  test('a machine assertion of the collector passes the gate on /api/tender-scan (local preview host)', { tag: '@local' }, async () => {
    test.skip(MODE !== 'local', 'needs the T2 stub');
    const assertion = await stub.mintAccessJwt({ commonName: process.env.T2_COLLECTOR_CLIENT_ID ?? 't2-collector' });
    const res = await api('/api/tender-scan', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': assertion }, json: { country_code: 'ZZ' } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'No connector for country: ZZ' });
  });

  test('Turnstile test-key mode: the dummy token passes the gate and the handler answers 400', { tag: ['@local', '@preview'] }, async () => {
    const res = await api('/api/emails', {
      method: 'POST',
      headers: { 'X-Turnstile-Token': DUMMY_TURNSTILE_TOKEN },
      json: { name: 'E2E', email: 'delivered@resend.dev' },
    });
    if (MODE === 'local' && res.status() === 503) {
      const answer = (await res.json()) as { error?: string };
      test.skip(answer.error === 'turnstile_unavailable', 'siteverify not reachable from the local workerd');
    }
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Missing required fields: name, email, and message are required' });
  });
});

test.describe('tracking links: answers that need no database', () => {
  test.skip(notIn('local', 'preview'), 'local and preview modes');

  for (const alias of [false, true]) {
    test(`T1: open without ids -> the 70-byte pixel${alias ? ' (/api/track)' : ''}`, { tag: ['@local', '@preview'] }, async () => {
      await resetStubIfLocal();
      const res = await track('type=open', alias);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/png');
      expect(res.headers()['cache-control']).toBe(PIXEL_CACHE_CONTROL);
      expect(res.headers()['pragma']).toBeUndefined();
      const body = await res.body();
      expect(body.byteLength).toBe(PIXEL_BYTES);
      expect(sha256Hex(body)).toBe(PIXEL_SHA256);
      if (MODE === 'local') expect(await upstreamCalls()).toEqual([]);
    });
  }

  test('T2: ids missing, other type -> 400 Missing required parameters', { tag: ['@local', '@preview'] }, async () => {
    const res = await track(`type=click&eid=${randomUuid()}`);
    expect(res.status()).toBe(400);
    expect(res.headers()['content-type']).toBe(JSON_TYPE);
    expect(await res.text()).toBe('{"error":"Missing required parameters"}');
  });

  test('T5: click without url -> 400 Missing url parameter', { tag: ['@local', '@preview'] }, async () => {
    const res = await track(`type=click&eid=${randomUuid()}&cid=${randomUuid()}`);
    expect(res.status()).toBe(400);
    expect(await res.text()).toBe('{"error":"Missing url parameter"}');
  });

  test('T10: ids with another type -> 400 Invalid tracking type', { tag: ['@local', '@preview'] }, async () => {
    const res = await track(`type=bogus&eid=${randomUuid()}&cid=${randomUuid()}`, true);
    expect(res.status()).toBe(400);
    expect(await res.text()).toBe('{"error":"Invalid tracking type"}');
  });
});

test.describe('paths outside the catalogue are forwarded', () => {
  test.skip(notIn('local'), 'the local forward target is the T2 stub');

  test('GET /api/x reaches the forward target with path and query', { tag: '@local' }, async () => {
    const res = await api(`/api/x-e2e-${RUN_ID}?q=1&r=a%20b`);
    expect(res.status()).toBe(200);
    expect(res.headers()['x-t2-forwarded']).toBe('1');
    expect(res.headers()['x-t2-method']).toBe('GET');
    expect(res.headers()['x-t2-url']).toBe(`/api/x-e2e-${RUN_ID}?q=1&r=a%20b`);
    expectParityCors(res);
  });

  test('POST /api/x with a 1 KiB JSON body is echoed byte for byte', { tag: '@local' }, async () => {
    const head = '{"data":"é€✓';
    const tail = '"}';
    const pad = 1024 - Buffer.byteLength(head + tail);
    const bytes = Buffer.from(head + 'a'.repeat(pad) + tail, 'utf8');
    expect(bytes.byteLength).toBe(1024);
    const res = await api('/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bytes });
    expect(res.status()).toBe(200);
    expect(res.headers()['x-t2-method']).toBe('POST');
    expect(Buffer.compare(await res.body(), bytes)).toBe(0);
  });
});

// =====================================================================================================
// Preview (T3): every endpoint and action with test users, seeded rows and machine tokens
// =====================================================================================================

/** One safe request per staff action ID and the answer a STAFF caller gets (the handler's, or a data rule). */
const STAFF_MATRIX: ReadonlyArray<{
  id: string;
  request: () => { path: string; method: string; json?: unknown; headers?: Record<string, string> };
  staffStatus: number;
  staffCheck?: (res: APIResponse) => Promise<void>;
}> = [
  { id: 'EM-4', request: () => ({ path: '/api/emails', method: 'POST', json: { action: 'rfq-pdf' } }), staffStatus: 400 },
  { id: 'S3-4', request: () => ({ path: '/api/s3?action=delete-folder', method: 'POST', json: { prefix: 'R' } }), staffStatus: 400, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'invalid_prefix' }) },
  { id: 'S3-5', request: () => ({ path: '/api/s3?action=list', method: 'POST', json: { prefix: `${fx().seed.rfqNumber}/e2e-none-${RUN_ID}/` } }), staffStatus: 200, staffCheck: async (res) => expect(await res.json()).toEqual({ objects: [] }) },
  { id: 'S3-6', request: () => ({ path: '/api/s3?action=list&scope=articles', method: 'POST', json: { prefix: `e2e-none-${RUN_ID}/` } }), staffStatus: 200, staffCheck: async (res) => expect(await res.json()).toEqual({ objects: [] }) },
  { id: 'MK-7', request: () => ({ path: '/api/marketing?action=apollo-enrich', method: 'POST', json: { companies: [], titles: [] } }), staffStatus: 400, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'companies array is required' }) },
  { id: 'NT-1', request: () => ({ path: '/api/notifications', method: 'POST', json: { action: 'partner', partnerEmail: `not-a-partner-${RUN_ID}@example.org`, partnerName: 'E2E', orderId: 'e2e', orderTitle: 'e2e', startDate: '2026-01-01', deliveryDate: '2026-01-02' } }), staffStatus: 422, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'recipient_mismatch' }) },
  { id: 'NT-2', request: () => ({ path: '/api/notifications', method: 'POST', json: { action: 'production-status' } }), staffStatus: 400 },
  { id: 'NT-3', request: () => ({ path: '/api/notifications', method: 'POST', json: { action: 'nest' } }), staffStatus: 400 },
  { id: 'NT-4', request: () => ({ path: '/api/notifications?action=inv-materials', method: 'GET' }), staffStatus: 200 },
  { id: 'NT-5', request: () => ({ path: `/api/notifications?action=inv-label&stockItemId=${fx().seed.stockItemId}`, method: 'GET' }), staffStatus: 200, staffCheck: async (res) => { expect(res.headers()['content-type']).toBe('application/pdf'); expect((await res.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-'); } },
  { id: 'NT-6', request: () => ({ path: `/api/notifications?action=inv-stock-scan&qrCode=${encodeURIComponent(fx().seed.stockQrCode)}`, method: 'GET' }), staffStatus: 200 },
  { id: 'GS-1', request: () => ({ path: '/api/gsc?action=submit-indexing', method: 'GET' }), staffStatus: 200, staffCheck: async (res) => expect(await res.json()).toMatchObject({ limit: 200 }) },
  { id: 'TD-1', request: () => ({ path: '/api/tenders?stats_only=true', method: 'GET' }), staffStatus: 200 },
  { id: 'TD-2', request: () => ({ path: '/api/tenders', method: 'PATCH', json: {} }), staffStatus: 400, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'id is required' }) },
  { id: 'TS-1', request: () => ({ path: '/api/tender-scan', method: 'POST', json: { country_code: 'ZZ' } }), staffStatus: 400, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'No connector for country: ZZ' }) },
  { id: 'FS-1', request: () => ({ path: '/api/funded-startups?action=stats', method: 'GET' }), staffStatus: 200 },
  { id: 'FS-2', request: () => ({ path: '/api/funded-startups', method: 'POST', json: { priority: 0 } }), staffStatus: 400, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'invalid_field' }) },
  { id: 'FS-3', request: () => ({ path: '/api/funded-startups', method: 'PATCH', json: {} }), staffStatus: 400, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'id is required' }) },
  { id: 'SC-1', request: () => ({ path: '/api/scrape-website', method: 'POST', json: { urls: ['http://127.0.0.1/'] } }), staffStatus: 400, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'url_not_allowed' }) },
  { id: 'SC-2', request: () => ({ path: '/api/scrape-company-profile', method: 'POST', json: { url: 'http://127.0.0.1/', source: 'europages' } }), staffStatus: 400, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'url_not_allowed' }) },
  { id: 'SC-3', request: () => ({ path: '/api/scan-directory', method: 'POST', json: { url: 'http://127.0.0.1/' } }), staffStatus: 400, staffCheck: async (res) => expect(await res.json()).toEqual({ error: 'url_not_allowed' }) },
];

test.describe('preview: principal classes by action ID', () => {
  test.skip(notIn('preview'), 'preview mode');

  for (const row of STAFF_MATRIX) {
    test(`${row.id}: customer -> 403, staff -> ${row.staffStatus}`, { tag: '@preview' }, async () => {
      const r = row.request();
      await expectError(await api(r.path, { method: r.method, json: r.json, headers: { ...r.headers, ...(await bearer('customer')) } }), 403, 'forbidden');
      const staff = await api(r.path, { method: r.method, json: r.json, headers: { ...r.headers, ...(await bearer('staff')) } });
      expect(staff.status()).toBe(row.staffStatus);
      expectParityCors(staff);
      if (row.staffCheck) await row.staffCheck(staff);
    });
  }

  test('ADMIN-only actions refuse a staff user that is not admin -> 403', { tag: '@preview' }, async () => {
    for (const path of ['/api/notifications?action=inv-cron-batch', `/api/marketing?action=google-auth&step=refresh&account_id=${randomUuid()}`]) {
      await expectError(await api(path, { headers: await bearer('staff') }), 403, 'forbidden');
    }
  });

  test('a body action wins over the query action (partner gate, customer) -> 403', { tag: '@preview' }, async () => {
    const res = await api('/api/notifications?action=inv-stock', { method: 'POST', json: { action: 'partner' }, headers: await bearer('customer') });
    await expectError(res, 403, 'forbidden');
  });

  test('inventory requests ignore a tenant chosen by the caller', { tag: '@preview' }, async () => {
    const res = await api(`/api/notifications?action=inv-materials&tenantId=${randomUuid()}`, { headers: await bearer('staff') });
    expect(res.status()).toBe(200);
    const rows = ((await res.json()) as { data?: Array<{ tenant_id?: string }> }).data ?? [];
    for (const row of rows) if (row.tenant_id !== undefined) expect(row.tenant_id).toBe('00000000-0000-0000-0000-000000000001');
    const form = await api('/api/notifications?action=inv-materials', {
      method: 'PUT',
      headers: { ...(await bearer('staff')), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `id=${randomUuid()}&tenant_id=${randomUuid()}`,
    });
    await expectError(form, 415, 'unsupported_media_type');
  });
});

test.describe('preview: endpoints and actions', () => {
  test.skip(notIn('preview'), 'preview mode');

  test('/api/sitemap (Phase 1 route) answers XML', { tag: '@preview' }, async () => {
    const res = await api('/api/sitemap?type=main-index');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('xml');
  });

  test('tenders: list, single id, CSV export, connector status', { tag: '@preview' }, async () => {
    const auth = await bearer('staff');
    const list = await api('/api/tenders?limit=1', { headers: auth });
    expect(list.status()).toBe(200);
    expect(Object.keys((await list.json()) as object).sort()).toEqual(['limit', 'offset', 'tenders', 'total']);
    expect((await api(`/api/tenders?id=${randomUuid()}`, { headers: auth })).status()).toBe(404);
    const csv = await api('/api/tenders?export=csv&country=ZZ', { headers: auth });
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toBe('text/csv; charset=utf-8');
    expect((await csv.body()).subarray(0, 3).toString('hex')).toBe('efbbbf');
    const status = await api('/api/connector-status', { headers: auth });
    expect(status.status()).toBe(200);
    expect(Array.isArray(((await status.json()) as { connectors?: unknown }).connectors)).toBe(true);
  });

  test('funded startups: list, single id, export, feeds', { tag: '@preview' }, async () => {
    const auth = await bearer('staff');
    const list = await api('/api/funded-startups', { headers: auth });
    expect(list.status()).toBe(200);
    expect((await api(`/api/funded-startups?id=${randomUuid()}`, { headers: auth })).status()).toBe(404);
    const csv = await api('/api/funded-startups?action=export&days_back=1', { headers: auth });
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toBe('text/csv; charset=utf-8');
    // The feeds list is ported as it is; the answer status is the same on both platforms.
    expect([200, 500]).toContain((await api('/api/funded-startups?action=feeds', { headers: auth })).status());
  });

  test('e-mail actions pass their gates and the handler validates the fields (no mail sent)', { tag: '@preview' }, async () => {
    const turnstile = { 'X-Turnstile-Token': DUMMY_TURNSTILE_TOKEN };
    for (const action of ['email', 'contact']) {
      const res = await api('/api/emails', { method: 'POST', headers: turnstile, json: { action, name: 'E2E', email: 'delivered@resend.dev' } });
      expect(res.status(), action).toBe(400);
    }
    const rfq = await api('/api/emails', { method: 'POST', headers: turnstile, json: { action: 'rfq', customerName: 'E2E' } });
    expect(rfq.status()).toBe(400);
    const pdf = await api('/api/emails', { method: 'POST', headers: await bearer('staff'), json: { action: 'rfq-pdf', customerName: 'E2E' } });
    expect(pdf.status()).toBe(400);
  });

  test('one real form mail to the Resend test sink', { tag: ['@preview', '@mail'] }, async () => {
    test.skip(!RUN?.sendMail, 'set E2E_SEND_MAIL=1 to send one e-mail');
    const res = await api('/api/emails', {
      method: 'POST',
      headers: { 'X-Turnstile-Token': DUMMY_TURNSTILE_TOKEN },
      json: { name: `E2E ${RUN_ID}`, email: 'delivered@resend.dev', message: `Phase 2 e2e run ${RUN_ID}`, subject: 'E2E' },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });

  test('Gmail connect: error codes are escaped, a forged state is refused, a navigation without admin gets the sign-in page', { tag: '@preview' }, async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const error = await api(`/api/marketing?action=google-auth&error=${encodeURIComponent(payload)}`);
    expect(error.status()).toBe(200);
    const errorPage = await error.text();
    expect(errorPage).not.toContain(payload);
    expect(errorPage).toContain('oauth_error');

    const forged = await api('/api/marketing?action=google-auth&step=callback&code=e2e&state=e2e-forged-state');
    expect(forged.status()).toBe(200);
    expect(await forged.text()).not.toContain('google-oauth-success');

    const navigation = await api('/api/marketing?action=google-auth&step=authorize');
    expect(navigation.status()).toBe(200);
    const page = await navigation.text();
    expect(page).toContain('sign_in_required');
    expect(page).not.toContain('accounts.google.com');
  });

  test('Gmail connect: an admin JSON request gets the Google URL', { tag: '@preview' }, async () => {
    test.skip(!fixtures?.users.admin, 'needs users.admin in the fixtures');
    const res = await api('/api/marketing?action=google-auth&step=authorize&account_id=new', { headers: { Accept: 'application/json', ...(await bearer('admin')) } });
    expect(res.status()).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const google = new URL(url);
    expect(google.hostname).toBe('accounts.google.com');
    expect(google.searchParams.get('state')).toBeTruthy();
    expect(google.searchParams.get('access_type')).toBe('offline');
  });
});

test.describe('preview: files on R2 and legacy S3', () => {
  test.skip(notIn('preview'), 'preview mode');

  test('R2 round trip as staff: presign, PUT, download (same bytes), list, delete', { tag: ['@preview', '@files'] }, async () => {
    const auth = await bearer('staff');
    const prefix = `${fx().seed.rfqNumber}/e2e-${RUN_ID}`;
    const bytes = Buffer.from(`ISO-10303-21;\n/* e2e ${RUN_ID} */\nEND-ISO-10303-21;\n`, 'utf8');
    const up = await api('/api/s3?action=presign-upload', { method: 'POST', headers: auth, json: { fileName: 'part 1.step', contentType: 'application/octet-stream', prefix } });
    expect(up.status()).toBe(200);
    const { uploadUrl, key, publicUrl } = (await up.json()) as { uploadUrl: string; key: string; publicUrl: string };
    expect(key).toBe(`${prefix}/part_1.step`);
    expect(new URL(uploadUrl).hostname).toMatch(/\.r2\.cloudflarestorage\.com$/);
    expect(new URL(uploadUrl).searchParams.get('X-Amz-Expires')).toBe('300');
    expect(publicUrl).toMatch(/^https:\/\/[^/]+\.s3\.[a-z0-9-]+\.amazonaws\.com\//);
    try {
      expect((await plain(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).status()).toBe(200);

      const down = await api('/api/s3?action=presign-download', { method: 'POST', headers: auth, json: { key } });
      expect(down.status()).toBe(200);
      const { url } = (await down.json()) as { url: string };
      expect(new URL(url).hostname).toMatch(/\.r2\.cloudflarestorage\.com$/);
      const object = await plain(url);
      expect(object.status()).toBe(200);
      expect(sha256Hex(await object.body())).toBe(sha256Hex(bytes));

      const listed = await api('/api/s3?action=list', { method: 'POST', headers: auth, json: { prefix } });
      const { objects } = (await listed.json()) as { objects: Array<{ key: string; url: string; lastModified: string }> };
      expect(objects.map((o) => o.key)).toContain(key);
      expect(Number.isNaN(Date.parse(objects[0].lastModified))).toBe(false);
    } finally {
      const removed = await api('/api/s3?action=delete', { method: 'POST', headers: auth, json: { key } });
      expect(await removed.json()).toEqual({ success: true });
    }
    // Gone from R2; the download falls back to a legacy URL, which has no such object either.
    const after = await api('/api/s3?action=presign-download', { method: 'POST', headers: auth, json: { key } });
    expect([403, 404]).toContain((await plain(((await after.json()) as { url: string }).url)).status());
  });

  test('delete-folder removes exactly one RFQ folder on both stores', { tag: ['@preview', '@files'] }, async () => {
    const auth = await bearer('staff');
    const folder = `RFQ-01011970-${9000 + Math.floor(Math.random() * 900)}`;
    const keys: string[] = [];
    for (const prefix of [folder, `${folder}0`]) {
      const up = await api('/api/s3?action=presign-upload', { method: 'POST', headers: auth, json: { fileName: 'a.step', contentType: 'application/octet-stream', prefix } });
      const { uploadUrl, key } = (await up.json()) as { uploadUrl: string; key: string };
      expect((await plain(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('e2e') })).status()).toBe(200);
      keys.push(key);
    }
    try {
      const res = await api('/api/s3?action=delete-folder', { method: 'POST', headers: auth, json: { prefix: folder } });
      expect(await res.json()).toEqual({ success: true, deletedCount: 1 });
      const left = await api('/api/s3?action=list', { method: 'POST', headers: auth, json: { prefix: `${folder}0/` } });
      expect(((await left.json()) as { objects: Array<{ key: string }> }).objects.map((o) => o.key)).toEqual([keys[1]]);
    } finally {
      await api('/api/s3?action=delete', { method: 'POST', headers: auth, json: { key: keys[1] } });
    }
  });

  test('an object that exists only on legacy S3 downloads through the Worker', { tag: ['@preview', '@files'] }, async () => {
    const key = fixtures?.seed.legacyObjectKey;
    test.skip(!key, 'needs seed.legacyObjectKey');
    const res = await api('/api/s3?action=presign-download', { method: 'POST', headers: await bearer('staff'), json: { key } });
    expect(res.status()).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(new URL(url).hostname).toMatch(/amazonaws\.com$/);
    expect((await plain(url, { method: 'GET' })).status()).toBe(200);
  });

  test('customers download only files of their own RFQs', { tag: ['@preview', '@files'] }, async () => {
    const auth = await bearer('customer');
    const own = await api('/api/s3?action=presign-download', { method: 'POST', headers: auth, json: { key: fx().seed.ownFileKey, expiresIn: 999999 } });
    expect(own.status()).toBe(200);
    const url = new URL(((await own.json()) as { url: string }).url);
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(3600);
    await expectError(await api('/api/s3?action=presign-download', { method: 'POST', headers: auth, json: { key: fx().seed.otherFileKey } }), 403, 'forbidden');
    await expectError(await api('/api/s3?action=delete', { method: 'POST', headers: auth, json: { key: fx().seed.otherFileKey } }), 403, 'forbidden');
  });

  test('anonymous uploads only into a freshly created RFQ', { tag: ['@preview', '@files'] }, async () => {
    const stale = await api('/api/s3?action=presign-upload', { method: 'POST', json: { fileName: 'a.step', contentType: 'application/octet-stream', prefix: `${fx().seed.rfqNumber}/part` } });
    await expectError(stale, 403, 'forbidden');
    const fresh = fixtures?.seed.freshRfqNumber;
    test.skip(!fresh, 'needs seed.freshRfqNumber refreshed by the seed reset block within 30 minutes');
    const typeRefused = await api('/api/s3?action=presign-upload', { method: 'POST', json: { fileName: 'a.exe', contentType: 'application/octet-stream', prefix: `${fresh}/part` } });
    await expectError(typeRefused, 400, 'file_type_not_allowed');
    const ok = await api('/api/s3?action=presign-upload', { method: 'POST', json: { fileName: `e2e-${RUN_ID}.step`, contentType: 'application/octet-stream', prefix: `${fresh}/part` } });
    expect(ok.status()).toBe(200);
  });
});

/** Location of a click answer for `url` with the given ids. */
async function clickLocation(eid: string, cid: string, url: string): Promise<string | undefined> {
  const res = await track(`type=click&eid=${encodeURIComponent(eid)}&cid=${encodeURIComponent(cid)}&url=${encodeURIComponent(url)}`);
  expect(res.status()).toBe(302);
  return res.headers()['location'];
}

test.describe('preview: tracking links with seeded sent events', () => {
  test.skip(notIn('preview'), 'preview mode');

  function set(): TrackingSet {
    return fx().seed.tracking.preview;
  }

  test('open: first hit (pixel, Content-Type only), repeat hit (pixel with the four cache headers)', { tag: '@preview' }, async () => {
    const s = set();
    const first = await track(`type=open&eid=${s.open.first.eid}&cid=${s.campaignId}`);
    expect(first.status()).toBe(200);
    expect(pickHeaders(first.headers(), ['content-type', 'cache-control', 'pragma', 'expires'])).toEqual({ 'content-type': 'image/png', 'cache-control': null, pragma: null, expires: null });
    expect(sha256Hex(await first.body())).toBe(PIXEL_SHA256);
    await track(`type=open&eid=${s.open.repeat.eid}&cid=${s.campaignId}`);
    const repeat = await track(`type=open&eid=${s.open.repeat.eid}&cid=${s.campaignId}`);
    expect(pickHeaders(repeat.headers(), ['content-type', 'cache-control', 'pragma', 'expires'])).toEqual({ 'content-type': 'image/png', 'cache-control': PIXEL_CACHE_CONTROL, pragma: 'no-cache', expires: '0' });
    expect(sha256Hex(await repeat.body())).toBe(PIXEL_SHA256);
  });

  test('click: a seeded link redirects to its url (first hit without, repeat hit with Cache-Control)', { tag: '@preview' }, async () => {
    const s = set();
    const url = fx().seed.clickUrl;
    const first = await track(`type=click&eid=${s.click.first.eid}&cid=${s.campaignId}&url=${encodeURIComponent(url)}`);
    expect(first.status()).toBe(302);
    expect(first.headers()['location']).toBe(url);
    expect(first.headers()['cache-control']).toBeUndefined();
    expect(await first.text()).toBe('');
    await track(`type=click&eid=${s.click.repeat.eid}&cid=${s.campaignId}&url=${encodeURIComponent(url)}`);
    const repeat = await track(`type=click&eid=${s.click.repeat.eid}&cid=${s.campaignId}&url=${encodeURIComponent(url)}`);
    expect(repeat.status()).toBe(302);
    expect(repeat.headers()['location']).toBe(url);
    expect(repeat.headers()['cache-control']).toBe('no-store');
  });

  test('unsubscribe: the 547-byte page, first and repeat hit', { tag: '@preview' }, async () => {
    const s = set();
    for (const c of [s.unsubscribe.first, s.unsubscribe.repeat, s.unsubscribe.repeat]) {
      const res = await track(`type=unsubscribe&eid=${c.eid}&cid=${s.campaignId}`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('text/html');
      const body = await res.body();
      expect(body.byteLength).toBe(UNSUBSCRIBE_BYTES);
      expect(sha256Hex(body)).toBe(UNSUBSCRIBE_SHA256);
    }
  });

  test('click links that belong to no sent e-mail lead to the site, except to hosts the campaign links', { tag: '@preview' }, async () => {
    const home = `${siteOrigin()}/`;
    const external = `https://e2e-${RUN_ID}.example.net/landing`;
    expect(await clickLocation(randomUuid(), randomUuid(), external)).toBe(home);
    expect(await clickLocation('x', randomUuid(), external)).toBe(home);
    expect(await clickLocation(randomUuid(), set().campaignId, fx().seed.clickUrl)).toBe(fx().seed.clickUrl);
    expect(await clickLocation(randomUuid(), randomUuid(), `${siteOrigin()}/en/services`)).toBe(`${siteOrigin()}/en/services`);
  });
});

test.describe('preview: Resend webhook signatures', () => {
  test.skip(notIn('preview'), 'preview mode');

  test('valid, replayed, tampered, wrongly keyed, stale and unsigned deliveries', { tag: '@preview' }, async () => {
    const secret = fixtures?.webhookSigningSecret;
    test.skip(!secret, 'needs webhookSigningSecret (the test secret set on microns-ops)');
    const body = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: `e2e-${randomUuid()}` } });
    const post = (headers: Record<string, string>, raw = body) =>
      api('/api/marketing?action=webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw });

    const signed = svixHeaders(secret!, body);
    const valid = await post(signed);
    expect(valid.status()).toBe(200);
    expect(await valid.json()).toEqual({ received: true, action: 'ignored' });
    expect((await post(signed)).status()).toBe(200);

    const tampered = await post(signed, body.replace('email.delivered', 'email.bounced'));
    expect(tampered.status()).toBe(401);
    expect(await tampered.json()).toEqual({ error: 'Invalid signature' });
    const otherKey = `whsec_${Buffer.from(`e2e-other-key-${RUN_ID}-NOT-A-SECRET`).toString('base64')}`;
    expect((await post(svixHeaders(otherKey, body))).status()).toBe(401);
    expect((await post(svixHeaders(secret!, body, { timestampSec: Math.floor(Date.now() / 1000) - 600 }))).status()).toBe(401);
    expect((await post({})).status()).toBe(401);
  });
});

test.describe('preview: machine callers (Access service tokens)', () => {
  test.skip(notIn('preview'), 'preview mode');

  test('the CI token alone is not an API credential -> 401', { tag: '@preview' }, async () => {
    await expectError(await api('/api/tender-scan', { method: 'POST', json: { country_code: 'ZZ' } }), 401, 'unauthorized');
  });

  test('collector: tender-collector-shaped scan request passes the gate; other machine actions are refused', { tag: '@preview' }, async () => {
    test.skip(!machinePair(fixtures?.machine?.collector), 'needs machine.collector');
    const invalid = await api('/api/tender-scan', { method: 'POST', access: 'collector', json: { country_code: 'ZZ' } });
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'No connector for country: ZZ' });
    await expectError(await api('/api/funded-startups', { method: 'POST', access: 'collector', json: { priority: 1 } }), 403, 'forbidden');
  });

  test('collector: a valid scan is queued and answered at once with the handler keys', { tag: '@preview' }, async () => {
    test.skip(!machinePair(fixtures?.machine?.collector), 'needs machine.collector');
    const country = fixtures?.seed.scanCountry ?? 'LU';
    const res = await api('/api/tender-scan', { method: 'POST', access: 'collector', json: { country_code: country }, timeout: 25_000 });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['success', 'country_code', 'tenders_found', 'tenders_new', 'tenders_relevant', 'errors', 'duration_ms', 'queued', 'run_id']);
    expect(body).toMatchObject({ success: true, country_code: country, tenders_found: 0, tenders_new: 0, tenders_relevant: 0, errors: [], duration_ms: 0, queued: true });
    expect(String(body.run_id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('mcp: CSV export, directory scan and funding scan pass the gate; actions without a machine caller are refused', { tag: '@preview' }, async () => {
    test.skip(!machinePair(fixtures?.machine?.mcp), 'needs machine.mcp');
    const csv = await api('/api/tenders?export=csv&country=ZZ', { access: 'mcp' });
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toBe('text/csv; charset=utf-8');
    await expectError(await api('/api/scan-directory', { method: 'POST', access: 'mcp', json: { url: 'http://127.0.0.1/' } }), 400, 'url_not_allowed');
    await expectError(await api('/api/scrape-website', { method: 'POST', access: 'mcp', json: { urls: ['http://127.0.0.1/'] } }), 400, 'url_not_allowed');
    await expectError(await api('/api/funded-startups', { method: 'POST', access: 'mcp', json: { priority: 0 } }), 400, 'invalid_field');
    await expectError(await api('/api/scrape-company-profile', { method: 'POST', access: 'mcp', json: { url: 'https://www.europages.co.uk/x', source: 'europages' } }), 403, 'forbidden');
    await expectError(await api('/api/tenders?stats_only=true', { access: 'mcp' }), 403, 'forbidden');
  });
});

test.describe('preview: nest fixtures', () => {
  test.skip(notIn('preview'), 'preview mode');

  for (const instances of [80, 400, 800, 1200]) {
    test(`nest ${instances} part instances (balanced) -> 200 with groups`, { tag: ['@preview', '@slow'] }, async () => {
      test.setTimeout(SLOW_TIMEOUT_MS);
      const { buildNestPayload } = (await import('../../workers/ops/scripts/nest-fixture.mjs')) as { buildNestPayload: (n: number, level: string) => unknown };
      const started = Date.now();
      const res = await api('/api/notifications', { method: 'POST', headers: await bearer('staff'), json: buildNestPayload(instances, 'balanced'), timeout: SLOW_TIMEOUT_MS - 10_000 });
      console.log(`[api e2e] nest ${instances}: HTTP ${res.status()} in ${Date.now() - started} ms`);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { success?: boolean; groups?: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.groups) && body.groups.length > 0).toBe(true);
    });
  }
});

test.describe('preview: rate limit', () => {
  test.skip(notIn('preview'), 'preview mode');

  test('the 31st OAuth callback from one client within a minute -> 429 with Retry-After', { tag: '@preview' }, async () => {
    test.setTimeout(180_000);
    // Earlier callbacks of this run (Gmail connect test) must have left the 60 s window first.
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    let limitedAt = -1;
    let retryAfter: string | undefined;
    for (let i = 0; i < 45 && limitedAt < 0; i++) {
      const res = await api(`/api/marketing?action=google-auth&step=callback&code=e2e&state=e2e-${RUN_ID}-${i}`);
      if (res.status() === 429) {
        limitedAt = i;
        retryAfter = res.headers()['retry-after'];
      }
    }
    expect(limitedAt, 'index of the first 429 (0-based)').toBeGreaterThanOrEqual(30);
    expect(retryAfter).toBe('60');
  });
});

// =====================================================================================================
// Compare (owner's allow-listed machine): the Worker and Vercel answer the same bytes
// =====================================================================================================

interface Snapshot {
  status: number;
  headers: Record<string, string | null>;
  bodySha256: string;
}

async function snapshot(res: APIResponse): Promise<Snapshot> {
  return { status: res.status(), headers: pickHeaders(res.headers()), bodySha256: sha256Hex(await res.body()) };
}

function vercel(path: string, method = 'GET'): Promise<APIResponse> {
  return plain(`${RUN!.vercelBaseURL}${path}`, { method });
}

test.describe('compare: Worker and Vercel answer the same', () => {
  test.skip(notIn('compare'), 'compare mode');

  for (const [path] of OPTIONS_STATUS) {
    test(`OPTIONS ${path}`, { tag: '@compare' }, async () => {
      expect(await snapshot(await api(path, { method: 'OPTIONS' }))).toEqual(await snapshot(await vercel(path, 'OPTIONS')));
    });
  }

  test('tracking: every case on its own seeded event per platform', { tag: '@compare' }, async () => {
    const worker = fx().seed.tracking.compareWorker;
    const other = fx().seed.tracking.compareVercel;
    test.skip(!worker || !other, 'needs seed.tracking.compareWorker and compareVercel');
    const url = encodeURIComponent(fx().seed.clickUrl);
    const query = (s: TrackingSet, kind: 'open' | 'click' | 'unsubscribe', hit: 'first' | 'repeat') =>
      `/api/marketing?action=track&type=${kind}&eid=${s[kind][hit].eid}&cid=${s.campaignId}${kind === 'click' ? `&url=${url}` : ''}`;

    // Prime the repeat-hit events once on each platform.
    for (const kind of ['open', 'click', 'unsubscribe'] as const) {
      await api(query(worker!, kind, 'repeat'));
      await vercel(query(other!, kind, 'repeat'));
    }
    for (const kind of ['open', 'click', 'unsubscribe'] as const) {
      for (const hit of ['first', 'repeat'] as const) {
        const w = await snapshot(await api(query(worker!, kind, hit)));
        const v = await snapshot(await vercel(query(other!, kind, hit)));
        expect(w, `${kind} ${hit}`).toEqual(v);
      }
    }
    for (const q of ['type=open', `type=click&eid=${randomUuid()}`, `type=click&eid=${randomUuid()}&cid=${randomUuid()}`, `type=bogus&eid=${randomUuid()}&cid=${randomUuid()}`]) {
      for (const prefix of ['/api/marketing?action=track&', '/api/track?']) {
        expect(await snapshot(await api(`${prefix}${q}`)), `${prefix}${q}`).toEqual(await snapshot(await vercel(`${prefix}${q}`)));
      }
    }
  });
});
