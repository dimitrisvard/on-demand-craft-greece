// applyGate: one test per action ID for each principal class, the site-side vectors T1-T12 and T18, request-format
// rules, burst vectors, machine-host rules and per-decision configuration names. Upstreams (Supabase Auth,
// PostgREST, siteverify, Access certs) are fakes installed as the global fetch (./gate-support.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionIdOf, applyGate, type ActionId, type GateOutcome } from '../src/auth/gate';
import { mintProjectKeyShape } from '../../shared/test/helpers/jwt';
import {
  COLLECTOR_ID,
  CI_ID,
  DUMMY_TOKEN,
  MCP_ID,
  PREVIEW,
  TEST_SECRET_FAIL,
  TEST_SECRET_PASS,
  WWW,
  apiCall,
  bearer,
  bodyText,
  ctx,
  fakeLimiter,
  installUpstream,
  makeEnv,
  minutesAgo,
  uuid,
  type ApiCall,
  type FakeUser,
  type Upstream,
} from './gate-support';

let up: Upstream;
let users: Record<'CUSTOMER' | 'PARTNER' | 'STAFF' | 'ADMIN', FakeUser>;

const RFQ_NUMBER = 'RFQ-04102026-7';
const RFQ_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const CUSTOMER_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const CUSTOMER_EMAIL = 'buyer@example.test';
const PARTNER_EMAIL = 'partner@example.test';

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  up = await installUpstream();
  users = {
    CUSTOMER: await up.addUser(['customer']),
    PARTNER: await up.addUser(['partner_seller']),
    STAFF: await up.addUser(['sales_rep']),
    ADMIN: await up.addUser(['admin']),
  };
  up.seed.rfqs.push({ id: RFQ_ID, rfq_number: RFQ_NUMBER, customer_id: CUSTOMER_ID, created_at: minutesAgo(5) });
  up.seed.customers.push({ id: CUSTOMER_ID, email: CUSTOMER_EMAIL });
  up.seed.partners.push({ email: PARTNER_EMAIL, active: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function gate(call: ApiCall, env = makeEnv()): Promise<GateOutcome> {
  const { r, request } = apiCall(call);
  return applyGate(r, request, env, ctx);
}

async function expectDeny(outcome: GateOutcome, status: number, error?: string): Promise<void> {
  expect(outcome.kind).toBe('deny');
  if (outcome.kind !== 'deny') return;
  expect(outcome.response.status).toBe(status);
  if (error !== undefined) {
    expect(outcome.response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(JSON.parse(await bodyText(outcome.response))).toEqual({ error });
  }
}

function expectAllow(outcome: GateOutcome): Extract<GateOutcome, { kind: 'allow' }> {
  expect(outcome.kind).toBe('allow');
  if (outcome.kind !== 'allow') throw new Error('not allowed');
  return outcome;
}

// A request per staff/admin action ID that passes every data rule for a staff caller.
const STAFF_CALLS: Record<string, ApiCall> = {
  'EM-4': { endpoint: 'emails', action: 'rfq-pdf', body: { action: 'rfq-pdf', customerName: 'B', customerEmail: CUSTOMER_EMAIL, companyName: 'C', rfqNumber: RFQ_NUMBER, pdfBase64: 'JVBERi0x' } },
  'S3-4': { endpoint: 's3', action: 'delete-folder', functionUrl: '/api/s3?action=delete-folder', body: { prefix: RFQ_NUMBER } },
  'S3-5': { endpoint: 's3', action: 'list', functionUrl: '/api/s3?action=list', body: { prefix: `${RFQ_NUMBER}/` } },
  'S3-6': { endpoint: 's3', action: 'presign-upload', scope: 'articles', functionUrl: '/api/s3?action=presign-upload', body: { scope: 'articles', fileName: 'a.png', prefix: 'featured/1' } },
  'MK-5': { endpoint: 'marketing', action: 'google-auth', step: 'refresh', functionUrl: `/api/marketing?action=google-auth&step=refresh&account_id=${RFQ_ID}` },
  'MK-7': { endpoint: 'marketing', action: 'apollo-enrich', functionUrl: '/api/marketing?action=apollo-enrich', body: { companies: ['acme.example'], titles: ['CEO'] } },
  'NT-1': { endpoint: 'notifications', action: 'partner', body: { action: 'partner', partnerEmail: PARTNER_EMAIL, partnerName: 'P', orderId: 'o1', orderTitle: 'T', startDate: '2026-10-01', deliveryDate: '2026-10-20' } },
  'NT-2': { endpoint: 'notifications', action: 'production-status', body: { action: 'production-status', partnerName: 'P', orderId: 'o1', orderTitle: 'T', status: 'started' } },
  'NT-3': { endpoint: 'notifications', action: 'nest', body: { action: 'nest', files: [], metadata: { parts: [] } } },
  'NT-4': { endpoint: 'notifications', action: 'inv-materials', functionUrl: '/api/notifications?action=inv-materials' },
  'NT-5': { endpoint: 'notifications', action: 'inv-label', functionUrl: '/api/notifications?action=inv-label&id=1' },
  'NT-6': { endpoint: 'notifications', action: 'inv-stock-scan', body: { action: 'inv-stock-scan', qr: 'abc' } },
  'NT-7': { endpoint: 'notifications', action: 'inv-cron-batch', body: { action: 'inv-cron-batch' } },
  'GS-1': { endpoint: 'gsc', action: 'gsc', functionUrl: '/api/gsc?action=summary' },
  'TD-1': { endpoint: 'tenders', action: 'list', functionUrl: '/api/tenders?country=GR' },
  'TD-2': { endpoint: 'tenders', action: 'patch', method: 'PATCH', body: { id: 'x', status: 'reviewed' } },
  'TS-1': { endpoint: 'tender-scan', action: 'scan', body: { country_code: 'GR' } },
  'FS-1': { endpoint: 'funded-startups', action: 'list', functionUrl: '/api/funded-startups?limit=10' },
  'FS-2': { endpoint: 'funded-startups', action: 'scan', body: { priority: 2 } },
  'FS-3': { endpoint: 'funded-startups', action: 'patch', method: 'PATCH', body: { id: 'x', status: 'contacted' } },
  'SC-1': { endpoint: 'scrape-website', action: 'post', body: { urls: ['https://example.com', 'http://shop.example.org/contact'] } },
  'SC-2': { endpoint: 'scrape-company-profile', action: 'post', body: { url: 'https://www.europages.co.uk/ACME/00000001.html', source: 'europages' } },
  'SC-3': { endpoint: 'scan-directory', action: 'post', body: { url: 'https://www.wlw.de/de/suche?q=cnc' } },
};

const ADMIN_ONLY = new Set(['MK-5', 'NT-7']);
// Machine callers allowed per ID (preview host); every other machine/ID pair is a valid credential of the wrong class.
const MACHINES_OK: Record<string, string[]> = { 'TS-1': ['collector', 'mcp'], 'FS-2': ['mcp'], 'SC-1': ['mcp'], 'SC-3': ['mcp'] };

describe('applyGate: class matrix of the staff and admin actions', () => {
  for (const [id, call] of Object.entries(STAFF_CALLS)) {
    describe(id, () => {
      it('maps to its action ID', () => {
        expect(actionIdOf(apiCall(call).r)).toBe(id);
      });

      it('ANON -> 401 unauthorized', async () => {
        await expectDeny(await gate(call), 401, 'unauthorized');
      });

      for (const cls of ['CUSTOMER', 'PARTNER'] as const) {
        it(`${cls} -> 403 forbidden`, async () => {
          await expectDeny(await gate({ ...call, headers: bearer(users[cls]) }), 403, 'forbidden');
        });
      }

      it(`STAFF -> ${ADMIN_ONLY.has(id) ? '403 forbidden' : 'allow'}`, async () => {
        const outcome = await gate({ ...call, headers: bearer(users.STAFF) });
        if (ADMIN_ONLY.has(id)) return expectDeny(outcome, 403, 'forbidden');
        const allowed = expectAllow(outcome);
        expect(allowed.actionId).toBe(id);
        expect(allowed.principal).toMatchObject({ class: 'STAFF', uid: users.STAFF.uid, roles: ['sales_rep'] });
      });

      it('ADMIN -> allow', async () => {
        const allowed = expectAllow(await gate({ ...call, headers: bearer(users.ADMIN) }));
        expect(allowed.principal).toMatchObject({ class: 'ADMIN', uid: users.ADMIN.uid });
      });

      for (const [name, clientId] of [['collector', COLLECTOR_ID], ['mcp', MCP_ID]] as const) {
        const ok = (MACHINES_OK[id] ?? []).includes(name);
        it(`MACHINE ${name} on a preview host -> ${ok ? 'allow' : '403 forbidden'}`, async () => {
          const outcome = await gate({ ...call, headers: { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(clientId) } });
          if (!ok) return expectDeny(outcome, 403, 'forbidden');
          expect(expectAllow(outcome).principal).toEqual({ class: 'MACHINE', machine: name });
        });
      }
    });
  }

  it('TD-1 accepts the mcp machine for export only', async () => {
    const assertion = { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(MCP_ID) };
    const exported = await gate({ endpoint: 'tenders', action: 'export', functionUrl: '/api/tenders?export=csv', headers: assertion });
    expect(expectAllow(exported).principal).toEqual({ class: 'MACHINE', machine: 'mcp' });
    await expectDeny(await gate({ endpoint: 'tenders', action: 'export', functionUrl: '/api/tenders?export=csv', headers: { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(COLLECTOR_ID) } }), 403, 'forbidden');
  });
});

describe('applyGate: class matrix of the public, form and file actions', () => {
  type Cls = 'ANON' | 'CUSTOMER' | 'PARTNER' | 'STAFF' | 'ADMIN' | 'MACHINE';
  const CLASSES: Cls[] = ['ANON', 'CUSTOMER', 'PARTNER', 'STAFF', 'ADMIN', 'MACHINE'];
  // Expected outcome per class: 'allow:<principal class>' or the denial status.
  type Expect = Record<Cls, string>;
  const all = (v: string): Expect => ({ ANON: v, CUSTOMER: v, PARTNER: v, STAFF: v, ADMIN: v, MACHINE: v });
  const VISIBLE_KEY = `${RFQ_NUMBER}/part-1/visible.step`;

  const ROWS: Array<[string, ActionId, ApiCall, Expect]> = [
    ['EM-1 with a valid token', 'EM-1', { endpoint: 'emails', action: 'email', body: { email: 'a@b.co' }, headers: { 'X-Turnstile-Token': DUMMY_TOKEN } }, all('allow:ANON')],
    ['EM-1 without a token', 'EM-1', { endpoint: 'emails', action: 'email', body: { email: 'a@b.co' } }, all('403')],
    ['EM-2 with a valid token', 'EM-2', { endpoint: 'emails', action: 'contact', body: { email: 'a@b.co' }, headers: { 'X-Turnstile-Token': DUMMY_TOKEN } }, all('allow:ANON')],
    ['EM-2 without a token', 'EM-2', { endpoint: 'emails', action: 'contact', body: { email: 'a@b.co' } }, all('403')],
    ['EM-3 with a valid token', 'EM-3', { endpoint: 'emails', action: 'rfq', body: { customerName: 'B', customerEmail: CUSTOMER_EMAIL, companyName: 'C', rfqNumber: RFQ_NUMBER }, headers: { 'X-Turnstile-Token': DUMMY_TOKEN } },
      { ANON: 'allow:ANON', CUSTOMER: 'allow:ANON', PARTNER: 'allow:ANON', STAFF: 'allow:STAFF', ADMIN: 'allow:ADMIN', MACHINE: 'allow:ANON' }],
    ['EM-3 without a token', 'EM-3', { endpoint: 'emails', action: 'rfq', body: { customerName: 'B', customerEmail: CUSTOMER_EMAIL, companyName: 'C', rfqNumber: RFQ_NUMBER } },
      { ANON: '403', CUSTOMER: '403', PARTNER: '403', STAFF: 'allow:STAFF', ADMIN: 'allow:ADMIN', MACHINE: '403' }],
    ['S3-1 into a fresh RFQ', 'S3-1', { endpoint: 's3', action: 'presign-upload', functionUrl: '/api/s3?action=presign-upload', body: { fileName: 'a.step', prefix: `${RFQ_NUMBER}/p` } },
      { ANON: 'allow:ANON', CUSTOMER: 'allow:CUSTOMER', PARTNER: 'allow:PARTNER', STAFF: 'allow:STAFF', ADMIN: 'allow:ADMIN', MACHINE: 'allow:ANON' }],
    ['S3-2 of a key nobody but staff can see', 'S3-2', { endpoint: 's3', action: 'presign-download', functionUrl: '/api/s3?action=presign-download', body: { key: 'other/hidden.step' } },
      { ANON: '401', CUSTOMER: '403', PARTNER: '403', STAFF: 'allow:STAFF', ADMIN: 'allow:ADMIN', MACHINE: '401' }],
    ['S3-3 of a key the customer and partner can see', 'S3-3', { endpoint: 's3', action: 'delete', functionUrl: '/api/s3?action=delete', body: { key: VISIBLE_KEY } },
      { ANON: '401', CUSTOMER: 'allow:CUSTOMER', PARTNER: '403', STAFF: 'allow:STAFF', ADMIN: 'allow:ADMIN', MACHINE: '401' }],
    ['MK-1', 'MK-1', { endpoint: 'marketing', action: 'track', functionUrl: '/api/marketing?action=track&type=open&eid=x&cid=y' }, all('allow:ANON')],
    ['MK-2', 'MK-2', { endpoint: 'marketing', action: 'webhook', functionUrl: '/api/marketing?action=webhook', body: { type: 'x' } }, all('allow:ANON')],
    ['MK-3 (JSON)', 'MK-3', { endpoint: 'marketing', action: 'google-auth', step: 'authorize', functionUrl: '/api/marketing?action=google-auth&step=authorize', headers: { accept: 'application/json' } },
      { ANON: '401', CUSTOMER: '403', PARTNER: '403', STAFF: '403', ADMIN: 'allow:ADMIN', MACHINE: '401' }],
    ['MK-4', 'MK-4', { endpoint: 'marketing', action: 'google-auth', step: 'callback', functionUrl: '/api/marketing?action=google-auth&step=callback&code=c&state=s' }, all('allow:ANON')],
    ['MK-6', 'MK-6', { endpoint: 'marketing', action: 'google-auth', step: 'error', functionUrl: '/api/marketing?action=google-auth&error=access_denied' }, all('allow:ANON')],
  ];

  for (const [name, id, call, expected] of ROWS) {
    describe(name, () => {
      it('maps to its action ID', () => {
        expect(actionIdOf(apiCall(call).r)).toBe(id);
      });
      for (const cls of CLASSES) {
        it(`${cls} -> ${expected[cls]}`, async () => {
          up.siteverify.answer = { success: true, action: 'test', hostname: 'localhost', challenge_ts: '2022-02-28T15:14:30.096Z' };
          users.CUSTOMER.visibleKeys = [VISIBLE_KEY];
          users.PARTNER.visibleKeys = [VISIBLE_KEY];
          const credential: Record<string, string> = cls === 'ANON' ? {}
            : cls === 'MACHINE' ? { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(MCP_ID) }
              : bearer(users[cls]);
          const outcome = await gate({ ...call, headers: { ...(call.headers ?? {}), ...credential } }, makeEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS }));
          const [kind, value] = expected[cls].split(':');
          if (kind === 'allow') {
            expect(expectAllow(outcome).principal.class).toBe(value);
          } else {
            expect(outcome.kind).toBe('deny');
            expect(outcome.kind === 'deny' && outcome.response.status).toBe(Number(kind));
          }
        });
      }
    });
  }
});

describe('site-side vectors (exit gate 6)', () => {
  const STAFF_ACTION: ApiCall = STAFF_CALLS['GS-1'];

  it('T1: a staff action without Authorization -> 401 unauthorized', async () => {
    await expectDeny(await gate(STAFF_ACTION), 401, 'unauthorized');
  });

  it('T2: the project API key as Bearer -> 401 without any network call (pre-check)', async () => {
    const anonKeyShape = await mintProjectKeyShape('anon');
    await expectDeny(await gate({ ...STAFF_ACTION, headers: { authorization: `Bearer ${anonKeyShape}` } }), 401, 'unauthorized');
    expect(up.calls).toEqual([]);
  });

  it('T3: a customer JWT -> 403 forbidden', async () => {
    await expectDeny(await gate({ ...STAFF_ACTION, headers: bearer(users.CUSTOMER) }), 403, 'forbidden');
  });

  it('T4: a staff JWT -> handler (allow)', async () => {
    expectAllow(await gate({ ...STAFF_ACTION, headers: bearer(users.STAFF) }));
  });

  it('an expired or signed-out token -> 401; Supabase unreachable -> 503 auth_unavailable', async () => {
    await expectDeny(await gate({ ...STAFF_ACTION, headers: { authorization: 'Bearer not.a.token' } }), 401, 'unauthorized');
    const stranger = await up.addUser(['admin']);
    up.users.delete(stranger.token); // Auth no longer knows the session
    await expectDeny(await gate({ ...STAFF_ACTION, headers: bearer(stranger) }), 401, 'unauthorized');
    up.failures.push({ match: /\/auth\/v1\/user$/, failure: 'network' });
    const staff2 = await up.addUser(['sales_rep']);
    await expectDeny(await gate({ ...STAFF_ACTION, headers: bearer(staff2) }), 503, 'auth_unavailable');
  });

  describe('T5: /api/emails email and Turnstile', () => {
    const contact: ApiCall = { endpoint: 'emails', action: 'email', body: { name: 'N', email: 'n@example.test' } };

    it('no token -> 403 turnstile_failed (no siteverify call)', async () => {
      await expectDeny(await gate(contact), 403, 'turnstile_failed');
      expect(up.siteverifyCalls).toHaveLength(0);
    });

    it('test secret 2x (always fails) -> 403', async () => {
      up.siteverify.answer = { success: false, 'error-codes': ['invalid-input-response'] };
      await expectDeny(await gate({ ...contact, headers: { 'X-Turnstile-Token': DUMMY_TOKEN } }, makeEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_FAIL })), 403, 'turnstile_failed');
    });

    it('test secret 1x on a preview host -> gate passes (test-key mode); the token, secret and client IP reach siteverify', async () => {
      up.siteverify.answer = { success: true, challenge_ts: '2022-02-28T15:14:30.096Z', hostname: 'localhost', 'error-codes': [], action: 'test', cdata: 'test-data' };
      const outcome = await gate({ ...contact, headers: { 'X-Turnstile-Token': DUMMY_TOKEN, 'CF-Connecting-IP': '203.0.113.9' } }, makeEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS }));
      expect(expectAllow(outcome).principal).toEqual({ class: 'ANON' });
      expect(up.siteverifyCalls[0].get('response')).toBe(DUMMY_TOKEN);
      expect(up.siteverifyCalls[0].get('secret')).toBe(TEST_SECRET_PASS);
      expect(up.siteverifyCalls[0].get('remoteip')).toBe('203.0.113.9');
    });

    it('test secret on a production host -> 503 turnstile_unavailable, even with turnstile=report', async () => {
      const headers = { 'X-Turnstile-Token': DUMMY_TOKEN };
      await expectDeny(await gate({ ...contact, host: WWW, headers }, makeEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS })), 503, 'turnstile_unavailable');
      await expectDeny(await gate({ ...contact, host: WWW, headers }, makeEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS, API_GATES_MODE: 'turnstile=report' })), 503, 'turnstile_unavailable');
      expect(up.siteverifyCalls).toHaveLength(0);
    });

    it('real secret: action and hostname must match the site', async () => {
      const fresh = new Date().toISOString();
      up.siteverify.answer = { success: true, action: 'quote', hostname: 'www.micronshub.eu', challenge_ts: fresh };
      expectAllow(await gate({ ...contact, host: WWW, headers: { 'X-Turnstile-Token': 'real-token' } }));
      up.siteverify.answer = { success: true, action: 'quote', hostname: 'evil.example', challenge_ts: fresh };
      await expectDeny(await gate({ ...contact, host: WWW, headers: { 'X-Turnstile-Token': 'real-token' } }), 403, 'turnstile_failed');
      up.siteverify.answer = { success: true, action: 'login', hostname: 'www.micronshub.eu', challenge_ts: fresh };
      await expectDeny(await gate({ ...contact, host: WWW, headers: { 'X-Turnstile-Token': 'real-token' } }), 403, 'turnstile_failed');
    });

    it('siteverify unreachable -> 503; with turnstile=report it is logged and allowed', async () => {
      up.failures.push({ match: /challenges\.cloudflare\.com/, failure: 503 });
      await expectDeny(await gate({ ...contact, host: WWW, headers: { 'X-Turnstile-Token': 't' } }), 503, 'turnstile_unavailable');
      const log = vi.mocked(console.log);
      expectAllow(await gate({ ...contact, host: WWW, headers: { 'X-Turnstile-Token': 't' } }, makeEnv({ API_GATES_MODE: 'turnstile=report' })));
      expect(log.mock.calls.map((c) => String(c[0]))).toContain('[microns-site] gate would deny EM-1 turnstile_unavailable');
    });
  });

  it('T6: an unknown emails action resolves to email and needs Turnstile -> 403', async () => {
    const { r, request } = apiCall({ endpoint: 'emails', action: 'email', body: { action: 'unknown', name: 'N' } });
    r.rawAction = 'unknown';
    expect(actionIdOf(r)).toBe('EM-1');
    await expectDeny(await applyGate(r, request, makeEnv(), ctx), 403, 'turnstile_failed');
  });

  it('T7: body action partner with query action inv-stock as CUSTOMER -> 403 (the body wins, staff gate)', async () => {
    const call: ApiCall = { endpoint: 'notifications', action: 'partner', functionUrl: '/api/notifications?action=inv-stock', body: { action: 'partner' }, headers: bearer(users.CUSTOMER) };
    expect(actionIdOf(apiCall(call).r)).toBe('NT-1');
    await expectDeny(await gate(call), 403, 'forbidden');
  });

  it('T8: presign-download of a key the customer cannot see -> 403; its own key -> allow with the 3,600 s cap', async () => {
    const own = `${RFQ_NUMBER}/part-1/a.step`;
    users.CUSTOMER.visibleKeys = [own];
    const call = (key: string): ApiCall => ({ endpoint: 's3', action: 'presign-download', functionUrl: '/api/s3?action=presign-download', body: { key, expiresIn: 86_400 }, headers: bearer(users.CUSTOMER) });
    await expectDeny(await gate(call('RFQ-01012026-3/part-1/b.step')), 403, 'forbidden');
    const allowed = expectAllow(await gate(call(own)));
    expect(allowed.constraints).toMatchObject({ staff: false, maxExpiresIn: 3600 });
    expect(up.calls.some((c) => c.includes(`/rest/v1/rfq_files?select=id&file_path=eq.${encodeURIComponent(own)}`))).toBe(true);
  });

  it('T9: anonymous presign-upload into an RFQ older than 30 min -> 403; a fresh one -> allow with the anonymous limits', async () => {
    up.seed.rfqs.push({ id: uuid(), rfq_number: 'RFQ-03102026-2', customer_id: null, created_at: minutesAgo(31) });
    const upload = (prefix: string): ApiCall => ({ endpoint: 's3', action: 'presign-upload', functionUrl: '/api/s3?action=presign-upload', body: { fileName: 'part.step', contentType: 'model/step', prefix } });
    await expectDeny(await gate(upload('RFQ-03102026-2/part-1')), 403, 'forbidden');
    const allowed = expectAllow(await gate(upload(`${RFQ_NUMBER}/part-1`)));
    expect(allowed.principal).toEqual({ class: 'ANON' });
    expect(allowed.constraints).toMatchObject({ staff: false, noOverwrite: true, maxObjectsUnderPrefix: 50, maxSizeBytes: 209_715_200, maxExpiresIn: 3600 });
    expect(allowed.constraints?.extensionAllowList).toContain('sldprt');
    await expectDeny(await gate(upload('random/part')), 403, 'forbidden');
  });

  it('T10: delete-folder with prefix "R" as STAFF -> 400 invalid_prefix; a whole RFQ number carries the pattern on', async () => {
    const call = (prefix: unknown): ApiCall => ({ endpoint: 's3', action: 'delete-folder', functionUrl: '/api/s3?action=delete-folder', body: { prefix }, headers: bearer(users.STAFF) });
    await expectDeny(await gate(call('R')), 400, 'invalid_prefix');
    await expectDeny(await gate(call('RFQ-04102026')), 400, 'invalid_prefix');
    await expectDeny(await gate(call(['RFQ-04102026-1'])), 400, 'invalid_prefix');
    for (const ok of ['RFQ-04102026-1', 'RFQ-04102026-1/', RFQ_ID, `${RFQ_ID}/`]) {
      const allowed = expectAllow(await gate(call(ok)));
      expect(allowed.constraints?.folderPrefixPattern?.test(ok)).toBe(true);
    }
  });

  describe('T11: inventory requests always work on the default tenant', () => {
    const laserkritis = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

    it('GET inv-materials with tenantId in the query -> the handler sees no tenant parameter', async () => {
      const allowed = expectAllow(await gate({ endpoint: 'notifications', action: 'inv-materials', functionUrl: `/api/notifications?action=inv-materials&tenantId=${laserkritis}&active_only=false&tenant_id=${laserkritis}&tenant%49d=x`, headers: bearer(users.STAFF) }));
      expect(allowed.functionUrl).toBe('/api/notifications?action=inv-materials&active_only=false');
    });

    it('PUT with tenant_id and tenantId in the body -> the body reaching the handler has neither', async () => {
      const allowed = expectAllow(await gate({ endpoint: 'notifications', action: 'inv-materials', method: 'PUT', body: { action: 'inv-materials', id: 'm1', name: 'Steel', tenant_id: laserkritis, tenantId: laserkritis }, headers: bearer(users.STAFF) }));
      expect(JSON.parse(new TextDecoder().decode(allowed.body))).toEqual({ action: 'inv-materials', id: 'm1', name: 'Steel' });
    });

    it('a form-urlencoded or text/plain body -> 415 unsupported_media_type', async () => {
      for (const type of ['application/x-www-form-urlencoded', 'text/plain']) {
        const body = type === 'text/plain' ? '{"action":"inv-materials"}' : `action=inv-materials&tenantId=${laserkritis}`;
        await expectDeny(await gate({ endpoint: 'notifications', action: 'inv-materials', method: 'PUT', body, headers: { ...bearer(users.STAFF), 'content-type': type } }), 415, 'unsupported_media_type');
      }
    });

    it('a request without tenant fields is passed on untouched', async () => {
      const allowed = expectAllow(await gate({ endpoint: 'notifications', action: 'inv-stock', method: 'POST', body: { action: 'inv-stock', x: 1 }, headers: bearer(users.STAFF) }));
      expect(allowed.body).toBeUndefined();
      expect(allowed.functionUrl).toBeUndefined();
    });
  });

  describe('T12: machine callers on tender-scan', () => {
    const scan: ApiCall = { endpoint: 'tender-scan', action: 'scan', body: { country_code: 'GR' } };

    it('the collector token -> allow as MACHINE collector with a machine rate key', async () => {
      const env = makeEnv();
      const allowed = expectAllow(await gate({ ...scan, headers: { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(COLLECTOR_ID) } }, env));
      expect(allowed.principal).toEqual({ class: 'MACHINE', machine: 'collector' });
      expect([...(env.API_RATE_LIMIT as unknown as ReturnType<typeof fakeLimiter>).counts.keys()]).toEqual(['m:collector:tender-scan']);
    });

    it('the CI token only -> 401 (not an API credential)', async () => {
      await expectDeny(await gate({ ...scan, headers: { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(CI_ID) } }), 401, 'unauthorized');
    });

    it('a forged assertion -> 401', async () => {
      const token = await up.machineAssertion(COLLECTOR_ID);
      const [h, p] = token.split('.');
      await expectDeny(await gate({ ...scan, headers: { 'Cf-Access-Jwt-Assertion': `${h}.${p}.AAAA` } }), 401, 'unauthorized');
    });
  });

  it('T18: 31 requests in 60 s on one key -> the 31st is 429 with Retry-After: 60', async () => {
    const env = makeEnv();
    const call: ApiCall = { ...STAFF_CALLS['GS-1'], headers: bearer(users.STAFF) };
    for (let i = 0; i < 30; i++) expectAllow(await gate(call, env));
    const outcome = await gate(call, env);
    await expectDeny(outcome, 429, 'rate_limited');
    expect(outcome.kind === 'deny' && outcome.response.headers.get('Retry-After')).toBe('60');
  });
});

