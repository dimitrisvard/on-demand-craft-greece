// /api/emails in the site (src/api/emails.ts): the unchanged api/emails.js through the shared shim, imported lazily
// so that a module-scope failure (no RESEND_API_KEY: `new Resend(undefined)` throws) fails this route only.
// Resend is reached through a stubbed global fetch; nothing leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import type { LocalInput } from '../src/api/emails';
import { MemoryKV, TestContext } from './helpers/kv';

const SITE = 'https://microns-site.example.workers.dev';
const DUMMY = 'dummy-not-a-secret';
const FUNCTION_CORS = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
  'access-control-allow-headers': 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
};

let outbound: Array<{ url: string; method: string; authorization: string | null; body: string }>;
let ctx: TestContext;

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    ASSETS: {} as Fetcher,
    SEO_CACHE: new MemoryKV().asBinding(),
    FLAGS: new MemoryKV().asBinding(),
    SUPABASE_URL: 'https://supabase.invalid',
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

function input(method: string, path: string, body?: string, env = makeEnv({ RESEND_API_KEY: DUMMY })): LocalInput {
  const bytes = body === undefined ? null : new TextEncoder().encode(body);
  const request = new Request(new URL(path, SITE), { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: bytes ?? undefined });
  return { request, env, ctx: ctx.asContext(), functionUrl: path, body: bytes, principal: { class: 'ANON' } };
}

function headersOf(res: Response): Record<string, string> {
  return Object.fromEntries(res.headers);
}

beforeEach(() => {
  outbound = [];
  ctx = new TestContext();
  vi.resetModules();
  // Neither the developer's shell nor an earlier test may provide the key.
  vi.stubEnv('RESEND_API_KEY', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    outbound.push({ url: request.url, method: request.method, authorization: request.headers.get('authorization'), body: await request.text() });
    return Response.json({ id: `email-${outbound.length}` });
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../../../api/emails.js');
  vi.doUnmock('../../../api/marketing.js');
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lazy import', () => {
  it('loading the Worker evaluates neither api/emails.js nor api/marketing.js; the first request does', async () => {
    const evaluated: string[] = [];
    vi.doMock('../../../api/emails.js', () => {
      evaluated.push('emails');
      return { default: (_req: unknown, res: { status(n: number): { json(v: unknown): void } }) => res.status(200).json({ stand_in: 'emails' }) };
    });
    vi.doMock('../../../api/marketing.js', () => {
      evaluated.push('marketing');
      return { default: (_req: unknown, res: { status(n: number): { json(v: unknown): void } }) => res.status(200).json({ stand_in: 'marketing' }) };
    });
    await import('../src/index');
    await import('../src/api/router');
    const { handleEmails } = await import('../src/api/emails');
    const { handleTrack } = await import('../src/api/track');
    expect(evaluated).toEqual([]);

    const res = await handleEmails(input('POST', '/api/emails', '{}'));
    expect(await res.json()).toEqual({ stand_in: 'emails' });
    expect(evaluated).toEqual(['emails']);
    await handleTrack(input('GET', '/api/marketing?action=track&type=open'));
    expect(evaluated).toEqual(['emails', 'marketing']);
  });

  it('without RESEND_API_KEY the Worker still loads, and the real module fails only when /api/emails is called', async () => {
    const worker = (await import('../src/index')).default;
    expect(typeof worker.fetch).toBe('function');
    const { handleEmails } = await import('../src/api/emails');
    await expect(handleEmails(input('POST', '/api/emails', '{}', makeEnv()))).rejects.toThrow(/Missing API key/);
    // The failed module is not evaluated again in this isolate: the next request fails the same way.
    await expect(handleEmails(input('OPTIONS', '/api/emails', undefined, makeEnv()))).rejects.toThrow(/Missing API key/);
  });
});

describe('deadline: 30 s from the call to res.end()', () => {
  // Stand-in handler: ends after ?ms= milliseconds, or never when ms is absent.
  function delayedHandler() {
    return {
      default: (req: { url: string }, res: { status(n: number): { json(v: unknown): void } }) => {
        const ms = new URL(req.url, 'http://localhost').searchParams.get('ms');
        if (ms !== null) setTimeout(() => res.status(200).json({ endedAfter: Number(ms) }), Number(ms));
      },
    };
  }

  function settle(promise: Promise<Response>): { done(): Response | undefined } {
    let settled: Response | undefined;
    void promise.then((r) => (settled = r));
    return { done: () => settled };
  }

  it('a handler that ends at 29,999 ms keeps its own answer', async () => {
    vi.doMock('../../../api/emails.js', delayedHandler);
    const { handleEmails } = await import('../src/api/emails');
    await handleEmails(input('POST', '/api/emails?ms=0', '{}'));
    vi.useFakeTimers();
    const run = settle(handleEmails(input('POST', '/api/emails?ms=29999', '{}')));
    await vi.advanceTimersByTimeAsync(29_998);
    expect(run.done()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.done()?.status).toBe(200);
    expect(await run.done()!.json()).toEqual({ endedAfter: 29_999 });
  });

  it('a handler that has not ended after 30,000 ms gets 504 "Gateway Timeout", not earlier', async () => {
    vi.doMock('../../../api/emails.js', delayedHandler);
    const { handleEmails } = await import('../src/api/emails');
    await handleEmails(input('POST', '/api/emails?ms=0', '{}'));
    vi.useFakeTimers();
    const run = settle(handleEmails(input('POST', '/api/emails', '{}')));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run.done()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.done()?.status).toBe(504);
    expect(run.done()!.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await run.done()!.text()).toBe('Gateway Timeout');
  });
});

