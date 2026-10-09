// Phase 5 (unit M5), /api/marketing?action=send-campaign through the whole site Worker (src/index.ts -> handleApi ->
// routeApi -> applyGate -> OPS): the resolver gives the action for every method, the gate (MK-8) answers 405 with
// Allow: POST for any method but POST and never dispatches it, POST needs a STAFF or ADMIN session (401 / 403
// otherwise, no machine caller), the rate key is u:<uid>:send-campaign on API_RATE_LIMIT, and the OpsCall handed to
// microns-ops carries endpoint 'marketing', action 'send-campaign', the session principal and the function URL.
// /api/track with the action resolves the same way (vercel.json rewrite). Every other marketing action keeps its
// Phase 2 resolution. Upstreams (Supabase Auth, PostgREST, Access certs) are the fakes of ./gate-support.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsCall } from '../../shared/src/http/rpc';
import { bindingFor, rateKey } from '../../shared/src/auth/rate-limit';
import { resolveApi } from '../src/api/resolve';
import { ENDPOINT_TARGETS, targetOf } from '../src/api/router';
import { actionIdOf, applyGate } from '../src/auth/gate';
import { ACTION_RULES, machinesFor, userScopeOf } from '../src/auth/policy';
import type { Env } from '../src/env';
import worker from '../src/index';
import { apiCall, bearer, ctx, fakeLimiter, installUpstream, makeEnv as gateEnv, MCP_ID, type FakeLimiter, type FakeUser, type Upstream } from './gate-support';
import { MemoryKV, TestContext } from './helpers/kv';

const SITE = 'https://www.micronshub.eu';
const CAMPAIGN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

interface OpsSeen {
  url: string;
  method: string;
  body: string;
  call: OpsCall;
}

let up: Upstream;
let users: Record<'CUSTOMER' | 'PARTNER' | 'STAFF' | 'ADMIN', FakeUser>;
let opsSeen: OpsSeen[];
let limiter: FakeLimiter;
let upstreamHits: string[];