describe('request-format rules of the public mail paths', () => {
  const env = () => makeEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS });
  const passToken = { 'X-Turnstile-Token': DUMMY_TOKEN };
  beforeEach(() => {
    up.siteverify.answer = { success: true, action: 'test', hostname: 'localhost', challenge_ts: '2022-02-28T15:14:30.096Z' };
  });

  for (const action of ['email', 'contact', 'rfq']) {
    it(`${action}: form-urlencoded and text/plain bodies -> 415 before Turnstile`, async () => {
      for (const [type, body] of [['application/x-www-form-urlencoded', 'name=a&email=a%40b.c&message=hi'], ['text/plain', '{"name":"a"}'], ['multipart/form-data; boundary=x', '--x--']]) {
        await expectDeny(await gate({ endpoint: 'emails', action, body, headers: { 'content-type': type } }, env()), 415, 'unsupported_media_type');
      }
      expect(up.siteverifyCalls).toHaveLength(0);
    });

    it(`${action}: array, object, number and boolean values -> 400 invalid_field`, async () => {
      for (const value of [['<b>x</b>'], { a: 1 }, 5, true]) {
        await expectDeny(await gate({ endpoint: 'emails', action, body: { action, name: value, email: 'a@b.co' }, headers: passToken }, env()), 400, 'invalid_field');
      }
    });
  }

  it('a JSON body that is not an object -> 400 invalid_field', async () => {
    for (const body of ['[1,2]', '"text"', 'null']) {
      await expectDeny(await gate({ endpoint: 'emails', action: 'email', body, headers: { 'content-type': 'application/json' } }, env()), 400, 'invalid_field');
    }
  });

  it('application/json with parameters is accepted; null values are accepted', async () => {
    expectAllow(await gate({ endpoint: 'emails', action: 'email', body: JSON.stringify({ name: 'a', phone: null, email: 'a@b.co' }), headers: { ...passToken, 'content-type': 'Application/JSON; charset=UTF-8' } }, env()));
  });

  it('invalid e-mail addresses -> 400 invalid_email', async () => {
    for (const email of ['no-at-sign', 'a@b', 'a b@c.de', '<a@b.co>', 'a@b.co\nBcc: x@y.z']) {
      await expectDeny(await gate({ endpoint: 'emails', action: 'email', body: { email }, headers: passToken }, env()), 400, 'invalid_email');
    }
    await expectDeny(await gate({ endpoint: 'emails', action: 'rfq', body: { customerEmail: 'x' }, headers: passToken }, env()), 400, 'invalid_email');
  });

  it('length caps: name 200, message 5,000, other strings 500 -> 400 field_too_long', async () => {
    const at = (field: string, n: number) => gate({ endpoint: 'emails', action: 'email', body: { email: 'a@b.co', [field]: 'x'.repeat(n) }, headers: passToken }, env());
    expectAllow(await at('name', 200));
    await expectDeny(await at('name', 201), 400, 'field_too_long');
    expectAllow(await at('message', 5000));
    await expectDeny(await at('message', 5001), 400, 'field_too_long');
    expectAllow(await at('company', 500));
    await expectDeny(await at('company', 501), 400, 'field_too_long');
  });

  it('escapes every string except email, customerEmail and action, and re-serialises the body', async () => {
    const body = { action: 'email', name: '<script>x</script>', email: "o'neil@example.test", message: 'a & "b"', rfqNumber: "RFQ-1'", phone: null };
    const allowed = expectAllow(await gate({ endpoint: 'emails', action: 'email', body, headers: passToken }, env()));
    expect(JSON.parse(new TextDecoder().decode(allowed.body))).toEqual({
      action: 'email',
      name: '&lt;script&gt;x&lt;/script&gt;',
      email: "o'neil@example.test",
      message: 'a &amp; &quot;b&quot;',
      rfqNumber: 'RFQ-1&#39;',
      phone: null,
    });
  });

  it('a body with nothing to escape is passed on as received', async () => {
    const allowed = expectAllow(await gate({ endpoint: 'emails', action: 'email', body: { name: 'Ann', email: 'a@b.co', message: 'Hello' }, headers: passToken }, env()));
    expect(allowed.body).toBeUndefined();
  });

  it('rfq-pdf keeps its body untouched (no escaping, any content type)', async () => {
    const allowed = expectAllow(await gate({ ...STAFF_CALLS['EM-4'], headers: bearer(users.STAFF) }));
    expect(allowed.body).toBeUndefined();
  });
});

