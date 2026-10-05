// applyGate for /api/agent/* (action IDs AG-1…AG-7): the class matrix of the session rows, the relay signature
// (good, bad, timestamp window both ways, replay, missing secret), signed partner links (expiry window, key
// patterns, signature), the admin-only flag edits and test card, staff file keys, exact body shapes and rate keys.
// Upstreams (Supabase Auth, PostgREST, Access certs) are the fakes of ./gate-support.ts.

import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionIdOf, applyGate, type GateOutcome } from '../src/auth/gate';
import { relaySeen } from '../src/auth/agent-hmac';
import {
  MCP_ID,
  apiCall,
  bearer,
  bodyText,
  ctx,
  fakeLimiter,
  installUpstream,
  makeEnv,
  type ApiCall,
  type FakeLimiter,
  type FakeUser,
  type Upstream,
} from './gate-support';

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


const SECRET = ['agent', 'gate', 'test', 'value'].join('-');
const RUN = '5d6e7f80-91a2-4b3c-8d4e-5f6a7b8c9d0e';
const ORDER = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';
const HASH = 'b'.repeat(64);
const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHA = 'c'.repeat(64);

let up: Upstream;
let users: Record<'CUSTOMER' | 'PARTNER' | 'STAFF' | 'ADMIN', FakeUser>;
let limiter: FakeLimiter;

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
  limiter = fakeLimiter(30);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function env(over: Record<string, unknown> = {}) {
  return makeEnv({ API_RATE_LIMIT: limiter, AGENT_APPROVAL_SECRET: SECRET, ...over } as never);
}

async function gate(call: ApiCall, e = env()): Promise<GateOutcome> {
  const { r, request } = apiCall(call);
  return applyGate(r, request, e, ctx);
}

async function expectDeny(outcome: GateOutcome, status: number, error?: string): Promise<void> {
  expect(outcome.kind).toBe('deny');
  if (outcome.kind !== 'deny') return;
  expect(outcome.response.status).toBe(status);
  if (error !== undefined) expect(JSON.parse(await bodyText(outcome.response))).toEqual({ error });
}

function expectAllow(outcome: GateOutcome): Extract<GateOutcome, { kind: 'allow' }> {
  if (outcome.kind !== 'allow') throw new Error(`expected allow, got ${outcome.kind} ${outcome.response.status}`);
  return outcome;
}

const dashboardBody = { v: 1, run_id: RUN, token_sha256: HASH, verb: 'approve' };
const relayBody = { v: 1, token: TOKEN, code: 'ok', tg: { user_id: 42, chat_id: 42, message_id: 7 } };

function relayHeaders(body: string, o: { ts?: number; secret?: string } = {}): Record<string, string> {
  const ts = o.ts ?? Math.floor(Date.now() / 1000);
  return {
    'content-type': 'application/json',
    'X-Microns-Timestamp': String(ts),
    'X-Microns-Signature': nodeCrypto.createHmac('sha256', o.secret ?? SECRET).update(`${ts}.${body}`).digest('hex'),
  };
}

function relayCall(body: unknown = relayBody, o: { ts?: number; secret?: string; headers?: Record<string, string> } = {}): ApiCall {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { endpoint: 'agent', action: 'decision', functionUrl: '/api/agent/decision', method: 'POST', body: text, headers: { ...relayHeaders(text, o), ...o.headers } };
}

/** sig of a partner link computed independently with node:crypto (HKDF-SHA256, info microns-file-link-v1). */
function linkSig(key: string, exp: number, secret = SECRET): string {
  const k = new Uint8Array(nodeCrypto.hkdfSync('sha256', secret, new Uint8Array(0), 'microns-file-link-v1', 32));
  return nodeCrypto.createHmac('sha256', k).update(`${key}|${exp}`).digest('base64url');
}

function linkCall(key: string, exp: number, sig = linkSig(key, exp)): ApiCall {
  const q = new URLSearchParams({ k: key, exp: String(exp), sig });
  return { endpoint: 'agent', action: 'file', functionUrl: `/api/agent/file?${q}`, headers: { 'CF-Connecting-IP': '203.0.113.9' } };
}

const nowS = () => Math.floor(Date.now() / 1000);

