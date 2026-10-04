// Gmail connect in microns-ops: signed state, JSON authorize for admins, escaped pages, callback writes only the
// account named in the state, refresh never returns a token. Google and PostgREST are fakes on the global fetch.

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsCall, Principal } from '../../shared/src/http/rpc';
import type { OpsEnv, OpsHono } from '../src/env';
import { escapeHtml, handleGoogleAuth, jsonForScript, signState, verifyState, type OAuthState } from '../src/routes/google-auth';

const SUPABASE_URL = 'https://project.supabase.test';
const CLIENT_SECRET = ['google', 'client', 'secret', 'test'].join('-');
const REDIRECT_URI = 'https://www.micronshub.eu/api/marketing?action=google-auth&step=callback';
const ACCOUNT_ID = '5b0c8f3e-2d1a-4c6b-9e7f-0a1b2c3d4e5f';
const ADMIN: Principal = { class: 'ADMIN', uid: 'b7e1c2d3-0000-4000-8000-000000000001', roles: ['admin'] };
const PREVIEW_ORIGIN = 'https://abc123-microns-site.example-sub.workers.dev';

interface Call { method: string; url: string; body: string }
let calls: Call[];
let accounts: Array<{ id: string; provider_config?: Record<string, unknown> }>;
let tokenAnswer: { status: number; body: Record<string, unknown> };

