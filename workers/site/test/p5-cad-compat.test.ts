// Phase 5 (unit M5), the site half of the CAD compat path /api/cad/<token>/flat-pattern (action CD-1): the endpoint
// 'cad-compat' is matched by the /api/cad/ prefix before the catalogue (which keeps its 13 paths); only the exact path
// shape with a 32-128 character token and POST reaches microns-ops, every other /api/cad/* path answers 404 and every
// other method 405 at the site; the token must equal CAD_COMPAT_TOKEN (constant-time compare of SHA-256 digests; a
// missing secret answers 500 for that request only); the principal is MACHINE:cad-compat and the rate key
// m:cad-compat; the token never reaches microns-ops (function URL /api/cad/flat-pattern, request URL, OpsCall) nor a
// log line; /api/cad/* is never forwarded to Vercel, whatever api.forward_to_vercel or API_FORWARD_TO_VERCEL say.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindingFor, rateKey } from '../../shared/src/auth/rate-limit';
import type { OpsCall } from '../../shared/src/http/rpc';
import { neverForwarded, NEVER_FORWARDED_P5_PREFIXES, shouldForward } from '../src/api/forward';
import { CAD_COMPAT_FUNCTION_URL, CATALOGUE_PATHS, cadCompatTokenOf, endpointOfPath, isCadPath, resolveApi } from '../src/api/resolve';
import { ENDPOINT_TARGETS, targetOf } from '../src/api/router';
import { checkCadCompatToken, type CadCompatEnv } from '../src/auth/cad-compat';
import { actionIdOf } from '../src/auth/gate';
import { ACTION_RULES, ALL_ACTION_IDS } from '../src/auth/policy';
import type { Env } from '../src/env';
import worker from '../src/index';
import { fakeLimiter, installUpstream, makeEnv as gateEnv, type FakeLimiter } from './gate-support';
import { MemoryKV, TestContext } from './helpers/kv';

const SITE = 'https://www.micronshub.eu';
// Test values built at runtime (URL-safe, 48 characters); never a real token.
const TOKEN = ['t2', 'compat', 'value', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-').slice(0, 48);
const OTHER = `${TOKEN.slice(0, -1)}X`;
const PATH = `/api/cad/${TOKEN}/flat-pattern`;
const BODY = JSON.stringify({ file_url: 'https://files.example.test/rfq/a.step', file_name: 'a.step', part_info: { material: 'S235', thickness: 2 } });

interface OpsSeen {
  url: string;
  method: string;
  body: string;
  call: OpsCall;
}

let opsSeen: OpsSeen[];
let upstreamHits: string[];
let limiter: FakeLimiter;
let lines: string[];
let flags: MemoryKV;
let answer: Response | (() => Response | Promise<Response>);

function opsBinding() {
  return {
    handle: vi.fn(async (request: Request, call: OpsCall) => {
      opsSeen.push({ url: request.url, method: request.method, body: await request.text(), call });
      return typeof answer === 'function' ? answer() : answer.clone();
    }),
    fetch: vi.fn(),
  };
}

function env(over: Record<string, unknown> = {}): Env {
  return {
    ...gateEnv({ API_RATE_LIMIT: limiter } as never),
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) } as unknown as Fetcher,
    SEO_CACHE: new MemoryKV().asBinding(),
    FLAGS: flags.asBinding(),
    PREVIEW_HOSTNAMES: '',
    SEO_STRICT_404: 'false',
    DIRECTORY_INDEX_EMULATION: 'true',
    API_FORWARD_ORIGIN: 'https://upstream.example.test',
    OPS: opsBinding(),
    CAD_COMPAT_TOKEN: TOKEN,
    ...over,
  } as unknown as Env;
}

async function call(path: string, init: RequestInit = {}, e: Env = env()): Promise<Response> {
  return worker.fetch(new Request(`${SITE}${path}`, init), e, new TestContext().asContext());
}

function post(body: string = BODY, headers: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body };
}

