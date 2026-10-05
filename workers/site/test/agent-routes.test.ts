// /api/agent/* through the whole site Worker (src/index.ts -> handleApi -> routeApi -> applyGate -> OPS): the five
// actions and their methods, the answers the site gives itself (404 unknown action, 405 with Allow, 413 above
// 65,536 bytes; never dispatched), Cache-Control: no-store on every agent answer, the OpsCall handed to microns-ops
// (endpoint 'agent', action, principal, function URL; relay headers never forwarded to ops), and the rule that
// /api/agent/* is never forwarded to Vercel, whatever api.forward_to_vercel or API_FORWARD_TO_VERCEL say.
// Upstreams (Supabase Auth, PostgREST) are the fakes of ./gate-support.ts.

import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsCall } from '../../shared/src/http/rpc';
import { endpointOfPath, isAgentPath, resolveApi } from '../src/api/resolve';
import { neverForwarded, shouldForward, NEVER_FORWARDED_PREFIXES } from '../src/api/forward';
import { AGENT_BODY_MAX_BYTES } from '../src/api/router';
import type { Env } from '../src/env';
import worker from '../src/index';
import { bearer, installUpstream, makeEnv as gateEnv, type FakeUser, type Upstream } from './gate-support';
import { MemoryKV, TestContext } from './helpers/kv';

// node:crypto loaded by a variable specifier (the Workers type set of this package declares only part of it).
const NODE_CRYPTO: string = 'node:crypto';
interface NodeCrypto {
  createHmac(algorithm: string, key: string | Uint8Array): { update(data: string): { digest(encoding: 'hex' | 'base64url'): string } };
  hkdfSync(digest: string, ikm: string, salt: Uint8Array, info: string, length: number): ArrayBuffer;
}
let nodeCrypto: NodeCrypto;
beforeAll(async () => {
  nodeCrypto = (await import(/* @vite-ignore */ NODE_CRYPTO)) as NodeCrypto;
});


const SITE = 'https://www.micronshub.eu';
const SECRET = ['relay', 'test', 'value', 'not', 'secret'].join('-');
const RUN = '5d6e7f80-91a2-4b3c-8d4e-5f6a7b8c9d0e';
const HASH = 'a'.repeat(64);
const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface OpsSeen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  call: OpsCall;
}

let up: Upstream;
let staff: FakeUser;
let admin: FakeUser;
let opsSeen: OpsSeen[];
let upstreamHits: string[];
let flags: MemoryKV;

function opsBinding() {
  return {
    handle: vi.fn(async (request: Request, call: OpsCall) => {
      opsSeen.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body: await request.text(), call });
      return new Response(JSON.stringify({ v: 1, ok: true, from: 'ops' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
    fetch: vi.fn(),
  };
}

function env(over: Record<string, unknown> = {}): Env {
  return {
    ...gateEnv(),
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) } as unknown as Fetcher,
    SEO_CACHE: new MemoryKV().asBinding(),
    FLAGS: flags.asBinding(),
    PREVIEW_HOSTNAMES: '',
    SEO_STRICT_404: 'false',
    DIRECTORY_INDEX_EMULATION: 'true',
    API_FORWARD_ORIGIN: 'https://upstream.example.test',
    OPS: opsBinding(),
    AGENT_APPROVAL_SECRET: SECRET,
    ...over,
  } as unknown as Env;
}

async function call(path: string, init: RequestInit = {}, e: Env = env()): Promise<Response> {
  return worker.fetch(new Request(`${SITE}${path}`, init), e, new TestContext().asContext());
}

function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

function signed(body: string, ts = Math.floor(Date.now() / 1000)): Record<string, string> {
  return {
    'X-Microns-Timestamp': String(ts),
    'X-Microns-Signature': nodeCrypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex'),
  };
}

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  up = await installUpstream();
  // The fake upstream answers Supabase; any other host is recorded as a forward attempt.
  const supabase = globalThis.fetch;
  upstreamHits = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://upstream.example.test')) {
      upstreamHits.push(url);
      return new Response('vercel', { status: 200 });
    }
    return supabase(input, init);
  }));
  staff = await up.addUser(['sales_rep']);
  admin = await up.addUser(['admin']);
  opsSeen = [];
  flags = new MemoryKV();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolver: endpoint agent', () => {
  it('every path under /api/agent/ (canonical spelling) is the agent endpoint; the catalogue keeps its paths', () => {
    for (const path of ['/api/agent/decision', '/api/agent/status', '/api/agent/x/y', '/api/agent/', '/api/agent', '/api/Agent/Status', '/api/agent//file', '/api/agent/decision.js', '/api/x/../agent/flag']) {
      expect(endpointOfPath(path), path).toBe('agent');
      expect(isAgentPath(path), path).toBe(true);
    }
    for (const path of ['/api/agents', '/api/agentx/decision', '/api/emails', '/api/agent-decision']) expect(isAgentPath(path), path).toBe(false);
    expect(endpointOfPath('/api/emails')).toBe('emails');
    expect(endpointOfPath('/api/agents')).toBeNull();
  });

  it('actions, methods and sentinels; the function URL keeps the query', () => {
    const r = (method: string, path: string) => resolveApi(new Request(`${SITE}${path}`, { method }), new Uint8Array(0));
    expect(r('POST', '/api/agent/decision')).toMatchObject({ endpoint: 'agent', action: 'decision', functionUrl: '/api/agent/decision' });
    expect(r('GET', '/api/agent/status')).toMatchObject({ action: 'status', functionUrl: '/api/agent/status' });
    expect(r('POST', '/api/agent/flag').action).toBe('flag');
    expect(r('POST', '/api/agent/start').action).toBe('start');
    expect(r('GET', '/api/agent/file?k=a&exp=1&sig=b')).toMatchObject({ action: 'file', functionUrl: '/api/agent/file?k=a&exp=1&sig=b', query: { k: 'a', exp: '1', sig: 'b' } });
    expect(r('GET', '/api/agent/decision').action).toBe('#method');
    expect(r('POST', '/api/agent/status').action).toBe('#method');
    expect(r('OPTIONS', '/api/agent/start').action).toBe('#method');
    expect(r('GET', '/api/agent/other').action).toBe('#unknown');
    expect(r('GET', '/api/agent/status/x').action).toBe('#unknown');
    expect(r('GET', '/api/agent').action).toBe('#unknown');
  });
});

