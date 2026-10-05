// The mini-PostgREST of the T2 harness (workers/site/test/integration/stubs/postgrest.mjs) against the real Db
// adapter of microns-ops (PostgrestDb, src/db/postgrest.ts): the shared KV vectors run end to end over HTTP
// (flagsSyncTick -> PostgrestDb -> stub -> memory-rpc), and the REST behaviours the agents rely on answer as
// PostgREST does (filters, on_conflict, Prefer, errors and their codes, single-object reads, the apikey header).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flagsSyncTick, type FlagsSyncPorts } from '../../src/cron/flags-sync';
import { DbError, PostgrestDb } from '../../src/db/postgrest';
import { DEFAULT_TENANT_ID } from '../../src/db/repos/feature-flags';
import type { OpsEnv } from '../../src/env';
import { FakeKv } from './table-db';
import { checkSeedCases, runScenario, VECTORS, type VectorWorld } from './vectors';

interface StubInstance {
  tables: Record<string, Array<Record<string, unknown>>>;
  seed(body: { tables?: Record<string, unknown[]>; replace?: boolean; flags?: 'migration' }): void;
  reset(): void;
}
interface StubModule {
  startPostgrestServer(o?: { port?: number }): Promise<{ url: string; stub: StubInstance; close(): Promise<void> }>;
}

const STUB_MODULE: string = new URL('../../../site/test/integration/stubs/postgrest.mjs', import.meta.url).href;
const KEY = 'stub-service-key';
const T0 = Date.parse('2026-10-05T07:01:00.000Z');

let server: Awaited<ReturnType<StubModule['startPostgrestServer']>>;
let db: PostgrestDb;

beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ STUB_MODULE)) as StubModule;
  server = await mod.startPostgrestServer();
  db = new PostgrestDb({ url: server.url, serviceRoleKey: KEY });
});
afterAll(async () => {
  await server?.close();
});
beforeEach(() => {
  server.stub.reset();
  server.stub.seed({ flags: 'migration' });
});

function world(kvInit: Record<string, string>): VectorWorld {
  const kv = new FakeKv(kvInit);
  const telegram = { sendText: vi.fn(async () => ({ message_id: 1 })), sendCard: vi.fn(), editCard: vi.fn() };
  let now = new Date(T0);
  const ports = { db, telegram, clock: { now: () => now } } as unknown as FlagsSyncPorts;
  const env = { FLAGS: kv.asBinding(), AGENT_TENANT_ID: DEFAULT_TENANT_ID } as unknown as OpsEnv;
  return {
    db,
    kv,
    tick: (at) => {
      now = new Date(at);
      return flagsSyncTick(env, { scheduledTime: at, cron: '* * * * *', noRetry() {} }, { ports });
    },
    flag: async (key, tenant) => {
      const [row] = await db.select('feature_flags', { filters: [['key', 'eq', key], ['tenant_id', 'eq', tenant ?? DEFAULT_TENANT_ID]] });
      return row;
    },
  };
}

const rest = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  fetch(`${server.url}/rest/v1${path}`, { ...init, headers: { apikey: KEY, authorization: `Bearer ${KEY}`, ...(init.headers ?? {}) } });

describe('PostgrestDb over the mini-PostgREST: shared KV vectors end to end', () => {
  it('seed rules', async () => {
    const w = world(Object.fromEntries(VECTORS.seed_cases.filter((c) => c.kv !== null).map((c) => [c.key, c.kv as string])));
    await checkSeedCases(w, T0 + 60_000);
  });

  it('scenario', async () => {
    await runScenario(world(VECTORS.scenario.kv), T0 + 60_000);
    const runs = server.stub.tables.agent_runs ?? [];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.agent === 'flags' && r.trigger === 'cron' && r.finished_at !== null)).toBe(true);
  });
});

