// W-4, T2 profile 'agents' (npm run test:integration:agents -- test/t2/web.t2.ts): /api/agent/* end to end in
// workerd, site (primary) -> gate -> OPS service binding -> microns-ops -> mini-PostgREST / local R2 / local KV.
// Identities are stub-minted Supabase JWTs whose /auth/v1/user and user_roles answers are canned per identity.
//   status    STAFF and ADMIN answers; anonymous 401; customer 403
//   site      unknown action 404, wrong method 405 with Allow, body over 64 KiB 413 (answered by the site)
//   flag      ADMIN edit with write-through (row rev, kv_synced_rev, KV record); stale rev 409; seo.* 403; STAFF 403
//   start     flag off 409; active quote 409; intake of a finished mail 409 stale; STAFF test_card 403
//   file      staff preview of a stored quote PDF (inline, private no-store, nosniff); encoded slash 403; missing
//             object 404; signed partner link to a traveller PDF (attachment), tampered signature 403
//   decision  dashboard decision with run_id + token_sha256 on a test card (run succeeded, card edited); repeat 409;
//             a raw token from a session 400; a relay request with a bad signature 401
// Only the site is served over HTTP; R2 objects and KV values are written through the Local Explorer.

import { createHmac, hkdfSync, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

type Row = Record<string, unknown>;

interface StubRoute { method: string; path: string; status: number; headers?: Record<string, string>; body?: unknown }
interface StubClient {
  stubRoute(route: StubRoute): Promise<void>;
  mintSupabaseJwt(claims: { sub: string; email?: string; exp?: number }): Promise<string>;
}

const SITE = process.env.T2_SITE_URL ?? '';
const STUB = process.env.T2_STUB_URL ?? '';
const EXPLORER = process.env.T2_EXPLORER_URL ?? `${SITE}/cdn-cgi/local/explorer/api`;
const SECRET = process.env.T2_APPROVAL_SECRET ?? '';
const BUCKET = 'microns-private';
const JSON_HEADERS = { 'content-type': 'application/json' };

const STAFF_UID = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ADMIN_UID = '7b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const CUSTOMER_UID = '8c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f';

async function loadStubClient(): Promise<StubClient> {
  return (await import(/* @vite-ignore */ new URL('../../../site/test/integration/stub-client.ts', import.meta.url).href)) as StubClient;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`not JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function stubRows(table: string): Promise<Row[]> {
  return json<Row[]>(await fetch(`${STUB}/__stub/rows/${table}`));
}

async function seed(body: unknown): Promise<void> {
  const res = await fetch(`${STUB}/__stub/seed`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  if (res.status >= 300) throw new Error(`seed: ${res.status} ${await res.text()}`);
}

async function r2Put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const res = await fetch(`${EXPLORER}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes });
  if (res.status >= 300) throw new Error(`r2 put: ${res.status} ${await res.text()}`);
}

let flagsNamespace = '';
async function kvUrl(key: string): Promise<string> {
  if (!flagsNamespace) {
    const body = await json<{ result: Array<{ id: string; title?: string }> }>(await fetch(`${EXPLORER}/storage/kv/namespaces`));
    const hit = body.result.find((n) => /FLAGS/.test(n.id) || /FLAGS/.test(n.title ?? ''));
    if (!hit) throw new Error('no FLAGS namespace in the Local Explorer');
    flagsNamespace = hit.id;
  }
  return `${EXPLORER}/storage/kv/namespaces/${encodeURIComponent(flagsNamespace)}/values/${encodeURIComponent(key)}`;
}

async function kvGet(key: string): Promise<string | null> {
  const res = await fetch(await kvUrl(key));
  return res.status === 404 ? null : res.text();
}

async function kvSet(key: string, raw: string | null): Promise<void> {
  const url = await kvUrl(key);
  const res = raw === null ? await fetch(url, { method: 'DELETE' }) : await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: raw });
  if (res.status >= 300 && res.status !== 404) throw new Error(`kv ${key}: ${res.status}`);
  // ops reads agent flags with cacheTtl 30; local KV answers the new value after a short pause (PHASE4_SPEC §6.3).
  await new Promise((r) => setTimeout(r, 1000));
}

/** Sets an agent flag in KV for the duration of `fn`, then puts the previous value back. */
async function withFlag<T>(key: string, enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const previous = await kvGet(key);
  await kvSet(key, JSON.stringify({ enabled, value: {}, updated_at: new Date().toISOString(), rev: 1 }));
  try {
    return await fn();
  } finally {
    await kvSet(key, previous);
  }
}