describe('/api/emails rfq (EM-3) and rfq-pdf (EM-4) recipient rules', () => {
  const passEnv = (extra: Record<string, unknown> = {}) => makeEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS, ...extra });
  const rfqBody = (o: Record<string, unknown> = {}) => ({ action: 'rfq', customerName: 'B', customerEmail: CUSTOMER_EMAIL, companyName: 'C', rfqNumber: RFQ_NUMBER, ...o });
  beforeEach(() => {
    up.siteverify.answer = { success: true, action: 'test', hostname: 'localhost', challenge_ts: '2022-02-28T15:14:30.096Z' };
  });

  it('rfq with Turnstile for the RFQ customer of a fresh RFQ -> allow', async () => {
    expectAllow(await gate({ endpoint: 'emails', action: 'rfq', body: rfqBody(), headers: { 'X-Turnstile-Token': DUMMY_TOKEN } }, passEnv()));
  });

  it('rfq to another address -> 422 recipient_mismatch; unknown RFQ -> 422', async () => {
    await expectDeny(await gate({ endpoint: 'emails', action: 'rfq', body: rfqBody({ customerEmail: 'victim@example.test' }), headers: { 'X-Turnstile-Token': DUMMY_TOKEN } }, passEnv()), 422, 'recipient_mismatch');
    await expectDeny(await gate({ endpoint: 'emails', action: 'rfq', body: rfqBody({ rfqNumber: 'RFQ-01012020-1' }), headers: { 'X-Turnstile-Token': DUMMY_TOKEN } }, passEnv()), 422, 'recipient_mismatch');
  });

  it('rfq for an RFQ older than 30 min -> 403 for the public, allowed for staff without Turnstile', async () => {
    up.seed.rfqs[0].created_at = minutesAgo(45);
    await expectDeny(await gate({ endpoint: 'emails', action: 'rfq', body: rfqBody(), headers: { 'X-Turnstile-Token': DUMMY_TOKEN } }, passEnv()), 403, 'forbidden');
    const allowed = expectAllow(await gate({ endpoint: 'emails', action: 'rfq', body: rfqBody(), headers: bearer(users.STAFF) }, passEnv()));
    expect(allowed.principal.class).toBe('STAFF');
  });

  it('rfq without Turnstile and without staff -> 403 turnstile_failed', async () => {
    await expectDeny(await gate({ endpoint: 'emails', action: 'rfq', body: rfqBody(), headers: bearer(users.CUSTOMER) }, passEnv()), 403, 'turnstile_failed');
  });

  it('rfq with a missing required field goes to the handler (it answers 400 before sending)', async () => {
    expectAllow(await gate({ endpoint: 'emails', action: 'rfq', body: rfqBody({ companyName: '' }), headers: { 'X-Turnstile-Token': DUMMY_TOKEN } }, passEnv()));
  });

  it('rfq-pdf recipient mismatch: logged and allowed by default (recipient=report), 422 with recipient=enforce', async () => {
    const call: ApiCall = { ...STAFF_CALLS['EM-4'], body: { ...(STAFF_CALLS['EM-4'].body as object), customerEmail: 'other@example.test' }, headers: bearer(users.STAFF) };
    expectAllow(await gate(call));
    expect(vi.mocked(console.log).mock.calls.map((c) => String(c[0]))).toContain('[microns-site] gate would deny EM-4 recipient_mismatch');
    await expectDeny(await gate(call, makeEnv({ API_GATES_MODE: 'recipient=enforce' })), 422, 'recipient_mismatch');
    // A var that does not name the class enforces it.
    await expectDeny(await gate(call, makeEnv({ API_GATES_MODE: 'redirect=report' })), 422, 'recipient_mismatch');
  });
});

