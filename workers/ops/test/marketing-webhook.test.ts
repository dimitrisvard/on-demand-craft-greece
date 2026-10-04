// Resend webhook in microns-ops: Svix verification on the raw bytes in front of the unchanged api/marketing.js.
// The handler runs for real (through the shared shim) against an in-memory PostgREST fake; deliveries are signed
// by the svix library.

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNodeHandler, type VercelHandler } from '../../shared/src/compat/vercel-node';
import type { OpsCall } from '../../shared/src/http/rpc';
import { svixHeaders, svixTestSecret } from '../../shared/test/auth/svix-oracle';
import type { OpsEnv, OpsHono } from '../src/env';

type WebhookModule = typeof import('../src/routes/marketing-webhook');

const SUPABASE_URL = 'https://project.supabase.test';
const SECRET = svixTestSecret();
const OTHER_SECRET = svixTestSecret('another-svix-test-key-NOT-A-SECRET');
const SERVICE = ['service', 'test', 'value'].join('-');
const FUNCTION_URL = '/api/marketing?action=webhook';

interface EventRow { id: string; event_type: string; resend_email_id?: string; subscriber_id?: string; campaign_id?: string }

let mod: WebhookModule;
let events: EventRow[];
let calls: string[];
let failInserts: boolean;

function fakeSupabase() {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.origin !== SUPABASE_URL) return new Response('unexpected host', { status: 599 });
    const single = (request.headers.get('accept') ?? '').includes('vnd.pgrst.object');
    const reply = (rows: unknown[]) => new Response(JSON.stringify(single ? rows[0] ?? null : rows), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/rest/v1/marketing_events') {
      if (request.method === 'GET') {
        const filters = [...url.searchParams.entries()].filter(([k, v]) => k !== 'select' && k !== 'limit' && v.startsWith('eq.'));
        return reply(events.filter((row) => filters.every(([k, v]) => String((row as unknown as Record<string, unknown>)[k]) === v.slice(3))));
      }
      if (request.method === 'POST') {
        if (failInserts) return new Response('{"message":"down"}', { status: 503 });
        const body = JSON.parse(await request.text());
        for (const row of Array.isArray(body) ? body : [body]) events.push({ id: `ev-${events.length}`, ...row });
        return new Response(null, { status: 201 });
      }
    }
    if (url.pathname === '/rest/v1/marketing_subscribers') {
      return request.method === 'GET' ? reply([{ bounce_count: 0, email: 'sub@example.test' }]) : new Response(null, { status: 204 });
    }
    return new Response(null, { status: 204 });
  });
}

function env(overrides: Partial<OpsEnv> = {}): OpsEnv {
  return {
    SUPABASE_URL,
    SITE_ORIGIN: 'https://www.micronshub.eu',
    SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    SUPABASE_ANON_KEY: 'anon-test-value',
    RESEND_API_KEY: 'resend-test-value',
    RESEND_WEBHOOK_SECRET: SECRET,
    TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: 'x', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REDIRECT_URI: 'x', APOLLO_API_KEY: 'x',
    SCRAPES: {} as OpsEnv['SCRAPES'],
    ...overrides,
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function app(): Hono<OpsHono> {
  const a = new Hono<OpsHono>();
  a.use('*', async (c, next) => {
    const call: OpsCall = { v: 1, requestId: 'req-1', endpoint: 'marketing', action: 'webhook', functionUrl: FUNCTION_URL, principal: { class: 'ANON' } };
    c.set('call', call);
    await next();
  });
  a.all('/api/marketing', (c) => mod.handleResendWebhook(c));
  return a;
}

function delivery(body: string, o: { id?: string; ts?: number; secret?: string; headers?: Record<string, string>; method?: string } = {}): Request {
  const ts = o.ts ?? Math.floor(Date.now() / 1000);
  const signed = svixHeaders(o.secret ?? SECRET, o.id ?? 'msg_1', ts, body);
  return new Request(`https://www.micronshub.eu${FUNCTION_URL}`, {
    method: o.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...signed, ...(o.headers ?? {}) },
    body: o.method === 'GET' ? undefined : body,
  });
}

async function send(request: Request, e = env()): Promise<{ status: number; json: unknown; response: Response }> {
  const response = await app().fetch(request, e, ctx);
  const text = await response.clone().text();
  let json: unknown = text;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, response };
}

