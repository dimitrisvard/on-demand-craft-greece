// Test support for the remote MCP: an Access key pair and certificates endpoint, a staff user in MemoryDb
// (auth.users + user_roles for rpc/agent_staff_for_email), the flag in the fake KV, a recording PostgREST fetch for
// the tools' supabase-js client, and an MCP client (SDK v1 or v2) whose transport calls handleMcp in-process.

import { Client as ClientV1 } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as TransportV1 } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resetAccessCertsCache } from '../../../shared/src/auth/access-jwt';
import { accessKeyPair, jwksBody, mintAccessJwt, type SigningKey } from '../../../shared/test/helpers/jwt';
import type { OpsEnv } from '../../src/env';
import { PrincipalCache } from '../../src/mcp/auth';
import type { GscClient, InProcessCall, McpContext, McpDeps } from '../../src/mcp/context';
import { handleMcp } from '../../src/mcp/index';
import { HostPauses } from '../../src/scrapers/context';
import { RobotsCache } from '../../src/scrapers/robots';
import { agentBindings, agentPorts, type AgentTestPorts, type FakeKV } from '../helpers/agent-env';
import { opsEnv, testContext, type TestContext } from '../helpers/ops';

export const TEAM = 'https://team.example.test';
export const AUD = 't1-aud-mcp';
export const STAFF_UID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
export const STAFF_EMAIL = 'owner@example.com';
export const MCP_URL = 'https://mcp.micronshub.eu/mcp';
export const NOW = new Date(Date.UTC(2026, 9, 5, 9, 0, 0));

// ----- PostgREST recorder (supabase-js requests) -----

export interface RecordedSb {
  method: string;
  /** path + query below /rest/v1, e.g. '/leads?select=*&order=...'. */
  path: string;
  body?: unknown;
}

export type SbRoute = (r: { method: string; table: string; url: URL; headers: Headers; body: unknown }) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

/**
 * fetch for supabase-js: records every request and answers from `route` (first match) or with the default: GET/HEAD
 * [] (an object request answers 406 PGRST116), writes 201/204 with [] .
 */
