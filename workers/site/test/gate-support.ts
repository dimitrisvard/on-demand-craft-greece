// Test support for the gate tests: a ResolvedApi builder (independent of the resolver), fake rate-limit bindings
// with the configured limits, and a fake upstream for Supabase Auth, PostgREST, Turnstile siteverify and the
// Access certs endpoint, installed as the global fetch. Tokens come from workers/shared/test/helpers/jwt.ts.

import { vi } from 'vitest';
import { resetAccessCertsCache } from '../../shared/src/auth/access-jwt';
import { resetSupabaseJwtCache } from '../../shared/src/auth/supabase-jwt';
import type { BodyView } from '../../shared/src/compat/vercel-node';
import type { EndpointId } from '../../shared/src/http/rpc';
import { accessKeyPair, jwksBody, mintAccessJwt, mintSupabaseJwt, type SigningKey } from '../../shared/test/helpers/jwt';
import type { ResolvedApi } from '../src/api/resolve';
import type { Env } from '../src/env';

export const SUPABASE_URL = 'https://project.supabase.test';
export const SITE_ORIGIN = 'https://www.micronshub.eu';
export const PREVIEW_HOST = 'abc123-microns-site.example-sub.workers.dev';
export const PREVIEW = `https://${PREVIEW_HOST}`;
export const WWW = 'https://www.micronshub.eu';
export const ACCESS_TEAM = 'microns-test.cloudflareaccess.com';
export const ACCESS_AUD = 'aud-preview-test';
export const COLLECTOR_ID = 'collector-client.access';
export const MCP_ID = 'mcp-client.access';
export const CI_ID = 'ci-client.access';
// Test values built at runtime; none of them is a credential.
export const REAL_TURNSTILE_SECRET = ['real', 'turnstile', 'secret', 'test'].join('-');
export const TEST_SECRET_PASS = '1x0000000000000000000000000000000AA';
export const TEST_SECRET_FAIL = '2x0000000000000000000000000000000AA';
export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

// ----- rate limits -----

export interface FakeLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
  counts: Map<string, number>;
}

export function fakeLimiter(max: number): FakeLimiter {
  const counts = new Map<string, number>();
  return {
    counts,
    async limit({ key }) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= max };
    },
  };
}

// ----- env -----

export function makeEnv(overrides: Partial<Record<keyof Env, unknown>> = {}): Env {
  const env: Record<string, unknown> = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ['anon', 'test', 'value'].join('-'),
    SITE_ORIGIN,
    PREVIEW_HOSTNAMES: '',
    SEO_STRICT_404: 'false',
    API_FORWARD_ORIGIN: 'https://upstream.example.test',
    DIRECTORY_INDEX_EMULATION: 'false',
    SUPABASE_SERVICE_ROLE_KEY: ['service', 'test', 'value'].join('-'),
    TURNSTILE_SECRET_KEY: REAL_TURNSTILE_SECRET,
    API_RATE_LIMIT: fakeLimiter(30),
    API_RATE_LIMIT_MAIL: fakeLimiter(5),
    API_RATE_LIMIT_BULK: fakeLimiter(300),
    ACCESS_TEAM_DOMAIN: ACCESS_TEAM,
    ACCESS_AUD,
    ACCESS_MACHINE_CLIENT_IDS: `${COLLECTOR_ID}=collector,${MCP_ID}=mcp`,
    ...overrides,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env as unknown as Env;
}

export const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

// ----- resolved requests -----

function parseQueryString(search: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(search)) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

function parseBody(contentType: string | null, bytes: Uint8Array): BodyView {
  const text = new TextDecoder().decode(bytes);
  if (contentType === null) return { ok: true, value: '' };
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type === 'application/json') {
    if (!text) return { ok: true, value: {} };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }
  if (type === 'text/plain') return { ok: true, value: text };
  if (type === 'application/x-www-form-urlencoded') return { ok: true, value: Object.fromEntries(new URLSearchParams(text)) };
  return { ok: true, value: undefined };
}