function opsBinding() {
  return {
    handle: vi.fn(async (request: Request, call: OpsCall) => {
      opsSeen.push({ url: request.url, method: request.method, body: await request.text(), call });
      return new Response(JSON.stringify({ queued: 2, run_id: '0f8fad5b-d9cb-469f-a165-70867728950e' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }),
    fetch: vi.fn(),
  };
}

function env(over: Record<string, unknown> = {}): Env {
  return {
    ...gateEnv({ API_RATE_LIMIT: limiter } as never),
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) } as unknown as Fetcher,
    SEO_CACHE: new MemoryKV().asBinding(),
    FLAGS: new MemoryKV().asBinding(),
    PREVIEW_HOSTNAMES: '',
    SEO_STRICT_404: 'false',
    DIRECTORY_INDEX_EMULATION: 'true',
    API_FORWARD_ORIGIN: 'https://upstream.example.test',
    OPS: opsBinding(),
    ...over,
  } as unknown as Env;
}

async function call(path: string, init: RequestInit = {}, e: Env = env()): Promise<Response> {
  return worker.fetch(new Request(`${SITE}${path}`, init), e, new TestContext().asContext());
}

function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  up = await installUpstream();
  const supabase = globalThis.fetch;
  upstreamHits = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://upstream.example.test')) {
      upstreamHits.push(url);
      return new Response('{"error":"Invalid action. Use: track, webhook, google-auth, apollo-enrich"}', { status: 400 });
    }
    return supabase(input, init);
  }));
  users = {
    CUSTOMER: await up.addUser(['customer']),
    PARTNER: await up.addUser(['partner_seller']),
    STAFF: await up.addUser(['sales_rep']),
    ADMIN: await up.addUser(['admin']),
  };
  opsSeen = [];
  limiter = fakeLimiter(30);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolver and policy', () => {
  it('send-campaign resolves to the action for every method, on /api/marketing and /api/track; target ops', () => {
    for (const method of ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      const body = method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify({ campaign_id: CAMPAIGN });
      const r = resolveApi(new Request(`${SITE}/api/marketing?action=send-campaign`, { method, body, headers: { 'content-type': 'application/json' } }), new TextEncoder().encode(body ?? ''));
      expect([method, r.endpoint, r.action, r.functionUrl, targetOf(r), actionIdOf(r)]).toEqual([method, 'marketing', 'send-campaign', '/api/marketing?action=send-campaign', 'ops', 'MK-8']);
    }
    const track = resolveApi(new Request(`${SITE}/api/track?action=send-campaign`, { method: 'POST' }), new Uint8Array(0));
    expect([track.endpoint, track.action, track.functionUrl, actionIdOf(track)]).toEqual(['marketing', 'send-campaign', '/api/marketing?action=send-campaign', 'MK-8']);
    expect(ENDPOINT_TARGETS.marketing).toBe('by-action');
  });

  it('MK-8: staff access, no machine caller, rate scope send-campaign on the default binding', () => {
    expect(ACTION_RULES['MK-8']).toEqual({ access: 'staff', userScope: 'send-campaign' });
    expect(machinesFor('MK-8', 'send-campaign')).toEqual([]);
    const key = rateKey('u', 'uid', userScopeOf('MK-8', 'POST')!);
    expect(key).toBe('u:uid:send-campaign');
    expect(bindingFor(key)).toBe('default');
  });

  it('the other marketing actions keep their Phase 2 resolution', () => {
    const r = (q: string, method = 'GET') => resolveApi(new Request(`${SITE}/api/marketing${q}`, { method }), new Uint8Array(0));
    expect(r('?action=track&type=open').action).toBe('track');
    expect(r('?action=bogus').action).toBe('#unknown');
    expect(r('?action=send-campaigns').action).toBe('#unknown');
    expect(r('?action=Send-Campaign').action).toBe('#unknown');
    expect(r('?action=send-campaign&action=send-campaign').action).toBe('#unknown');
    expect(r('?action=apollo-enrich').action).toBe('#method');
  });
});

describe('gate MK-8', () => {
  async function gate(method: string, headers: Record<string, string> = {}) {
    const { r, request } = apiCall({ endpoint: 'marketing', action: 'send-campaign', functionUrl: '/api/marketing?action=send-campaign', method, headers, body: method === 'GET' ? undefined : { campaign_id: CAMPAIGN } });
    return applyGate(r, request, gateEnv({ API_RATE_LIMIT: limiter } as never), ctx);
  }

  it('POST: anonymous 401, customer and partner 403, staff and admin allowed with their principal', async () => {
    const anon = await gate('POST');
    expect(anon.kind).toBe('deny');
    expect(anon.kind === 'deny' && anon.response.status).toBe(401);
    for (const who of ['CUSTOMER', 'PARTNER'] as const) {
      const out = await gate('POST', bearer(users[who]));
      expect([who, out.kind, out.kind === 'deny' ? out.response.status : 0]).toEqual([who, 'deny', 403]);
    }
    for (const who of ['STAFF', 'ADMIN'] as const) {
      const out = await gate('POST', bearer(users[who]));
      expect(out.kind).toBe('allow');
      if (out.kind === 'allow') expect([out.actionId, out.principal.class, out.principal.uid]).toEqual(['MK-8', who, users[who].uid]);
    }
  });

  it('a machine caller (Access service token) is refused with 403', async () => {
    const assertion = await up.machineAssertion(MCP_ID);
    const { r, request } = apiCall({ endpoint: 'marketing', action: 'send-campaign', functionUrl: '/api/marketing?action=send-campaign', method: 'POST', body: { campaign_id: CAMPAIGN }, headers: { 'cf-access-jwt-assertion': assertion, 'cf-access-client-id': MCP_ID } });
    const out = await applyGate(r, request, gateEnv({ API_RATE_LIMIT: limiter } as never), ctx);
    expect(out.kind === 'deny' ? out.response.status : out.kind).toBe(403);
  });

  it('any method but POST: 405 method_not_allowed with Allow: POST, before any credential is looked at', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const callsBefore = up.calls.length;
      const out = await gate(method, bearer(users.STAFF));
      expect(out.kind).toBe('deny');
      if (out.kind !== 'deny') continue;
      expect([method, out.response.status, out.response.headers.get('allow'), await out.response.json()]).toEqual([method, 405, 'POST', { error: 'method_not_allowed' }]);
      expect(up.calls.length).toBe(callsBefore);
    }
    expect(limiter.counts.size).toBe(0);
  });

  it('counts against u:<uid>:send-campaign; the 31st call within the window answers 429', async () => {
    for (let i = 0; i < 30; i++) expect((await gate('POST', bearer(users.STAFF))).kind).toBe('allow');
    expect([...limiter.counts.entries()]).toEqual([[`u:${users.STAFF.uid}:send-campaign`, 30]]);
    const limited = await gate('POST', bearer(users.STAFF));
    expect(limited.kind === 'deny' ? [limited.response.status, limited.response.headers.get('retry-after')] : limited.kind).toEqual([429, '60']);
  });
});