describe('actionIdOf for endpoint agent', () => {
  it('decision AG-1, flag AG-4, status AG-5, start AG-6, file with sig AG-3, file without sig AG-7; sentinels null', () => {
    const id = (action: string, functionUrl = `/api/agent/${action}`) => actionIdOf(apiCall({ endpoint: 'agent', action, functionUrl }).r);
    expect(id('decision')).toBe('AG-1');
    expect(id('flag')).toBe('AG-4');
    expect(id('status')).toBe('AG-5');
    expect(id('start')).toBe('AG-6');
    expect(id('file', '/api/agent/file?k=a&exp=1&sig=x')).toBe('AG-3');
    expect(id('file', '/api/agent/file?k=a&sig=')).toBe('AG-3');
    expect(id('file', '/api/agent/file?k=a')).toBe('AG-7');
    for (const sentinel of ['#unknown', '#method']) expect(id(sentinel)).toBeNull();
    expect(id('bogus')).toBeNull();
  });
});

describe('session rows: class matrix', () => {
  const CALLS: Record<string, ApiCall> = {
    'AG-1': { endpoint: 'agent', action: 'decision', functionUrl: '/api/agent/decision', body: dashboardBody },
    'AG-4': { endpoint: 'agent', action: 'flag', functionUrl: '/api/agent/flag', body: { v: 1, key: 'agent.quote', expected_rev: 4, enabled: true } },
    'AG-5': { endpoint: 'agent', action: 'status', functionUrl: '/api/agent/status' },
    'AG-6': { endpoint: 'agent', action: 'start', functionUrl: '/api/agent/start', body: { v: 1, kind: 'quote', rfq_id: RUN } },
    'AG-7': { endpoint: 'agent', action: 'file', functionUrl: `/api/agent/file?k=quotes/${RUN}/v2/quote.pdf` },
  };
  const ADMIN_ONLY = new Set(['AG-4']);

  for (const [id, call] of Object.entries(CALLS)) {
    describe(id, () => {
      it('ANON -> 401', async () => {
        await expectDeny(await gate(call), 401, 'unauthorized');
      });
      for (const cls of ['CUSTOMER', 'PARTNER'] as const) {
        it(`${cls} -> 403`, async () => {
          await expectDeny(await gate({ ...call, headers: bearer(users[cls]) }), 403, 'forbidden');
        });
      }
      it(`STAFF -> ${ADMIN_ONLY.has(id) ? '403' : 'allow'}`, async () => {
        const outcome = await gate({ ...call, headers: bearer(users.STAFF) });
        if (ADMIN_ONLY.has(id)) return expectDeny(outcome, 403, 'forbidden');
        const allowed = expectAllow(outcome);
        expect(allowed.actionId).toBe(id);
        expect(allowed.principal).toMatchObject({ class: 'STAFF', uid: users.STAFF.uid });
        expect(limiter.counts.get(`u:${users.STAFF.uid}:agent`)).toBe(1);
      });
      it('ADMIN -> allow', async () => {
        const allowed = expectAllow(await gate({ ...call, headers: bearer(users.ADMIN) }));
        expect(allowed.actionId).toBe(id);
        expect(allowed.principal).toMatchObject({ class: 'ADMIN', uid: users.ADMIN.uid });
      });
      it('an Access machine credential (mcp, preview host) -> 403: no machine caller on agent rows', async () => {
        await expectDeny(await gate({ ...call, headers: { 'Cf-Access-Jwt-Assertion': await up.machineAssertion(MCP_ID) } }), 403, 'forbidden');
      });
    });
  }

  it('rate limit: the 31st request of a staff user in the window -> 429', async () => {
    for (let i = 0; i < 30; i++) expectAllow(await gate({ ...CALLS['AG-5'], headers: bearer(users.STAFF) }));
    await expectDeny(await gate({ ...CALLS['AG-5'], headers: bearer(users.STAFF) }), 429, 'rate_limited');
  });

  it('the session rows work without AGENT_APPROVAL_SECRET', async () => {
    const e = env({ AGENT_APPROVAL_SECRET: undefined });
    for (const call of Object.values(CALLS)) expectAllow(await gate({ ...call, headers: bearer(users.ADMIN) }, e));
  });
});

