// T2 profile 'agents' (npm run test:integration:agents), scraper module in real workerd ([surfaces] Z-5). This file
// starts its own harness instance with microns-ops as the primary Worker and the scrapes queue consumer kept
// (startHarness({profile: 'agents', primary: 'ops', keepScrapesConsumer: true})); the module reaches the network
// only through SCRAPER_API_BASE (generated configs with AGENT_STUBS only), which points at a fixture server of this
// file on 127.0.0.1, so nothing leaves the machine. The scans are started through the remote MCP tool
// scan_directory (Host: mcp.micronshub.eu, a staff Access assertion of this file).
//   - The generated ops config has no BROWSER binding (no local simulation).
//   - Flag agent.growth.scrapers off: scan_directory is refused and nothing is fetched.
//   - Flag on, host not permitted (www.wlw.de with its saved robots.txt): robots_disallowed; only robots.txt is
//     fetched, with the crawler identity; the growth.scrapers run closes 'skipped'. The same scan with more than
//     3 pages goes through the queue and the real scrapes consumer, with the same outcome.
//   - Flag on, host permitted (www.wlw.at in SCRAPER_PERMITTED_HOSTS): no robots.txt fetch, the page is fetched with
//     the crawler identity, scan_logs and the run record the permission reference.
// The Phase 2 routes (/api/scan-directory, /api/scrape-company-profile) are reachable only through the site's
// service binding, which this instance does not serve over HTTP; their flag-off identity with the Phase 2 handlers
// is checked in T1 (test/scrapers/route.test.ts, real handlers through OpsApi.handle).

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessKeyPair, jwksBody, mintAccessJwt, type SigningKey } from '../../../shared/test/helpers/jwt';
import { hostFetch } from '../mcp/host-fetch';

const MCP_HOST = 'mcp.micronshub.eu';
const AUD = 't2-aud-mcp';
const STAFF_UID = '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a';
const STAFF_EMAIL = 'owner@example.com';
const CRAWLER_UA = 'MicronsHubBot/1.0 (+https://www.micronshub.eu/en/contact)';
const PERMISSION = 'owner-permission-t2';
const ROBOTS_WLW_DE = readFileSync(new URL('../fixtures/scrapers/robots/www.wlw.de_robots.txt', import.meta.url), 'utf8');

interface Instance {
  url: string;
  stub: { url: string };
  explorer: string;
  configs: { ops: string };
  stop: () => Promise<void>;
}

type Row = Record<string, unknown>;
interface Seen { path: string; userAgent: string | undefined }

/** Directory pages by '/<host><path>', as SCRAPER_API_BASE re-addresses them; every request is recorded. */
async function fixtureServer(): Promise<{ url: string; seen: Seen[]; close(): Promise<void> }> {
  const pages: Record<string, { status: number; type: string; body: string }> = {
    '/www.wlw.de/robots.txt': { status: 200, type: 'text/plain', body: ROBOTS_WLW_DE },
    '/www.wlw.at/de/suche/cnc': { status: 200, type: 'text/html; charset=utf-8', body: '<!doctype html><html><body><p>No companies match this search.</p></body></html>' },
  };
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url ?? '', userAgent: req.headers['user-agent'] });
    const page = pages[(req.url ?? '').split('?')[0]];
    if (!page) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(page.status, { 'content-type': page.type });
    res.end(page.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function call(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok && res.status !== 404) throw new Error(`${init?.method ?? 'GET'} ${url}: ${res.status} ${await res.text()}`);
  return res;
}

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

