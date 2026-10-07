// W-3 /api/agent/{status,flag,start,file} in microns-ops (src/routes/agent-admin.ts), called through the K route
// handler (src/routes/agent.ts) with fake ports, as the site's OpsCall reaches it.
//   status  actions by class (flag for ADMIN only), no database call; other principals 403
//   flag    key allow-list, 'auto' refusal for quote and post-order, mode only where the row has one, writes only on
//           mcp.remote, stale rev 409, write-through order (kv_key, kv_value, FLAGS.put, mark_synced), kv 'pending'
//           when KV fails or is not bound, 413 / 400 bodies
//   start   quote: flag off 409, RFQ missing 404, active quote 409, version increment, "already exists" created
//           false, QUOTE missing 500; rfq_intake: flag off, mailbox, status and waiting-run rules, create, running
//           instance left alone, ended instance restarted after its final run row is reopened, a final run reopened
//           before create() too (instance past retention), a failed create/restart or a live instance gives the
//           run back its previous columns (only while it still carries this request's rerun); test_card: ADMIN
//           only, one waiting 'test' run with the verb 'dismiss' sent to Telegram
//   file    key regex table, encoded separators and dot segments refused, headers per type, 404, 500 without R2
// Plus the CHECK-LISTS rule: the status lists the handlers use equal the migration's lists.

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAgentStatus, isFlagEditResult, isStartResult } from '../../../shared/src/agent-api';
import type { OpsCall, Principal } from '../../../shared/src/http/rpc';
import type { RunStatus } from '../../src/agents/runs';
import type { InboundStatus } from '../../src/db/repos/inbound-emails';
import type { OpsEnv, OpsHono } from '../../src/env';
import { AGENT_ROUTE, createAgentHandler } from '../../src/routes/agent';
import { createAgentAdminHandlers, QUOTE_FINAL, RERUNNABLE_INBOUND, STAFF_FILE_KEY_RE, staffFileKeyOf } from '../../src/routes/agent-admin';
import { agentBindings, agentPorts, FakeKV, FakeR2Bucket, FakeWorkflow, type AgentTestPorts } from '../helpers/agent-env';
import { agentLayerMigration, checkList, seededFlags, sorted } from '../helpers/check-lists';
import { opsCall, opsEnv, STAFF } from '../helpers/ops';

const ADMIN: Principal = { class: 'ADMIN', uid: '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', roles: ['admin'] };
const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
const RFQ = '2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182';
const INBOUND = '3c4d5e6f-7081-4b92-8c3d-4e5f60718293';
const SHA = 'ab'.repeat(32);
const QUOTE_ID = '4d5e6f70-8192-4ca3-9d4e-5f6071829304';

/** An app that serves /api/agent/* as microns-ops does, with the given principal and action in the OpsCall. */
function app(ports: AgentTestPorts, principal: Principal, action: string) {
  const a = new Hono<OpsHono>();
  a.use('*', async (c, next) => {
    c.set('call', opsCall({ endpoint: 'agent', functionUrl: `/api/agent/${action}`, action, principal }) as OpsCall);
    await next();
  });
  const admin = createAgentAdminHandlers(() => ports);
  a.all(AGENT_ROUTE, async (c) => {
    // routes/agent.ts dispatches status/flag/start/staff file to agent-admin; the admin handlers here use the
    // same fake ports as the route.
    switch (action) {
      case 'status':
        return c.req.method === 'GET' ? admin.handleStatus(c) : createAgentHandler(() => ports)(c);
      case 'flag':
        return c.req.method === 'POST' ? admin.handleFlag(c) : createAgentHandler(() => ports)(c);
      case 'start':
        return c.req.method === 'POST' ? admin.handleStart(c) : createAgentHandler(() => ports)(c);
      case 'file':
        return c.req.method === 'GET' && !new URL(c.req.url).searchParams.has('sig') ? admin.handleStaffFile(c) : createAgentHandler(() => ports)(c);
      default:
        return createAgentHandler(() => ports)(c);
    }
  });
  return a;
}

interface Setup {
  env: OpsEnv;
  ports: AgentTestPorts;
  kv: FakeKV;
  quote: FakeWorkflow;
  intake: FakeWorkflow;
  bucket: FakeR2Bucket;
}

function setup(overrides: Partial<OpsEnv> = {}): Setup {
  const bucket = new FakeR2Bucket();
  const env = opsEnv({ ...agentBindings({ PRIVATE_FILES: bucket as unknown as R2Bucket }), AGENT_APPROVAL_SECRET: 'approval-test-value', ...overrides });
  const ports = agentPorts({ bucket });
  return { env, ports, kv: env.FLAGS as unknown as FakeKV, quote: env.QUOTE as unknown as FakeWorkflow, intake: env.RFQ_INTAKE as unknown as FakeWorkflow, bucket };
}

/** The 13 flag rows as the migration seeds them, with the seed import done (kv_seed_pending false). */
function seedFlags(ports: AgentTestPorts): void {
  ports.db.seed('feature_flags', seededFlags().map((r) => ({ ...r, kv_seed_pending: false })));
}

type FlagRowView = Record<string, unknown> & { rev: number; value: Record<string, unknown>; kv_synced_rev: number | null };