describe('NT-1 partner recipient (always enforced)', () => {
  const call = (partnerEmail: unknown): ApiCall => ({ ...STAFF_CALLS['NT-1'], body: { ...(STAFF_CALLS['NT-1'].body as object), partnerEmail }, headers: bearer(users.STAFF) });

  it('an address that is not an active production partner -> 422 recipient_mismatch, also in report mode', async () => {
    up.seed.partners.push({ email: 'old@example.test', active: false });
    await expectDeny(await gate(call('someone@example.test')), 422, 'recipient_mismatch');
    await expectDeny(await gate(call('old@example.test')), 422, 'recipient_mismatch');
    await expectDeny(await gate(call('someone@example.test'), makeEnv({ API_GATES_MODE: 'data=report,recipient=report' })), 422, 'recipient_mismatch');
    await expectDeny(await gate(call(['partner@example.test'])), 422, 'recipient_mismatch');
  });

  it('a wildcard-looking address is compared literally', async () => {
    await expectDeny(await gate(call('*@example.test')), 422, 'recipient_mismatch');
    expect(up.calls.some((c) => c.includes('email=eq.*%40example.test'))).toBe(true);
  });
});

describe('S3 ownership rules', () => {
  const upload = (prefix: unknown, headers?: Record<string, string>): ApiCall => ({ endpoint: 's3', action: 'presign-upload', functionUrl: '/api/s3?action=presign-upload', body: { fileName: 'x.step', prefix }, headers });

  it('a customer uploads into an RFQ it owns (number or id) even when it is older than 30 min', async () => {
    up.seed.rfqs[0].created_at = minutesAgo(600);
    users.CUSTOMER.rfqIds = [RFQ_ID];
    for (const prefix of [`${RFQ_NUMBER}/part-1`, `${RFQ_ID}/files`]) {
      const allowed = expectAllow(await gate(upload(prefix, bearer(users.CUSTOMER))));
      expect(allowed.principal.class).toBe('CUSTOMER');
      expect(allowed.constraints).toMatchObject({ staff: false, noOverwrite: true });
      expect(allowed.constraints?.maxObjectsUnderPrefix).toBeUndefined();
    }
  });

  it('a customer that does not own the RFQ falls back to the anonymous rule', async () => {
    users.CUSTOMER.rfqIds = [];
    const fresh = expectAllow(await gate(upload(`${RFQ_NUMBER}/p`, bearer(users.CUSTOMER))));
    expect(fresh.constraints?.maxObjectsUnderPrefix).toBe(50);
    up.seed.rfqs[0].created_at = minutesAgo(40);
    await expectDeny(await gate(upload(`${RFQ_NUMBER}/p`, bearer(users.CUSTOMER))), 403, 'forbidden');
  });

  it('staff upload anywhere without limits', async () => {
    const allowed = expectAllow(await gate(upload('anything/at/all', bearer(users.STAFF))));
    expect(allowed.constraints).toEqual({ staff: true, maxExpiresIn: 3600, noOverwrite: false });
  });

  it('a missing fileName goes to the files handler (it answers 400)', async () => {
    expectAllow(await gate({ endpoint: 's3', action: 'presign-upload', functionUrl: '/api/s3?action=presign-upload', body: { prefix: 'x' } }));
  });

  it('delete: a customer only with a visible row; a partner never; anonymous 401', async () => {
    const key = `${RFQ_NUMBER}/p/a.step`;
    users.CUSTOMER.visibleKeys = [key];
    users.PARTNER.visibleKeys = [key];
    const del = (headers?: Record<string, string>, k = key): ApiCall => ({ endpoint: 's3', action: 'delete', functionUrl: '/api/s3?action=delete', body: { key: k }, headers });
    expectAllow(await gate(del(bearer(users.CUSTOMER))));
    await expectDeny(await gate(del(bearer(users.CUSTOMER), 'other/key')), 403, 'forbidden');
    await expectDeny(await gate(del(bearer(users.PARTNER))), 403, 'forbidden');
    await expectDeny(await gate(del()), 401, 'unauthorized');
    expectAllow(await gate(del(bearer(users.STAFF), 'other/key')));
  });

  it('presign-download: a partner may read a row it can see', async () => {
    const key = `${RFQ_NUMBER}/p/a.step`;
    users.PARTNER.visibleKeys = [key];
    expectAllow(await gate({ endpoint: 's3', action: 'presign-download', functionUrl: '/api/s3?action=presign-download', body: { key }, headers: bearer(users.PARTNER) }));
  });

  it('a text/plain JSON body is read as the files handler reads it', async () => {
    users.CUSTOMER.visibleKeys = ['k1'];
    expectAllow(await gate({ endpoint: 's3', action: 'presign-download', functionUrl: '/api/s3?action=presign-download', body: '{"key":"k1"}', headers: { ...bearer(users.CUSTOMER), 'content-type': 'text/plain' } }));
    await expectDeny(await gate({ endpoint: 's3', action: 'presign-download', functionUrl: '/api/s3?action=presign-download', body: '{"key":"k2"}', headers: { ...bearer(users.CUSTOMER), 'content-type': 'text/plain' } }), 403, 'forbidden');
  });

  it('a database outage during an ownership lookup -> 503 auth_unavailable', async () => {
    up.failures.push({ match: /\/rest\/v1\/rfq_files/, failure: 502 });
    await expectDeny(await gate({ endpoint: 's3', action: 'presign-download', functionUrl: '/api/s3?action=presign-download', body: { key: 'k' }, headers: bearer(users.CUSTOMER) }), 503, 'auth_unavailable');
  });

  it('articles scope and list are staff only', async () => {
    await expectDeny(await gate({ ...STAFF_CALLS['S3-6'], headers: bearer(users.CUSTOMER) }), 403, 'forbidden');
    await expectDeny(await gate({ ...STAFF_CALLS['S3-5'] }), 401, 'unauthorized');
  });
});

