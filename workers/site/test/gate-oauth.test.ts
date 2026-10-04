// Gmail connect at the site gate (MK-3 authorize, MK-4 callback, MK-5 refresh): JSON requests from non-admins are
// refused with JSON, page navigations go on to microns-ops as the caller they are, and the opener origin is set only
// for the site's own origins.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyGate, type GateOutcome } from '../src/auth/gate';
import { PREVIEW, WWW, apiCall, bearer, bodyText, ctx, fakeLimiter, installUpstream, makeEnv, type ApiCall, type FakeUser, type Upstream } from './gate-support';

let up: Upstream;
let admin: FakeUser;
let staff: FakeUser;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  up = await installUpstream();
  admin = await up.addUser(['admin']);
  staff = await up.addUser(['production_manager']);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const authorize = (o: Partial<ApiCall> = {}): ApiCall => ({
  endpoint: 'marketing', action: 'google-auth', step: 'authorize', functionUrl: '/api/marketing?action=google-auth&step=authorize&account_id=new', ...o,
});

async function gate(call: ApiCall, env = makeEnv()): Promise<GateOutcome> {
  const { r, request } = apiCall(call);
  return applyGate(r, request, env, ctx);
}

async function denied(outcome: GateOutcome, status: number, error: string): Promise<void> {
  expect(outcome.kind).toBe('deny');
  if (outcome.kind !== 'deny') return;
  expect(outcome.response.status).toBe(status);
  expect(JSON.parse(await bodyText(outcome.response))).toEqual({ error });
}

describe('MK-3 authorize', () => {
  it('ANON with Accept: application/json -> 401 JSON', async () => {
    await denied(await gate(authorize({ headers: { accept: 'application/json' } })), 401, 'unauthorized');
  });

  it('a staff (non-admin) JSON request -> 403 JSON', async () => {
    await denied(await gate(authorize({ headers: { accept: 'application/json', ...bearer(staff) } })), 403, 'forbidden');
  });

  it('ANON page navigation -> on to ops as ANON (ops answers the sign-in page)', async () => {
    const outcome = await gate(authorize({ headers: { accept: 'text/html,application/xhtml+xml' } }));
    expect(outcome).toMatchObject({ kind: 'allow', actionId: 'MK-3', principal: { class: 'ANON' } });
    expect(outcome.kind === 'allow' && outcome.openerOrigin).toBeFalsy();
  });

  it('a staff page navigation -> on to ops as that staff user, without an opener origin', async () => {
    const outcome = await gate(authorize({ headers: bearer(staff) }));
    expect(outcome).toMatchObject({ kind: 'allow', principal: { class: 'STAFF', uid: staff.uid } });
    expect(outcome.kind === 'allow' && outcome.openerOrigin).toBeFalsy();
  });

  it('ADMIN on www -> allow with openerOrigin https://www.micronshub.eu', async () => {
    const outcome = await gate(authorize({ host: WWW, headers: { accept: 'application/json', ...bearer(admin) } }));
    expect(outcome).toMatchObject({ kind: 'allow', principal: { class: 'ADMIN' }, openerOrigin: 'https://www.micronshub.eu' });
  });

  it('ADMIN on a preview host -> openerOrigin is that preview origin', async () => {
    const outcome = await gate(authorize({ host: PREVIEW, headers: { accept: 'application/json', ...bearer(admin) } }));
    expect(outcome).toMatchObject({ kind: 'allow', openerOrigin: PREVIEW });
  });

  it('ADMIN on hosts that are not site origins -> no openerOrigin (ops falls back to SITE_ORIGIN)', async () => {
    for (const host of ['https://api.micronshub.eu', 'http://localhost:8787', 'https://on-demand-craft-greece.vercel.app']) {
      const outcome = await gate(authorize({ host, headers: { accept: 'application/json', ...bearer(admin) } }));
      expect(outcome.kind).toBe('allow');
      expect(outcome.kind === 'allow' && outcome.openerOrigin).toBeUndefined();
    }
  });

  it('Supabase unreachable on a JSON request -> 503', async () => {
    up.failures.push({ match: /\/auth\/v1\/user/, failure: 'network' });
    await denied(await gate(authorize({ headers: { accept: 'application/json', ...bearer(admin) } })), 503, 'auth_unavailable');
  });

  it('OPTIONS is gated like GET', async () => {
    await denied(await gate(authorize({ method: 'OPTIONS', headers: { accept: 'application/json' } })), 401, 'unauthorized');
  });
});

describe('MK-5 refresh', () => {
  const refresh: ApiCall = { endpoint: 'marketing', action: 'google-auth', step: 'refresh', functionUrl: '/api/marketing?action=google-auth&step=refresh&account_id=a' };

  it('requires ADMIN (also for OPTIONS)', async () => {
    await denied(await gate(refresh), 401, 'unauthorized');
    await denied(await gate({ ...refresh, headers: bearer(staff) }), 403, 'forbidden');
    await denied(await gate({ ...refresh, method: 'OPTIONS', headers: bearer(staff) }), 403, 'forbidden');
    expect(await gate({ ...refresh, headers: bearer(admin) })).toMatchObject({ kind: 'allow', principal: { class: 'ADMIN' } });
  });
});

describe('MK-4 callback', () => {
  const callback: ApiCall = { endpoint: 'marketing', action: 'google-auth', step: 'callback', functionUrl: '/api/marketing?action=google-auth&step=callback&code=c&state=s' };

  it('is ungated except for oauth:<ip>; the 31st callback in a minute gets a 429 page', async () => {
    const env = makeEnv();
    const headers = { 'CF-Connecting-IP': '198.51.100.20' };
    for (let i = 0; i < 30; i++) expect(await gate({ ...callback, headers }, env)).toMatchObject({ kind: 'allow', principal: { class: 'ANON' } });
    const outcome = await gate({ ...callback, headers }, env);
    expect(outcome.kind).toBe('deny');
    if (outcome.kind !== 'deny') return;
    expect(outcome.response.status).toBe(429);
    expect(outcome.response.headers.get('Retry-After')).toBe('60');
    expect(outcome.response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const html = await bodyText(outcome.response);
    expect(html).toContain("postMessage({ type: 'google-oauth-error', error: 'rate_limited' }, \"https://www.micronshub.eu\")");
    expect((env.API_RATE_LIMIT as unknown as ReturnType<typeof fakeLimiter>).counts.get('oauth:198.51.100.20')).toBe(31);
  });

  it('makes no Supabase call (state is verified in ops)', async () => {
    await gate({ ...callback, headers: bearer(admin) });
    expect(up.calls).toEqual([]);
  });
});