export interface ApiCall {
  endpoint: EndpointId;
  action: string;
  /** Function path + query; default /api/<endpoint>. */
  functionUrl?: string;
  method?: string;
  host?: string;
  headers?: Record<string, string>;
  /** Object -> JSON with application/json; string -> as given (set content-type yourself). */
  body?: unknown;
  scope?: 'rfq' | 'articles';
  step?: string;
  publicPath?: string;
}

export interface Built {
  r: ResolvedApi;
  request: Request;
}

export function apiCall(call: ApiCall): Built {
  const method = (call.method ?? (call.body === undefined ? 'GET' : 'POST')).toUpperCase();
  const functionUrl = call.functionUrl ?? `/api/${call.endpoint}`;
  const host = call.host ?? PREVIEW;
  const headers = new Headers(call.headers ?? {});
  let bytes: Uint8Array = new Uint8Array(0);
  if (call.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    if (typeof call.body === 'string') {
      bytes = new TextEncoder().encode(call.body);
    } else {
      bytes = new TextEncoder().encode(JSON.stringify(call.body));
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  }
  const request = new Request(`${host}${call.publicPath ?? functionUrl}`, {
    method,
    headers,
    body: bytes.length ? bytes : undefined,
  });
  const q = functionUrl.indexOf('?');
  const r: ResolvedApi = {
    endpoint: call.endpoint,
    publicPath: call.publicPath ?? (q < 0 ? functionUrl : functionUrl.slice(0, q)),
    functionUrl,
    method,
    query: parseQueryString(q < 0 ? '' : functionUrl.slice(q + 1)),
    body: parseBody(headers.get('content-type'), bytes),
    bodyBytes: bytes,
    action: call.action,
    rawAction: call.action,
  };
  if (call.endpoint === 's3') r.scope = call.scope ?? 'rfq';
  if (call.step !== undefined) r.step = call.step;
  return { r, request };
}

// ----- fake upstream -----

export interface FakeUser {
  uid: string;
  email: string;
  roles: string[];
  token: string;
  /** rfq ids this user owns as a customer (my_rfq_ids). */
  rfqIds?: string[];
  /** rfq_files.file_path values visible to this user. */
  visibleKeys?: string[];
}

export interface Seed {
  rfqs: Array<{ id: string; rfq_number: string; customer_id: string | null; created_at: string }>;
  customers: Array<{ id: string; email: string }>;
  partners: Array<{ email: string; active: boolean }>;
  sentEvents: Array<{ id: string; campaign_id: string }>;
  campaigns: Array<{ id: string; body: string }>;
}

export type Failure = 'network' | 'hang' | number;

export interface Upstream {
  users: Map<string, FakeUser>;
  seed: Seed;
  calls: string[];
  /** Answer for any request whose URL matches. */
  failures: Array<{ match: RegExp; failure: Failure }>;
  siteverify: { answer: unknown; status: number };
  siteverifyCalls: URLSearchParams[];
  accessKey: SigningKey;
  addUser(roles: string[], extra?: Partial<Omit<FakeUser, 'uid' | 'token' | 'roles'>>): Promise<FakeUser>;
  machineAssertion(clientId: string): Promise<string>;
}

let counter = 0;
export function uuid(): string {
  counter += 1;
  const hex = counter.toString(16).padStart(12, '0');
  return `3f6c1d2e-4b5a-4c7d-8e9f-${hex}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function eqParam(url: URL, name: string): string | null {
  const value = url.searchParams.get(name);
  return value && value.startsWith('eq.') ? value.slice(3) : null;
}

// One RSA key pair per test file (generation is slow); the certs cache is reset per test instead.
let accessKeyPromise: Promise<SigningKey> | undefined;

export async function installUpstream(): Promise<Upstream> {
  resetSupabaseJwtCache();
  resetAccessCertsCache();
  accessKeyPromise ??= accessKeyPair('test-kid');
  const accessKey = await accessKeyPromise;
  const up: Upstream = {
    users: new Map(),
    seed: { rfqs: [], customers: [], partners: [], sentEvents: [], campaigns: [] },
    calls: [],
    failures: [],
    siteverify: { answer: { success: false }, status: 200 },
    siteverifyCalls: [],
    accessKey,
    async addUser(roles, extra = {}) {
      const uid = uuid();
      const email = extra.email ?? `user-${uid.slice(-4)}@example.test`;
      const token = await mintSupabaseJwt({ sub: uid, email });
      const user: FakeUser = { uid, email, roles, token, ...extra };
      up.users.set(token, user);
      return user;
    },
    async machineAssertion(clientId) {
      return mintAccessJwt(accessKey, { iss: `https://${ACCESS_TEAM}`, aud: [ACCESS_AUD], commonName: clientId });
    },
  };

  const handler = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    up.calls.push(`${request.method} ${url.origin}${url.pathname}${url.search}`);
    for (const f of up.failures) {
      if (!f.match.test(url.href)) continue;
      if (f.failure === 'network') throw new TypeError('fetch failed');
      if (f.failure === 'hang') {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return json({ code: 'PGRST', message: 'stubbed failure' }, f.failure);
    }

    if (url.href === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      up.siteverifyCalls.push(new URLSearchParams(String(init.body ?? (await request.text()))));
      return json(up.siteverify.answer, up.siteverify.status);
    }
    if (url.origin === `https://${ACCESS_TEAM}` && url.pathname === '/cdn-cgi/access/certs') {
      return json(jwksBody(accessKey));
    }
    if (url.origin !== SUPABASE_URL) return json({ error: 'unexpected host' }, 599);

    const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const user = up.users.get(bearer);
    const path = url.pathname;
    if (path === '/auth/v1/user') {
      return user ? json({ id: user.uid, email: user.email }) : json({ msg: 'invalid JWT' }, 401);
    }
    if (path === '/rest/v1/user_roles') {
      if (!user) return json({ message: 'JWT invalid' }, 401);
      return json(user.roles.map((role) => ({ role })));
    }
    if (path === '/rest/v1/rpc/my_rfq_ids') {
      if (!user) return json({ message: 'JWT invalid' }, 401);
      return json(user.rfqIds ?? []);
    }
    if (path === '/rest/v1/rfq_files') {
      if (!user) return json({ message: 'JWT invalid' }, 401);
      const key = eqParam(url, 'file_path');
      return json(key !== null && (user.visibleKeys ?? []).includes(key) ? [{ id: uuid() }] : []);
    }
    if (path === '/rest/v1/rfqs') {
      const number = eqParam(url, 'rfq_number');
      return json(up.seed.rfqs.filter((r) => r.rfq_number === number).map((r) => ({ id: r.id, customer_id: r.customer_id, created_at: r.created_at })));
    }
    if (path === '/rest/v1/customers') {
      const id = eqParam(url, 'id');
      return json(up.seed.customers.filter((c) => c.id === id).map((c) => ({ email: c.email })));
    }
    if (path === '/rest/v1/production_partners') {
      const email = eqParam(url, 'email');
      const activeOnly = url.searchParams.get('active') === 'eq.true';
      return json(up.seed.partners.filter((p) => p.email === email && (!activeOnly || p.active)).map(() => ({ id: uuid() })));
    }
    if (path === '/rest/v1/marketing_events') {
      const id = eqParam(url, 'id');
      const cid = eqParam(url, 'campaign_id');
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if ((id && !uuidRe.test(id)) || (cid && !uuidRe.test(cid))) return json({ code: '22P02', message: 'invalid input syntax for type uuid' }, 400);
      return json(up.seed.sentEvents.filter((e) => e.id === id && e.campaign_id === cid).map((e) => ({ id: e.id })));
    }
    if (path === '/rest/v1/marketing_campaigns') {
      const id = eqParam(url, 'id');
      return json(up.seed.campaigns.filter((c) => c.id === id).map((c) => ({ body: c.body })));
    }
    return json({ message: `unexpected path ${path}` }, 404);
  };

  vi.stubGlobal('fetch', vi.fn(handler));
  return up;
}

export function bearer(user: { token: string }): Record<string, string> {
  return { authorization: `Bearer ${user.token}` };
}

/** Body of a Response as text. */
export async function bodyText(response: Response): Promise<string> {
  return new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()));
}

export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