describe('answers given by the site (never dispatched)', () => {
  it('unknown action -> 404 {"error":"not_found"}, no-store, ops not called', async () => {
    for (const path of ['/api/agent/other', '/api/agent', '/api/agent/', '/api/agent/status/extra']) {
      const res = await call(path, { headers: bearer(staff) });
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(opsSeen).toHaveLength(0);
  });

  it('known action with another method -> 405 with Allow, ops not called', async () => {
    const cases: Array<[string, string, string]> = [
      ['GET', '/api/agent/decision', 'POST'], ['POST', '/api/agent/status', 'GET'], ['GET', '/api/agent/flag', 'POST'],
      ['PUT', '/api/agent/start', 'POST'], ['DELETE', '/api/agent/file', 'GET'], ['OPTIONS', '/api/agent/decision', 'POST'],
    ];
    for (const [method, path, allow] of cases) {
      const res = await call(path, { method, headers: bearer(staff) });
      expect([method, path, res.status]).toEqual([method, path, 405]);
      expect(res.headers.get('allow')).toBe(allow);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'method_not_allowed' });
    }
    expect(opsSeen).toHaveLength(0);
  });

  it('a body above 65,536 bytes -> 413 before the gate; exactly 65,536 bytes reaches the gate', async () => {
    const over = `{"v":1,"pad":"${'x'.repeat(AGENT_BODY_MAX_BYTES)}"}`;
    const res = await call('/api/agent/decision', post(over, bearer(staff)));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(up.calls).toHaveLength(0);

    const exact = `{"v":1,"pad":"${'x'.repeat(AGENT_BODY_MAX_BYTES - 16)}"}`;
    expect(new TextEncoder().encode(exact).byteLength).toBe(AGENT_BODY_MAX_BYTES);
    const atLimit = await call('/api/agent/decision', post(exact, bearer(staff)));
    expect(atLimit.status).toBe(400);
    expect(await atLimit.json()).toEqual({ error: 'bad_request' });
    expect(opsSeen).toHaveLength(0);
  });

  it('gate refusals carry no-store too', async () => {
    const res = await call('/api/agent/status');
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('dispatch to microns-ops', () => {
  it('status: staff session -> OpsCall {endpoint agent, action status, principal STAFF}; answer with no-store', async () => {
    const res = await call('/api/agent/status', { headers: bearer(staff) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ v: 1, ok: true, from: 'ops' });
    expect(opsSeen).toHaveLength(1);
    expect(opsSeen[0].call).toMatchObject({ v: 1, endpoint: 'agent', action: 'status', functionUrl: '/api/agent/status', principal: { class: 'STAFF', uid: staff.uid } });
    expect(new URL(opsSeen[0].url).pathname).toBe('/api/agent/status');
  });

  it('dashboard decision -> AG-1 principal, body passed unchanged', async () => {
    const body = { v: 1, run_id: RUN, token_sha256: HASH, verb: 'approve' };
    const res = await call('/api/agent/decision', post(body, bearer(staff)));
    expect(res.status).toBe(200);
    expect(opsSeen[0].call).toMatchObject({ action: 'decision', principal: { class: 'STAFF' } });
    expect(JSON.parse(opsSeen[0].body)).toEqual(body);
  });

  it('relay decision -> MACHINE telegram principal; the relay headers never reach ops', async () => {
    const body = JSON.stringify({ v: 1, token: TOKEN, code: 'dis', tg: { user_id: 7, chat_id: 7, message_id: 9 } });
    const res = await call('/api/agent/decision', post(body, signed(body)));
    expect(res.status).toBe(200);
    expect(opsSeen[0].call.principal).toEqual({ class: 'MACHINE', machine: 'telegram' });
    expect(Object.keys(opsSeen[0].headers).filter((h) => h.startsWith('x-microns-'))).toEqual([]);
    expect(opsSeen[0].body).toBe(body);
  });

  it('flag, start and file reach ops with their actions; the file query is kept', async () => {
    await call('/api/agent/flag', post({ v: 1, key: 'agent.quote', expected_rev: 3, enabled: true }, bearer(admin)));
    await call('/api/agent/start', post({ v: 1, kind: 'quote', rfq_id: RUN }, bearer(staff)));
    await call(`/api/agent/file?k=quotes/${RUN}/v1/quote.pdf`, { headers: bearer(staff) });
    expect(opsSeen.map((s) => [s.call.action, s.call.functionUrl])).toEqual([
      ['flag', '/api/agent/flag'],
      ['start', '/api/agent/start'],
      ['file', `/api/agent/file?k=quotes/${RUN}/v1/quote.pdf`],
    ]);
  });

  it('OPS binding missing -> 500 for agent requests only after the site answered its own cases', async () => {
    const e = env({ OPS: undefined });
    expect((await call('/api/agent/unknown', {}, e)).status).toBe(404);
    const res = await call('/api/agent/status', { headers: bearer(staff) }, e);
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('never forwarded to Vercel', () => {
  it('shouldForward is false under /api/agent/ with the flag on (all paths) and with the var', async () => {
    flags.store.set('api.forward_to_vercel', JSON.stringify({ enabled: true }));
    const e = env();
    expect(await shouldForward(e, new URL(`${SITE}/api/agent/decision`))).toBe(false);
    expect(await shouldForward(e, new URL(`${SITE}/api/Agent/status/`))).toBe(false);
    expect(await shouldForward(e, new URL(`${SITE}/api/agent`))).toBe(false);
    expect(await shouldForward(e, new URL(`${SITE}/api/emails`))).toBe(true);
    flags.store.set('api.forward_to_vercel', JSON.stringify({ enabled: true, value: { paths: ['/api/agent/decision'] } }));
    expect(await shouldForward(e, new URL(`${SITE}/api/agent/decision`))).toBe(false);
    flags.store.clear();
    const viaVar = env({ API_FORWARD_TO_VERCEL: 'true' });
    expect(await shouldForward(viaVar, new URL(`${SITE}/api/agent/status`))).toBe(false);
    expect(await shouldForward(viaVar, new URL(`${SITE}/api/tenders`))).toBe(true);
    expect(NEVER_FORWARDED_PREFIXES).toEqual(['/api/agent/']);
    expect(neverForwarded('/api/agents')).toBe(false);
  });

  it('with the flag on every /api/agent/* request is answered by the site or ops, never by the upstream', async () => {
    flags.store.set('api.forward_to_vercel', JSON.stringify({ enabled: true }));
    const e = env();
    expect((await call('/api/agent/status', { headers: bearer(staff) }, e)).status).toBe(200);
    expect((await call('/api/agent/other', {}, e)).status).toBe(404);
    expect((await call('/api/agent/decision', { method: 'GET' }, e)).status).toBe(405);
    expect(upstreamHits).toEqual([]);
    expect(opsSeen).toHaveLength(1);
    // A catalogue path still follows the flag.
    expect(await (await call('/api/tenders', {}, e)).text()).toBe('vercel');
    expect(upstreamHits).toHaveLength(1);
  });
});