describe('AG-1 dashboard decision body', () => {
  const call = (body: unknown): ApiCall => ({ endpoint: 'agent', action: 'decision', functionUrl: '/api/agent/decision', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { ...bearer(users.STAFF), 'content-type': 'application/json' } });

  it('exact DecisionBodyDashboard (with edits and note) -> allow', async () => {
    expectAllow(await gate(call(dashboardBody)));
    expectAllow(await gate(call({ ...dashboardBody, note: 'checked', edits: { shipping: 12, overrides: [{ line_no: 1, unit_price: 3.5 }] } })));
  });

  it('a raw approval token from a session -> 400 bad_request (also beside a hash)', async () => {
    await expectDeny(await gate(call({ v: 1, token: TOKEN, code: 'ok', tg: { user_id: 1, chat_id: 1, message_id: 1 } })), 400, 'bad_request');
    await expectDeny(await gate(call({ ...dashboardBody, token: TOKEN })), 400, 'bad_request');
  });

  it('wrong shapes -> 400 bad_request', async () => {
    for (const body of [
      '', 'not json', '[]', { ...dashboardBody, v: 2 }, { ...dashboardBody, token_sha256: 'B'.repeat(64) }, { ...dashboardBody, run_id: 'x' },
      { ...dashboardBody, verb: 'Approve!' }, { ...dashboardBody, extra: 1 }, { ...dashboardBody, note: 'x'.repeat(501) },
    ]) {
      await expectDeny(await gate(call(body)), 400, 'bad_request');
    }
  });
});

describe('AG-2 relay decision', () => {
  beforeEach(() => {
    // A fresh replay set per test (module scope = one isolate).
    relaySeen.clear();
  });

  it('a valid signature -> allow as MACHINE telegram with rate key m:telegram:agent', async () => {
    const allowed = expectAllow(await gate(relayCall()));
    expect(allowed.actionId).toBe('AG-2');
    expect(allowed.principal).toEqual({ class: 'MACHINE', machine: 'telegram' });
    expect(limiter.counts.get('m:telegram:agent')).toBe(1);
  });

  it('timestamp window: 300 s either way accepted, 301 s refused', async () => {
    expectAllow(await gate(relayCall(relayBody, { ts: nowS() - 300 })));
    expectAllow(await gate(relayCall({ ...relayBody, code: 'rej' }, { ts: nowS() + 300 })));
    await expectDeny(await gate(relayCall({ ...relayBody, code: 'a1' }, { ts: nowS() - 301 })), 401, 'unauthorized');
    await expectDeny(await gate(relayCall({ ...relayBody, code: 'a2' }, { ts: nowS() + 301 })), 401, 'unauthorized');
  });

  it('a replayed request (same signature) -> 401', async () => {
    const call = relayCall();
    expectAllow(await gate(call));
    await expectDeny(await gate(call), 401, 'unauthorized');
  });

  it('a bad signature, another secret, a changed body or a malformed header -> 401', async () => {
    await expectDeny(await gate(relayCall(relayBody, { secret: 'another-value' })), 401, 'unauthorized');
    const call = relayCall();
    await expectDeny(await gate({ ...call, body: JSON.stringify({ ...relayBody, code: 'rej' }) }), 401, 'unauthorized');
    await expectDeny(await gate(relayCall(relayBody, { headers: { 'X-Microns-Signature': 'zz' } })), 401, 'unauthorized');
    await expectDeny(await gate(relayCall(relayBody, { headers: { 'X-Microns-Timestamp': '12ab' } })), 401, 'unauthorized');
    const onlyTimestamp: ApiCall = { endpoint: 'agent', action: 'decision', functionUrl: '/api/agent/decision', body: JSON.stringify(relayBody), headers: { 'content-type': 'application/json', 'X-Microns-Timestamp': String(nowS()) } };
    await expectDeny(await gate(onlyTimestamp), 401, 'unauthorized');
  });

  it('a relay header decides the path: a staff session with a bad signature is still refused', async () => {
    await expectDeny(await gate(relayCall(relayBody, { secret: 'another-value', headers: bearer(users.ADMIN) })), 401, 'unauthorized');
  });

  it('a token hash from the relay or another shape -> 400 bad_request (after the signature check)', async () => {
    await expectDeny(await gate(relayCall({ ...relayBody, token_sha256: HASH })), 400, 'bad_request');
    await expectDeny(await gate(relayCall(dashboardBody)), 400, 'bad_request');
    await expectDeny(await gate(relayCall({ ...relayBody, code: 'TOOLONG' })), 400, 'bad_request');
    await expectDeny(await gate(relayCall({ ...relayBody, tg: { user_id: 1 } })), 400, 'bad_request');
  });

  it('AGENT_APPROVAL_SECRET missing -> 500 config error for relay decisions; dashboard decisions unaffected', async () => {
    const e = env({ AGENT_APPROVAL_SECRET: undefined });
    const outcome = await gate(relayCall(), e);
    expect(outcome.kind).toBe('deny');
    if (outcome.kind === 'deny') {
      expect(outcome.response.status).toBe(500);
      expect(await bodyText(outcome.response)).toBe('Internal Server Error');
    }
    expectAllow(await gate({ endpoint: 'agent', action: 'decision', functionUrl: '/api/agent/decision', body: dashboardBody, headers: bearer(users.STAFF) }, e));
  });

  it('the relay principal is accepted for decisions only: signed headers on status or start do not count', async () => {
    const body = JSON.stringify({ v: 1, kind: 'test_card' });
    await expectDeny(await gate({ endpoint: 'agent', action: 'start', functionUrl: '/api/agent/start', body, headers: relayHeaders(body) }), 401, 'unauthorized');
    await expectDeny(await gate({ endpoint: 'agent', action: 'status', functionUrl: '/api/agent/status', headers: relayHeaders('') }), 401, 'unauthorized');
  });
});

