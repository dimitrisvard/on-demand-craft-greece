// T2 profile 'agents' (npm run test:integration:agents), remote MCP in real workerd ([surfaces] X-6). This file
// starts its own harness instance with microns-ops as the primary Worker (startHarness({profile: 'agents', primary:
// 'ops'})), because only the primary Worker is served over HTTP: the ops default fetch (MCP host branch) is the
// surface. Every request carries Host: mcp.micronshub.eu (wrangler dev takes the request URL's hostname from it);
// Node's fetch does not send a custom Host header, so the MCP clients use a fetch built on node:http.
//   - Access: a key pair of this file, registered at the instance stub's /cdn-cgi/access/certs; assertions carry
//     iss = the stub origin, aud = t2-aud-mcp (the generated MCP_ACCESS_AUD) and the staff e-mail address.
//   - Staff mapping: auth.users and user_roles rows in the instance's mini-PostgREST (rpc/agent_staff_for_email).
//   - Flag mcp.remote: written to the instance's local KV namespace FLAGS through the Local Explorer.
// Checks: no assertion -> 401; flag missing -> only mcp_status (and no audit row); stage 'read' -> an SDK 1.30.0
// client and a @modelcontextprotocol/client 2.0.0 client initialise, list the read tools and call one read tool
// (get_companies) against the mini-PostgREST, with e-mail addresses masked and one agent_runs audit row (agent
// 'mcp') per call; then one read tool of every tool file (leads, companies, tenders, startups, gsc, rfqs, orders,
// agents), one resource and one prompt answer from the stubbed database. Tables the mini-PostgREST does not keep
// (leads, tenders, funded_startups, gsc_monitored_urls, gsc_inspection_cache) answer through canned /__stub/routes
// registrations of this file.

import { Client as ClientV1 } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as TransportV1 } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client as ClientV2, StreamableHTTPClientTransport as TransportV2 } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessKeyPair, jwksBody, mintAccessJwt, type SigningKey } from '../../../shared/test/helpers/jwt';
import { hostFetch } from '../mcp/host-fetch';

const MCP_HOST = 'mcp.micronshub.eu';
const AUD = 't2-aud-mcp';
const STAFF_UID = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
const STAFF_EMAIL = 'owner@example.com';
const TENANT = '00000000-0000-0000-0000-000000000001';
const RFQ_ID = '6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c';
const ORDER_ID = '7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d';
const TODAY = new Date().toISOString();

/** Canned PostgREST answers for the tables the mini-PostgREST does not keep (synthetic rows). */
const CANNED: Record<string, unknown[]> = {
  leads: [{ id: '8b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e', title: 'Looking for a CNC shop for robot arm brackets', status: 'new', source: 'reddit', subreddit: 'r/robotics', author: 'maker42', discovered_at: TODAY, auto_score: 'high', matched_keywords: ['cnc'], source_url: 'https://www.reddit.com/r/robotics/comments/t2example' }],
  tenders: [{ id: '9c0d1e2f-3a4b-4c5d-9e6f-7a8b9c0d1e2f', relevance_score: 82, country_code: 'DE', country_name: 'Germany', title: 'Sheet metal housings', buyer_name: 'Stadtwerke Beispiel', estimated_value_eur: 120000, submission_deadline: '2026-11-30T00:00:00Z', status: 'new', cpv_codes: ['44000000'], matched_keywords: ['sheet metal'], portal_url: 'https://ted.europa.eu/notice/t2-example' }],
  funded_startups: [{ id: '0d1e2f3a-4b5c-4d6e-8f7a-8b9c0d1e2f3a', company_name: 'Example Drones BV', country_code: 'NL', funding_currency: 'EUR', funding_amount_millions: 4, funding_stage: 'seed', industry_tags: ['drones'], hardware_confidence: 85, outreach_status: 'new', source_name: 'Example News', article_title: 'Example Drones raises 4M', source_url: 'https://news.example.com/example-drones', discovered_at: TODAY }],
  gsc_monitored_urls: [{ url: 'https://www.example.com/en/sheet-metal', label: 'Sheet metal', language: 'en', service_type: 'sheet_metal', priority: 5 }],
  gsc_inspection_cache: [],
};