describe('through the site Worker', () => {
  it('POST as staff reaches microns-ops with the marketing endpoint, the action, the principal and the body as sent', async () => {
    const res = await call('/api/marketing?action=send-campaign', post({ campaign_id: CAMPAIGN }, bearer(users.STAFF)));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: 2, run_id: '0f8fad5b-d9cb-469f-a165-70867728950e' });
    expect(opsSeen).toHaveLength(1);
    const seen = opsSeen[0]!;
    expect(seen.url).toBe(`${SITE}/api/marketing?action=send-campaign`);
    expect(seen.method).toBe('POST');
    expect(JSON.parse(seen.body)).toEqual({ campaign_id: CAMPAIGN });
    expect(seen.call).toMatchObject({ v: 1, endpoint: 'marketing', action: 'send-campaign', functionUrl: '/api/marketing?action=send-campaign', principal: { class: 'STAFF', uid: users.STAFF.uid } });
    expect(upstreamHits).toEqual([]);
  });

  it('GET, PUT and OPTIONS answer 405 at the site and never reach ops or Vercel', async () => {
    for (const method of ['GET', 'PUT', 'OPTIONS']) {
      const res = await call('/api/marketing?action=send-campaign', { method, headers: bearer(users.STAFF) });
      expect([method, res.status, res.headers.get('allow')]).toEqual([method, 405, 'POST']);
      expect(await res.json()).toEqual({ error: 'method_not_allowed' });
    }
    expect(opsSeen).toEqual([]);
    expect(upstreamHits).toEqual([]);
  });

  it('without a session 401, as a customer 403; nothing dispatched', async () => {
    expect((await call('/api/marketing?action=send-campaign', post({ campaign_id: CAMPAIGN }))).status).toBe(401);
    expect((await call('/api/marketing?action=send-campaign', post({ campaign_id: CAMPAIGN }, bearer(users.CUSTOMER)))).status).toBe(403);
    expect(opsSeen).toEqual([]);
  });

  it('with api.forward_to_vercel on, the action goes to Vercel unchanged (its 400 there is the dashboard fallback signal)', async () => {
    const flags = new MemoryKV();
    flags.store.set('api.forward_to_vercel', JSON.stringify({ enabled: true }));
    const res = await call('/api/marketing?action=send-campaign', post({ campaign_id: CAMPAIGN }, bearer(users.STAFF)), env({ FLAGS: flags.asBinding() }));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/^\{"error":"Invalid action/);
    expect(opsSeen).toEqual([]);
    expect(upstreamHits).toEqual(['https://upstream.example.test/api/marketing?action=send-campaign']);
  });
});