describe('staff-tool data rules', () => {
  it('SC-1: every URL must be a public web host', async () => {
    const call = (urls: unknown[]): ApiCall => ({ endpoint: 'scrape-website', action: 'post', body: { urls }, headers: bearer(users.STAFF) });
    for (const bad of ['http://127.0.0.1/', 'http://2130706433/', 'http://[::1]/', 'http://localhost:3000', 'https://intranet', 'https://www.micronshub.eu/x', 'https://tenant.micronshub.eu', 'https://x.workers.dev', 'https://on-demand-craft-greece.vercel.app', 'ftp://example.com', 'file:///etc/passwd', 42]) {
      await expectDeny(await gate(call(['https://example.com', bad])), 400, 'url_not_allowed');
    }
    expectAllow(await gate(call(['https://example.com', 'https://sub.example.co.uk/contact'])));
    // Shapes the handler refuses itself go through unchanged.
    expectAllow(await gate(call([])));
    expectAllow(await gate(call(Array.from({ length: 26 }, () => 'http://127.0.0.1'))));
  });

  it('SC-2 and SC-3: only Europages and wlw hosts', async () => {
    for (const id of ['SC-2', 'SC-3'] as const) {
      const base = STAFF_CALLS[id];
      const call = (url: string): ApiCall => ({ ...base, body: { ...(base.body as object), url }, headers: bearer(users.STAFF) });
      for (const ok of ['https://www.europages.de/unternehmen/x.html', 'https://europages.com/x', 'https://www.wlw.at/de/suche?q=x']) expectAllow(await gate(call(ok)));
      for (const bad of ['https://europages.evil.com/x', 'https://evil.com/europages.de', 'http://169.254.169.254/latest', 'https://wlw.de.evil.net/']) {
        await expectDeny(await gate(call(bad)), 400, 'url_not_allowed');
      }
    }
  });

  it('FS-2: priority must be 1, 2 or 3 when given', async () => {
    const call = (priority: unknown): ApiCall => ({ endpoint: 'funded-startups', action: 'scan', body: { priority }, headers: bearer(users.STAFF) });
    for (const ok of [1, 3, '2', null, '']) expectAllow(await gate(call(ok)));
    for (const bad of [4, 0, '9', 'all', 2.5]) await expectDeny(await gate(call(bad)), 400, 'invalid_field');
  });
});

