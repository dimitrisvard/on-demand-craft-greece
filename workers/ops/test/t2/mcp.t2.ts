// T2 profile 'agents' (npm run test:integration:agents), remote MCP in real workerd ([surfaces] X-6). This file
// starts its own harness instance with microns-ops as the primary Worker (startHarness({profile: 'agents', primary:
// 'ops'})), because only the primary Worker is served over HTTP: the ops default fetch (MCP host branch) is the
// surface. Every request carries Host: mcp.micronshub.eu (wrangler dev takes the request URL's hostname from it);
// Node's fetch does not send a custom Host header, so the MCP clients use a fetch built on node:http.
//   - Access: a key pair of this file, registered at the instance stub's /cdn-cgi/access/certs; assertions carry
//     iss = the stub origin, aud = t2-aud-mcp (the generated MCP_ACCESS_AUD) and the staff e-mail address.
//   - Staff mapping: auth.users and user_roles rows in the instance's mini-PostgREST (rpc/agent_staff_for_email).
//   - Flag mcp.remote: written to the instance's local KV namespace FLAGS through the Local Explorer.
// Checks: no assertion -> 401; flag missing -> only mcp_status; stage 'read' -> an SDK 1.30.0 client and a
// @modelcontextprotocol/client 2.0.0 client initialise, list the read tools and call one read tool (get_companies)
// against the mini-PostgREST, with e-mail addresses masked and one agent_runs audit row (agent 'mcp') per call.

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
        },
      }),
    });
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

  it('flag mcp.remote missing: the server lists only mcp_status', async () => {
    await setFlag('mcp.remote', null);
    const client = await connectV1();
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['mcp_status']);
    expect(textOf(await client.callTool({ name: 'mcp_status', arguments: {} }))).toContain('flag mcp.remote');
    await client.close();
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
});