describe('the unchanged handler through the shim (RESEND_API_KEY from env)', () => {
  it('copies RESEND_API_KEY from env into process.env before the module is evaluated', async () => {
    const { handleEmails } = await import('../src/api/emails');
    const res = await handleEmails(input('OPTIONS', '/api/emails'));
    expect(res.status).toBe(200);
    expect(process.env.RESEND_API_KEY).toBe(DUMMY);
  });

  it('OPTIONS -> 200 empty with the function CORS headers', async () => {
    const { handleEmails } = await import('../src/api/emails');
    const res = await handleEmails(input('OPTIONS', '/api/emails'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(headersOf(res)).toMatchObject(FUNCTION_CORS);
  });

  it('GET -> 405 {"error":"Method not allowed"}', async () => {
    const { handleEmails } = await import('../src/api/emails');
    const res = await handleEmails(input('GET', '/api/emails'));
    expect(res.status).toBe(405);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });

  it('invalid JSON -> the handler\'s own 500', async () => {
    const { handleEmails } = await import('../src/api/emails');
    const res = await handleEmails(input('POST', '/api/emails', '{bad'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to process email request', details: 'Invalid JSON', success: false });
    expect(outbound).toEqual([]);
  });

  it('missing fields -> 400 before any Resend call', async () => {
    const { handleEmails } = await import('../src/api/emails');
    const res = await handleEmails(input('POST', '/api/emails', JSON.stringify({ name: 'N', email: 'n@example.test' })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing required fields: name, email, and message are required' });
    expect(outbound).toEqual([]);
  });

  it('contact -> two Resend calls with the env key, then the handler\'s 200 body', async () => {
    const { handleEmails } = await import('../src/api/emails');
    const body = JSON.stringify({ action: 'contact', name: 'N', email: 'n@example.test', message: 'hello' });
    const res = await handleEmails(input('POST', '/api/emails', body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Contact form received successfully', companyEmailId: 'email-1', customerEmailId: 'email-2' });
    expect(outbound.map((o) => `${o.method} ${new URL(o.url).host}`)).toEqual(['POST api.resend.com', 'POST api.resend.com']);
    expect(outbound.every((o) => o.authorization === `Bearer ${DUMMY}`)).toBe(true);
  });
});

describe('routing: a missing RESEND_API_KEY fails /api/emails only', () => {
  it('/api/emails -> 500 (names of its target), tracking and the SEO paths unaffected', async () => {
    const worker = (await import('../src/index')).default;
    const env = makeEnv({
      API_RATE_LIMIT: { limit: async () => ({ success: true }) } as unknown as RateLimit,
      ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) } as unknown as Fetcher,
    });
    const emails = await worker.fetch(new Request(`${SITE}/api/emails`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env, ctx.asContext());
    expect(emails.status).toBe(500);
    expect(await emails.text()).toBe('Internal Server Error');
    const track = await worker.fetch(new Request(`${SITE}/api/marketing?action=track&type=open`), env, ctx.asContext());
    expect(track.status).toBe(200);
    expect(track.headers.get('content-type')).toBe('image/png');
    const asset = await worker.fetch(new Request(`${SITE}/robots.txt`), env, ctx.asContext());
    expect(asset.status).toBe(200);
  });
});