describe('machine callers and hosts', () => {
  const scan: ApiCall = { endpoint: 'tender-scan', action: 'scan', body: { country_code: 'GR' } };

  it('a machine assertion on www or the apex is ignored -> 401 (no certs fetched)', async () => {
    for (const host of [WWW, 'https://micronshub.eu', 'https://tenant.micronshub.eu']) {
      await expectDeny(await gate({ ...scan, host, headers: { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(COLLECTOR_ID) } }), 401, 'unauthorized');
    }
    expect(up.calls.some((c) => c.includes('/cdn-cgi/access/certs'))).toBe(false);
  });

  it('a zone host listed in API_MACHINE_HOSTS accepts machines; unlisted it does not', async () => {
    const headers = { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(COLLECTOR_ID) };
    const api = 'https://api.micronshub.eu';
    await expectDeny(await gate({ ...scan, host: api, headers }, makeEnv({ API_MACHINE_HOSTS: '' })), 401, 'unauthorized');
    expectAllow(await gate({ ...scan, host: api, headers }, makeEnv({ API_MACHINE_HOSTS: 'other.example, API.micronshub.eu' })));
    await expectDeny(await gate({ ...scan, host: WWW, headers }, makeEnv({ API_MACHINE_HOSTS: 'api.micronshub.eu' })), 401, 'unauthorized');
  });

  it('a staff JWT still works on any host', async () => {
    expectAllow(await gate({ ...scan, host: WWW, headers: bearer(users.STAFF) }));
  });
});