describe('AG-3 signed partner link', () => {
  const traveller = `orders/${ORDER}/traveler.pdf`;

  it('a valid link -> allow ANON, rate key file:<ip>', async () => {
    const allowed = expectAllow(await gate(linkCall(traveller, nowS() + 3600)));
    expect(allowed.actionId).toBe('AG-3');
    expect(allowed.principal).toEqual({ class: 'ANON' });
    expect(limiter.counts.get('file:203.0.113.9')).toBe(1);
    expectAllow(await gate(linkCall(`cad/${ORDER}/output/drawing.pdf`, nowS() + 7 * 24 * 3600)));
    expectAllow(await gate(linkCall(`cad/${ORDER}/output/flat.dxf`, nowS() + 60)));
  });

  it('expired, more than 7 days ahead, wrong signature, wrong key pattern -> 403 without detail', async () => {
    await expectDeny(await gate(linkCall(traveller, nowS() - 1)), 403, 'forbidden');
    await expectDeny(await gate(linkCall(traveller, nowS() + 7 * 24 * 3600 + 60)), 403, 'forbidden');
    await expectDeny(await gate(linkCall(traveller, nowS() + 3600, linkSig(traveller, nowS() + 3601))), 403, 'forbidden');
    await expectDeny(await gate(linkCall(traveller, nowS() + 3600, linkSig(traveller, nowS() + 3600, 'other-value'))), 403, 'forbidden');
    for (const key of [`quotes/${ORDER}/v1/quote.pdf`, `cad/${ORDER}/output/result.json`, `email/${SHA}/raw.eml`, `orders/${ORDER}/../x/traveler.pdf`]) {
      await expectDeny(await gate(linkCall(key, nowS() + 3600)), 403, 'forbidden');
    }
    await expectDeny(await gate({ endpoint: 'agent', action: 'file', functionUrl: `/api/agent/file?k=${traveller}&sig=` }), 403, 'forbidden');
  });

  it('AGENT_APPROVAL_SECRET missing -> 500 for this request only', async () => {
    const outcome = await gate(linkCall(traveller, nowS() + 3600), env({ AGENT_APPROVAL_SECRET: undefined }));
    expect(outcome.kind === 'deny' && outcome.response.status).toBe(500);
  });
});