function flagRow(ports: AgentTestPorts, key: string, tenant = DEFAULT_TENANT): FlagRowView {
  return ports.db.rows('feature_flags', ['key', 'eq', key], ['tenant_id', 'eq', tenant])[0] as FlagRowView;
}

/** The JSON body of a response, for field assertions. */
async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Sets an agent flag in KV as the mirror writes it. */
function kvFlag(s: Setup, key: string, enabled: boolean, value: Record<string, unknown> = {}): void {
  s.kv.setJson(key, { enabled, value, updated_at: '2026-10-05T08:00:00Z', rev: 1 });
}

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const get = { method: 'GET' };

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ----- status -----

describe('status', () => {
  it('STAFF: decision, start, file; ADMIN: also flag; no database call; no-store', async () => {
    const s = setup();
    const staff = await app(s.ports, STAFF, 'status').request('https://x/api/agent/status', get, s.env);
    expect(staff.status).toBe(200);
    expect(staff.headers.get('cache-control')).toBe('no-store');
    const staffBody = await staff.json();
    expect(isAgentStatus(staffBody)).toBe(true);
    expect(staffBody).toEqual({ v: 1, ok: true, actions: ['decision', 'start', 'file'], principal: 'STAFF' });
    const admin = await (await app(s.ports, ADMIN, 'status').request('https://x/api/agent/status', get, s.env)).json();
    expect(admin).toEqual({ v: 1, ok: true, actions: ['decision', 'flag', 'start', 'file'], principal: 'ADMIN' });
    expect(s.ports.db.calls).toEqual([]);
  });

  it('customer, anonymous, the relay and a staff principal without a uid -> 403 forbidden', async () => {
    const s = setup();
    for (const p of [{ class: 'CUSTOMER', uid: ADMIN.uid }, { class: 'ANON' }, { class: 'MACHINE', machine: 'telegram' }, { class: 'STAFF', roles: ['admin'] }] as Principal[]) {
      const res = await app(s.ports, p, 'status').request('https://x/api/agent/status', get, s.env);
      expect([res.status, await res.json()], JSON.stringify(p)).toEqual([403, { error: 'forbidden' }]);
    }
  });

  it('POST -> 405 with Allow GET (the route checks the method first)', async () => {
    const s = setup();
    const res = await app(s.ports, ADMIN, 'status').request('https://x/api/agent/status', post({}), s.env);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });
});

// ----- flag -----