describe('per-decision configuration names', () => {
  it('without TURNSTILE_SECRET_KEY: /api/emails email -> 500 with a log line; a tracking request is still allowed', async () => {
    const env = makeEnv({ TURNSTILE_SECRET_KEY: undefined });
    const outcome = await gate({ endpoint: 'emails', action: 'email', body: { name: 'a' }, headers: { 'X-Turnstile-Token': 't' } }, env);
    expect(outcome.kind).toBe('deny');
    if (outcome.kind === 'deny') {
      expect(outcome.response.status).toBe(500);
      expect(await bodyText(outcome.response)).toBe('Internal Server Error');
    }
    expect(vi.mocked(console.error).mock.calls.map((c) => String(c[0]))).toContain('[microns-site] api config missing: TURNSTILE_SECRET_KEY');
    expectAllow(await gate({ endpoint: 'marketing', action: 'track', functionUrl: `/api/marketing?action=track&type=open&eid=${uuid()}&cid=${uuid()}` }, env));
  });

  it('without the ACCESS names: a machine request on a preview host -> 500; a staff JWT is unaffected', async () => {
    const env = makeEnv({ ACCESS_TEAM_DOMAIN: undefined });
    const outcome = await gate({ endpoint: 'tender-scan', action: 'scan', body: {}, headers: { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(COLLECTOR_ID) } }, env);
    expect(outcome.kind === 'deny' && outcome.response.status).toBe(500);
    expectAllow(await gate({ endpoint: 'tender-scan', action: 'scan', body: {}, headers: bearer(users.STAFF) }, env));
  });

  it('without SUPABASE_SERVICE_ROLE_KEY: anonymous upload into an RFQ -> 500; staff upload unaffected', async () => {
    const env = makeEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    const call: ApiCall = { endpoint: 's3', action: 'presign-upload', functionUrl: '/api/s3?action=presign-upload', body: { fileName: 'a.step', prefix: `${RFQ_NUMBER}/x` } };
    expect((await gate(call, env)).kind).toBe('deny');
    expectAllow(await gate({ ...call, headers: bearer(users.STAFF) }, env));
  });

  it('without API_RATE_LIMIT: rate-limited decisions -> 500; MAIL and BULK keys use their own bindings', async () => {
    const env = makeEnv({ API_RATE_LIMIT: undefined });
    const outcome = await gate({ ...STAFF_CALLS['GS-1'], headers: bearer(users.STAFF) }, env);
    expect(outcome.kind === 'deny' && outcome.response.status).toBe(500);
    expectAllow(await gate({ ...STAFF_CALLS['FS-1'], headers: bearer(users.STAFF) }, env));
  });

  it('MAIL and BULK fall back to API_RATE_LIMIT when unbound', async () => {
    const env = makeEnv({ API_RATE_LIMIT_MAIL: undefined, API_RATE_LIMIT_BULK: undefined, TURNSTILE_SECRET_KEY: TEST_SECRET_PASS });
    up.siteverify.answer = { success: true };
    expectAllow(await gate({ endpoint: 'emails', action: 'email', body: { email: 'A@B.co' }, headers: { 'X-Turnstile-Token': DUMMY_TOKEN, 'CF-Connecting-IP': '203.0.113.5' } }, env));
    const keys = [...(env.API_RATE_LIMIT as unknown as ReturnType<typeof fakeLimiter>).counts.keys()];
    expect(keys[0]).toBe('form:203.0.113.5');
    expect(keys[1]).toMatch(/^rcpt:[0-9a-f]{64}$/);
  });
});

describe('burst vectors', () => {
  it('40 parallel presign-download by one staff user -> all allowed (bulk binding)', async () => {
    const env = makeEnv();
    const call: ApiCall = { endpoint: 's3', action: 'presign-download', functionUrl: '/api/s3?action=presign-download', body: { key: 'k' }, headers: bearer(users.STAFF) };
    const outcomes = await Promise.all(Array.from({ length: 40 }, () => gate(call, env)));
    expect(outcomes.every((o) => o.kind === 'allow')).toBe(true);
    expect((env.API_RATE_LIMIT_BULK as unknown as ReturnType<typeof fakeLimiter>).counts.get(`u:${users.STAFF.uid}:s3:r`)).toBe(40);
  });

  it('40 sequential anonymous presign-upload for one fresh RFQ -> all allowed', async () => {
    const env = makeEnv();
    for (let i = 0; i < 40; i++) {
      expectAllow(await gate({ endpoint: 's3', action: 'presign-upload', functionUrl: '/api/s3?action=presign-upload', body: { fileName: `p${i}.step`, prefix: `${RFQ_NUMBER}/part-${i}` }, headers: { 'CF-Connecting-IP': '198.51.100.4' } }, env));
    }
    expect((env.API_RATE_LIMIT_BULK as unknown as ReturnType<typeof fakeLimiter>).counts.get('upl:198.51.100.4')).toBe(40);
  });

  it('31 rfq-pdf calls by one staff user -> the 31st is 429', async () => {
    const env = makeEnv();
    const call: ApiCall = { ...STAFF_CALLS['EM-4'], headers: bearer(users.STAFF) };
    for (let i = 0; i < 30; i++) expectAllow(await gate(call, env));
    await expectDeny(await gate(call, env), 429, 'rate_limited');
  });

  it('public mail: the sixth message from one address within the window -> 429 (mail binding)', async () => {
    const env = makeEnv({ TURNSTILE_SECRET_KEY: TEST_SECRET_PASS });
    up.siteverify.answer = { success: true };
    const call = (i: number): ApiCall => ({ endpoint: 'emails', action: 'email', body: { email: `a${i}@b.co` }, headers: { 'X-Turnstile-Token': DUMMY_TOKEN, 'CF-Connecting-IP': '192.0.2.1' } });
    for (let i = 0; i < 5; i++) expectAllow(await gate(call(i), env));
    await expectDeny(await gate(call(9), env), 429, 'rate_limited');
  });
});

