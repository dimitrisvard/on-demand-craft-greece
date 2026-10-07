// The flag-on branch of /api/scan-directory and /api/scrape-company-profile through OpsApi.handle with the real
// Phase 2 handlers (api/scan-directory.js, api/scrape-company-profile.js) and the module's default dependencies.
// The global fetch is replaced: SUPABASE_URL answers as a recording PostgREST, the directory pages come from
// test/fixtures/scrapers/pages, anything else answers 404, so nothing reaches a network.
//   - flag off, no permitted host, a host not permitted, or another method: the Phase 2 answer, byte for byte
//     (status, headers, body) the answer of the handler run on its own, and no flag read without a permitted host.
//   - flag on and host permitted: the module answers the handler's body for the same page, fetched with the crawler
//     identity, and records one scan_logs row and one agent_runs row (growth.scrapers).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNodeHandler, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import type { Principal } from '../../../shared/src/http/rpc';
import type { OpsEnv } from '../../src/env';
import { OpsApi } from '../../src/index';
import { hostPauses, DEFAULT_SCRAPER_USER_AGENT } from '../../src/scrapers/context';
import { FakeKV } from '../helpers/agent-env';
import { MCP, STAFF, SUPABASE_URL, invoke, jsonPost, opsCall, opsEnv, snapshot } from '../helpers/ops';
import { postgrestRecorder, type RecordedSb } from '../mcp/helpers';
import { page } from './helpers';

const SEARCH = 'https://www.europages.co.uk/companies/germany/robotics.html';
const PROFILE = 'https://www.europages.co.uk/EXAMPLE-METALLBAU-CO-GMBH/00000001-1.html';
const RUN_ID = '7d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a';
const PERMITTED = JSON.stringify({ 'www.europages.co.uk': 'owner-permission-2026-10' });

interface Net {
  sb: RecordedSb[];
  pages: Array<{ url: string; userAgent: string | null }>;
}

let net: Net;
let pageRoutes: Record<string, () => Response>;
let sbStatus: number | null;

