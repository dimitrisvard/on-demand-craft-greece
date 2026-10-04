// handleApi (src/api/forward.ts): the flag api.forward_to_vercel (KV FLAGS) and its var fallback
// API_FORWARD_TO_VERCEL decide between the forward to Vercel and the /api router; forwardToVercel with and
// without the buffered body; getFlagValue (src/flags.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/router', () => ({ routeApi: vi.fn() }));

import { FORWARD_FLAG_KEY, forwardHeaders, forwardToVercel, handleApi, HOP_BY_HOP, shouldForward } from '../src/api/forward';
import { routeApi } from '../src/api/router';
import type { Env } from '../src/env';
import { getFlag, getFlagValue } from '../src/flags';
import { MemoryKV, TestContext } from './helpers/kv';

const PREVIEW = 'https://microns-site.example.workers.dev';
const PROD = 'https://www.micronshub.eu';
const UPSTREAM = 'https://on-demand-craft-greece.vercel.app';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

let flags: MemoryKV;
let seen: Seen[];
let errors: string[];

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    ASSETS: {} as Fetcher,
    SEO_CACHE: new MemoryKV().asBinding(),
    FLAGS: flags.asBinding(),
    SUPABASE_URL: 'https://supabase.invalid',
    SUPABASE_ANON_KEY: 'dummy-not-a-secret',
    SITE_ORIGIN: PROD,
    PREVIEW_HOSTNAMES: '',
    SEO_STRICT_404: 'false',
    API_FORWARD_ORIGIN: UPSTREAM,
    DIRECTORY_INDEX_EMULATION: 'true',
    ...over,
  };
}