describe('flag', () => {
  it('an admin edit: one PATCH by key, tenant and rev; value merged; updated_by = uid; write-through in order; kv written', async () => {
    const s = setup();
    seedFlags(s.ports);
    const before = flagRow(s.ports, 'agent.rfq_intake');
    expect(before.value).toMatchObject({ mode: 'shadow' });
    const putOrder: string[] = [];
    const put = s.kv.put.bind(s.kv);
    s.kv.put = async (k: string, v: string) => {
      putOrder.push(`put:${k}`);
      s.ports.db.calls.push({ method: 'rpc', target: '(kv put)' });
      return put(k, v);
    };
    const res = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key: 'agent.rfq_intake', expected_rev: before.rev, enabled: true, mode: 'assist' }), s.env);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(isFlagEditResult(body)).toBe(true);
    const after = flagRow(s.ports, 'agent.rfq_intake');
    expect(body).toEqual({ v: 1, ok: true, key: 'agent.rfq_intake', rev: after.rev, kv: 'written' });
    expect(after.rev).toBeGreaterThan(before.rev);
    expect(after).toMatchObject({ enabled: true, updated_by: ADMIN.uid, kv_synced_rev: after.rev });
    // Every other value field kept, mode replaced.
    expect(after.value).toEqual({ ...(before.value as object), mode: 'assist' });
    // Write-through order.
    const sequence = s.ports.db.calls.filter((c) => c.method !== 'select').map((c) => `${c.method}:${c.target}`);
    expect(sequence).toEqual(['update:feature_flags', 'rpc:feature_flags_kv_key', 'rpc:feature_flags_kv_value', 'rpc:(kv put)', 'rpc:feature_flags_mark_synced']);
    const patch = s.ports.db.calls.find((c) => c.method === 'update')?.patch;
    expect(Object.keys(patch ?? {}).sort()).toEqual(['enabled', 'updated_by', 'value']);
    expect(putOrder).toEqual(['put:agent.rfq_intake']);
    expect(JSON.parse(s.kv.store.get('agent.rfq_intake') as string)).toEqual({ enabled: true, value: after.value, updated_at: after.updated_at, rev: after.rev, mode: 'assist' });
    // Log line: key, rev, outcome; never the uid.
    expect(logs.join('\n')).toContain('agent flag');
    expect(logs.join('\n')).not.toContain(ADMIN.uid as string);
  });

  it('mcp.remote: writes switch kept beside the other value fields; a non-default tenant writes t:<tenant>:<key>', async () => {
    const tenant = '9f9e9d9c-1b2a-4c3d-8e4f-5a6b7c8d9e0f';
    const s = setup({ AGENT_TENANT_ID: tenant });
    s.ports.db.seed('feature_flags', [{ key: 'mcp.remote', tenant_id: tenant, enabled: false, value: { writes: false, write_tools: [] }, kv_seed_pending: false }]);
    const row = flagRow(s.ports, 'mcp.remote', tenant);
    const res = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key: 'mcp.remote', expected_rev: row.rev, enabled: true, writes: true }), s.env);
    expect(res.status).toBe(200);
    expect(flagRow(s.ports, 'mcp.remote', tenant).value).toEqual({ writes: true, write_tools: [] });
    expect([...s.kv.store.keys()]).toEqual([`t:${tenant}:mcp.remote`]);
  });

  it('stale rev -> 409 stale; nothing written; KV untouched', async () => {
    const s = setup();
    seedFlags(s.ports);
    const row = flagRow(s.ports, 'agent.quote');
    const res = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key: 'agent.quote', expected_rev: row.rev + 5, enabled: true }), s.env);
    expect([res.status, await res.json()]).toEqual([409, { error: 'stale' }]);
    expect(flagRow(s.ports, 'agent.quote')).toEqual(row);
    expect(s.kv.store.size).toBe(0);
  });

  it('the KV put fails -> kv pending and the row is not marked synced; FLAGS not bound -> pending', async () => {
    const s = setup();
    seedFlags(s.ports);
    s.kv.put = async () => {
      throw new Error('KV PUT failed: 503');
    };
    const row = flagRow(s.ports, 'agent.post_order');
    const res = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key: 'agent.post_order', expected_rev: row.rev, enabled: true }), s.env);
    expect(res.status).toBe(200);
    expect((await body(res)).kv).toBe('pending');
    const after = flagRow(s.ports, 'agent.post_order');
    expect(after.enabled).toBe(true);
    expect(after.kv_synced_rev).not.toBe(after.rev);
    expect(s.ports.db.calls.some((c) => c.target === 'feature_flags_mark_synced')).toBe(false);

    const unbound = setup({ FLAGS: undefined });
    seedFlags(unbound.ports);
    const r2 = flagRow(unbound.ports, 'agent.quote');
    const res2 = await app(unbound.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key: 'agent.quote', expected_rev: r2.rev, enabled: false }), unbound.env);
    expect([res2.status, (await body(res2)).kv]).toEqual([200, 'pending']);
  });

  it('key allow-list: seo.*, api.* and other keys -> 403; a STAFF caller -> 403; unknown agent key -> 404', async () => {
    const s = setup();
    seedFlags(s.ports);
    for (const key of ['seo.strict_404', 'api.forward_to_vercel', 'mcp.other', 'Agent.quote', 'agent']) {
      const res = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key, expected_rev: 1, enabled: true }), s.env);
      expect([res.status, await res.json()], key).toEqual([403, { error: 'forbidden' }]);
    }
    const rev = flagRow(s.ports, 'agent.quote').rev;
    expect((await app(s.ports, STAFF, 'flag').request('https://x/api/agent/flag', post({ v: 1, key: 'agent.quote', expected_rev: rev, enabled: true }), s.env)).status).toBe(403);
    const missing = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key: 'agent.not_seeded', expected_rev: 1, enabled: true }), s.env);
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'not_found' }]);
    expect(s.ports.db.calls.some((c) => c.method === 'update')).toBe(false);
  });

  it("'auto' refused for agent.quote and agent.post_order (403); allowed for agent.rfq_intake", async () => {
    const s = setup();
    seedFlags(s.ports);
    for (const key of ['agent.quote', 'agent.post_order']) {
      const res = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key, expected_rev: flagRow(s.ports, key).rev, enabled: true, mode: 'auto' }), s.env);
      expect([res.status, await res.json()], key).toEqual([403, { error: 'forbidden' }]);
    }
    const ok = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key: 'agent.rfq_intake', expected_rev: flagRow(s.ports, 'agent.rfq_intake').rev, enabled: true, mode: 'auto' }), s.env);
    expect(ok.status).toBe(200);
    expect(flagRow(s.ports, 'agent.rfq_intake').value).toMatchObject({ mode: 'auto' });
  });

  it('mode on a row without mode -> 400; writes on another key -> 400; wrong shapes -> 400; invalid JSON 400; > 64 KiB 413', async () => {
    const s = setup();
    seedFlags(s.ports);
    const noMode = seededFlags().find((r) => String(r.key).startsWith('agent.') && !('mode' in (r.value as object)));
    expect(noMode, 'the seed has an agent flag without mode').toBeDefined();
    const key = noMode?.key as string;
    const cases: unknown[] = [
      { v: 1, key, expected_rev: flagRow(s.ports, key).rev, enabled: true, mode: 'assist' },
      { v: 1, key: 'agent.quote', expected_rev: flagRow(s.ports, 'agent.quote').rev, enabled: true, writes: true },
      { v: 1, key: 'agent.quote', expected_rev: -1, enabled: true },
      { v: 1, key: 'agent.quote', expected_rev: 1, enabled: 'yes' },
      { v: 2, key: 'agent.quote', expected_rev: 1, enabled: true },
      { v: 1, key: 'agent.quote', expected_rev: 1, enabled: true, mode: 'fast' },
      { v: 1, key: 'agent.quote', expected_rev: 1, enabled: true, extra: 1 },
      '{"v":1,',
    ];
    for (const body of cases) {
      const res = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post(body), s.env);
      expect([res.status, await res.json()], JSON.stringify(body)).toEqual([400, { error: 'bad_request' }]);
    }
    const big = await app(s.ports, ADMIN, 'flag').request('https://x/api/agent/flag', post({ v: 1, key: 'agent.quote', pad: 'x'.repeat(70_000) }), s.env);
    expect([big.status, await big.json()]).toEqual([413, { error: 'payload_too_large' }]);
    expect(s.ports.db.calls.some((c) => c.method === 'update')).toBe(false);
  });
});