describe('AG-4 flag edits (ADMIN)', () => {
  const call = (body: unknown): ApiCall => ({ endpoint: 'agent', action: 'flag', functionUrl: '/api/agent/flag', body, headers: bearer(users.ADMIN) });

  it('agent.* and mcp.remote keys, modes and writes -> allow', async () => {
    expectAllow(await gate(call({ v: 1, key: 'agent.rfq_intake', expected_rev: 1, enabled: true, mode: 'auto' })));
    expectAllow(await gate(call({ v: 1, key: 'agent.quote', expected_rev: 1, enabled: false, mode: 'assist' })));
    expectAllow(await gate(call({ v: 1, key: 'mcp.remote', expected_rev: 9, enabled: true, writes: true })));
  });

  it('seo.* and api.* (or any other key) -> 403', async () => {
    for (const key of ['seo.strict_404', 'api.forward_to_vercel', 'other', 'agent', 'mcp.remote.x']) {
      await expectDeny(await gate(call({ v: 1, key, expected_rev: 1, enabled: true })), 403, 'forbidden');
    }
  });

  it("'auto' for agent.quote and agent.post_order -> 403", async () => {
    await expectDeny(await gate(call({ v: 1, key: 'agent.quote', expected_rev: 1, enabled: true, mode: 'auto' })), 403, 'forbidden');
    await expectDeny(await gate(call({ v: 1, key: 'agent.post_order', expected_rev: 1, enabled: true, mode: 'auto' })), 403, 'forbidden');
  });

  it('wrong shapes and writes on another key -> 400', async () => {
    for (const body of [{ v: 1, key: 'agent.quote', enabled: true }, { v: 1, key: 'agent.quote', expected_rev: -1, enabled: true }, { v: 1, key: 'agent.quote', expected_rev: 1, enabled: 'yes' }, { v: 1, key: 'agent.quote', expected_rev: 1, enabled: true, writes: true }, 'x']) {
      await expectDeny(await gate(call(body)), 400, 'bad_request');
    }
  });
});

describe('AG-6 start', () => {
  const call = (body: unknown, user: FakeUser): ApiCall => ({ endpoint: 'agent', action: 'start', functionUrl: '/api/agent/start', body, headers: bearer(user) });

  it("'test_card' is ADMIN only; quote and rfq_intake for STAFF", async () => {
    await expectDeny(await gate(call({ v: 1, kind: 'test_card' }, users.STAFF)), 403, 'forbidden');
    expectAllow(await gate(call({ v: 1, kind: 'test_card' }, users.ADMIN)));
    expectAllow(await gate(call({ v: 1, kind: 'rfq_intake', inbound_email_id: RUN }, users.STAFF)));
  });

  it('wrong shapes -> 400', async () => {
    for (const body of [{ v: 1, kind: 'quote' }, { v: 1, kind: 'quote', rfq_id: 'x' }, { v: 1, kind: 'other' }, { v: 1, kind: 'test_card', extra: 1 }]) {
      await expectDeny(await gate(call(body, users.ADMIN)), 400, 'bad_request');
    }
  });
});

describe('AG-7 staff file keys', () => {
  const call = (search: string): ApiCall => ({ endpoint: 'agent', action: 'file', functionUrl: `/api/agent/file${search}`, headers: bearer(users.STAFF) });

  it('the fixed key patterns -> allow', async () => {
    for (const key of [`quotes/${RUN}/v1/quote.pdf`, `orders/${ORDER}/traveler.pdf`, `cad/${ORDER}/output/flat.dxf`, `cad/${ORDER}/output/result.json`, `email/${SHA}/raw.eml`, `email/${SHA}/att/2-drawing_v1.pdf`]) {
      expectAllow(await gate(call(`?k=${key}`)));
    }
  });

  it('dot segments, backslashes, encoded slashes, other keys, no key or two keys -> 403', async () => {
    for (const search of [
      `?k=quotes/${RUN}/v1/../v2/quote.pdf`, `?k=quotes%2F${RUN}/v1/quote.pdf`, `?k=quotes/${RUN}/v1/quote.pdf%5c`, `?k=orders\\${ORDER}/traveler.pdf`,
      `?k=rfq/${RUN}/file.step`, `?k=email/${SHA}/att/x.pdf`, `?k=quotes/${RUN.toUpperCase()}/v1/quote.pdf`, '', `?k=orders/${ORDER}/traveler.pdf&k=orders/${ORDER}/traveler.pdf`,
    ]) {
      await expectDeny(await gate(call(search)), 403, 'forbidden');
    }
  });
});