describe('report mode for the auth class', () => {
  it('auth=report: a missing credential is logged and the request goes on as ANON', async () => {
    const outcome = expectAllow(await gate(STAFF_CALLS['GS-1'], makeEnv({ API_GATES_MODE: 'auth=report' })));
    expect(outcome.principal).toEqual({ class: 'ANON' });
    expect(vi.mocked(console.log).mock.calls.map((c) => String(c[0]))).toContain('[microns-site] gate would deny GS-1 unauthorized');
  });

  it('log lines carry no token, address or body', async () => {
    await gate({ ...STAFF_CALLS['NT-1'], headers: bearer(users.CUSTOMER) }, makeEnv({ API_GATES_MODE: 'auth=report' }));
    const lines = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].map((c) => c.map(String).join(' '));
    for (const line of lines) {
      expect(line.startsWith('[microns-site] ')).toBe(true);
      expect(line).not.toContain(users.CUSTOMER.token);
      expect(line).not.toContain(PARTNER_EMAIL);
    }
  });
});

describe('actionIdOf', () => {
  // Every normalised action of the resolver catalogue maps to an ID.
  const NORMALISED: Array<[ApiCall['endpoint'], string, Partial<ApiCall>?, ActionId?]> = [
    ['emails', 'email', {}, 'EM-1'], ['emails', 'contact', {}, 'EM-2'], ['emails', 'rfq', {}, 'EM-3'], ['emails', 'rfq-pdf', {}, 'EM-4'],
    ['s3', 'presign-upload', {}, 'S3-1'], ['s3', 'presign-download', {}, 'S3-2'], ['s3', 'delete', {}, 'S3-3'],
    ['s3', 'delete-folder', {}, 'S3-4'], ['s3', 'list', {}, 'S3-5'], ['s3', 'list', { scope: 'articles' }, 'S3-6'],
    ['s3', 'delete', { scope: 'articles' }, 'S3-6'],
    ['marketing', 'track', {}, 'MK-1'], ['marketing', 'webhook', {}, 'MK-2'],
    ['marketing', 'google-auth', { step: 'authorize' }, 'MK-3'], ['marketing', 'google-auth', { step: 'callback' }, 'MK-4'],
    ['marketing', 'google-auth', { step: 'refresh' }, 'MK-5'], ['marketing', 'google-auth', { step: 'error' }, 'MK-6'],
    ['marketing', 'apollo-enrich', {}, 'MK-7'],
    ['notifications', 'partner', {}, 'NT-1'], ['notifications', 'production-status', {}, 'NT-2'], ['notifications', 'nest', {}, 'NT-3'],
    ['notifications', 'inv-materials', {}, 'NT-4'], ['notifications', 'inv-x', {}, 'NT-4'], ['notifications', 'inv-label', {}, 'NT-5'],
    ['notifications', 'inv-stock-scan', {}, 'NT-6'], ['notifications', 'inv-cron-batch', {}, 'NT-7'],
    ['gsc', 'gsc', {}, 'GS-1'],
    ['tenders', 'connectors', {}, 'TD-1'], ['tenders', 'stats', {}, 'TD-1'], ['tenders', 'export', {}, 'TD-1'], ['tenders', 'id', {}, 'TD-1'],
    ['tenders', 'list', {}, 'TD-1'], ['tenders', 'patch', {}, 'TD-2'],
    ['tender-scan', 'scan', {}, 'TS-1'],
    ['funded-startups', 'stats', {}, 'FS-1'], ['funded-startups', 'feeds', {}, 'FS-1'], ['funded-startups', 'export', {}, 'FS-1'],
    ['funded-startups', 'id', {}, 'FS-1'], ['funded-startups', 'list', {}, 'FS-1'], ['funded-startups', 'scan', {}, 'FS-2'],
    ['funded-startups', 'patch', {}, 'FS-3'],
    ['scrape-website', 'post', {}, 'SC-1'], ['scrape-company-profile', 'post', {}, 'SC-2'], ['scan-directory', 'post', {}, 'SC-3'],
  ];

  it.each(NORMALISED)('%s %s %j -> %s', (endpoint, action, extra, id) => {
    expect(actionIdOf(apiCall({ endpoint, action, ...extra }).r)).toBe(id);
  });

  it('returns null for every sentinel on every endpoint', () => {
    for (const endpoint of ['emails', 's3', 'marketing', 'notifications', 'gsc', 'tenders', 'tender-scan', 'funded-startups', 'scrape-website', 'scrape-company-profile', 'scan-directory'] as const) {
      for (const sentinel of ['#options', '#method', '#unknown', '#unknown-step', '#throws']) {
        expect(actionIdOf(apiCall({ endpoint, action: sentinel }).r)).toBeNull();
      }
    }
  });

  it('applyGate refuses (throws) a non-sentinel it cannot classify', async () => {
    const { r, request } = apiCall({ endpoint: 'tenders', action: 'bogus' });
    await expect(applyGate(r, request, makeEnv(), ctx)).rejects.toThrow(/no action id/);
  });

  it('covers every action ID of the policy', () => {
    const ids = new Set(NORMALISED.map((row) => row[3]));
    expect(ids.size).toBe(34);
  });
});

describe('ungated actions', () => {
  it('MK-2 webhook: allowed as ANON without any check or rate limit (verified in microns-ops)', async () => {
    const env = makeEnv();
    const allowed = expectAllow(await gate({ endpoint: 'marketing', action: 'webhook', functionUrl: '/api/marketing?action=webhook', body: { type: 'x' } }, env));
    expect(allowed.principal).toEqual({ class: 'ANON' });
    expect(up.calls).toEqual([]);
    expect((env.API_RATE_LIMIT as unknown as ReturnType<typeof fakeLimiter>).counts.size).toBe(0);
  });

  it('MK-6 google-auth error: allowed as ANON', async () => {
    expect(expectAllow(await gate({ endpoint: 'marketing', action: 'google-auth', step: 'error', functionUrl: '/api/marketing?action=google-auth&error=access_denied' })).principal).toEqual({ class: 'ANON' });
  });

  it('a bearer on a public action is not verified (no network)', async () => {
    await gate({ endpoint: 'marketing', action: 'webhook', functionUrl: '/api/marketing?action=webhook', headers: bearer(users.ADMIN) });
    expect(up.calls).toEqual([]);
  });
});