describe('scraper module in workerd (own instance, ops primary, scrapes consumer kept)', () => {
  let h: Instance;
  let fixtures: Awaited<ReturnType<typeof fixtureServer>>;
  let key: SigningKey;
  let client: Client;

  const rows = async (table: string): Promise<Row[]> => (await (await call(`${h.stub.url}/__stub/rows/${table}`)).json()) as Row[];
  const scanRuns = async (): Promise<Row[]> => (await rows('agent_runs')).filter((r) => r.agent === 'growth.scrapers');

  async function setFlag(name: string, record: Row | null): Promise<void> {
    const list = (await (await call(`${h.explorer}/storage/kv/namespaces`)).json()) as { result: Array<{ id: string; title: string }> };
    const ns = list.result.find((n) => /FLAGS/.test(n.id) || /FLAGS/.test(n.title));
    if (!ns) throw new Error(`no FLAGS namespace in ${JSON.stringify(list.result)}`);
    const url = `${h.explorer}/storage/kv/namespaces/${encodeURIComponent(ns.id)}/values/${encodeURIComponent(name)}`;
    if (record === null) await call(url, { method: 'DELETE' });
    else await call(url, { method: 'PUT', body: JSON.stringify(record), headers: { 'content-type': 'application/octet-stream' } });
  }

  beforeAll(async () => {
    fixtures = await fixtureServer();
    const harness = (await import(/* @vite-ignore */ new URL('../../../site/test/integration/harness.mjs', import.meta.url).href)) as {
      startHarness(o: Record<string, unknown>): Promise<Instance>;
    };
    h = await harness.startHarness({
      profile: 'agents',
      primary: 'ops',
      keepScrapesConsumer: true,
      publish: false,
      quiet: true,
      opsVars: { SCRAPER_API_BASE: fixtures.url, SCRAPER_PERMITTED_HOSTS: JSON.stringify({ 'www.wlw.at': PERMISSION }) },
    });
    key = await accessKeyPair('t2-scrapers-kid');
    await call(`${h.stub.url}/__stub/access-keys`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(jwksBody(key)) });
    await call(`${h.stub.url}/__stub/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tables: { 'auth.users': [{ id: STAFF_UID, email: STAFF_EMAIL }], user_roles: [{ user_id: STAFF_UID, role: 'admin' }] } }),
    });
    await setFlag('mcp.remote', { enabled: true, value: { writes: true, write_tools: ['scan_directory'] }, updated_at: '2026-10-05T08:00:00.000Z', rev: 3 });
    const token = await mintAccessJwt(key, { iss: new URL(h.stub.url).origin, aud: [AUD], email: STAFF_EMAIL });
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', h.url), { fetch: hostFetch(MCP_HOST), requestInit: { headers: { 'Cf-Access-Jwt-Assertion': token } } });
    client = new Client({ name: 't2-scrapers', version: '1.0.0' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    await h?.stop();
    await fixtures?.close();
  });

  it('the generated ops config has no BROWSER binding and the scrapes consumer is kept', () => {
    const config = readFileSync(h.configs.ops, 'utf8');
    const parsed = JSON.parse(config) as { browser?: unknown; queues?: { consumers?: Array<{ queue: string }> }; vars: Record<string, string> };
    expect(parsed.browser).toBeUndefined();
    expect(parsed.queues?.consumers?.map((c) => c.queue)).toContain('scrapes');
    expect(parsed.vars.SCRAPER_API_BASE).toBe(fixtures.url);
  });

  it('flag agent.growth.scrapers off: scan_directory is refused and nothing is fetched', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain('scan_directory');
    const result = await client.callTool({ name: 'scan_directory', arguments: { url: 'https://www.wlw.de/de/suche/cnc', maxPages: 1 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('flag agent.growth.scrapers');
    expect(fixtures.seen).toEqual([]);
    expect(await scanRuns()).toEqual([]);
  });

  it('flag on, host not permitted: robots_disallowed, only robots.txt fetched with the crawler identity, run skipped', async () => {
    await setFlag('agent.growth.scrapers', { enabled: true, value: {}, updated_at: '2026-10-05T08:00:00.000Z', rev: 4 });
    const result = await until('the scrapers flag', async () => {
      const r = await client.callTool({ name: 'scan_directory', arguments: { url: 'https://www.wlw.de/de/suche/cnc', maxPages: 2 } });
      return textOf(r).includes('flag agent.growth.scrapers') ? null : r;
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Page 1: robots_disallowed');
    expect(fixtures.seen.map((s) => s.path)).toEqual(['/www.wlw.de/robots.txt']);
    expect(fixtures.seen[0].userAgent).toBe(CRAWLER_UA);
    const runs = await scanRuns();
    expect(runs).toEqual([expect.objectContaining({ trigger: 'mcp', status: 'skipped', error: 'robots_disallowed' })]);
    const logs = await rows('scan_logs');
    expect(logs).toEqual([expect.objectContaining({ scan_type: 'directory', source: 'wlw', status: 'failed', error_message: 'Page 1: robots_disallowed', companies_found: 0 })]);
  });

  it('more than 3 pages: queued, the real scrapes consumer closes the run skipped (robots_disallowed)', async () => {
    const result = await client.callTool({ name: 'scan_directory', arguments: { url: 'https://www.wlw.de/de/suche/cnc-drehen', maxPages: 6 } });
    const runId = /run_id ([0-9a-f-]{36})/.exec(textOf(result))?.[1];
    expect(runId, textOf(result)).toBeDefined();
    const run = await until('the consumer to close the queued run', async () => {
      const r = (await scanRuns()).find((x) => x.id === runId);
      return r && r.status !== 'running' ? r : null;
    });
    expect(run).toMatchObject({ status: 'skipped', error: 'robots_disallowed' });
    expect(fixtures.seen.filter((s) => !s.path.endsWith('/robots.txt'))).toEqual([]);
  });

  it('flag on, host permitted: the page is fetched with the crawler identity, no robots.txt fetch, the permission is recorded', async () => {
    const before = fixtures.seen.length;
    const result = await client.callTool({ name: 'scan_directory', arguments: { url: 'https://www.wlw.at/de/suche/cnc', maxPages: 1 } });
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(textOf(result)).toContain('Pages scanned: 1 of up to 1');
    const fetched = fixtures.seen.slice(before);
    expect(fetched).toEqual([{ path: '/www.wlw.at/de/suche/cnc', userAgent: CRAWLER_UA }]);
    const run = (await scanRuns()).find((r) => (r.output as Row | null)?.permission === PERMISSION);
    expect(run).toMatchObject({ status: 'succeeded', output: { source: 'wlw', pages: 1, robots: 'permitted', permission: PERMISSION } });
    expect((await rows('scan_logs')).some((l) => l.url === 'https://www.wlw.at/de/suche/cnc' && l.status === 'completed')).toBe(true);
  });
});
