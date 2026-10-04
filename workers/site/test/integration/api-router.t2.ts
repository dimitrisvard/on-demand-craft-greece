// T2: the /api router over real workerd (wrangler dev with the site and ops configs, test/integration/harness.mjs).
//   - OPTIONS on every routed /api path is answered by the handler itself (local or in microns-ops) with the
//     vercel.json CORS headers, and touches no upstream
//   - a staff request crosses the OPS service binding (RPC to OpsApi) and its handler reads the stub database
//   - an /api path outside the catalogue reaches the forward target (the stub's echo), GET and POST with a 1 KiB
//     JSON body echoed byte for byte
//   - a body over 4.5 MiB answers 413 before any handler
// /api/sitemap (Phase 1, router step 2) is left out: its handler reads the production sitemap storage.
// The stub client (./stub-client.ts) is loaded at run time, like the other T2 suites.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

interface StubRoute { method: string; path: string; status: number; headers?: Record<string, string>; body?: unknown }
interface StubClient {
  stubRoute(route: StubRoute): Promise<void>;
  stubReset(): Promise<void>;
  stubCalls(): Promise<Array<{ method: string; path: string; headers?: Record<string, string> }>>;
  mintSupabaseJwt(claims: { sub: string; email?: string; exp?: number }): Promise<string>;
}

const SITE = (process.env.T2_SITE_URL as string | undefined) ?? '';
const UID = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const PARITY_CORS: Record<string, string> = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
  'access-control-allow-headers': 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
};

// OPTIONS answer of each handler (api/*.js; /api/s3 is the files API, which keeps api/s3.js's 204).
const OPTIONS_STATUS: Array<[string, number]> = [
  ['/api/emails', 200],
  ['/api/s3', 204],
  ['/api/marketing', 400], // no action: the marketing handler's 400
  ['/api/marketing?action=apollo-enrich', 200],
  ['/api/marketing?action=track', 400], // track has no method check: OPTIONS runs it like GET (no ids: 400)
  ['/api/track', 400],
  ['/api/notifications', 200],
  ['/api/gsc', 200],
  ['/api/tenders', 200],
  ['/api/connector-status', 200],
  ['/api/tender-scan', 200],
  ['/api/funded-startups', 200],
  ['/api/scrape-website', 200],
  ['/api/scrape-company-profile', 200],
  ['/api/scan-directory', 200],
];

let stub: StubClient;

async function loadStubClient(): Promise<StubClient> {
  const specifier = new URL('./stub-client.ts', (import.meta as unknown as { url: string }).url).href;
  return (await import(/* @vite-ignore */ specifier)) as StubClient;
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SITE}${path}`, { redirect: 'manual', ...init });
}

function expectParityCors(res: Response): void {
  for (const [name, value] of Object.entries(PARITY_CORS)) expect(res.headers.get(name), name).toBe(value);
}

beforeAll(async () => {
  expect(SITE, 'T2_SITE_URL is set by the T2 harness (vitest.t2.config.ts globalSetup)').not.toBe('');
  stub = await loadStubClient();
});

beforeEach(async () => {
  await stub.stubReset();
});

describe('OPTIONS is answered by the handlers', () => {
  it.each(OPTIONS_STATUS)('OPTIONS %s -> %i with the parity CORS headers', async (path, status) => {
    const res = await api(path, { method: 'OPTIONS' });
    expect(res.status).toBe(status);
    expectParityCors(res);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    await res.arrayBuffer();
  });

  it('no OPTIONS request reaches an upstream (database, Vercel)', async () => {
    for (const [path] of OPTIONS_STATUS) await (await api(path, { method: 'OPTIONS' })).arrayBuffer();
    expect(await stub.stubCalls()).toEqual([]);
  });
});

describe('OPS service binding', () => {
  it('a staff request reaches the tenders handler in microns-ops, which reads the stub database', async () => {
    const token = await stub.mintSupabaseJwt({ sub: UID, email: 't2-staff@example.test', exp: Math.floor(Date.now() / 1000) + 600 });
    await stub.stubRoute({ method: 'GET', path: '^/auth/v1/user$', status: 200, body: { id: UID, email: 't2-staff@example.test' } });
    await stub.stubRoute({ method: 'GET', path: '^/rest/v1/user_roles', status: 200, body: [{ role: 'admin' }] });
    await stub.stubRoute({ method: 'GET', path: '^/rest/v1/tender_connectors', status: 200, body: [{ country_code: 'GR', name: 't2 connector' }] });
    const res = await api('/api/connector-status', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expectParityCors(res);
    expect(JSON.stringify(await res.json())).toContain('t2 connector');
    const paths = (await stub.stubCalls()).map((c) => c.path.split('?')[0]);
    expect(paths).toContain('/auth/v1/user');
    expect(paths).toContain('/rest/v1/tender_connectors');
    expect(paths).toContain('/rest/v1/tender_scan_logs');
  });

  it('a request without credentials never reaches microns-ops', async () => {
    const res = await api('/api/connector-status');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect((await stub.stubCalls()).some((c) => c.path.startsWith('/rest/v1/tender'))).toBe(false);
  });
});

describe('forward of paths outside the catalogue', () => {
  it('GET /api/x reaches the forward target with path, query and X-Forwarded-Host', async () => {
    const res = await api('/api/x?q=1&r=a%20b');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-t2-forwarded')).toBe('1');
    expect(res.headers.get('x-t2-method')).toBe('GET');
    expect(res.headers.get('x-t2-url')).toBe('/api/x?q=1&r=a%20b');
    expect(res.headers.get('x-t2-forwarded-host')).toBe(new URL(SITE).host);
    expectParityCors(res);
  });

  it('POST /api/x with a 1 KiB JSON body is echoed byte for byte', async () => {
    const prefix = '{"data":"é€✓';
    const suffix = '"}';
    const used = new TextEncoder().encode(prefix + suffix).byteLength;
    const bytes = new TextEncoder().encode(prefix + 'a'.repeat(1024 - used) + suffix);
    expect(bytes.byteLength).toBe(1024);
    const res = await api('/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: bytes });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-t2-forwarded')).toBe('1');
    expect(res.headers.get('x-t2-method')).toBe('POST');
    const echoed = new Uint8Array(await res.arrayBuffer());
    expect(echoed.byteLength).toBe(1024);
    expect(echoed.every((byte, i) => byte === bytes[i])).toBe(true);
  });
});

describe('request body limit', () => {
  it('a body over 4,718,592 bytes answers 413 payload_too_large with the parity CORS headers', async () => {
    const res = await api('/api/emails', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array(4_718_593) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expectParityCors(res);
  });
});
