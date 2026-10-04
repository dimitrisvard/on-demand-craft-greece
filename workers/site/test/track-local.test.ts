// /api/marketing?action=track and /api/track in the site (src/api/track.ts): the unchanged api/marketing.js through
// the shared shim. Byte fixtures: tracking pixel 70 B and unsubscribe page 547 B (SHA-256 below). The database is
// a stubbed global fetch that answers every PostgREST call "not found"; nothing leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalInput } from '../src/api/emails';
import type { Env } from '../src/env';
import { MemoryKV, TestContext } from './helpers/kv';

const SITE = 'https://microns-site.example.workers.dev';
const DB = 'https://supabase.invalid';
const DUMMY = 'dummy-not-a-secret';
const PIXEL_SHA256 = '497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581';
const UNSUBSCRIBE_SHA256 = '2c9b981f4b00465600eb652d7cb3bf19d1d31327b57293d626e6344411a5eb43';
const NO_CACHE = 'no-store, no-cache, must-revalidate, proxy-revalidate';
const EID = '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b';
const CID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

let dbCalls: Array<{ url: string; method: string; apikey: string | null }>;
let ctx: TestContext;

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    ASSETS: {} as Fetcher,
    SEO_CACHE: new MemoryKV().asBinding(),
    FLAGS: new MemoryKV().asBinding(),
    SUPABASE_URL: DB,
    SUPABASE_ANON_KEY: DUMMY,
    SITE_ORIGIN: 'https://www.micronshub.eu',
    PREVIEW_HOSTNAMES: '',
    SEO_STRICT_404: 'false',
    API_FORWARD_ORIGIN: 'https://upstream.example',
    DIRECTORY_INDEX_EMULATION: 'true',
    SUPABASE_SERVICE_ROLE_KEY: DUMMY,
    ...over,
  };
}