// ----- start -----

function seedRfq(ports: AgentTestPorts): void {
  ports.db.seed('rfqs', [{ id: RFQ, tenant_id: DEFAULT_TENANT, rfq_number: 'RFQ-20261005-1', status: 'received' }]);
}

function seedQuote(ports: AgentTestPorts, version: number, status: string, id = crypto.randomUUID()): void {
  ports.db.seed('quote_workflows', [{ id, rfq_id: RFQ, quote_version: version, status, tenant_id: DEFAULT_TENANT }]);
}

describe('start quote', () => {
  it('flag off -> 409 flag_off (nothing read or created)', async () => {
    const s = setup();
    seedRfq(s.ports);
    const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post({ v: 1, kind: 'quote', rfq_id: RFQ }), s.env);
    expect([res.status, await res.json()]).toEqual([409, { error: 'flag_off' }]);
    expect(s.quote.created).toEqual([]);
  });

  it('RFQ missing -> 404; an active quote -> 409 active_quote_exists', async () => {
    const s = setup();
    kvFlag(s, 'agent.quote', true, { mode: 'assist' });
    const missing = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post({ v: 1, kind: 'quote', rfq_id: RFQ }), s.env);
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'not_found' }]);
    seedRfq(s.ports);
    seedQuote(s.ports, 1, 'lost');
    seedQuote(s.ports, 2, 'awaiting_approval', QUOTE_ID);
    const active = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post({ v: 1, kind: 'quote', rfq_id: RFQ }), s.env);
    expect([active.status, await active.json()]).toEqual([409, { error: 'active_quote_exists' }]);
    expect(s.quote.created).toEqual([]);
  });

  it('no quote yet -> v1; after final v1 and v2 -> v3, params carry the trigger and the requester', async () => {
    const s = setup();
    kvFlag(s, 'agent.quote', true, { mode: 'assist' });
    seedRfq(s.ports);
    const first = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post({ v: 1, kind: 'quote', rfq_id: RFQ }), s.env);
    const firstBody = await first.json();
    expect(isStartResult(firstBody)).toBe(true);
    expect(firstBody).toEqual({ v: 1, ok: true, instance_id: `quote-${RFQ}-v1`, created: true });

    const t = setup();
    kvFlag(t, 'agent.quote', true, { mode: 'assist' });
    seedRfq(t.ports);
    seedQuote(t.ports, 1, 'rejected');
    seedQuote(t.ports, 2, 'expired');
    const res = await app(t.ports, ADMIN, 'start').request('https://x/api/agent/start', post({ v: 1, kind: 'quote', rfq_id: RFQ }), t.env);
    expect(await res.json()).toEqual({ v: 1, ok: true, instance_id: `quote-${RFQ}-v3`, created: true });
    expect(t.quote.created).toEqual([
      { id: `quote-${RFQ}-v3`, params: { v: 1, rfq_id: RFQ, quote_version: 3, tenant_id: DEFAULT_TENANT, trigger: 'dashboard', requested_by: `user:${ADMIN.uid}` } },
    ]);
  });

  it('"already exists" -> 200 created false', async () => {
    const s = setup();
    kvFlag(s, 'agent.quote', true);
    seedRfq(s.ports);
    s.quote.ensure(`quote-${RFQ}-v1`);
    const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post({ v: 1, kind: 'quote', rfq_id: RFQ }), s.env);
    expect([res.status, await res.json()]).toEqual([200, { v: 1, ok: true, instance_id: `quote-${RFQ}-v1`, created: false }]);
  });

  it('QUOTE not bound -> 500 config error for this request only', async () => {
    const s = setup({ QUOTE: undefined });
    kvFlag(s, 'agent.quote', true);
    seedRfq(s.ports);
    const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post({ v: 1, kind: 'quote', rfq_id: RFQ }), s.env);
    expect(res.status).toBe(500);
    expect(logs.join('\n')).toContain('QUOTE');
  });
});

function seedInbound(ports: AgentTestPorts, o: { status?: InboundStatus; mailbox?: string } = {}): void {
  ports.db.seed('inbound_emails', [
    {
      id: INBOUND,
      tenant_id: DEFAULT_TENANT,
      mailbox: o.mailbox ?? 'rfq',
      source: 'email_routing',
      message_id_sha256: SHA,
      raw_r2_key: `email/${SHA}/raw.eml`,
      status: o.status ?? 'needs_review',
      received_at: '2026-10-05T08:00:00Z',
    },
  ]);
}

function seedIntakeRun(ports: AgentTestPorts, status: RunStatus, extra: Record<string, unknown> = {}): string {
  const id = '5e6f7081-92a3-4b4c-8d5e-6f708192a3b4';
  ports.db.seed('agent_runs', [
    {
      id,
      agent: 'rfq_intake',
      trigger: 'email',
      idempotency_key: SHA,
      status,
      finished_at: status === 'running' || status === 'waiting_human' ? null : '2026-10-05T08:05:00Z',
      error: status === 'failed' ? 'extract_failed' : null,
      approval_token_sha256: status === 'waiting_human' ? 'cd'.repeat(32) : null,
      ...extra,
    },
  ]);
  return id;
}