beforeEach(async () => {
  lines = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  await installUpstream();
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
  opsSeen = [];
  limiter = fakeLimiter(30);
  flags = new MemoryKV();
  answer = new Response('0\nSECTION\n', { status: 200, headers: { 'content-type': 'application/dxf' } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectNoToken(): void {
  for (const line of lines) expect(line.includes(TOKEN), line).toBe(false);
  for (const seen of opsSeen) {
    expect(seen.url.includes(TOKEN)).toBe(false);
    expect(JSON.stringify(seen.call).includes(TOKEN)).toBe(false);
  }
}

describe('resolver, router table and policy', () => {
  it('the /api/cad/ prefix names the cad-compat endpoint before the catalogue, which keeps its 13 paths', () => {
    for (const path of [PATH, '/api/cad', '/api/cad/', '/api/cad/x', '/API/Cad/x/flat-pattern', '/api//cad/x', '/api/x/../cad/y']) {
      expect([path, endpointOfPath(path), isCadPath(path)]).toEqual([path, 'cad-compat', true]);
    }
    for (const path of ['/api/cadx', '/api/cads/x', '/api/marketing', '/api/agent/status']) expect([path, isCadPath(path)]).toEqual([path, false]);
    expect(CATALOGUE_PATHS).toHaveLength(13);
    expect(CATALOGUE_PATHS.some((p) => p.startsWith('/api/cad'))).toBe(false);
    expect(ENDPOINT_TARGETS['cad-compat']).toBe('ops');
  });

  it('only the exact path shape with a 32-128 character [A-Za-z0-9_-] token carries a token', () => {
    expect(cadCompatTokenOf(PATH)).toBe(TOKEN);
    expect(cadCompatTokenOf(`/api/cad/${'a'.repeat(32)}/flat-pattern`)).toBe('a'.repeat(32));
    expect(cadCompatTokenOf(`/api/cad/${'A_-9'.repeat(32)}/flat-pattern`)).toBe('A_-9'.repeat(32));
    for (const path of [
      `/api/cad/${'a'.repeat(31)}/flat-pattern`,
      `/api/cad/${'a'.repeat(129)}/flat-pattern`,
      `/api/cad/${TOKEN}/flat-pattern/`,
      `/api/cad/${TOKEN}/flat-pattern.js`,
      `/api/cad/${TOKEN}/other`,
      `/api/cad/${TOKEN}`,
      `/api/cad/${TOKEN}.x/flat-pattern`,
      `/api/cad/%41${TOKEN}/flat-pattern`,
      `/api/cad/x/${TOKEN}/flat-pattern`,
      `/API/cad/${TOKEN}/flat-pattern`,
      '/api/cad/flat-pattern',
    ]) expect([path, cadCompatTokenOf(path)]).toEqual([path, null]);
  });

  it('resolution: POST -> flat-pattern, other methods -> method-not-allowed, other shapes -> not-found; function URL without token or query', () => {
    const r = (path: string, method = 'POST') => resolveApi(new Request(`${SITE}${path}`, { method, body: method === 'GET' || method === 'HEAD' ? undefined : BODY, headers: { 'content-type': 'application/json' } }), new TextEncoder().encode(BODY));
    const ok = r(`${PATH}?debug=1`);
    expect([ok.endpoint, ok.action, ok.functionUrl, ok.method, targetOf(ok), actionIdOf(ok)]).toEqual(['cad-compat', 'flat-pattern', CAD_COMPAT_FUNCTION_URL, 'POST', 'ops', 'CD-1']);
    expect(ok.functionUrl).toBe('/api/cad/flat-pattern');
    expect(ok.query).toEqual({});
    expect(new TextDecoder().decode(ok.bodyBytes)).toBe(BODY);
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) expect([method, r(PATH, method).action]).toEqual([method, 'method-not-allowed']);
    for (const path of ['/api/cad', '/api/cad/x/flat-pattern', `/api/cad/${TOKEN}/other`]) {
      const res = r(path);
      expect([path, res.action, res.functionUrl, actionIdOf(res)]).toEqual([path, 'not-found', CAD_COMPAT_FUNCTION_URL, 'CD-1']);
    }
  });

  it('CD-1: access cad-token, no user scope, machine rate key m:cad-compat on the default binding', () => {
    expect(ACTION_RULES['CD-1']).toEqual({ access: 'cad-token' });
    expect(ALL_ACTION_IDS).toContain('CD-1');
    expect(rateKey('m', 'cad-compat')).toBe('m:cad-compat');
    expect(bindingFor(rateKey('m', 'cad-compat'))).toBe('default');
  });
});

describe('checkCadCompatToken', () => {
  const cenv = (value: unknown) => ({ CAD_COMPAT_TOKEN: value }) as unknown as CadCompatEnv;

  it('ok for the configured value only; mismatch for any other value, length or case', async () => {
    expect(await checkCadCompatToken(cenv(TOKEN), TOKEN)).toBe('ok');
    for (const candidate of [OTHER, TOKEN.toUpperCase(), `${TOKEN}a`, TOKEN.slice(1), '', ' ', 'x'.repeat(200)]) {
      expect([candidate.length, await checkCadCompatToken(cenv(TOKEN), candidate)]).toEqual([candidate.length, 'mismatch']);
    }
  });

  it('not_configured when the secret is missing or empty, and then nothing is hashed or compared', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest');
    for (const value of [undefined, null, '']) expect(await checkCadCompatToken(cenv(value), TOKEN)).toBe('not_configured');
    expect(await checkCadCompatToken(cenv(''), '')).toBe('not_configured');
    expect(digest).not.toHaveBeenCalled();
  });

  it('compares the SHA-256 digests of both values (fixed length), never the raw strings', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest');
    expect(await checkCadCompatToken(cenv(TOKEN), 'short')).toBe('mismatch');
    expect(digest).toHaveBeenCalledTimes(2);
    expect(digest.mock.calls.every((c) => c[0] === 'SHA-256')).toBe(true);
  });
});

describe('through the site Worker', () => {
  it('a POST with the configured token reaches microns-ops as MACHINE:cad-compat, function URL without the token, body as sent', async () => {
    const res = await call(`${PATH}?x=1`, post());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/dxf');
    expect(await res.text()).toBe('0\nSECTION\n');
    expect(opsSeen).toHaveLength(1);
    const seen = opsSeen[0]!;
    expect(seen.url).toBe(`${SITE}/api/cad/flat-pattern`);
    expect(seen.method).toBe('POST');
    expect(seen.body).toBe(BODY);
    expect(seen.call).toEqual({
      v: 1,
      requestId: expect.any(String),
      endpoint: 'cad-compat',
      action: 'flat-pattern',
      functionUrl: '/api/cad/flat-pattern',
      principal: { class: 'MACHINE', machine: 'cad-compat' },
    });
    expect([...limiter.counts.entries()]).toEqual([['m:cad-compat', 1]]);
    expect(upstreamHits).toEqual([]);
    expectNoToken();
  });

  it('the answer of microns-ops passes unchanged (error statuses and FastAPI detail bodies included)', async () => {
    answer = new Response('{"detail":"CAD busy"}', { status: 503, headers: { 'content-type': 'application/json' } });
    const busy = await call(PATH, post());
    expect([busy.status, await busy.text()]).toEqual([503, '{"detail":"CAD busy"}']);
    answer = new Response('{"detail":"file_url host not allowed"}', { status: 400, headers: { 'content-type': 'application/json' } });
    const bad = await call(PATH, post());
    expect([bad.status, await bad.json()]).toEqual([400, { detail: 'file_url host not allowed' }]);
  });

  it('a wrong token answers 401 unauthorized and never reaches ops; nothing is counted against the compat rate key', async () => {
    for (const token of [OTHER, 'b'.repeat(32), 'Z'.repeat(128)]) {
      const res = await call(`/api/cad/${token}/flat-pattern`, post());
      expect([token.length, res.status, await res.json()]).toEqual([token.length, 401, { error: 'unauthorized' }]);
    }
    expect(opsSeen).toEqual([]);
    expect(limiter.counts.size).toBe(0);
    expectNoToken();
  });

  it('a missing CAD_COMPAT_TOKEN answers 500 text/plain for that request only, naming the secret but never the path', async () => {
    const res = await call(PATH, post(), env({ CAD_COMPAT_TOKEN: undefined }));
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('Internal Server Error');
    expect(opsSeen).toEqual([]);
    expect(lines.some((l) => l.includes('config missing: CAD_COMPAT_TOKEN'))).toBe(true);
    expectNoToken();
    // another endpoint is unaffected
    expect((await call('/api/agent/other', {}, env({ CAD_COMPAT_TOKEN: undefined }))).status).toBe(404);
  });

  it('any other method answers 405 with Allow: POST, before the token is checked; never dispatched', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      const res = await call(PATH, { method, body: method === 'GET' || method === 'OPTIONS' ? undefined : BODY }, env({ CAD_COMPAT_TOKEN: undefined }));
      expect([method, res.status, res.headers.get('allow')]).toEqual([method, 405, 'POST']);
      expect(await res.json()).toEqual({ error: 'method_not_allowed' });
    }
    expect(opsSeen).toEqual([]);
    expectNoToken();
  });

  it('every other /api/cad/* path answers 404 not_found at the site', async () => {
    // (an upper-case /API/ path never enters the API router at all, as on Vercel)
    for (const path of ['/api/cad', '/api/cad/', '/api/cad/flat-pattern', `/api/cad/${'a'.repeat(31)}/flat-pattern`, `/api/cad/${TOKEN}/other`, `/api/cad/${TOKEN}/flat-pattern/x`, `/api/CAD/${TOKEN}/flat-pattern`, `/api/cad/${TOKEN}/Flat-Pattern`]) {
      const res = await call(path, post());
      expect([path, res.status, await res.json()]).toEqual([path, 404, { error: 'not_found' }]);
    }
    expect(opsSeen).toEqual([]);
    expect(upstreamHits).toEqual([]);
  });

  it('the 31st call within the window answers 429 rate_limited', async () => {
    for (let i = 0; i < 30; i++) expect((await call(PATH, post())).status).toBe(200);
    const limited = await call(PATH, post());
    expect([limited.status, limited.headers.get('retry-after'), await limited.json()]).toEqual([429, '60', { error: 'rate_limited' }]);
    expect(opsSeen).toHaveLength(30);
  });

  it('an RPC failure of microns-ops answers the frozen 500 text/plain, and its log line carries no token', async () => {
    answer = () => {
      throw new Error(`ops down for ${SITE}/api/cad/flat-pattern`);
    };
    const res = await call(PATH, post());
    expect([res.status, await res.text()]).toEqual([500, 'Internal Server Error']);
    expect(lines.some((l) => l.includes('api ops call failed'))).toBe(true);
    expectNoToken();
  });

  it('the router log line names the endpoint and the action only', async () => {
    await call(PATH, post());
    const api = lines.filter((l) => l.includes('[microns-site] api'));
    expect(api.length).toBeGreaterThan(0);
    expect(api.some((l) => l.includes(' endpoint=cad-compat ') && l.includes(' action=flat-pattern ') && l.includes(' actionId=CD-1 '))).toBe(true);
    expectNoToken();
  });
});