function input(path: string, env = makeEnv(), method = 'GET'): LocalInput {
  return { request: new Request(new URL(path, SITE), { method }), env, ctx: ctx.asContext(), functionUrl: path, body: null, principal: { class: 'ANON' } };
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function track(path: string, env?: Env, method?: string): Promise<Response> {
  const { handleTrack } = await import('../src/api/track');
  return handleTrack(input(path, env, method));
}

beforeEach(() => {
  dbCalls = [];
  ctx = new TestContext();
  vi.resetModules();
  vi.stubEnv('SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // supabase-js keeps the global fetch it finds when the client is created (module scope), so it is stubbed first.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    dbCalls.push({ url: request.url, method: request.method, apikey: request.headers.get('apikey') });
    return Response.json({ code: 'PGRST116', message: 'not found' }, { status: 406 });
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../../../api/marketing.js');
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('answers without a database read (T1, T2, T5, T10)', () => {
  it('T1: type=open without ids -> 200 pixel, image/png, Cache-Control', async () => {
    const res = await track('/api/marketing?action=track&type=open');
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toEqual({ 'content-type': 'image/png', 'cache-control': NO_CACHE });
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(70);
    expect(await sha256(body)).toBe(PIXEL_SHA256);
    expect(dbCalls).toEqual([]);
  });

  it('T2: other or missing type without ids -> 400 {"error":"Missing required parameters"} (39 B)', async () => {
    for (const path of ['/api/marketing?action=track&type=click&eid=x', '/api/marketing?action=track&cid=y']) {
      const res = await track(path);
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await res.text()).toBe('{"error":"Missing required parameters"}');
    }
    expect(dbCalls).toEqual([]);
  });

  it('T5: type=click without url -> 400 {"error":"Missing url parameter"}', async () => {
    const res = await track(`/api/marketing?action=track&type=click&eid=${EID}&cid=${CID}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"Missing url parameter"}');
    expect(dbCalls).toEqual([]);
  });

  it('T10: ids with another type -> 400 {"error":"Invalid tracking type"}', async () => {
    const res = await track(`/api/marketing?action=track&type=bogus&eid=${EID}&cid=${CID}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"Invalid tracking type"}');
    expect(dbCalls).toEqual([]);
  });
});

describe('answers after a "not found" database read (T3, T6, T9)', () => {
  it('T3: open -> 200 pixel with the four cache headers', async () => {
    const res = await track(`/api/marketing?action=track&type=open&eid=${EID}&cid=${CID}`);
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toEqual({ 'content-type': 'image/png', 'cache-control': NO_CACHE, pragma: 'no-cache', expires: '0' });
    expect(await sha256(await res.arrayBuffer())).toBe(PIXEL_SHA256);
    expect(dbCalls).toHaveLength(1);
  });

  it('T6: click -> 302 to the decoded url, Cache-Control no-store, empty body', async () => {
    const target = 'https://www.micronshub.eu/en/services?a=1&b=2';
    const res = await track(`/api/marketing?action=track&type=click&eid=${EID}&cid=${CID}&url=${encodeURIComponent(encodeURIComponent(target))}`);
    expect(res.status).toBe(302);
    expect(Object.fromEntries(res.headers)).toEqual({ 'cache-control': 'no-store', location: target });
    expect(await res.text()).toBe('');
  });

  it('T9: unsubscribe -> 200 text/html page (547 B)', async () => {
    const res = await track(`/api/marketing?action=track&type=unsubscribe&eid=${EID}&cid=${CID}`);
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toEqual({ 'content-type': 'text/html' });
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(547);
    expect(await sha256(body)).toBe(UNSUBSCRIBE_SHA256);
  });

  it('the database calls go to SUPABASE_URL of env with the service key copied from env', async () => {
    await track(`/api/marketing?action=track&type=unsubscribe&eid=${EID}&cid=${CID}`);
    expect(dbCalls.length).toBeGreaterThan(0);
    for (const call of dbCalls) {
      expect(call.url.startsWith(`${DB}/rest/v1/marketing_events?`)).toBe(true);
      expect(call.apikey).toBe(DUMMY);
    }
  });

  it('HEAD of T3 keeps the headers without a body', async () => {
    const res = await track(`/api/marketing?action=track&type=open&eid=${EID}&cid=${CID}`, makeEnv(), 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('pragma')).toBe('no-cache');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});

describe('deadline: 30 s from the call to res.end()', () => {
  // Stand-in handler: ends after ?ms= milliseconds, or never when ms is absent.
  function delayedHandler() {
    return {
      default: (req: { url: string }, res: { status(n: number): { send(v: string): void } }) => {
        const ms = new URL(req.url, 'http://localhost').searchParams.get('ms');
        if (ms !== null) setTimeout(() => res.status(200).send(`ended after ${ms}`), Number(ms));
      },
    };
  }

  function settle(promise: Promise<Response>): { done(): Response | undefined } {
    let settled: Response | undefined;
    void promise.then((r) => (settled = r));
    return { done: () => settled };
  }

  it('a handler that ends at 29,999 ms keeps its own answer', async () => {
    vi.doMock('../../../api/marketing.js', delayedHandler);
    await track('/api/marketing?action=track&ms=0');
    vi.useFakeTimers();
    const run = settle(track('/api/marketing?action=track&ms=29999'));
    await vi.advanceTimersByTimeAsync(29_998);
    expect(run.done()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.done()?.status).toBe(200);
    expect(await run.done()!.text()).toBe('ended after 29999');
  });

  it('a handler that has not ended after 30,000 ms gets 504 "Gateway Timeout", not earlier', async () => {
    vi.doMock('../../../api/marketing.js', delayedHandler);
    await track('/api/marketing?action=track&ms=0');
    vi.useFakeTimers();
    const run = settle(track('/api/marketing?action=track&type=open'));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run.done()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.done()?.status).toBe(504);
    expect(run.done()!.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await run.done()!.text()).toBe('Gateway Timeout');
  });
});

describe('/api/track through the Worker', () => {
  it('the alias serves the same bytes as /api/marketing?action=track (T1)', async () => {
    const worker = (await import('../src/index')).default;
    const env = makeEnv();
    const viaAlias = await worker.fetch(new Request(`${SITE}/api/track?type=open`), env, ctx.asContext());
    const direct = await worker.fetch(new Request(`${SITE}/api/marketing?action=track&type=open`), env, ctx.asContext());
    expect(viaAlias.status).toBe(200);
    expect(await sha256(await viaAlias.arrayBuffer())).toBe(PIXEL_SHA256);
    expect(await sha256(await direct.arrayBuffer())).toBe(PIXEL_SHA256);
    expect(viaAlias.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('module-scope failure', () => {
  it('without the service key api/marketing.js fails to load: tracking fails, /api/emails does not', async () => {
    const env = makeEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined, RESEND_API_KEY: DUMMY });
    await expect(track('/api/marketing?action=track&type=open', env)).rejects.toThrow(/supabaseKey is required/);
    const { handleEmails } = await import('../src/api/emails');
    const res = await handleEmails({ ...input('/api/emails', env, 'OPTIONS'), functionUrl: '/api/emails' });
    expect(res.status).toBe(200);
  });

  it('through the router the missing name answers 500 on tracking only (names of its target)', async () => {
    const { routeApi } = await import('../src/api/router');
    const env = makeEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    const res = await routeApi(new Request(`${SITE}/api/track?type=open`), env, ctx.asContext());
    expect(res.status).toBe(500);
    expect(vi.mocked(console.error).mock.calls.map((c) => String(c[0]))).toContain('[microns-site] api config missing: SUPABASE_SERVICE_ROLE_KEY');
  });
});