describe('mini-PostgREST: REST behaviours', () => {
  it('needs an apikey header and knows only the tables of the agent layer and its business tables', async () => {
    const noKey = await fetch(`${server.url}/rest/v1/agent_runs`);
    expect(noKey.status).toBe(401);
    const missing = await rest('/no_such_table');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'PGRST205' });
    const empty = await rest('/agent_runs');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
  });

  it('filters, select lists, order and limit as PostgrestDb sends them', async () => {
    const at = (n: number) => new Date(T0 + n * 3_600_000).toISOString();
    await db.insert('agent_runs', [
      { agent: 'quote', trigger: 'workflow', idempotency_key: 'a_1%x', started_at: at(1), output: { tags: ['x'] } },
      { agent: 'quote', trigger: 'workflow', idempotency_key: 'A_1%X', started_at: at(2), output: null },
      { agent: 'cad', trigger: 'queue', idempotency_key: 'c', started_at: at(3), output: null },
    ]);
    const keys = async (o: Parameters<PostgrestDb['select']>[1]) => (await db.select('agent_runs', o)).map((r) => r.idempotency_key);
    expect(await keys({ filters: [['agent', 'eq', 'quote']], order: [{ column: 'started_at', ascending: false }] })).toEqual(['A_1%X', 'a_1%x']);
    expect(await keys({ filters: [['agent', 'in', ['cad', 'mcp']]] })).toEqual(['c']);
    expect(await keys({ filters: [['idempotency_key', 'ilike', 'a_1%x']], order: [{ column: 'idempotency_key' }] })).toEqual(['A_1%X', 'a_1%x']);
    expect(await keys({ filters: [['idempotency_key', 'ilike', 'a11x']] })).toEqual([]);
    expect(await keys({ filters: [['started_at', 'gte', at(2)], ['started_at', 'lt', at(3)]] })).toEqual(['A_1%X']);
    expect(await keys({ filters: [['output', 'is', null]], order: [{ column: 'started_at' }], limit: 1 })).toEqual(['A_1%X']);
    const cols = await db.select('agent_runs', { columns: 'agent,idempotency_key', filters: [['agent', 'eq', 'cad']] });
    expect(cols).toEqual([{ agent: 'cad', idempotency_key: 'c' }]);
    const bad = await rest('/agent_runs?colour=eq.red');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: '42703' });
  });

  it('array filters: ov and cs on text[] columns (reply lookup by outbound Message-ID)', async () => {
    const rfq = 'a0000000-0000-4000-8000-000000000001';
    server.stub.seed({ tables: { rfqs: [{ id: rfq, company_name: 'Example GmbH' }] } });
    await db.insert('quote_workflows', { rfq_id: rfq, workflow_instance_id: `quote-${rfq}-v1`, outbound_message_ids: ['<q.1.0@rfq.micronshub.eu>', '<q.1.1@rfq.micronshub.eu>'] });
    const hit = await db.select('quote_workflows', { filters: [['outbound_message_ids', 'ov', ['<x@example.com>', '<q.1.1@rfq.micronshub.eu>']]] });
    expect(hit).toHaveLength(1);
    expect(await db.select('quote_workflows', { filters: [['outbound_message_ids', 'cs', ['<q.1.0@rfq.micronshub.eu>', '<x@example.com>']]] })).toEqual([]);
  });

  it('on_conflict: ignore-duplicates returns only new rows, merge-duplicates updates; return=minimal answers no rows', async () => {
    const row = { message_id: '<m@example.com>', message_id_sha256: 'a'.repeat(64), mailbox: 'rfq', from_email: 'buyer@example.com', received_at: new Date(T0).toISOString() };
    const first = await db.insert('inbound_emails', row, { onConflict: ['tenant_id', 'message_id_sha256'], returning: true });
    const again = await db.insert('inbound_emails', { ...row, subject: 'x' }, { onConflict: ['tenant_id', 'message_id_sha256'], returning: true });
    expect(first).toHaveLength(1);
    expect(again).toEqual([]);
    const merged = await db.insert('inbound_emails', { ...row, subject: 'x' }, { onConflict: ['tenant_id', 'message_id_sha256'], ignoreDuplicates: false, returning: 'id,subject' });
    expect(merged).toEqual([{ id: first[0].id, subject: 'x' }]);
    expect(await db.insert('inbound_emails', { ...row, message_id_sha256: 'b'.repeat(64) })).toEqual([]);
    expect(server.stub.tables.inbound_emails).toHaveLength(2);
  });

  it('errors keep PostgREST codes and statuses; a request is one transaction', async () => {
    const check = await db.insert('agent_runs', { agent: 'quote', trigger: 'sms', idempotency_key: 'k' }).catch((e: unknown) => e);
    expect(check).toBeInstanceOf(DbError);
    expect(check).toMatchObject({ status: 400, code: '23514' });
    await db.insert('agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'dup' });
    expect(await db.insert('agent_runs', { agent: 'quote', trigger: 'cron', idempotency_key: 'dup' }).catch((e: unknown) => e)).toMatchObject({ status: 409, code: '23505' });
    // Second row fails: the first is not kept either.
    const bulk = await db.insert('agent_runs', [
      { agent: 'quote', trigger: 'cron', idempotency_key: 'bulk-1' },
      { agent: 'quote', trigger: 'cron', idempotency_key: 'dup' },
    ]).catch((e: unknown) => e);
    expect(bulk).toMatchObject({ code: '23505' });
    expect((server.stub.tables.agent_runs ?? []).map((r) => r.idempotency_key)).toEqual(['dup']);
    const keys = await rest('/agent_runs', { method: 'POST', body: JSON.stringify([{ agent: 'a', trigger: 'cron', idempotency_key: 'x' }, { agent: 'a' }]), headers: { 'content-type': 'application/json' } });
    expect(keys.status).toBe(400);
    expect(await keys.json()).toMatchObject({ code: 'PGRST102' });
    expect(await db.rpc('claim_approval', {}).catch((e: unknown) => e)).toMatchObject({ status: 404, code: 'PGRST202' });
    const raised = await db.rpc('create_email_rfq', { p_inbound_email_id: DEFAULT_TENANT_ID, p_payload: {}, p_source: 'web' }).catch((e: unknown) => e);
    expect(raised).toMatchObject({ status: 400, code: 'P0001' });
    const del = await rest('/feature_flags?key=eq.agent.quote', { method: 'DELETE' });
    expect(del.status).toBe(403);
    expect(await del.json()).toMatchObject({ code: '42501', message: expect.stringContaining('not deleted') });
  });

  it('single-object reads answer 406 PGRST116 unless exactly one row matches; RPC results keep their shapes', async () => {
    const one = await rest('/feature_flags?key=eq.agent.quote&select=key,enabled', { headers: { accept: 'application/vnd.pgrst.object+json' } });
    expect(one.status).toBe(200);
    expect(await one.json()).toEqual({ key: 'agent.quote', enabled: false });
    const none = await rest('/feature_flags?key=eq.nope', { headers: { accept: 'application/vnd.pgrst.object+json' } });
    expect(none.status).toBe(406);
    expect(await none.json()).toMatchObject({ code: 'PGRST116' });
    expect(await db.rpc('feature_flags_kv_key', { p_key: 'agent.quote', p_tenant_id: DEFAULT_TENANT_ID })).toBe('agent.quote');
    const begun = await db.rpc<Array<{ run_id: string; created: boolean }>>('agent_run_begin', { p_agent: 'eval', p_trigger: 'manual', p_idempotency_key: 'e1' });
    expect(begun).toEqual([{ run_id: expect.stringMatching(/^[0-9a-f-]{36}$/), created: true, run_status: 'running' }]);
    expect(await db.rpc('feature_flags_mark_synced', { p_key: 'agent.quote', p_tenant_id: DEFAULT_TENANT_ID, p_rev: 999 })).toBe(false);
  });

  it('seeds the 13 flag rows as the migration inserts them, and serves rows to the control API', async () => {
    const rows = await db.select('feature_flags', { columns: 'key,rev,kv_seed_pending', order: [{ column: 'rev' }] });
    expect(rows).toHaveLength(13);
    expect(rows.map((r) => r.rev)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(rows.every((r) => r.kv_seed_pending === true)).toBe(true);
    const viaControl = await fetch(`${server.url}/__stub/rows/feature_flags`);
    expect(await viaControl.json()).toHaveLength(13);
  });
});