export function postgrestRecorder(route?: SbRoute): { fetch: typeof fetch; requests: RecordedSb[] } {
  const requests: RecordedSb[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    const body = text ? JSON.parse(text) : undefined;
    const path = url.pathname.replace(/^\/rest\/v1/, '') + url.search;
    requests.push(body === undefined ? { method: request.method, path } : { method: request.method, path, body });
    const table = url.pathname.replace(/^\/rest\/v1\//, '');
    const custom = route?.({ method: request.method, table, url, headers: request.headers, body });
    const wantsObject = (request.headers.get('accept') ?? '').includes('vnd.pgrst.object');
    if (custom) {
      return new Response(custom.body === undefined ? null : JSON.stringify(custom.body), { status: custom.status ?? 200, headers: { 'content-type': 'application/json', ...custom.headers } });
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (wantsObject) return new Response(JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows', hint: null }), { status: 406, headers: { 'content-type': 'application/json' } });
      return new Response(request.method === 'HEAD' ? null : '[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '*/0' } });
    }
    if (wantsObject) return new Response(JSON.stringify({ id: 1 }), { status: 201, headers: { 'content-type': 'application/json' } });
    return new Response(request.method === 'POST' ? '[]' : null, { status: request.method === 'POST' ? 201 : 204, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: impl, requests };
}

// ----- environment -----

export interface McpHarness {
  env: OpsEnv;
  ports: AgentTestPorts;
  kv: FakeKV;
  key: SigningKey;
  ctx: TestContext;
  sb: { fetch: typeof fetch; requests: RecordedSb[] };
  inprocessCalls: InProcessCall[];
  gscCalls: Array<{ fn: string; args: unknown[] }>;
  deps: Partial<McpDeps>;
  cache: PrincipalCache;
  /** Assertion of the staff user (or of another e-mail / audience / issuer). */
  token(o?: { email?: string | null; aud?: string; commonName?: string; exp?: number; key?: SigningKey }): Promise<string>;
  /** handleMcp for a raw request. */
  call(req: Request): Promise<Response>;
  setFlag(value: Record<string, unknown> | null): void;
}

export interface HarnessOptions {
  flag?: Record<string, unknown> | null;
  roles?: string[];
  sbRoute?: SbRoute;
  inprocess?: (ctx: McpContext, call: InProcessCall) => Promise<Response>;
  gsc?: Partial<GscClient>;
  env?: Partial<OpsEnv>;
}

export async function mcpHarness(o: HarnessOptions = {}): Promise<McpHarness> {
  // Each harness has its own Access key pair; the per-isolate certificate cache must not keep an earlier one.
  resetAccessCertsCache();
  const key = await accessKeyPair();
  const ports = agentPorts();
  ports.clock.set(NOW);
  ports.db.seed('auth.users', [{ id: STAFF_UID, email: STAFF_EMAIL }, { id: '1c2d3e4f-5061-4b7c-8d9e-0f1a2b3c4d5e', email: 'buyer@example.com' }]);
  ports.db.seed('user_roles', [
    ...(o.roles ?? ['admin']).map((role, i) => ({ id: `r-${i}`, user_id: STAFF_UID, role })),
    { id: 'r-cust', user_id: '1c2d3e4f-5061-4b7c-8d9e-0f1a2b3c4d5e', role: 'customer' },
  ]);
  const bindings = agentBindings();
  const env = opsEnv({ ...bindings, ...o.env });
  const kv = env.FLAGS as unknown as FakeKV;
  const setFlag = (value: Record<string, unknown> | null) => {
    if (value === null) kv.store.delete('mcp.remote');
    else kv.setJson('mcp.remote', value);
  };
  setFlag(o.flag === undefined ? { enabled: true, value: { writes: false }, updated_at: '2026-10-05T08:00:00Z', rev: 2 } : o.flag);
  const sb = postgrestRecorder(o.sbRoute);
  const inprocessCalls: InProcessCall[] = [];
  const gscCalls: Array<{ fn: string; args: unknown[] }> = [];
  const gscFake: GscClient = {
    searchAnalytics: async (...args) => { gscCalls.push({ fn: 'searchAnalytics', args }); return { rows: [{ keys: ['cnc machining'], clicks: 12, impressions: 340, ctr: 0.035, position: 7.2 }] }; },
    inspectUrl: async (...args) => { gscCalls.push({ fn: 'inspectUrl', args }); return { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' } }; },
    getIndexingQuotaUsed: async () => { gscCalls.push({ fn: 'getIndexingQuotaUsed', args: [] }); return { used: 3, limit: 200 }; },
    submitBatchForIndexing: async (...args) => { gscCalls.push({ fn: 'submitBatchForIndexing', args }); return { results: [{ url: String((args[0] as string[])[0]), status: 'success' }], quota: { used: 4, limit: 200 } }; },
    listSitemaps: async () => { gscCalls.push({ fn: 'listSitemaps', args: [] }); return [{ path: 'https://www.micronshub.eu/sitemap.xml', type: 'sitemap' }]; },
    submitSitemap: async (...args) => { gscCalls.push({ fn: 'submitSitemap', args }); return { ok: true }; },
    ...o.gsc,
  };
  const deps: Partial<McpDeps> = {
    fetch: sb.fetch,
    ports: () => ports,
    gsc: async () => gscFake,
    now: () => ports.clock.now(),
    sleep: async () => {},
    scraper: () => ({
      fetch: (async () => new Response('', { status: 404 })) as typeof fetch,
      userAgent: 'MicronsHubBot/1.0 (+https://www.micronshub.eu/en/contact)',
      permitted: new Map(),
      browser: null,
      now: () => ports.clock.now().getTime(),
      sleep: async () => {},
      robotsCache: new RobotsCache(),
      pauses: new HostPauses(),
      db: ports.db,
      log: () => {},
    }),
    inprocess: async (ctx, call) => {
      inprocessCalls.push(call);
      if (o.inprocess) return o.inprocess(ctx, call);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const cache = new PrincipalCache();
  const ctx = testContext();
  const certsFetch = (async () => new Response(JSON.stringify(jwksBody(key)), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  return {
    env,
    ports,
    kv,
    key,
    ctx,
    sb,
    inprocessCalls,
    gscCalls,
    deps,
    cache,
    setFlag,
    token: (t = {}) => mintAccessJwt(t.key ?? key, {
      iss: TEAM,
      aud: [t.aud ?? AUD],
      ...(t.commonName !== undefined ? { commonName: t.commonName } : {}),
      ...(t.email === null ? {} : { email: t.email ?? STAFF_EMAIL }),
      ...(t.exp !== undefined ? { exp: t.exp } : {}),
    }),
    call: (req) => handleMcp(req, env, ctx, { deps, certsFetch, principalCache: cache }),
  };
}

/** An MCP SDK v1 client connected through handleMcp with the given assertion. */
export async function connectV1(h: McpHarness, token: string, headers: Record<string, string> = {}): Promise<ClientV1> {
  const transport = new TransportV1(new URL(MCP_URL), {
    fetch: (url: string | URL, init?: RequestInit) => h.call(withHost(new Request(url, init))),
    requestInit: { headers: { 'Cf-Access-Jwt-Assertion': token, ...headers } },
  });
  const client = new ClientV1({ name: 't1-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

/** The request with the Host header workerd sets from the URL (Node's fetch adds it only when sending). */
export function withHost(req: Request, host?: string): Request {
  const headers = new Headers(req.headers);
  headers.set('host', host ?? new URL(req.url).host);
  return new Request(req, { headers });
}

/** Waits for every waitUntil promise of the harness context. */
export async function settle(h: McpHarness): Promise<void> {
  while (h.ctx.pending.length > 0) await Promise.all(h.ctx.pending.splice(0));
}

/** Text of a tools/call result. */
export function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
}

/** A JSON-RPC POST to the MCP endpoint (raw, for status-code tests). */
export function rpcRequest(o: { token?: string; host?: string; path?: string; origin?: string; headers?: Record<string, string>; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { host: o.host ?? 'mcp.micronshub.eu', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...o.headers };
  if (o.token) headers['Cf-Access-Jwt-Assertion'] = o.token;
  if (o.origin) headers.origin = o.origin;
  const url = `https://${o.host ?? 'mcp.micronshub.eu'}${o.path ?? '/mcp'}`;
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(o.body ?? { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
  });
}