async function telegramCalls(): Promise<Array<{ method: string; body: Record<string, unknown> }>> {
  return json(await fetch(`${STUB}/__stub/telegram/calls`));
}

let stub: StubClient;
const tokens: Record<string, string> = {};

/** A JWT for the identity; the stub answers /auth/v1/user and user_roles for it (registered just before use). */
async function as(uid: string, roles: string[]): Promise<Record<string, string>> {
  await stub.stubRoute({ method: 'GET', path: '^/auth/v1/user$', status: 200, body: { id: uid, email: `${uid.slice(0, 8)}@example.test` } });
  await stub.stubRoute({ method: 'GET', path: `^/rest/v1/user_roles\\?select=role&user_id=eq\\.${uid}`, status: 200, body: roles.map((role) => ({ role })) });
  tokens[uid] ??= await stub.mintSupabaseJwt({ sub: uid, email: `${uid.slice(0, 8)}@example.test` });
  return { authorization: `Bearer ${tokens[uid]}` };
}

function post(path: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  return fetch(`${SITE}${path}`, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

beforeAll(async () => {
  expect(process.env.T2_PROFILE).toBe('agents');
  expect(SECRET).toMatch(/^[0-9a-f]{64}$/);
  stub = await loadStubClient();
  await seed({ flags: 'migration', replace: true });
});

describe('status', () => {
  it('STAFF: decision, start, file; ADMIN: also flag; both no-store', async () => {
    const staff = await fetch(`${SITE}/api/agent/status`, { headers: await as(STAFF_UID, ['sales_rep']) });
    expect(staff.status).toBe(200);
    expect(staff.headers.get('cache-control')).toBe('no-store');
    expect(await json(staff)).toEqual({ v: 1, ok: true, actions: ['decision', 'start', 'file'], principal: 'STAFF' });
    const admin = await fetch(`${SITE}/api/agent/status`, { headers: await as(ADMIN_UID, ['admin']) });
    expect(await json(admin)).toEqual({ v: 1, ok: true, actions: ['decision', 'flag', 'start', 'file'], principal: 'ADMIN' });
  });

  it('anonymous -> 401; a customer -> 403', async () => {
    const anon = await fetch(`${SITE}/api/agent/status`);
    expect(anon.status).toBe(401);
    const customer = await fetch(`${SITE}/api/agent/status`, { headers: await as(CUSTOMER_UID, ['customer']) });
    expect(customer.status).toBe(403);
  });
});

describe('answered by the site', () => {
  it('unknown action 404, wrong method 405 with Allow, body over 64 KiB 413', async () => {
    const headers = await as(STAFF_UID, ['sales_rep']);
    const unknown = await fetch(`${SITE}/api/agent/nope`, { headers });
    expect([unknown.status, await json(unknown)]).toEqual([404, { error: 'not_found' }]);
    const method = await fetch(`${SITE}/api/agent/decision`, { headers });
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST');
    expect(method.headers.get('cache-control')).toBe('no-store');
    const big = await post('/api/agent/start', headers, { v: 1, kind: 'test_card', pad: 'x'.repeat(70_000) });
    expect([big.status, await json(big)]).toEqual([413, { error: 'payload_too_large' }]);
  });
});

describe('flag', () => {
  it('ADMIN edit of mcp.remote: row updated with a new rev, written through to KV and marked synced; then put back', async () => {
    const headers = await as(ADMIN_UID, ['admin']);
    const before = (await stubRows('feature_flags')).find((r) => r.key === 'mcp.remote') as Row;
    expect(before).toBeDefined();
    const res = await post('/api/agent/flag', headers, { v: 1, key: 'mcp.remote', expected_rev: before.rev, enabled: false, writes: true });
    expect(res.status).toBe(200);
    const result = await json<{ rev: number; kv: string }>(res);
    expect(result).toMatchObject({ v: 1, ok: true, key: 'mcp.remote', kv: 'written' });
    const after = (await stubRows('feature_flags')).find((r) => r.key === 'mcp.remote') as Row;
    expect(Number(after.rev)).toBeGreaterThan(Number(before.rev));
    expect(after).toMatchObject({ rev: result.rev, kv_synced_rev: result.rev, updated_by: ADMIN_UID, value: expect.objectContaining({ writes: true }) });
    expect(JSON.parse((await kvGet('mcp.remote')) as string)).toMatchObject({ enabled: false, rev: result.rev, value: expect.objectContaining({ writes: true }) });

    const back = await post('/api/agent/flag', headers, { v: 1, key: 'mcp.remote', expected_rev: result.rev, enabled: false, writes: false });
    expect(back.status).toBe(200);
    expect(JSON.parse((await kvGet('mcp.remote')) as string)).toMatchObject({ value: expect.objectContaining({ writes: false }) });
  });

  it('a stale rev -> 409 stale; seo.* -> 403 at the site; a STAFF caller -> 403', async () => {
    const admin = await as(ADMIN_UID, ['admin']);
    const row = (await stubRows('feature_flags')).find((r) => r.key === 'agent.post_order') as Row;
    const stale = await post('/api/agent/flag', admin, { v: 1, key: 'agent.post_order', expected_rev: Number(row.rev) + 100, enabled: false });
    expect([stale.status, await json(stale)]).toEqual([409, { error: 'stale' }]);
    const seo = await post('/api/agent/flag', admin, { v: 1, key: 'seo.strict_404', expected_rev: 1, enabled: true });
    expect(seo.status).toBe(403);
    const staff = await post('/api/agent/flag', await as(STAFF_UID, ['sales_rep']), { v: 1, key: 'agent.post_order', expected_rev: Number(row.rev), enabled: false });
    expect(staff.status).toBe(403);
    expect((await stubRows('feature_flags')).find((r) => r.key === 'agent.post_order')).toMatchObject({ rev: row.rev });
  });
});

describe('start', () => {
  const RFQ = randomUUID();
  const MAIL = randomUUID();

  beforeAll(async () => {
    await seed({
      tables: {
        rfqs: [{ id: RFQ, rfq_number: `RFQ-T2W-${RFQ.slice(0, 4)}`, status: 'received', company_name: 'Example GmbH', tenant_id: '00000000-0000-0000-0000-000000000001' }],
        quote_workflows: [{ id: randomUUID(), rfq_id: RFQ, quote_version: 1, workflow_instance_id: `quote-${RFQ}-v1`, status: 'awaiting_approval', tenant_id: '00000000-0000-0000-0000-000000000001' }],
        inbound_emails: [
          {
            id: MAIL,
            tenant_id: '00000000-0000-0000-0000-000000000001',
            message_id: `<t2-web-${MAIL}@example.com>`,
            message_id_sha256: 'cd'.repeat(32),
            mailbox: 'rfq',
            source: 'email_routing',
            from_email: 'buyer@example.com',
            received_at: new Date().toISOString(),
            status: 'rfq_created',
          },
        ],
      },
    });
  });

  it('quote with agent.quote off -> 409 flag_off', async () => {
    const headers = await as(STAFF_UID, ['sales_rep']);
    await withFlag('agent.quote', false, async () => {
      const res = await post('/api/agent/start', headers, { v: 1, kind: 'quote', rfq_id: RFQ });
      expect([res.status, await json(res)]).toEqual([409, { error: 'flag_off' }]);
    });
  });

  it('quote with an active quote -> 409 active_quote_exists; intake of a mail already turned into an RFQ -> 409 stale', async () => {
    const headers = await as(STAFF_UID, ['sales_rep']);
    await withFlag('agent.quote', true, async () => {
      const res = await post('/api/agent/start', headers, { v: 1, kind: 'quote', rfq_id: RFQ });
      expect([res.status, await json(res)]).toEqual([409, { error: 'active_quote_exists' }]);
    });
    await withFlag('agent.rfq_intake', true, async () => {
      const res = await post('/api/agent/start', headers, { v: 1, kind: 'rfq_intake', inbound_email_id: MAIL });
      expect([res.status, await json(res)]).toEqual([409, { error: 'stale' }]);
    });
  });

  it("STAFF 'test_card' -> 403 at the site", async () => {
    const res = await post('/api/agent/start', await as(STAFF_UID, ['sales_rep']), { v: 1, kind: 'test_card' });
    expect(res.status).toBe(403);
  });
});

describe('file', () => {
  const RFQ = randomUUID();
  const ORDER = randomUUID();
  const quoteKey = `quotes/${RFQ}/v1/quote.pdf`;
  const travelerKey = `orders/${ORDER}/traveler.pdf`;
  const PDF = new TextEncoder().encode('%PDF-1.7\n% t2 web fixture\n%%EOF\n');

  beforeAll(async () => {
    await r2Put(quoteKey, PDF, 'application/pdf');
    await r2Put(travelerKey, PDF, 'application/pdf');
    await seed({ tables: { orders: [{ id: ORDER, rfq_id: RFQ, partner_id: randomUUID(), status: 'new', tenant_id: '00000000-0000-0000-0000-000000000001' }] } });
  });

  it('staff preview of a quote PDF: inline, private no-store, nosniff, the stored bytes', async () => {
    const res = await fetch(`${SITE}/api/agent/file?k=${quoteKey}`, { headers: await as(STAFF_UID, ['sales_rep']) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('inline; filename="quote.pdf"');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
  });

  it('an encoded slash -> 403 at the site; a missing object -> 404; anonymous -> 401', async () => {
    const headers = await as(STAFF_UID, ['sales_rep']);
    const encoded = await fetch(`${SITE}/api/agent/file?k=${encodeURIComponent(quoteKey)}`, { headers });
    expect([encoded.status, await json(encoded)]).toEqual([403, { error: 'forbidden' }]);
    const missing = await fetch(`${SITE}/api/agent/file?k=quotes/${randomUUID()}/v1/quote.pdf`, { headers });
    expect(missing.status).toBe(404);
    expect((await fetch(`${SITE}/api/agent/file?k=${quoteKey}`)).status).toBe(401);
  });

  it('a signed partner link to an order traveller PDF -> attachment; a tampered signature -> 403', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const key = Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), 'microns-file-link-v1', 32));
    const sig = createHmac('sha256', key).update(`${travelerKey}|${exp}`).digest('base64url');
    const ok = await fetch(`${SITE}/api/agent/file?k=${encodeURIComponent(travelerKey)}&exp=${exp}&sig=${sig}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toBe('attachment; filename="traveler.pdf"');
    expect(ok.headers.get('x-robots-tag')).toBe('noindex');
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PDF);
    const bad = await fetch(`${SITE}/api/agent/file?k=${encodeURIComponent(travelerKey)}&exp=${exp}&sig=${sig.slice(0, -2)}AA`);
    expect(bad.status).toBe(403);
  });
});

describe('decision', () => {
  it('dashboard decision with run_id + token_sha256 on a test card: dismissed, run succeeded, card edited; a repeat 409', async () => {
    const admin = await as(ADMIN_UID, ['admin']);
    const start = await post('/api/agent/start', admin, { v: 1, kind: 'test_card' });
    expect(start.status).toBe(200);
    const { instance_id: runId } = await json<{ instance_id: string }>(start);
    const run = (await stubRows('agent_runs')).find((r) => r.id === runId) as Row;
    expect(run).toMatchObject({ status: 'waiting_human', agent: 'eval', trigger: 'dashboard' });
    const hash = String(run.approval_token_sha256);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const callsBefore = (await telegramCalls()).length;
    const staff = await as(STAFF_UID, ['sales_rep']);
    const body = { v: 1, run_id: runId, token_sha256: hash, verb: 'dismiss' };
    const res = await post('/api/agent/decision', staff, body);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ v: 1, ok: true, run_id: runId, verb: 'dismiss', outcome: 'dismissed' });
    const decided = (await stubRows('agent_runs')).find((r) => r.id === runId) as Row;
    expect(decided).toMatchObject({ status: 'succeeded', approval_token_sha256: null, human_action: expect.objectContaining({ channel: 'dashboard', actor: `user:${STAFF_UID}`, verb: 'dismiss' }) });
    expect((await telegramCalls()).slice(callsBefore).map((c) => c.method)).toContain('editMessageText');

    const again = await post('/api/agent/decision', staff, body);
    expect([again.status, await json(again)]).toEqual([409, { error: 'already_decided' }]);
  });

  it('a raw token from a session -> 400 at the site; a relay request with a bad signature -> 401', async () => {
    const staff = await as(STAFF_UID, ['sales_rep']);
    const raw = await post('/api/agent/decision', staff, { v: 1, run_id: randomUUID(), token_sha256: 'ab'.repeat(32), verb: 'dismiss', token: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
    expect([raw.status, await json(raw)]).toEqual([400, { error: 'bad_request' }]);
    const relayBody = JSON.stringify({ v: 1, token: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', code: 'dis', tg: { user_id: 1, chat_id: 1, message_id: 1 } });
    const ts = String(Math.floor(Date.now() / 1000));
    const wrong = createHmac('sha256', 'not-the-secret').update(`${ts}.${relayBody}`).digest('hex');
    const relay = await fetch(`${SITE}/api/agent/decision`, { method: 'POST', headers: { ...JSON_HEADERS, 'x-microns-timestamp': ts, 'x-microns-signature': wrong }, body: relayBody });
    expect([relay.status, await json(relay)]).toEqual([401, { error: 'unauthorized' }]);
  });
});