/** The columns a rerun changes and a failed start must give back. */
const RERUN_COLUMNS = ['status', 'finished_at', 'error', 'parked_reason', 'human_action', 'approval_token_sha256'] as const;

function rerunView(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(RERUN_COLUMNS.map((k) => [k, row[k] ?? null]));
}

describe('start rfq_intake', () => {
  const body = { v: 1, kind: 'rfq_intake', inbound_email_id: INBOUND };
  const instanceId = `rfq-intake-${SHA.slice(0, 32)}`;

  it('flag off -> 409 flag_off; row missing -> 404; mailbox replies -> 400; status rfq_created -> 409 stale', async () => {
    const off = setup();
    seedInbound(off.ports);
    expect(await (await app(off.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), off.env)).json()).toEqual({ error: 'flag_off' });

    const s = setup();
    kvFlag(s, 'agent.rfq_intake', true, { mode: 'shadow' });
    const missing = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'not_found' }]);

    const replies = setup();
    kvFlag(replies, 'agent.rfq_intake', true);
    seedInbound(replies.ports, { mailbox: 'replies' });
    expect((await app(replies.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), replies.env)).status).toBe(400);

    const done = setup();
    kvFlag(done, 'agent.rfq_intake', true);
    seedInbound(done.ports, { status: 'rfq_created' });
    const res = await app(done.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), done.env);
    expect([res.status, await res.json()]).toEqual([409, { error: 'stale' }]);
    for (const t of [off, s, replies, done]) expect(t.intake.created).toEqual([]);
  });

  it('a run waiting for a human -> 409 stale (decide it on its card instead)', async () => {
    const s = setup();
    kvFlag(s, 'agent.rfq_intake', true);
    seedInbound(s.ports, { status: 'received' });
    seedIntakeRun(s.ports, 'waiting_human');
    const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
    expect([res.status, await res.json()]).toEqual([409, { error: 'stale' }]);
    expect(s.intake.created).toEqual([]);
  });

  it('no instance yet -> create rfq-intake-<32 hex> with the row ids; created true', async () => {
    const s = setup();
    kvFlag(s, 'agent.rfq_intake', true);
    seedInbound(s.ports, { status: 'received' });
    const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
    expect([res.status, await res.json()]).toEqual([200, { v: 1, ok: true, instance_id: instanceId, created: true }]);
    expect(s.intake.created).toEqual([{ id: instanceId, params: { v: 1, inbound_email_id: INBOUND, message_id_sha256: SHA, tenant_id: DEFAULT_TENANT } }]);
  });

  it('an instance still running -> created false, no restart, the run row untouched', async () => {
    const s = setup();
    kvFlag(s, 'agent.rfq_intake', true);
    seedInbound(s.ports, { status: 'failed' });
    const runId = seedIntakeRun(s.ports, 'running');
    const instance = s.intake.ensure(instanceId);
    instance.status_ = 'waiting';
    const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
    expect([res.status, await res.json()]).toEqual([200, { v: 1, ok: true, instance_id: instanceId, created: false }]);
    expect(instance.calls.filter((c) => c.method === 'restart')).toEqual([]);
    expect(s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0].status).toBe('running');
  });

  it('an ended instance with a final run -> the run is reopened (running, rerun by the user), then restarted from the start', async () => {
    for (const ended of ['complete', 'errored', 'terminated'] as const) {
      const s = setup();
      kvFlag(s, 'agent.rfq_intake', true);
      seedInbound(s.ports, { status: 'failed' });
      const runId = seedIntakeRun(s.ports, 'failed');
      const instance = s.intake.ensure(instanceId);
      instance.status_ = ended;
      const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
      expect([res.status, await res.json()], ended).toEqual([200, { v: 1, ok: true, instance_id: instanceId, created: false }]);
      expect(instance.calls, ended).toEqual([{ method: 'restart' }]);
      const run = s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0];
      expect(run, ended).toMatchObject({ status: 'running', finished_at: null, error: null, parked_reason: null, approval_token_sha256: null });
      expect(run.human_action, ended).toEqual({ channel: 'dashboard', actor: `user:${STAFF.uid}`, verb: 'rerun', decided_at: s.ports.clock.now().toISOString() });
    }
  });

  it('a final run whose instance no longer exists (past retention) -> the run is reopened before create(); created true', async () => {
    for (const status of ['skipped', 'failed', 'cancelled'] as const) {
      const s = setup();
      kvFlag(s, 'agent.rfq_intake', true);
      seedInbound(s.ports, { status: 'needs_review' });
      const runId = seedIntakeRun(s.ports, status, status === 'skipped' ? { error: 'daily_cap' } : {});
      // The run status the new instance's open-run step would read when create() starts it.
      const seenAtCreate: unknown[] = [];
      const create = s.intake.create.bind(s.intake);
      s.intake.create = async (o) => {
        seenAtCreate.push(s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0].status);
        return create(o);
      };
      const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
      expect([res.status, await res.json()], status).toEqual([200, { v: 1, ok: true, instance_id: instanceId, created: true }]);
      expect(seenAtCreate, status).toEqual(['running']);
      expect(s.intake.created, status).toEqual([{ id: instanceId, params: { v: 1, inbound_email_id: INBOUND, message_id_sha256: SHA, tenant_id: DEFAULT_TENANT } }]);
      const run = s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0];
      expect(run, status).toMatchObject({ status: 'running', finished_at: null, error: null, parked_reason: null });
      expect(run.human_action, status).toEqual({ channel: 'dashboard', actor: `user:${STAFF.uid}`, verb: 'rerun', decided_at: s.ports.clock.now().toISOString() });
    }
  });

  const EARLIER_ACTION = { channel: 'telegram', actor: 'telegram:4242', verb: 'not_rfq', decided_at: '2026-10-05T08:04:00Z' };

  it('restart() fails -> 500 and the run is final again with its previous status, finished_at, error, parked_reason and human_action', async () => {
    for (const status of ['skipped', 'failed', 'cancelled'] as const) {
      const s = setup();
      kvFlag(s, 'agent.rfq_intake', true);
      seedInbound(s.ports, { status: 'needs_review' });
      const runId = seedIntakeRun(s.ports, status, { human_action: EARLIER_ACTION });
      const before = rerunView(s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0]);
      const instance = s.intake.ensure(instanceId);
      instance.status_ = 'complete';
      instance.failures.set('restart', new Error('restart refused'));
      const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
      expect(res.status, status).toBe(500);
      expect(rerunView(s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0]), status).toEqual(before);
      expect(instance.calls, status).toEqual([]);
      expect(logs.join('\n')).not.toContain(STAFF.uid as string);
    }
  });

  it('create() fails with anything but "already exists" -> 500 and the reopened run is given back its previous columns', async () => {
    const s = setup();
    kvFlag(s, 'agent.rfq_intake', true);
    seedInbound(s.ports, { status: 'failed' });
    const runId = seedIntakeRun(s.ports, 'failed', { human_action: EARLIER_ACTION });
    const before = rerunView(s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0]);
    s.intake.create = async () => {
      throw new Error('workflow service unavailable');
    };
    const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
    expect(res.status).toBe(500);
    expect(rerunView(s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0])).toEqual(before);
  });

  it('a final run whose instance is live or unreadable -> created false, no restart, the run row unchanged', async () => {
    for (const live of ['waiting', 'running', 'unreadable'] as const) {
      const s = setup();
      kvFlag(s, 'agent.rfq_intake', true);
      seedInbound(s.ports, { status: 'needs_review' });
      const runId = seedIntakeRun(s.ports, 'skipped', { human_action: EARLIER_ACTION });
      const before = rerunView(s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0]);
      const instance = s.intake.ensure(instanceId);
      if (live === 'unreadable') {
        instance.status = async () => {
          throw new Error('status unavailable');
        };
      } else {
        instance.status_ = live;
      }
      const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
      expect([res.status, await res.json()], live).toEqual([200, { v: 1, ok: true, instance_id: instanceId, created: false }]);
      expect(instance.calls, live).toEqual([]);
      expect(rerunView(s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0]), live).toEqual(before);
    }
  });

  it('a failed start does not overwrite a run that another rerun changed after the reopen', async () => {
    const s = setup();
    kvFlag(s, 'agent.rfq_intake', true);
    seedInbound(s.ports, { status: 'needs_review' });
    const runId = seedIntakeRun(s.ports, 'skipped');
    const instance = s.intake.ensure(instanceId);
    instance.status_ = 'complete';
    const other = { channel: 'dashboard', actor: `user:${ADMIN.uid}`, verb: 'rerun', decided_at: '2026-10-05T09:00:30.000Z' };
    instance.restart = async () => {
      await s.ports.db.update('agent_runs', { human_action: other }, { filters: [['id', 'eq', runId]] });
      throw new Error('restart refused');
    };
    const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env);
    expect(res.status).toBe(500);
    const run = s.ports.db.rows('agent_runs', ['id', 'eq', runId])[0];
    expect(run).toMatchObject({ status: 'running', finished_at: null });
    expect(run.human_action).toEqual(other);
  });

  it('RFQ_INTAKE not bound -> 500 for this request only', async () => {
    const s = setup({ RFQ_INTAKE: undefined });
    kvFlag(s, 'agent.rfq_intake', true);
    seedInbound(s.ports, { status: 'received' });
    expect((await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post(body), s.env)).status).toBe(500);
  });
});