const EMAIL_ID = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
const delivered = JSON.stringify({ type: 'email.delivered', created_at: '2026-10-04T10:00:00.000Z', data: { email_id: EMAIL_ID } });
const bounced = JSON.stringify({ type: 'email.bounced', created_at: '2026-10-04T10:00:00.000Z', data: { email_id: EMAIL_ID, bounce: { type: 'hard', description: 'x' } } });

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  events = [{ id: 'sent-1', event_type: 'sent', resend_email_id: EMAIL_ID, subscriber_id: 'sub-1', campaign_id: 'camp-1' }];
  calls = [];
  failInserts = false;
  // The handler reads its configuration at module scope (process.env, populated from the Worker env in workerd).
  vi.stubEnv('SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
  vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET);
  vi.stubGlobal('fetch', fakeSupabase());
  vi.resetModules();
  mod = await import('../src/routes/marketing-webhook');
  mod.resetWebhookReplayCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Svix verification (T13)', () => {
  it('a valid delivery reaches the unchanged handler, which accepts the adapter signature -> 200 {"received":true}', async () => {
    const result = await send(delivery(delivered));
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ received: true });
    expect(events.some((e) => e.event_type === 'delivered' && e.resend_email_id === EMAIL_ID)).toBe(true);
  });

  it('no Svix headers -> 401 {"error":"Invalid signature"} and the handler does not run', async () => {
    const request = new Request(`https://www.micronshub.eu${FUNCTION_URL}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: delivered });
    const result = await send(request);
    expect(result.status).toBe(401);
    expect(result.json).toEqual({ error: 'Invalid signature' });
    expect(calls).toEqual([]);
  });

  it('a tampered body -> 401', async () => {
    const signed = delivery(delivered);
    const tampered = new Request(signed.url, { method: 'POST', headers: signed.headers, body: delivered.replace('delivered', 'complained') });
    expect((await send(tampered)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('a body re-serialised with other whitespace -> 401 (raw bytes are verified)', async () => {
    const signed = delivery(delivered);
    const reformatted = new Request(signed.url, { method: 'POST', headers: signed.headers, body: JSON.stringify(JSON.parse(delivered), null, 2) });
    expect((await send(reformatted)).status).toBe(401);
  });

  it('a signature made with another key -> 401', async () => {
    expect((await send(delivery(delivered, { secret: OTHER_SECRET }))).status).toBe(401);
  });

  it('a timestamp 10 minutes old -> 401', async () => {
    expect((await send(delivery(delivered, { ts: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(401);
  });

  it('the 401 has the handler\'s exact bytes and headers', async () => {
    const ours = (await send(new Request(`https://www.micronshub.eu${FUNCTION_URL}`, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-signature': 'sha256=00' }, body: delivered }))).response;
    // @ts-ignore -- api/*.js is plain JavaScript; its default export is a Vercel (req, res) handler
    const handler = (await import('../../../api/marketing.js')) as { default: VercelHandler };
    const theirs = await runNodeHandler(handler.default, {
      request: new Request(`https://www.micronshub.eu${FUNCTION_URL}`, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-signature': 'sha256=00' } }),
      functionUrl: FUNCTION_URL,
      body: new TextEncoder().encode(delivered),
      logPrefix: '[microns-ops]',
    });
    expect(ours.status).toBe(theirs.status);
    expect([...ours.headers.entries()]).toEqual([...theirs.headers.entries()]);
    expect(await ours.text()).toBe(await theirs.text());
  });

  it('the handler accepts a delivery only with the adapter signature of this wrapper', async () => {
    // @ts-ignore -- api/*.js is plain JavaScript; its default export is a Vercel (req, res) handler
    const handler = (await import('../../../api/marketing.js')) as { default: VercelHandler };
    const request = delivery(delivered);
    const response = await runNodeHandler(handler.default, { request, functionUrl: FUNCTION_URL, body: new TextEncoder().encode(delivered), logPrefix: '[microns-ops]' });
    expect(response.status).toBe(401);
  });

  it('no RESEND_WEBHOOK_SECRET -> 500 with an error log, nothing processed', async () => {
    const result = await send(delivery(delivered), env({ RESEND_WEBHOOK_SECRET: '' }));
    expect(result.status).toBe(500);
    expect(vi.mocked(console.error).mock.calls.map((c) => String(c[0]))).toContain('[microns-ops] api config missing: RESEND_WEBHOOK_SECRET');
    expect(calls).toEqual([]);
  });

  it('a method other than POST goes to the handler unchanged (405)', async () => {
    const result = await send(new Request(`https://www.micronshub.eu${FUNCTION_URL}`, { method: 'GET' }));
    expect(result.status).toBe(405);
    expect(result.json).toEqual({ error: 'Method not allowed' });
  });

  it('log lines carry no signature or secret', async () => {
    await send(delivery(delivered, { secret: OTHER_SECRET }));
    const lines = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].map((c) => c.map(String).join(' '));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith('[microns-ops] ')).toBe(true);
      expect(line).not.toContain('v1,');
      expect(line).not.toContain(SECRET.slice(6, 20));
    }
  });
});