function setFlag(value: unknown): void {
  flags.store.set(FORWARD_FLAG_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

async function dispatch(url: string, env = makeEnv(), init: RequestInit = {}): Promise<'forward' | 'router'> {
  const res = await handleApi(new Request(url, init), env, new TestContext().asContext());
  const text = await res.text();
  if (text === 'upstream') return 'forward';
  if (text === 'routed') return 'router';
  throw new Error(`unexpected answer ${res.status} ${text}`);
}

beforeEach(() => {
  flags = new MemoryKV();
  seen = [];
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(' ')));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : new Uint8Array(await request.arrayBuffer());
    seen.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body });
    return new Response('upstream', { status: 200, headers: { 'X-Vercel-Id': 'fra1::abc' } });
  }));
  vi.mocked(routeApi).mockReset();
  vi.mocked(routeApi).mockImplementation(async () => new Response('routed'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('flag api.forward_to_vercel', () => {
  it('missing flag and missing var: the router', async () => {
    expect(await dispatch(`${PREVIEW}/api/gsc`)).toBe('router');
    expect(seen).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it('{"enabled":true}: every /api path and method is forwarded, OPTIONS included, never routed', async () => {
    setFlag({ enabled: true });
    expect(await dispatch(`${PREVIEW}/api/gsc`)).toBe('forward');
    expect(await dispatch(`${PROD}/api/emails`, makeEnv(), { method: 'OPTIONS' })).toBe('forward');
    expect(await dispatch(`${PREVIEW}/api/x`, makeEnv(), { method: 'POST', body: 'b' })).toBe('forward');
    expect(routeApi).not.toHaveBeenCalled();
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      `GET ${UPSTREAM}/api/gsc`,
      `OPTIONS ${UPSTREAM}/api/emails`,
      `POST ${UPSTREAM}/api/x`,
    ]);
  });

  it('{"enabled":false}: the router, even when the var says true', async () => {
    setFlag({ enabled: false });
    expect(await dispatch(`${PREVIEW}/api/gsc`, makeEnv({ API_FORWARD_TO_VERCEL: 'true' }))).toBe('router');
  });

  it('paths: only the listed public paths (exact match)', async () => {
    setFlag({ enabled: true, value: { paths: ['/api/gsc', '/api/track'] } });
    expect(await dispatch(`${PREVIEW}/api/gsc?action=x`)).toBe('forward');
    expect(await dispatch(`${PREVIEW}/api/track?type=open`)).toBe('forward');
    expect(await dispatch(`${PREVIEW}/api/tenders`)).toBe('router');
    expect(await dispatch(`${PREVIEW}/api/gsc/`)).toBe('router');
  });

  it('hosts preview: only preview hosts; hosts production: only the others', async () => {
    setFlag({ enabled: true, value: { hosts: ['preview'] } });
    expect(await dispatch(`${PREVIEW}/api/gsc`)).toBe('forward');
    expect(await dispatch('http://localhost:8787/api/gsc')).toBe('forward');
    expect(await dispatch(`${PROD}/api/gsc`)).toBe('router');
    expect(await dispatch('https://acme.micronshub.eu/api/gsc')).toBe('router');
    setFlag({ enabled: true, value: { hosts: ['production'] } });
    expect(await dispatch(`${PREVIEW}/api/gsc`)).toBe('router');
    expect(await dispatch(`${PROD}/api/gsc`)).toBe('forward');
  });

  it('paths and hosts combine with AND', async () => {
    setFlag({ enabled: true, value: { paths: ['/api/gsc'], hosts: ['preview'] } });
    expect(await dispatch(`${PREVIEW}/api/gsc`)).toBe('forward');
    expect(await dispatch(`${PREVIEW}/api/tenders`)).toBe('router');
    expect(await dispatch(`${PROD}/api/gsc`)).toBe('router');
  });

  it.each([
    ['enabled not a boolean', { enabled: 'true' }],
    ['no enabled', { value: { paths: ['/api/gsc'] } }],
    ['value not an object', { enabled: true, value: ['/api/gsc'] }],
    ['paths not strings', { enabled: true, value: { paths: [1] } }],
    ['paths not an array', { enabled: true, value: { paths: '/api/gsc' } }],
    ['unknown host kind', { enabled: true, value: { hosts: ['staging'] } }],
    ['a JSON array', [true]],
    ['a JSON string', 'true'],
  ])('malformed (%s) -> the var, logged', async (_label, value) => {
    setFlag(JSON.stringify(value));
    expect(await dispatch(`${PREVIEW}/api/gsc`, makeEnv({ API_FORWARD_TO_VERCEL: 'true' }))).toBe('forward');
    expect(await dispatch(`${PREVIEW}/api/gsc`, makeEnv({ API_FORWARD_TO_VERCEL: 'false' }))).toBe('router');
    expect(errors.some((e) => e.includes(`flag ${FORWARD_FLAG_KEY}: malformed value`))).toBe(true);
  });

  it('a KV failure -> the var, logged', async () => {
    flags.failGet = true;
    expect(await dispatch(`${PREVIEW}/api/gsc`, makeEnv({ API_FORWARD_TO_VERCEL: 'true' }))).toBe('forward');
    expect(await dispatch(`${PREVIEW}/api/gsc`)).toBe('router');
    expect(errors.some((e) => e.includes(`flag ${FORWARD_FLAG_KEY}: KV read failed`))).toBe(true);
  });

  it('var: "true" forwards; "false", empty, absent route silently; anything else routes and is logged', async () => {
    expect(await dispatch(`${PREVIEW}/api/gsc`, makeEnv({ API_FORWARD_TO_VERCEL: 'true' }))).toBe('forward');
    for (const value of ['false', '', undefined]) {
      expect(await dispatch(`${PREVIEW}/api/gsc`, makeEnv({ API_FORWARD_TO_VERCEL: value })), String(value)).toBe('router');
    }
    expect(errors).toEqual([]);
    for (const value of ['yes', 'TRUE', '1']) {
      expect(await dispatch(`${PREVIEW}/api/gsc`, makeEnv({ API_FORWARD_TO_VERCEL: value })), value).toBe('router');
    }
    expect(errors.filter((e) => e.includes('API_FORWARD_TO_VERCEL is neither'))).toHaveLength(3);
  });

  it('the flag is read with the 60 s KV edge cache', async () => {
    const get = vi.fn(async () => null);
    await shouldForward(makeEnv({ FLAGS: { get } as unknown as KVNamespace }), new URL(`${PREVIEW}/api/gsc`));
    expect(get).toHaveBeenCalledWith(FORWARD_FLAG_KEY, { type: 'json', cacheTtl: 60 });
  });

  it('the forward answer is Vercel\'s own (headers kept)', async () => {
    setFlag({ enabled: true });
    const res = await handleApi(new Request(`${PREVIEW}/api/gsc`), makeEnv(), new TestContext().asContext());
    expect(res.headers.get('x-vercel-id')).toBe('fra1::abc');
  });
});

describe('getFlagValue and getFlag', () => {
  it('returns the parsed value with only the known options', async () => {
    flags.store.set('k', JSON.stringify({ enabled: true, value: { paths: ['/a'], hosts: ['preview', 'production'], extra: 1 }, note: 'x' }));
    expect(await getFlagValue(makeEnv(), 'k')).toEqual({ enabled: true, value: { paths: ['/a'], hosts: ['preview', 'production'] } });
    flags.store.set('k', JSON.stringify({ enabled: false }));
    expect(await getFlagValue(makeEnv(), 'k')).toEqual({ enabled: false });
  });

  it('null for a missing key (not logged)', async () => {
    expect(await getFlagValue(makeEnv(), 'missing')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('getFlag (Phase 1) is unchanged', async () => {
    flags.store.set('seo.strict_404', JSON.stringify({ enabled: true }));
    expect(await getFlag(makeEnv(), 'seo.strict_404', false)).toBe(true);
    expect(await getFlag(makeEnv(), 'absent', true)).toBe(true);
  });
});

describe('forwardToVercel', () => {
  it('with buffered bytes: sends them as is and never reads the request body', async () => {
    const request = new Request(`${PREVIEW}/api/gsc?x=1`, { method: 'POST', body: 'original', headers: { 'content-type': 'text/plain' } });
    const bytes = new Uint8Array([0, 1, 2, 250, 251]);
    const res = await forwardToVercel(request, makeEnv(), bytes);
    expect(res.status).toBe(200);
    expect(request.bodyUsed).toBe(false);
    expect(seen[0]).toMatchObject({ url: `${UPSTREAM}/api/gsc?x=1`, method: 'POST' });
    expect(seen[0].body).toEqual(bytes);
  });

  it('with null: no body is sent', async () => {
    const request = new Request(`${PREVIEW}/api/gsc`, { method: 'DELETE', body: 'ignored' });
    await forwardToVercel(request, makeEnv(), null);
    expect(seen[0].body).toEqual(new Uint8Array(0));
    expect(request.bodyUsed).toBe(false);
  });

  it('without the parameter: reads the request body (Phase 1 behaviour)', async () => {
    const request = new Request(`${PREVIEW}/api/x`, { method: 'PUT', body: 'payload' });
    await forwardToVercel(request, makeEnv());
    expect(new TextDecoder().decode(seen[0].body!)).toBe('payload');
    expect(request.bodyUsed).toBe(true);
  });

  it('GET and HEAD carry no body, even when bytes are passed', async () => {
    await forwardToVercel(new Request(`${PREVIEW}/api/x`), makeEnv(), new Uint8Array([1]));
    await forwardToVercel(new Request(`${PREVIEW}/api/x`, { method: 'HEAD' }), makeEnv(), new Uint8Array([1]));
    expect(seen.map((s) => [s.method, s.body])).toEqual([['GET', null], ['HEAD', null]]);
  });

  it('headers: hop-by-hop, Connection-named, Host, Content-Length and cf-* stripped; X-Forwarded-Host added', async () => {
    const request = new Request(`${PREVIEW}/api/x`, {
      headers: {
        connection: 'keep-alive, x-named',
        'x-named': '1',
        'keep-alive': 'timeout=5',
        te: 'trailers',
        host: 'evil.example',
        'cf-access-client-id': 'id',
        'cf-connecting-ip': '198.51.100.1',
        authorization: 'Bearer t',
        'x-custom': 'kept',
      },
    });
    await forwardToVercel(request, makeEnv());
    expect(Object.keys(seen[0].headers).sort()).toEqual(['authorization', 'x-custom', 'x-forwarded-host']);
    expect(seen[0].headers['x-forwarded-host']).toBe('microns-site.example.workers.dev');
    expect([...HOP_BY_HOP].sort()).toEqual(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
    expect([...forwardHeaders(new Headers({ 'content-length': '3', a: 'b' }), 'h')]).toEqual([['a', 'b'], ['x-forwarded-host', 'h']]);
  });

  it('502 {"error":"upstream"} on an invalid origin, on its own host and on a network error', async () => {
    const bad = await forwardToVercel(new Request(`${PREVIEW}/api/x`), makeEnv({ API_FORWARD_ORIGIN: 'not a url' }));
    expect(bad.status).toBe(502);
    expect(await bad.json()).toEqual({ error: 'upstream' });
    const loop = await forwardToVercel(new Request(`${UPSTREAM}/api/x`), makeEnv());
    expect(loop.status).toBe(502);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network'));
    const down = await forwardToVercel(new Request(`${PREVIEW}/api/x`), makeEnv());
    expect(down.status).toBe(502);
    expect(seen).toHaveLength(0);
  });

  it('redirects are passed back, not followed', async () => {
    await forwardToVercel(new Request(`${PREVIEW}/api/x`), makeEnv());
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe('manual');
  });
});