describe('start test_card', () => {
  it('STAFF -> 403; nothing written', async () => {
    const s = setup();
    const res = await app(s.ports, STAFF, 'start').request('https://x/api/agent/start', post({ v: 1, kind: 'test_card' }), s.env);
    expect([res.status, await res.json()]).toEqual([403, { error: 'forbidden' }]);
    expect(s.ports.db.rows('agent_runs')).toEqual([]);
    expect(s.ports.telegram.cards).toEqual([]);
  });

  it("ADMIN -> one 'eval' run (trigger dashboard, key test-card:<uuid>) waiting on a 'test' card with the verb dismiss; sent with buttons", async () => {
    const s = setup();
    const res = await app(s.ports, ADMIN, 'start').request('https://x/api/agent/start', post({ v: 1, kind: 'test_card' }), s.env);
    expect(res.status).toBe(200);
    const result = await body(res);
    expect(isStartResult(result)).toBe(true);
    expect(result.created).toBe(true);
    const runs = s.ports.db.rows('agent_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: result.instance_id, agent: 'eval', trigger: 'dashboard', status: 'waiting_human' });
    expect(runs[0].idempotency_key).toMatch(/^test-card:[0-9a-f-]{36}$/);
    expect(runs[0].approval_token_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(runs[0].output).toMatchObject({ card_kind: 'test', allowed_verbs: ['dismiss'], telegram_message_id: s.ports.telegram.cards[0].message_id });
    expect(s.ports.telegram.cards).toHaveLength(1);
    expect(s.ports.telegram.cards[0].card).toMatchObject({ kind: 'test', run_id: result.instance_id, allowed_verbs: ['dismiss'], open_url: `https://www.micronshub.eu/dashboard/approvals?run=${result.instance_id}` });
    expect(s.ports.telegram.cards[0].token).toMatch(/^[A-Z2-7]{26}$/);
    // The raw token is never logged or stored.
    const token = s.ports.telegram.cards[0].token as string;
    expect(logs.join('\n')).not.toContain(token);
    expect(JSON.stringify(runs[0])).not.toContain(token);
  });
});

// ----- staff file previews -----

const QUOTE_KEY = `quotes/${RFQ}/v2/quote.pdf`;
const EML_KEY = `email/${SHA}/raw.eml`;

describe('staff file previews', () => {
  it('key table: the fixed patterns only', () => {
    const allowed = [
      QUOTE_KEY,
      `orders/${RFQ}/traveler.pdf`,
      `cad/${RFQ}/output/flat.dxf`,
      `cad/${RFQ}/output/result.json`,
      `cad/${RFQ}/output/drawing.pdf`,
      EML_KEY,
      `email/${SHA}/att/1-drawing_v2.pdf`,
      `email/${SHA}/att/12-${'a'.repeat(100)}`,
    ];
    const refused = [
      `rfq/${RFQ}/file.pdf`,
      `quotes/${RFQ}/v2/other.pdf`,
      `quotes/${RFQ}/vx/quote.pdf`,
      `cad/${RFQ}/output/Flat.DXF`,
      `cad/${RFQ}/input/part.step`,
      `email/${SHA}/att/x-file.pdf`,
      `email/${SHA}/att/1-${'a'.repeat(101)}`,
      `email/${SHA.slice(2)}/raw.eml`,
      `eval/golden/2026-10-05/x.json`,
      `/quotes/${RFQ}/v2/quote.pdf`,
      `${QUOTE_KEY}/`,
    ];
    for (const k of allowed) expect(STAFF_FILE_KEY_RE.test(k), k).toBe(true);
    for (const k of refused) expect(STAFF_FILE_KEY_RE.test(k), k).toBe(false);
  });

  it('query rules: exactly one k, no encoded slash or backslash, no dot segments or backslash after decoding', () => {
    expect(staffFileKeyOf(`?k=${QUOTE_KEY}`)).toBe(QUOTE_KEY);
    expect(staffFileKeyOf(`?k=${QUOTE_KEY.replace('v2', '%76%32')}`)).toBe(QUOTE_KEY);
    expect(staffFileKeyOf(`?k=${QUOTE_KEY.replace(/\//g, '%2F')}`)).toBeNull();
    expect(staffFileKeyOf(`?k=${QUOTE_KEY.replace(/\//g, '%2f')}`)).toBeNull();
    expect(staffFileKeyOf(`?k=${QUOTE_KEY.replace('/v2/', '%5cv2/')}`)).toBeNull();
    expect(staffFileKeyOf(`?k=${QUOTE_KEY.replace('/v2/', '\\v2/')}`)).toBeNull();
    expect(staffFileKeyOf(`?k=quotes/${RFQ}/v2/../v1/quote.pdf`)).toBeNull();
    expect(staffFileKeyOf(`?k=${QUOTE_KEY}&k=${EML_KEY}`)).toBeNull();
    expect(staffFileKeyOf('?x=1')).toBeNull();
    expect(staffFileKeyOf('?k=%E0%A4%A')).toBeNull();
  });

  // Same vectors in workers/site/test/agent-hmac.test.ts and tests/frontend-api/agentApi.test.ts.
  const DOT_KEYS = [`cad/${RFQ}/output/..`, `cad/${RFQ}/output/a..b`, `email/${SHA}/att/1-..`, `email/${SHA}/att/1-a..b.pdf`, `email/${SHA}/att/12-..pdf`];

  it("'..' anywhere in a key -> null and 403; every vector otherwise fits STAFF_FILE_KEY_RE", async () => {
    expect(STAFF_FILE_KEY_RE.source).toBe(
      '^(quotes\\/[0-9a-f-]{36}\\/v\\d+\\/quote\\.pdf|orders\\/[0-9a-f-]{36}\\/traveler\\.pdf|cad\\/[0-9a-f-]{36}\\/output\\/[a-z_.]+|email\\/[0-9a-f]{64}\\/(raw\\.eml|att\\/[0-9]+-[A-Za-z0-9._-]{1,100}))$',
    );
    const s = setup();
    for (const key of DOT_KEYS) {
      expect(STAFF_FILE_KEY_RE.test(key), key).toBe(true);
      expect(staffFileKeyOf(`?k=${key}`), key).toBeNull();
      expect(staffFileKeyOf(`?k=${key.replace(/\./g, '%2E')}`), key).toBeNull();
      await s.bucket.put(key, 'x');
      const res = await app(s.ports, STAFF, 'file').request(`https://x/api/agent/file?k=${key}`, get, s.env);
      expect([res.status, await res.json()], key).toEqual([403, { error: 'forbidden' }]);
    }
    expect(s.bucket.reads).toEqual([]);
    // A single dot stays allowed.
    expect(staffFileKeyOf(`?k=email/${SHA}/att/1-a.b.pdf`)).toBe(`email/${SHA}/att/1-a.b.pdf`);
  });

  it('a quote PDF is served inline; a raw e-mail as an octet-stream attachment; nosniff, private no-store, noindex', async () => {
    const s = setup();
    await s.bucket.put(QUOTE_KEY, '%PDF-1.7 test', { httpMetadata: { contentType: 'application/pdf' } });
    await s.bucket.put(EML_KEY, 'From: a@example.com\r\n\r\nbody', { httpMetadata: { contentType: 'message/rfc822' } });
    const pdf = await app(s.ports, STAFF, 'file').request(`https://x/api/agent/file?k=${QUOTE_KEY}`, get, s.env);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toBe('inline; filename="quote.pdf"');
    expect(pdf.headers.get('cache-control')).toBe('private, no-store');
    expect(pdf.headers.get('x-content-type-options')).toBe('nosniff');
    expect(pdf.headers.get('x-robots-tag')).toBe('noindex');
    expect(await pdf.text()).toBe('%PDF-1.7 test');
    const eml = await app(s.ports, ADMIN, 'file').request(`https://x/api/agent/file?k=${EML_KEY}`, get, s.env);
    expect(eml.status).toBe(200);
    expect(eml.headers.get('content-type')).toBe('application/octet-stream');
    expect(eml.headers.get('content-disposition')).toBe('attachment; filename="raw.eml"');
    expect(eml.headers.get('x-content-type-options')).toBe('nosniff');
    // No log line carries the key.
    expect(logs.join('\n')).not.toContain(SHA);
  });

  it('refused keys -> 403 forbidden without detail; a missing object -> 404; other principals -> 403', async () => {
    const s = setup();
    for (const q of [`k=quotes/${RFQ}/v2/..%2Fquote.pdf`, `k=${QUOTE_KEY.replace(/\//g, '%2F')}`, `k=rfq/${RFQ}/x.pdf`, '']) {
      const res = await app(s.ports, STAFF, 'file').request(`https://x/api/agent/file?${q}`, get, s.env);
      expect([res.status, await res.json()], q).toEqual([403, { error: 'forbidden' }]);
    }
    const missing = await app(s.ports, STAFF, 'file').request(`https://x/api/agent/file?k=${QUOTE_KEY}`, get, s.env);
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'not_found' }]);
    const customer = await app(s.ports, { class: 'CUSTOMER', uid: ADMIN.uid }, 'file').request(`https://x/api/agent/file?k=${QUOTE_KEY}`, get, s.env);
    expect(customer.status).toBe(403);
    expect(s.bucket.reads).toEqual([{ key: QUOTE_KEY, range: undefined }]);
  });

  it('PRIVATE_FILES not bound -> 500 for this request only', async () => {
    const s = setup({ PRIVATE_FILES: undefined });
    expect((await app(s.ports, STAFF, 'file').request(`https://x/api/agent/file?k=${QUOTE_KEY}`, get, s.env)).status).toBe(500);
  });
});

