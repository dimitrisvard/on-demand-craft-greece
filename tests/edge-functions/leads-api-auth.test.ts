// leads-api caller authentication (PLAN.md P6-4, H-6): the pure check (staff-auth.ts), its Supabase adapter, the
// real index.ts run in Node with stubbed Deno imports, and the rule that index.ts is the live v7 source plus the
// marked check only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  STAFF_ROLES,
  bearerToken,
  checkStaff,
  looksLikeUserToken,
  supabaseStaffDeps,
  type StaffAuthDeps,
} from '../../supabase/functions/leads-api/staff-auth.ts';
import { fakeSupabase } from './stubs/supabase-js';
import { servedHandler } from './stubs/deno-serve';

// SHA-256 of supabase/functions/leads-api/index.ts as deployed (version 7, read with get_edge_function on
// 2026-10-04 and re-checked on 2026-10-09). If the live function changes, re-pull it, rebuild index.ts from it and
// update this value.
const LIVE_V7_SHA256 = '9c4b076ccc02cafe0700dfa0e7066cc9274a9baa9bbc3debdab4382588829377';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const UID = '5b0c8f9e-2a1d-4c3b-9e8f-7a6b5c4d3e2f';

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`;
}

const userToken = (over: Record<string, unknown> = {}) =>
  jwt({ role: 'authenticated', aud: 'authenticated', sub: UID, exp: NOW / 1000 + 3600, ...over });

function repoRoot(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error('test path unknown');
  return resolve(testPath, '../../..');
}

function deps(user: string | null | 'unavailable', roles: string[] | 'unavailable') {
  const d = {
    getUserId: vi.fn(async () => user),
    getRoles: vi.fn(async () => roles),
  } satisfies StaffAuthDeps;
  return d;
}

describe('bearerToken and the payload pre-check', () => {
  it('takes only a well-formed Bearer JWT', () => {
    const t = userToken();
    expect(bearerToken(`Bearer ${t}`)).toBe(t);
    expect(bearerToken(`bearer ${t}`)).toBeNull();
    expect(bearerToken(t)).toBeNull();
    expect(bearerToken('Bearer abc')).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(`Bearer ${t} extra`)).toBeNull();
  });

  it('accepts a live user token and turns away project keys, expired and malformed tokens', () => {
    expect(looksLikeUserToken(userToken(), NOW)).toBe(true);
    expect(looksLikeUserToken(userToken({ aud: ['authenticated', 'x'] }), NOW)).toBe(true);
    expect(looksLikeUserToken(jwt({ role: 'anon', iss: 'supabase', exp: NOW / 1000 + 1e8 }), NOW)).toBe(false);
    expect(looksLikeUserToken(jwt({ role: 'service_role', iss: 'supabase', exp: NOW / 1000 + 1e8 }), NOW)).toBe(false);
    expect(looksLikeUserToken(userToken({ exp: NOW / 1000 - 1 }), NOW)).toBe(false);
    expect(looksLikeUserToken(userToken({ exp: String(NOW / 1000 + 60) }), NOW)).toBe(false);
    expect(looksLikeUserToken(userToken({ aud: 'anon' }), NOW)).toBe(false);
    expect(looksLikeUserToken(userToken({ sub: 'not-a-uuid' }), NOW)).toBe(false);
    expect(looksLikeUserToken('a.%%%.c', NOW)).toBe(false);
    expect(looksLikeUserToken(`a.${Buffer.from('[1]').toString('base64url')}.c`, NOW)).toBe(false);
  });
});

describe('checkStaff', () => {
  it('401 without a usable credential, before any lookup', async () => {
    for (const header of [null, '', 'Basic x', `Bearer ${jwt({ role: 'anon', exp: NOW / 1000 + 1e8 })}`]) {
      const d = deps(UID, ['admin']);
      expect(await checkStaff(header, d, NOW)).toEqual({ ok: false, status: 401, error: 'unauthorized' });
      expect(d.getUserId).not.toHaveBeenCalled();
    }
  });

  it('401 when Supabase Auth does not know the token; 503 when it cannot answer (fail closed)', async () => {
    const h = `Bearer ${userToken()}`;
    expect(await checkStaff(h, deps(null, ['admin']), NOW)).toMatchObject({ status: 401 });
    expect(await checkStaff(h, deps('unavailable', ['admin']), NOW)).toMatchObject({ status: 503, error: 'auth_unavailable' });
    const throwing: StaffAuthDeps = { getUserId: async () => { throw new Error('boom'); }, getRoles: async () => ['admin'] };
    expect(await checkStaff(h, throwing, NOW)).toMatchObject({ status: 503 });
    expect(await checkStaff(h, deps(UID, 'unavailable'), NOW)).toMatchObject({ status: 503 });
  });

  it('403 for customers, partners, suppliers and users without a role', async () => {
    const h = `Bearer ${userToken()}`;
    for (const roles of [[], ['customer'], ['partner_seller'], ['supplier'], ['customer', 'supplier']]) {
      expect(await checkStaff(h, deps(UID, roles), NOW), JSON.stringify(roles)).toEqual({ ok: false, status: 403, error: 'forbidden' });
    }
  });

  it('passes each staff role, also as one of several role rows', async () => {
    const h = `Bearer ${userToken()}`;
    expect(STAFF_ROLES).toEqual(['admin', 'sales_rep', 'production_manager', 'accountant']);
    for (const role of STAFF_ROLES) {
      expect(await checkStaff(h, deps(UID, [role]), NOW)).toEqual({ ok: true, userId: UID, roles: [role] });
    }
    expect(await checkStaff(h, deps(UID, ['customer', 'admin']), NOW)).toMatchObject({ ok: true });
  });
});

describe('supabaseStaffDeps', () => {
  function client(getUser: unknown, roles: { data: unknown; error: unknown }) {
    const eq = vi.fn(async () => roles);
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { c: { auth: { getUser: vi.fn(async () => getUser) }, from } as never, from, select, eq };
  }

  it('maps Auth answers: user id, unknown token (4xx) null, network (0, none) and 5xx unavailable', async () => {
    expect(await supabaseStaffDeps(client({ data: { user: { id: UID } }, error: null }, { data: [], error: null }).c).getUserId('t')).toBe(UID);
    for (const [status, want] of [[401, null], [403, null], [0, 'unavailable'], [undefined, 'unavailable'], [502, 'unavailable'], [503, 'unavailable']] as const) {
      const { c } = client({ data: { user: null }, error: { status } }, { data: [], error: null });
      expect(await supabaseStaffDeps(c).getUserId('t'), String(status)).toBe(want);
    }
  });

  it('reads every user_roles row of the user; a database error is unavailable', async () => {
    const ok = client(null, { data: [{ role: 'customer' }, { role: 'admin' }], error: null });
    expect(await supabaseStaffDeps(ok.c).getRoles(UID)).toEqual(['customer', 'admin']);
    expect(ok.from).toHaveBeenCalledWith('user_roles');
    expect(ok.select).toHaveBeenCalledWith('role');
    expect(ok.eq).toHaveBeenCalledWith('user_id', UID);
    expect(await supabaseStaffDeps(client(null, { data: null, error: { message: 'x' } }).c).getRoles(UID)).toBe('unavailable');
  });
});

describe('index.ts (Deno handler run in Node)', () => {
  // The handler checks against the real clock.
  const live = { exp: Math.floor(Date.now() / 1000) + 3600 };
  const STAFF = userToken(live);
  const CUSTOMER = userToken({ ...live, sub: '0f0e0d0c-0b0a-4908-8706-050403020100' });

  beforeAll(async () => {
    vi.stubGlobal('Deno', { env: { get: (name: string) => ({ SUPABASE_URL: 'https://project.supabase.example', SUPABASE_SERVICE_ROLE_KEY: 'service-key' })[name] } });
    await import('../../supabase/functions/leads-api/index.ts');
  });

  beforeEach(() => {
    fakeSupabase.reset();
    fakeSupabase.users[STAFF] = UID;
    fakeSupabase.roles[UID] = ['sales_rep'];
    fakeSupabase.users[CUSTOMER] = '0f0e0d0c-0b0a-4908-8706-050403020100';
    fakeSupabase.roles['0f0e0d0c-0b0a-4908-8706-050403020100'] = ['customer'];
  });

  // The edge runtime hands the function its path without the /functions/v1 prefix (pathParts[1] is the resource).
  const call = (path: string, init: RequestInit = {}) =>
    servedHandler()(new Request(`https://project.supabase.example${path}`, init));

  it('preflight stays open (no credential, CORS headers as today)', async () => {
    const res = await call('/leads-api/stats', { method: 'OPTIONS' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('authorization, x-client-info, apikey, content-type');
    expect(fakeSupabase.calls).toEqual([]);
  });

  it('every resource answers 401 without a credential or with the public key, and touches no table', async () => {
    const anon = jwt({ role: 'anon', iss: 'supabase', exp: NOW / 1000 + 1e8 });
    for (const [method, path] of [['GET', '/leads-api/stats'], ['GET', '/leads-api/leads'], ['PATCH', '/leads-api/leads/1'], ['DELETE', '/leads-api/keywords/1'], ['GET', '/leads-api/collect?source=all'], ['GET', '/leads-api/nothing']]) {
      for (const headers of [{}, { Authorization: `Bearer ${anon}`, apikey: anon }]) {
        const res = await call(path, { method, headers, body: method === 'PATCH' ? '{}' : undefined });
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(await res.json()).toEqual({ error: 'unauthorized' });
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      }
    }
    expect(fakeSupabase.calls).toEqual([]);
  });

  it('a signed-in customer gets 403; only the role lookup ran', async () => {
    const res = await call('/leads-api/leads/1', { method: 'DELETE', headers: { Authorization: `Bearer ${CUSTOMER}` } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(fakeSupabase.calls).toEqual(['user_roles user_id=0f0e0d0c-0b0a-4908-8706-050403020100']);
  });

  it('a staff user reaches the routes unchanged', async () => {
    fakeSupabase.tableRows = [{ source: 'reddit', auto_score: 'hot', status: 'new', discovered_at: '2026-10-04T08:00:00Z' }];
    const res = await call('/leads-api/stats?days_back=7', { headers: { Authorization: `Bearer ${STAFF}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ period_days: 7, by_source: { reddit: 1 } });
    expect(fakeSupabase.calls[0]).toBe(`user_roles user_id=${UID}`);
    expect(fakeSupabase.calls.length).toBeGreaterThan(1);
  });

  it('503 when Supabase Auth is down (fail closed)', async () => {
    fakeSupabase.users[STAFF] = { status: 503 };
    const res = await call('/leads-api/stats', { headers: { Authorization: `Bearer ${STAFF}` } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'auth_unavailable' });
  });
});

describe('index.ts = live v7 + the marked check', () => {
  it('removing the marked lines gives the deployed source byte for byte', () => {
    const src = readFileSync(join(repoRoot(), 'supabase/functions/leads-api/index.ts'), 'utf8');
    const lines = src.split('\n');
    const out: string[] = [];
    let inBlock = false;
    let removed = 0;
    for (const line of lines) {
      if (line.includes('// P6-4 caller authentication: begin')) inBlock = true;
      if (inBlock || line.includes('// P6-4 caller authentication (line added to live v7)')) {
        removed += 1;
        if (line.includes('// P6-4 caller authentication: end')) inBlock = false;
        continue;
      }
      out.push(line);
    }
    // The block is followed by one blank line that belongs to it.
    const rebuilt = out.join('\n').replace('  }\n\n\n  const url = new URL(req.url);', '  }\n\n  const url = new URL(req.url);');
    expect(removed).toBe(6);
    expect(createHash('sha256').update(rebuilt).digest('hex')).toBe(LIVE_V7_SHA256);
  });

  it('the check runs after the preflight and before any route; verify_jwt stays off as deployed', () => {
    const src = readFileSync(join(repoRoot(), 'supabase/functions/leads-api/index.ts'), 'utf8');
    const options = src.indexOf('if (req.method === "OPTIONS")');
    const check = src.indexOf('await checkStaff(req.headers.get("Authorization"), supabaseStaffDeps(supabase))');
    const firstRoute = src.indexOf('const url = new URL(req.url);');
    expect(options).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(options);
    expect(firstRoute).toBeGreaterThan(check);
    const config = readFileSync(join(repoRoot(), 'supabase/config.toml'), 'utf8');
    expect(config).toMatch(/\[functions\.leads-api\]\nverify_jwt = false\n/);
  });
});