describe('replay and retries', () => {
  it('a replay of a processed svix-id is acknowledged without running the handler', async () => {
    expect((await send(delivery(delivered, { id: 'msg_replay' }))).status).toBe(200);
    const before = calls.length;
    const again = await send(delivery(delivered, { id: 'msg_replay' }));
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ received: true });
    expect(calls.length).toBe(before);
    expect(events.filter((e) => e.event_type === 'delivered')).toHaveLength(1);
  });

  it('a bounce the handler recorded but answered 500 is acknowledged on retry without re-processing', async () => {
    const first = await send(delivery(bounced, { id: 'msg_bounce' }));
    expect(first.status).toBe(500); // the handler fails after its writes (analytics upsert)
    expect(events.filter((e) => e.event_type === 'bounced')).toHaveLength(1);
    const writesBefore = calls.filter((c) => !c.startsWith('GET')).length;
    const retry = await send(delivery(bounced, { id: 'msg_bounce' }));
    expect(retry.status).toBe(200);
    expect(retry.json).toEqual({ received: true });
    expect(calls.filter((c) => !c.startsWith('GET')).length).toBe(writesBefore);
    expect(events.filter((e) => e.event_type === 'bounced')).toHaveLength(1);
  });

  it('a delivery that failed before anything was recorded runs the handler again on retry', async () => {
    failInserts = true;
    const first = await send(delivery(bounced, { id: 'msg_retry' }));
    expect(first.status).toBe(500);
    failInserts = false;
    const handlerReads = () => calls.filter((c) => c.includes('event_type=eq.sent')).length;
    const before = handlerReads();
    const retry = await send(delivery(bounced, { id: 'msg_retry' }));
    expect(handlerReads()).toBe(before + 1);
    expect(events.filter((e) => e.event_type === 'bounced')).toHaveLength(1);
    expect(retry.status).toBe(500);
  });

  it('a complaint already recorded for the e-mail is acknowledged under a new svix-id', async () => {
    events.push({ id: 'c-1', event_type: 'complained', resend_email_id: EMAIL_ID });
    const complained = JSON.stringify({ type: 'email.complained', data: { email_id: EMAIL_ID } });
    const result = await send(delivery(complained, { id: 'msg_new' }));
    expect(result.status).toBe(200);
    expect(calls.every((c) => c.startsWith('GET /rest/v1/marketing_events?select=id&event_type=eq.complained'))).toBe(true);
  });

  it('only 2xx answers are remembered: an invalid payload (400) is processed again', async () => {
    const invalid = JSON.stringify({ hello: 'world' });
    expect((await send(delivery(invalid, { id: 'msg_bad' }))).status).toBe(400);
    expect((await send(delivery(invalid, { id: 'msg_bad' }))).status).toBe(400);
  });
});