// ----- the handlers as registered (routes/agent.ts delegates to agent-admin.ts) -----

describe('through the registered route', () => {
  it('status, flag, start and the staff file preview reach agent-admin through createAgentHandler', async () => {
    const env = opsEnv({ ...agentBindings() });
    const a = new Hono<OpsHono>();
    a.use('*', async (c, next) => {
      c.set('call', opsCall({ endpoint: 'agent', functionUrl: '/api/agent/status', action: 'status', principal: STAFF }) as OpsCall);
      await next();
    });
    a.all(AGENT_ROUTE, createAgentHandler());
    const res = await a.request('https://x/api/agent/status', get, env);
    expect(await res.json()).toEqual({ v: 1, ok: true, actions: ['decision', 'start', 'file'], principal: 'STAFF' });
  });
});

// ----- CHECK-LISTS -----

describe('CHECK-LISTS: the status lists used here equal the migration', () => {
  it('RERUNNABLE_INBOUND is a subset of inbound_emails_status_check', () => {
    const list = checkList('inbound_emails_status_check');
    for (const s of RERUNNABLE_INBOUND) expect(list).toContain(s);
  });

  it('QUOTE_FINAL equals the NOT IN list of quote_workflows_one_active_idx and is within quote_workflows_status_check', () => {
    const sql = agentLayerMigration().sql;
    const m = /CREATE UNIQUE INDEX quote_workflows_one_active_idx[^;]*WHERE status NOT IN \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const inIndex = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(sorted(QUOTE_FINAL)).toEqual(sorted(inIndex));
    const all = checkList('quote_workflows_status_check');
    for (const s of QUOTE_FINAL) expect(all).toContain(s);
  });

  it('the run statuses written here are in agent_runs_status_check', () => {
    expect(sorted(['running', 'waiting_human', 'succeeded', 'failed', 'cancelled', 'skipped'] satisfies RunStatus[])).toEqual(sorted(checkList('agent_runs_status_check')));
  });
});