beforeEach(() => {
  hostPauses.clear();
  sbStatus = null;
  pageRoutes = {
    [SEARCH]: () => new Response(page('europages-search-jsonld.html'), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    [PROFILE]: () => new Response(page('europages-profile-jsonld.html'), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  };
  const recorder = postgrestRecorder(({ table }) => {
    if (sbStatus !== null) return { status: sbStatus, body: { message: 'unavailable' } };
    if (table === 'rpc/agent_run_begin') return { body: [{ run_id: RUN_ID, created: true, run_status: 'running' }] };
    return undefined;
  });
  net = { sb: recorder.requests, pages: [] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith(SUPABASE_URL)) return recorder.fetch(input, init);
    net.pages.push({ url: request.url, userAgent: request.headers.get('user-agent') });
    const route = pageRoutes[request.url];
    return route ? route() : new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function env(o: { flag?: boolean; permitted?: string | undefined } = {}): { env: OpsEnv; kv: FakeKV } {
  const kv = new FakeKV();
  if (o.flag) kv.setJson('agent.growth.scrapers', { enabled: true, value: {}, updated_at: '2026-10-05T08:00:00Z', rev: 1 });
  const permitted = 'permitted' in o ? o.permitted : PERMITTED;
  return { env: opsEnv({ FLAGS: kv as unknown as KVNamespace, ...(permitted !== undefined ? { SCRAPER_PERMITTED_HOSTS: permitted } : {}) }), kv };
}

type RouteName = 'scan-directory' | 'scrape-company-profile';

function call(route: RouteName, principal: Principal = STAFF) {
  return opsCall({ endpoint: route, functionUrl: `/api/${route}`, principal });
}

async function viaOps(route: RouteName, e: OpsEnv, init: RequestInit, principal?: Principal) {
  return snapshot(await invoke(OpsApi, call(route, principal), { ...init, env: e }));
}

/** The Phase 2 handler run on its own (shim only) for the same request. */
async function handlerAlone(route: RouteName, init: RequestInit) {
  const handler = ((await import(`../../../../api/${route}.js`)) as { default: VercelHandler }).default;
  const request = new Request(`https://www.micronshub.eu/api/${route}`, init);
  const body = init.body === undefined ? null : new TextEncoder().encode(String(init.body));
  return snapshot(await runNodeHandler(handler, { request, functionUrl: `/api/${route}`, body, timeoutMs: 300_000, logPrefix: '[microns-ops]' }));
}

const sbPaths = () => net.sb.map((r) => `${r.method} ${decodeURIComponent(r.path)}`);

describe('Phase 2 path (unchanged)', () => {
  const cases: Array<[string, { flag?: boolean; permitted?: string | undefined }, RouteName, unknown]> = [
    ['no permitted host, flag on', { flag: true, permitted: undefined }, 'scan-directory', { url: SEARCH, source: 'auto' }],
    ['permitted host, flag off', { flag: false }, 'scan-directory', { url: SEARCH }],
    ['flag on, host not permitted', { flag: true, permitted: JSON.stringify({ 'www.wlw.de': 'owner-permission-2026-10' }) }, 'scan-directory', { url: SEARCH }],
    ['flag on, malformed permitted hosts', { flag: true, permitted: '{not json' }, 'scan-directory', { url: SEARCH }],
    ['profile: permitted host, flag off', { flag: false }, 'scrape-company-profile', { url: PROFILE, source: 'europages' }],
    ['profile: no permitted host, flag on', { flag: true, permitted: undefined }, 'scrape-company-profile', { url: PROFILE, source: 'europages' }],
  ];
  for (const [name, o, route, body] of cases) {
    it(`${name}: the handler's answer byte for byte, fetched with a browser identity`, async () => {
      const { env: e } = env(o);
      const viaRoute = await viaOps(route, e, jsonPost(body));
      const alone = await handlerAlone(route, jsonPost(body));
      expect(viaRoute.status).toBe(200);
      expect(viaRoute).toEqual(alone);
      expect(net.pages.every((p) => p.userAgent !== DEFAULT_SCRAPER_USER_AGENT && /Mozilla/.test(p.userAgent ?? ''))).toBe(true);
      expect(net.pages.some((p) => p.url.endsWith('/robots.txt'))).toBe(false);
      expect(net.sb).toEqual([]);
    });
  }

  it('without a permitted host the flag is not read and the body is not inspected', async () => {
    const { env: e, kv } = env({ flag: true, permitted: undefined });
    await viaOps('scan-directory', e, jsonPost({ url: SEARCH }));
    expect(kv.gets).toEqual([]);
  });

  it('GET, OPTIONS and a body without a string url keep the handler answers', async () => {
    const { env: e } = env({ flag: true });
    for (const init of [{ method: 'GET' }, { method: 'OPTIONS' }, jsonPost({ source: 'europages' }), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":' }] as RequestInit[]) {
      expect(await viaOps('scan-directory', e, init)).toEqual(await handlerAlone('scan-directory', init));
    }
    // A number url makes the handler throw (url.toLowerCase); the app answers 500 as in Phase 2.
    expect(await viaOps('scan-directory', e, jsonPost({ url: 42 }))).toMatchObject({ status: 500, body: 'Internal Server Error' });
    expect(net.sb).toEqual([]);
  });
});

describe('module path (flag on, host permitted)', () => {
  it('scan-directory: the handler body for the same page, crawler identity, scan_logs and a growth.scrapers run', async () => {
    const { env: e } = env({ flag: true });
    const viaModule = await viaOps('scan-directory', e, jsonPost({ url: SEARCH, source: 'auto' }));
    const alone = await handlerAlone('scan-directory', jsonPost({ url: SEARCH, source: 'auto' }));
    expect(viaModule).toEqual(alone);
    expect(JSON.parse(viaModule.body).companiesFound).toBeGreaterThan(0);

    const fetched = net.pages.filter((p) => p.userAgent === DEFAULT_SCRAPER_USER_AGENT);
    expect(fetched.map((p) => p.url)).toEqual([SEARCH]);
    const begin = net.sb.find((r) => r.path === '/rpc/agent_run_begin');
    expect(begin?.body).toMatchObject({ p_agent: 'growth.scrapers', p_trigger: 'dashboard', p_idempotency_key: 'growth.scrapers:req-test-1' });
    const log = net.sb.find((r) => r.method === 'POST' && r.path.startsWith('/scan_logs'));
    expect(log?.body).toMatchObject({ scan_type: 'directory', source: 'europages', url: SEARCH, status: 'completed', companies_found: JSON.parse(viaModule.body).companiesFound, error_message: null });
    const close = net.sb.find((r) => r.method === 'PATCH' && r.path.startsWith('/agent_runs'));
    expect(decodeURIComponent(close?.path ?? '')).toContain(`id=eq.${RUN_ID}`);
    expect(close?.body).toMatchObject({ status: 'succeeded', output: { route: 'directory', robots: 'permitted', permission: 'owner-permission-2026-10' } });
  });

  it('scrape-company-profile: the handler body for the same profile; a MACHINE mcp caller is recorded as trigger mcp', async () => {
    const { env: e } = env({ flag: true });
    const body = { url: PROFILE, source: 'europages' };
    const viaModule = await viaOps('scrape-company-profile', e, jsonPost(body), MCP);
    expect(viaModule).toEqual(await handlerAlone('scrape-company-profile', jsonPost(body)));
    expect(net.sb.find((r) => r.path === '/rpc/agent_run_begin')?.body).toMatchObject({ p_trigger: 'mcp' });
    expect(net.sb.find((r) => r.path.startsWith('/scan_logs') && r.method === 'POST')?.body).toMatchObject({ scan_type: 'profile', status: 'completed' });
  });

  it('a 403 from the directory pauses the host: host_blocked, scan_logs blocked:<host>, run failed; the next request fetches nothing', async () => {
    pageRoutes[SEARCH] = () => new Response('denied', { status: 403, headers: { 'content-type': 'text/html' } });
    const { env: e } = env({ flag: true });
    const first = await viaOps('scan-directory', e, jsonPost({ url: SEARCH }));
    expect(first.status).toBe(403);
    expect(JSON.parse(first.body)).toEqual({ error: 'host_blocked', retryAfter: 86400 });
    expect(first.headers['access-control-allow-origin']).toBe('*');
    expect(net.sb.find((r) => r.path.startsWith('/scan_logs') && r.method === 'POST')?.body).toMatchObject({ status: 'failed', error_message: 'blocked:www.europages.co.uk' });
    expect(net.sb.find((r) => r.method === 'PATCH')?.body).toMatchObject({ status: 'failed', error: 'host_blocked' });
    const fetchedBefore = net.pages.length;
    const second = await viaOps('scan-directory', e, jsonPost({ url: SEARCH }));
    expect(second.status).toBe(429);
    expect(JSON.parse(second.body).error).toBe('host_blocked');
    expect(net.pages.length).toBe(fetchedBefore);
  });

  it('the module validates as the handler does: url required, unknown source, a permitted host that is not a directory', async () => {
    const { env: e } = env({ flag: true, permitted: JSON.stringify({ 'www.europages.co.uk': 'owner-permission-2026-10', 'example.com': 'owner-permission-2026-10' }) });
    const unknown = await viaOps('scan-directory', e, jsonPost({ url: 'https://example.com/companies.html' }));
    expect(unknown).toEqual(await handlerAlone('scan-directory', jsonPost({ url: 'https://example.com/companies.html' })));
    const profileSource = await viaOps('scrape-company-profile', e, jsonPost({ url: PROFILE, source: 'kompass' }));
    expect(profileSource).toEqual(await handlerAlone('scrape-company-profile', jsonPost({ url: PROFILE, source: 'kompass' })));
    const notDirectory = await viaOps('scrape-company-profile', e, jsonPost({ url: 'https://example.com/profile', source: 'europages' }));
    expect(notDirectory.status).toBe(400);
    expect(JSON.parse(notDirectory.body)).toEqual({ error: 'url_not_allowed' });
    expect(net.pages.filter((p) => p.url.startsWith('https://example.com'))).toEqual([]);
  });

  it('a bookkeeping failure (PostgREST down) never changes the answer', async () => {
    sbStatus = 503;
    const { env: e } = env({ flag: true });
    const viaModule = await viaOps('scan-directory', e, jsonPost({ url: SEARCH }));
    sbStatus = null;
    expect(viaModule).toEqual(await handlerAlone('scan-directory', jsonPost({ url: SEARCH })));
    expect(sbPaths().some((p) => p.startsWith('POST /rpc/agent_run_begin'))).toBe(true);
  });
});