interface Instance {
  url: string;
  stub: { url: string };
  explorer: string;
  stop: () => Promise<void>;
}

type Row = Record<string, unknown>;

async function call(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok && res.status !== 404) throw new Error(`${init?.method ?? 'GET'} ${url}: ${res.status} ${await res.text()}`);
  return res;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
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

describe('remote MCP over HTTP (own instance, ops primary)', () => {
  let h: Instance;
  let key: SigningKey;
  let mcpUrl: URL;
  const viaHost = hostFetch(MCP_HOST);

  const rows = async (table: string): Promise<Row[]> => (await (await call(`${h.stub.url}/__stub/rows/${table}`)).json()) as Row[];

  async function setFlag(name: string, record: Row | null): Promise<void> {
    const list = (await (await call(`${h.explorer}/storage/kv/namespaces`)).json()) as { result: Array<{ id: string; title: string }> };
    const ns = list.result.find((n) => /FLAGS/.test(n.id) || /FLAGS/.test(n.title));
    if (!ns) throw new Error(`no FLAGS namespace in ${JSON.stringify(list.result)}`);
    const url = `${h.explorer}/storage/kv/namespaces/${encodeURIComponent(ns.id)}/values/${encodeURIComponent(name)}`;
    if (record === null) await call(url, { method: 'DELETE' });
    else await call(url, { method: 'PUT', body: JSON.stringify(record), headers: { 'content-type': 'application/octet-stream' } });
  }

  const token = () => mintAccessJwt(key, { iss: new URL(h.stub.url).origin, aud: [AUD], email: STAFF_EMAIL });

  async function connectV1(): Promise<ClientV1> {
    const transport = new TransportV1(mcpUrl, { fetch: viaHost, requestInit: { headers: { 'Cf-Access-Jwt-Assertion': await token() } } });
    const client = new ClientV1({ name: 't2-v1', version: '1.0.0' });
    await client.connect(transport);
    return client;
  }

  beforeAll(async () => {
    const harness = (await import(/* @vite-ignore */ new URL('../../../site/test/integration/harness.mjs', import.meta.url).href)) as {
      startHarness(o: Record<string, unknown>): Promise<Instance>;
    };
    h = await harness.startHarness({ profile: 'agents', primary: 'ops', publish: false, quiet: true });
    mcpUrl = new URL('/mcp', h.url);
    key = await accessKeyPair('t2-mcp-kid');
    await call(`${h.stub.url}/__stub/access-keys`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(jwksBody(key)) });
    await call(`${h.stub.url}/__stub/seed`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tables: {
          'auth.users': [{ id: STAFF_UID, email: STAFF_EMAIL }],
          user_roles: [{ user_id: STAFF_UID, role: 'admin' }],
          company_leads: [{ company_name: 'Example Metallbau GmbH', source: 'wlw', source_url: 'https://www.wlw.de/de/firma/example-metallbau', city: 'Wien', country: 'AT', scraped_emails: ['office@example.at'], outreach_status: 'new', email_scrape_status: 'scraped' }],
          rfqs: [{ id: RFQ_ID, tenant_id: TENANT, rfq_number: 'RFQ-20261005-7', company_name: 'Example Robotics BV', country: 'NL', status: 'pending', source: 'email', total_amount: 840, currency: 'EUR', created_at: new Date().toISOString() }],
          orders: [{ id: ORDER_ID, tenant_id: TENANT, po_number: 'PO-2026-0042', title: 'Brackets', status: 'new', production_status: 'pending', total_amount: 1200, currency: 'EUR', created_at: new Date().toISOString() }],
        },
      }),
    });
    for (const [table, body] of Object.entries(CANNED)) {
      await call(`${h.stub.url}/__stub/routes`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ method: 'GET', path: `^/rest/v1/${table}\\?`, status: 200, body }) });
    }
  });

  afterAll(async () => {
    await h?.stop();
  });

  it('without an Access assertion the MCP host answers 401; another host keeps the Phase 2 404', async () => {
    const res = await viaHost(mcpUrl, { method: 'POST', headers: { ...JSON_HEADERS, accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    expect(res.status).toBe(401);
    await res.arrayBuffer();
    const other = await hostFetch('ops.example.test')(mcpUrl, { method: 'POST', body: '{}' });
    expect(other.status).toBe(404);
    expect(await other.text()).toBe('');
  });

  it('flag mcp.remote missing: the server lists only mcp_status, and its calls add no run', async () => {
    await setFlag('mcp.remote', null);
    const client = await connectV1();
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['mcp_status']);
    expect(textOf(await client.callTool({ name: 'mcp_status', arguments: {} }))).toContain('flag mcp.remote');
    await client.close();
    await new Promise((r) => setTimeout(r, 500));
    expect((await rows('agent_runs')).filter((x) => x.agent === 'mcp')).toEqual([]);
  });

  it('stage read: an SDK 1.30.0 client lists the read tools and calls get_companies (e-mail masked, one audit row)', async () => {
    await setFlag('mcp.remote', { enabled: true, value: { writes: false }, updated_at: '2026-10-05T08:00:00.000Z', rev: 2 });
    const client = await until('the read stage', async () => {
      const c = await connectV1();
      const names = (await c.listTools()).tools.map((t) => t.name);
      if (names.includes('get_companies')) return { c, names };
      await c.close();
      return null;
    });
    expect(client.names).not.toContain('mcp_status');
    expect(client.names).not.toContain('decide_approval');
    expect(client.names.length).toBe(35);
    const text = textOf(await client.c.callTool({ name: 'get_companies', arguments: { source: 'wlw' } }));
    expect(text).toContain('Example Metallbau GmbH [WLW]');
    expect(text).toContain('o***@example.at');
    expect(text).not.toContain('office@example.at');
    await client.c.close();
    const audit = await until('the audit row', async () => {
      const r = (await rows('agent_runs')).filter((x) => x.agent === 'mcp' && x.status === 'succeeded');
      return r.length ? r : null;
    });
    expect(audit[0]).toMatchObject({ trigger: 'mcp', status: 'succeeded' });
    expect(String(audit[0].idempotency_key)).toMatch(/^mcp:r:[0-9a-f-]{36}$/);
    expect(JSON.stringify(audit[0].output)).not.toContain('office@example.at');
  });

  it('stage read: a @modelcontextprotocol/client 2.0.0 client initialises, lists and calls the same tool', async () => {
    const transport = new TransportV2(mcpUrl, { fetch: viaHost, requestInit: { headers: { 'Cf-Access-Jwt-Assertion': await token() } } });
    const client = new ClientV2({ name: 't2-v2', version: '2.0.0' });
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('get_companies');
    const text = textOf(await client.callTool({ name: 'get_companies', arguments: { country: 'AT' } }));
    expect(text).toContain('Found 1 companies');
    await client.close();
  });

  it('stage read: one read tool of every tool file, a resource and a prompt answer from the stubbed database', async () => {
    const client = await connectV1();
    const calls: Array<[file: string, tool: string, args: Record<string, unknown>, expected: string]> = [
      ['leads', 'get_leads', {}, '[HIGH] Looking for a CNC shop for robot arm brackets'],
      ['companies', 'get_companies', {}, 'Example Metallbau GmbH [WLW]'],
      ['tenders', 'get_tenders', {}, '[82 HIGH] DE Germany - Sheet metal housings'],
      ['startups', 'get_funded_startups', {}, 'Example Drones BV (NL)'],
      ['gsc', 'gsc_get_unindexed_pages', {}, '[en] https://www.example.com/en/sheet-metal'],
      ['rfqs', 'list_rfqs', {}, 'RFQ-20261005-7 | Example Robotics BV (NL) | pending | email'],
      ['orders', 'list_orders', {}, 'PO-2026-0042 | new/pending | 1200 EUR'],
      ['agents', 'list_agent_runs', { agent: 'mcp' }, 'mcp'],
    ];
    for (const [file, name, args, expected] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${file}: ${textOf(result)}`).toBeFalsy();
      expect(textOf(result), file).toContain(expected);
    }
    const resource = await client.readResource({ uri: 'leads://today' });
    expect(String((resource.contents[0] as { text?: string }).text)).toContain('1');
    const prompt = await client.getPrompt({ name: 'daily_lead_review', arguments: {} });
    expect(prompt.messages).toHaveLength(1);
    await client.close();
  });
});