describe('never forwarded to Vercel', () => {
  it('shouldForward is false under /api/cad/ with the flag on (all paths, listed paths) and with the var', async () => {
    expect(NEVER_FORWARDED_P5_PREFIXES).toEqual(['/api/cad/']);
    flags.store.set('api.forward_to_vercel', JSON.stringify({ enabled: true }));
    const e = env();
    for (const path of [PATH, '/api/cad', '/api/Cad/x/', '/api//cad/x']) {
      expect([path, neverForwarded(path), await shouldForward(e, new URL(`${SITE}${path}`))]).toEqual([path, true, false]);
    }
    expect(await shouldForward(e, new URL(`${SITE}/api/emails`))).toBe(true);
    flags.store.set('api.forward_to_vercel', JSON.stringify({ enabled: true, value: { paths: [PATH] } }));
    expect(await shouldForward(e, new URL(`${SITE}${PATH}`))).toBe(false);
    flags.store.clear();
    const viaVar = env({ API_FORWARD_TO_VERCEL: 'true' });
    expect(await shouldForward(viaVar, new URL(`${SITE}${PATH}`))).toBe(false);
    expect(await shouldForward(viaVar, new URL(`${SITE}/api/tenders`))).toBe(true);
    expect(neverForwarded('/api/cadx')).toBe(false);
  });

  it('with forwarding on, compat calls are still answered by the site or ops and the token never leaves for Vercel', async () => {
    flags.store.set('api.forward_to_vercel', JSON.stringify({ enabled: true }));
    expect((await call(PATH, post())).status).toBe(200);
    expect((await call('/api/cad/x', post())).status).toBe(404);
    expect((await call(PATH, { method: 'GET' })).status).toBe(405);
    expect(upstreamHits).toEqual([]);
    expect(opsSeen).toHaveLength(1);
    expectNoToken();
  });
});