function env(overrides: Partial<OpsEnv> = {}): OpsEnv {
  return {
    SUPABASE_URL,
    SITE_ORIGIN: 'https://www.micronshub.eu',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test-value',
    SUPABASE_ANON_KEY: 'anon-test-value',
    RESEND_API_KEY: 'x', RESEND_WEBHOOK_SECRET: 'x', TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: 'x', APOLLO_API_KEY: 'x',
    GOOGLE_CLIENT_ID: 'client-id.apps.example',
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: REDIRECT_URI,
    SCRAPES: {} as OpsEnv['SCRAPES'],
    ...overrides,
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

async function run(functionUrl: string, o: { principal?: Principal; openerOrigin?: string; accept?: string; env?: OpsEnv } = {}) {
  const app = new Hono<OpsHono>();
  app.use('*', async (c, next) => {
    const call: OpsCall = { v: 1, requestId: 'r', endpoint: 'marketing', action: 'google-auth', functionUrl, principal: o.principal ?? { class: 'ANON' } };
    if (o.openerOrigin) call.openerOrigin = o.openerOrigin;
    c.set('call', call);
    await next();
  });
  app.all('/api/marketing', (c) => handleGoogleAuth(c));
  const headers: Record<string, string> = {};
  if (o.accept) headers.accept = o.accept;
  const response = await app.fetch(new Request(`https://www.micronshub.eu${functionUrl}`, { headers }), o.env ?? env(), ctx);
  return { response, text: await response.text() };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  calls = [];
  accounts = [{ id: ACCOUNT_ID, provider_config: { refresh_token: 'rt-old', access_token: 'at-old', google_email: 'box@example.test' } }];
  tokenAnswer = { status: 200, body: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3599 } };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? '' : await request.text();
    calls.push({ method: request.method, url: url.href, body });
    if (url.href === 'https://oauth2.googleapis.com/token') return Response.json(tokenAnswer.body, { status: tokenAnswer.status });
    if (url.href === 'https://www.googleapis.com/oauth2/v2/userinfo') return Response.json({ email: 'box@example.test', name: 'Box' });
    if (url.origin === SUPABASE_URL && url.pathname === '/rest/v1/marketing_sender_accounts') {
      if (request.method === 'GET') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        return Response.json(accounts.filter((a) => a.id === id));
      }
      return new Response(null, { status: 204 });
    }
    return new Response('unexpected', { status: 599 });
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stateFrom(url: string): string {
  return new URL(url).searchParams.get('state')!;
}

async function validState(o: Partial<OAuthState> = {}): Promise<string> {
  return signState(CLIENT_SECRET, { v: 1, aid: ACCOUNT_ID, uid: ADMIN.uid!, origin: 'https://www.micronshub.eu', n: 'nonce', exp: Math.floor(Date.now() / 1000) + 600, ...o });
}

describe('state', () => {
  it('round trip: a signed state verifies and carries its fields', async () => {
    const token = await validState();
    expect(await verifyState(CLIENT_SECRET, token, Math.floor(Date.now() / 1000))).toMatchObject({ v: 1, aid: ACCOUNT_ID, uid: ADMIN.uid, origin: 'https://www.micronshub.eu' });
  });

  it('a tampered payload, a tampered signature, another key or an expired state does not verify', async () => {
    const token = await validState();
    const [payload, signature] = token.split('.');
    const forged = btoa(JSON.stringify({ v: 1, aid: 'new', uid: 'x', origin: 'https://evil.example', n: 'n', exp: 9_999_999_999 })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const now = Math.floor(Date.now() / 1000);
    expect(await verifyState(CLIENT_SECRET, `${forged}.${signature}`, now)).toBeNull();
    expect(await verifyState(CLIENT_SECRET, `${payload}.${signature.slice(0, -2)}AA`, now)).toBeNull();
    expect(await verifyState('another-secret', token, now)).toBeNull();
    expect(await verifyState(CLIENT_SECRET, await validState({ exp: now - 1 }), now)).toBeNull();
    for (const junk of [undefined, '', 'a', 'a.b.c', btoa('{"account_id":"new"}')]) expect(await verifyState(CLIENT_SECRET, junk, now)).toBeNull();
  });
});

describe('authorize (MK-3)', () => {
  const url = `/api/marketing?action=google-auth&step=authorize&account_id=${ACCOUNT_ID}`;

  it('ADMIN with Accept: application/json -> 200 {url} for Google with a signed state', async () => {
    const { response, text } = await run(url, { principal: ADMIN, accept: 'application/json' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const google = new URL(JSON.parse(text).url);
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(google.searchParams)).toMatchObject({
      client_id: 'client-id.apps.example', redirect_uri: REDIRECT_URI, response_type: 'code', access_type: 'offline', prompt: 'consent',
      scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
    });
    const state = await verifyState(CLIENT_SECRET, stateFrom(google.href), Math.floor(Date.now() / 1000));
    expect(state).toMatchObject({ aid: ACCOUNT_ID, uid: ADMIN.uid, origin: 'https://www.micronshub.eu' });
    expect(state!.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(590);
  });

  it('the opener origin from a preview host lands in state.origin', async () => {
    const { text } = await run(url, { principal: ADMIN, accept: 'application/json', openerOrigin: PREVIEW_ORIGIN });
    const state = await verifyState(CLIENT_SECRET, stateFrom(JSON.parse(text).url), Math.floor(Date.now() / 1000));
    expect(state?.origin).toBe(PREVIEW_ORIGIN);
  });

  it('account_id "new" (or none) needs no lookup; an unknown or malformed id -> 400', async () => {
    const { response } = await run('/api/marketing?action=google-auth&step=authorize', { principal: ADMIN, accept: 'application/json' });
    expect(response.status).toBe(200);
    expect(calls).toEqual([]);
    expect((await run('/api/marketing?action=google-auth&step=authorize&account_id=5b0c8f3e-2d1a-4c6b-9e7f-000000000000', { principal: ADMIN, accept: 'application/json' })).response.status).toBe(400);
    expect((await run('/api/marketing?action=google-auth&step=authorize&account_id=1%20or%201', { principal: ADMIN, accept: 'application/json' })).response.status).toBe(400);
  });

  it('an ANON navigation gets the sign-in-required page: no Google URL, no state, posted to SITE_ORIGIN', async () => {
    const { response, text } = await run(url, { accept: 'text/html' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(text).toContain("{\"type\":\"google-oauth-error\",\"error\":\"sign_in_required\"}, \"https://www.micronshub.eu\"");
    expect(text).not.toContain('accounts.google.com');
    expect(text).not.toContain('state=');
  });

  it('an ADMIN without a JSON Accept and a staff caller with one also get the sign-in page', async () => {
    expect((await run(url, { principal: ADMIN })).text).toContain('sign_in_required');
    expect((await run(url, { principal: { class: 'STAFF', uid: 'u' }, accept: 'application/json' })).text).toContain('sign_in_required');
  });
});

describe('error step (MK-6, T16)', () => {
  it('error=<script> is never reflected; the code falls back to oauth_error', async () => {
    const { response, text } = await run(`/api/marketing?action=google-auth&error=${encodeURIComponent("<script>alert(1)</script>'")}`);
    expect(response.status).toBe(200);
    expect(text).not.toContain('<script>alert');
    expect(text).not.toContain('alert(1)');
    expect(text).toContain('"error":"oauth_error"');
    expect(text).toContain(', "https://www.micronshub.eu");');
  });

  it('a plain error code is kept and posted to SITE_ORIGIN only', async () => {
    const { text } = await run('/api/marketing?action=google-auth&step=callback&error=access_denied', { openerOrigin: 'https://evil.example' });
    expect(text).toContain('{"type":"google-oauth-error","error":"access_denied"}, "https://www.micronshub.eu"');
    expect(text).toContain('google_error=access_denied');
    expect(text).not.toContain("'*'");
  });
});

describe('callback (MK-4, T17)', () => {
  it('a modified state -> error page, no Google call and no database write', async () => {
    const token = await validState();
    const tampered = `${token.slice(0, 10)}${token[10] === 'A' ? 'B' : 'A'}${token.slice(11)}`;
    const { text } = await run(`/api/marketing?action=google-auth&step=callback&code=c&state=${encodeURIComponent(tampered)}`);
    expect(text).toContain('"error":"invalid_state"');
    expect(calls).toEqual([]);
  });

  it('a state without a signature is refused', async () => {
    const legacy = btoa(JSON.stringify({ account_id: ACCOUNT_ID }));
    const { text } = await run(`/api/marketing?action=google-auth&step=callback&code=c&state=${encodeURIComponent(legacy)}`);
    expect(text).toContain('invalid_state');
    expect(calls).toEqual([]);
  });

  it('a valid state: code exchanged, only state.aid updated, success posted to state.origin only', async () => {
    const state = await validState({ origin: PREVIEW_ORIGIN });
    const { response, text } = await run(`/api/marketing?action=google-auth&step=callback&code=auth-code&state=${encodeURIComponent(state)}&account_id=5b0c8f3e-2d1a-4c6b-9e7f-999999999999`);
    expect(response.status).toBe(200);
    const exchange = calls.find((c) => c.url === 'https://oauth2.googleapis.com/token')!;
    expect(Object.fromEntries(new URLSearchParams(exchange.body))).toMatchObject({ code: 'auth-code', redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' });
    const writes = calls.filter((c) => c.url.startsWith(SUPABASE_URL));
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('PATCH');
    expect(writes[0].url).toBe(`${SUPABASE_URL}/rest/v1/marketing_sender_accounts?id=eq.${ACCOUNT_ID}`);
    expect(JSON.parse(writes[0].body).provider_config).toMatchObject({ refresh_token: 'rt-new', access_token: 'at-new', google_email: 'box@example.test' });
    expect(text).toContain(`{"type":"google-oauth-success","email":"box@example.test"}, "${PREVIEW_ORIGIN}"`);
    expect(text).not.toContain('at-new');
  });

  it('aid "new" upserts on the Google address', async () => {
    const state = await validState({ aid: 'new' });
    await run(`/api/marketing?action=google-auth&step=callback&code=c&state=${encodeURIComponent(state)}`);
    const write = calls.find((c) => c.url.startsWith(SUPABASE_URL))!;
    expect(write.method).toBe('POST');
    expect(write.url).toBe(`${SUPABASE_URL}/rest/v1/marketing_sender_accounts?on_conflict=email`);
    expect(JSON.parse(write.body)).toMatchObject({ email: 'box@example.test', display_name: 'Box', provider: 'google_workspace', is_active: true });
  });

  it('a token error from Google is shown as a code, escaped, without a database write', async () => {
    tokenAnswer = { status: 400, body: { error: 'invalid_grant' } };
    const state = await validState();
    const { text } = await run(`/api/marketing?action=google-auth&step=callback&code=c&state=${encodeURIComponent(state)}`);
    expect(text).toContain('"error":"invalid_grant"');
    tokenAnswer = { status: 400, body: { error: "</script><script>alert('x')</script>" } };
    const second = await run(`/api/marketing?action=google-auth&step=callback&code=c&state=${encodeURIComponent(state)}`);
    expect(second.text).toContain('"error":"token_error"');
    expect(second.text).not.toContain('alert(');
    expect(calls.some((c) => c.url.startsWith(SUPABASE_URL))).toBe(false);
  });

  it('no code with a valid state -> no_code posted to the state origin', async () => {
    const state = await validState({ origin: PREVIEW_ORIGIN });
    const { text } = await run(`/api/marketing?action=google-auth&step=callback&state=${encodeURIComponent(state)}`);
    expect(text).toContain(`"error":"no_code"}, "${PREVIEW_ORIGIN}"`);
  });
});

describe('refresh (MK-5)', () => {
  it('ADMIN: refreshes server-side and answers {success, token_expiry} without any token', async () => {
    const { response, text } = await run(`/api/marketing?action=google-auth&step=refresh&account_id=${ACCOUNT_ID}`, { principal: ADMIN });
    expect(response.status).toBe(200);
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(['success', 'token_expiry']);
    expect(body.success).toBe(true);
    expect(text).not.toContain('at-new');
    expect(text).not.toContain('rt-old');
    const write = calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(write.body).provider_config).toMatchObject({ refresh_token: 'rt-old', access_token: 'at-new', google_email: 'box@example.test' });
  });

  it('a non-admin principal -> 403 (defence in depth behind the site gate)', async () => {
    const { response } = await run(`/api/marketing?action=google-auth&step=refresh&account_id=${ACCOUNT_ID}`, { principal: { class: 'STAFF', uid: 'u' } });
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('no stored refresh token -> 400 as before', async () => {
    accounts[0].provider_config = {};
    const { response, text } = await run(`/api/marketing?action=google-auth&step=refresh&account_id=${ACCOUNT_ID}`, { principal: ADMIN });
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: 'No refresh token available' });
  });
});

describe('page helpers', () => {
  it('escapeHtml and jsonForScript neutralise markup and line separators', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const ls = String.fromCharCode(0x2028);
    expect(jsonForScript({ v: `</script>${ls}&` })).toBe('{"v":"\\u003c/script\\u003e\\u2028\\u0026"}');
  });

  it('an unknown step -> 400 with the handler\'s message', async () => {
    const { response, text } = await run('/api/marketing?action=google-auth&step=bogus');
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: 'Invalid step. Use: authorize, callback, or refresh' });
  });
});
