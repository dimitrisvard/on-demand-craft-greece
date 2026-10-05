// flagsSyncTick (src/cron/flags-sync.ts) against the in-memory RPCs and a fake KV (PHASE4_SPEC.md §5.1 DB-4):
// the shared vectors of supabase/tests/agent_layer/vectors/flags-sync.json (the SQL tests run the same file against
// the SQL functions), mark-after-put ordering, run records only on change or failure, the hourly drift report
// without overwrite, bulk KV reads, and the missing-binding check.

import { describe, expect, it, vi } from 'vitest';
import { ConfigMissingError } from '../../src/agents/config';
import { DRIFT_SETTLE_MS, flagsSyncTick, KV_BULK_MAX, tickKey, type FlagsSyncPorts, type FlagsSyncSummary } from '../../src/cron/flags-sync';
import { DbError } from '../../src/db/postgrest';
import { DEFAULT_TENANT_ID, flagKvKey } from '../../src/db/repos/feature-flags';
import type { OpsEnv } from '../../src/env';
import { seededFlags } from '../helpers/check-lists';
import { insertRow, rowsOf, updateRow, type MemoryRow, type MemoryTableSet } from '../helpers/memory-rpc';
import { FakeKv, TableDb } from './table-db';
import { checkSeedCases, runScenario, VECTORS } from './vectors';

const T0 = Date.parse('2026-10-05T07:01:00.000Z');
const minute = (n: number): number => T0 + n * 60_000;

function world(kvInit: Record<string, string> = {}) {
  const tables: MemoryTableSet = {};
  const log: string[] = [];
  let now = new Date(T0);
  // The 13 rows as the migration's INSERT leaves them (trigger-assigned revs 1..13, waiting for the KV import).
  for (const row of seededFlags()) insertRow(tables, 'feature_flags', row, new Date(Date.parse('2026-10-01T00:00:00Z')));
  const db = new TableDb(tables, log, () => now);
  const kv = new FakeKv(kvInit, log);
  const telegram = { sendText: vi.fn(async (_t: string) => ({ message_id: 1 })), sendCard: vi.fn(), editCard: vi.fn() };
  const ports = { db, telegram, clock: { now: () => now } } as unknown as FlagsSyncPorts;
  const env = { FLAGS: kv.asBinding(), AGENT_TENANT_ID: DEFAULT_TENANT_ID } as unknown as OpsEnv;
  const flagRow = (key: string, tenant = DEFAULT_TENANT_ID): MemoryRow => {
    const row = rowsOf(tables, 'feature_flags').find((r) => r.key === key && r.tenant_id === tenant);
    if (!row) throw new Error(`no flag ${key}`);
    return row;
  };
  const edit = (key: string, set: MemoryRow, tenant = DEFAULT_TENANT_ID): MemoryRow => {
    const i = rowsOf(tables, 'feature_flags').findIndex((r) => r.key === key && r.tenant_id === tenant);
    return updateRow(tables, 'feature_flags', i, set, now);
  };
  /** One tick scheduled at `at` (ms); the clock reads `at` too. */
  const tick = async (at: number): Promise<FlagsSyncSummary> => {
    now = new Date(at);
    return flagsSyncTick(env, { scheduledTime: at, cron: '* * * * *', noRetry() {} }, { ports });
  };
  const runs = (): MemoryRow[] => rowsOf(tables, 'agent_runs');
  return {
    tables, log, db, kv, telegram, ports, env, flag: flagRow, edit, tick, runs,
    vectorWorld: { db, kv, tick, flag: async (key: string, tenant?: string) => flagRow(key, tenant) },
  };
}

describe('flagsSyncTick: shared KV vectors (vectors/flags-sync.json)', () => {
  it('seed rules: valid records are imported, absent keys marked in sync without a write, malformed keys stay pending', async () => {
    const w = world(Object.fromEntries(VECTORS.seed_cases.filter((c) => c.kv !== null).map((c) => [c.key, c.kv as string])));
    await checkSeedCases(w.vectorWorld, minute(1));
  });

  it('scenario: ticks, edits, a batch/mark race, a failed put, another tenant', async () => {
    const w = world(VECTORS.scenario.kv);
    await runScenario(w.vectorWorld, minute(1));
  });
});

describe('flagsSyncTick: write order and run records', () => {
  it('puts each row before marking it synced, and never marks a row whose put failed', async () => {
    const w = world({ 'seo.strict_404': '{"enabled":true}' });
    await w.tick(minute(1));
    w.edit('agent.quote', { enabled: true });
    w.kv.failNext.add('agent.quote');
    w.log.length = 0;
    const r = await w.tick(minute(2));
    expect(r.failed).toEqual(['agent.quote']);
    expect(w.log).toContain('kv.put agent.quote failed');
    expect(w.log.filter((l) => l === 'db.rpc feature_flags_mark_synced agent.quote')).toHaveLength(0);
    expect(w.flag('agent.quote').kv_synced_rev).not.toBe(w.flag('agent.quote').rev);

    w.log.length = 0;
    await w.tick(minute(3));
    const put = w.log.indexOf('kv.put agent.quote');
    const mark = w.log.indexOf('db.rpc feature_flags_mark_synced agent.quote');
    expect(put).toBeGreaterThanOrEqual(0);
    expect(mark).toBeGreaterThan(put);
    expect(w.flag('agent.quote').kv_synced_rev).toBe(w.flag('agent.quote').rev);
  });

  it('writes revisions in rev order of the batch and marks exactly the rev that was put', async () => {
    const w = world();
    await w.tick(minute(1));
    w.edit('agent.post_order', { enabled: true });
    w.edit('agent.quote', { enabled: true });
    const revs = { post: w.flag('agent.post_order').rev as number, quote: w.flag('agent.quote').rev as number };
    expect(revs.quote).toBeGreaterThan(revs.post);
    await w.tick(minute(2));
    expect(JSON.parse(w.kv.map.get('agent.post_order') as string).rev).toBe(revs.post);
    expect(JSON.parse(w.kv.map.get('agent.quote') as string).rev).toBe(revs.quote);
    expect(w.flag('agent.quote').kv_synced_rev).toBe(revs.quote);
  });

  it('records one agent_runs row (flags, cron, flags-sync:<minute>) for a tick that did something, none for a steady tick', async () => {
    const w = world({ 'seo.strict_404': '{"enabled":false}' });
    const first = await w.tick(minute(1));
    expect(w.runs()).toHaveLength(1);
    const run = w.runs()[0];
    expect(run).toMatchObject({
      agent: 'flags', trigger: 'cron', idempotency_key: tickKey(minute(1)), status: 'succeeded', error: null,
      llm_calls: 0, cost_cents: 0, approval_token_sha256: null, parked_reason: null,
    });
    expect(run.idempotency_key).toBe('flags-sync:2026-10-05T07:02Z');
    expect(run.finished_at).not.toBeNull();
    expect(first.run_id).toBe(run.id);
    expect((run.output as { counts: Record<string, number> }).counts).toMatchObject({ imported: 1, absent: 12, written: 1, invalid: 0 });

    w.log.length = 0;
    const steady = await w.tick(minute(2));
    expect(steady.run_id).toBeNull();
    expect(w.runs()).toHaveLength(1);
    expect(w.log.filter((l) => !l.startsWith('db.select') && !l.startsWith('db.rpc feature_flags_sync_batch'))).toEqual([]);
  });

  it('closes the run failed with kv_put_failed when a put fails, and records the same minute only once', async () => {
    const w = world();
    await w.tick(minute(1));
    w.edit('agent.growth.hn', { enabled: true });
    w.kv.failNext.add('agent.growth.hn');
    await w.tick(minute(2));
    const run = w.runs().find((r) => r.idempotency_key === tickKey(minute(2)));
    expect(run).toMatchObject({ status: 'failed', error: 'kv_put_failed' });
    expect((run!.output as { failed: string[] }).failed).toEqual(['agent.growth.hn']);

    // A repeated invocation for the same minute writes the key but keeps the one run row.
    await w.tick(minute(2));
    expect(w.runs().filter((r) => r.idempotency_key === tickKey(minute(2)))).toHaveLength(1);
    expect(w.flag('agent.growth.hn').kv_synced_rev).toBe(w.flag('agent.growth.hn').rev);
  });

  it('a database failure records a failed run and rejects', async () => {
    const w = world();
    w.db.failNext = { target: 'feature_flags_sync_batch', error: new DbError(503, null, 'PostgREST 503') };
    await expect(w.tick(minute(1))).rejects.toBeInstanceOf(DbError);
    const run = w.runs()[0];
    expect(run).toMatchObject({ agent: 'flags', status: 'failed', error: 'flags_sync_failed:http_503' });
  });

  it('refuses to run without the FLAGS binding', async () => {
    const w = world();
    const env = { ...w.env, FLAGS: undefined } as OpsEnv;
    const err = await flagsSyncTick(env, { scheduledTime: minute(1), cron: '* * * * *', noRetry() {} }, { ports: w.ports }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigMissingError);
    expect((err as ConfigMissingError).names).toEqual(['FLAGS']);
    expect(w.log).toEqual([]);
  });

  it(`reads pending KV keys in bulk, at most ${KV_BULK_MAX} per call`, async () => {
    const w = world();
    const tenant = '22222222-2222-4222-8222-222222222222';
    for (let i = 0; i < 150; i++) {
      insertRow(w.tables, 'feature_flags', { key: `agent.k${i}`, tenant_id: tenant, kv_seed_pending: true }, new Date(T0));
    }
    w.kv.map.set(flagKvKey('agent.k149', tenant), '{"enabled":true}');
    const r = await w.tick(minute(1));
    expect(w.kv.bulkReads).toBe(2);
    expect(r.imported).toEqual([`t:${tenant}:agent.k149`]);
    expect(r.absent).toHaveLength(13 + 149);
    expect(rowsOf(w.tables, 'feature_flags').every((f) => f.kv_seed_pending === false)).toBe(true);
  });
});

describe('flagsSyncTick: hourly drift report (minute 0)', () => {
  const HOUR = Date.parse('2026-10-05T08:00:00.000Z');

  async function synced(kvInit: Record<string, string> = {}) {
    const w = world(kvInit);
    await w.tick(minute(1));
    w.edit('agent.quote', { enabled: true });
    w.edit('agent.post_order', { enabled: true });
    await w.tick(minute(2));
    return w;
  }

  it('reports a KV value changed by hand at minute 0 and leaves it as it is', async () => {
    const w = await synced();
    const handSet = '{"enabled":false,"value":{"mode":"assist"}}';
    w.kv.map.set('agent.quote', handSet);
    const r = await w.tick(HOUR);
    expect(r.drift).toEqual([{ kv_key: 'agent.quote', kind: 'kv_differs' }]);
    expect(w.kv.map.get('agent.quote')).toBe(handSet);
    expect(w.flag('agent.quote').enabled).toBe(true);
    const run = w.runs().find((x) => x.idempotency_key === tickKey(HOUR));
    expect(run).toMatchObject({ status: 'succeeded' });
    expect((run!.output as { drift: unknown }).drift).toEqual([{ kv_key: 'agent.quote', kind: 'kv_differs' }]);
    expect(w.telegram.sendText).toHaveBeenCalledTimes(1);
    const text = w.telegram.sendText.mock.calls[0][0];
    expect(text).toContain('agent.quote (kv_differs)');
    expect(text).toContain('Nothing was overwritten');
  });

  it('checks only at minute 0', async () => {
    const w = await synced();
    w.kv.map.set('agent.quote', '{"enabled":false}');
    const r = await w.tick(HOUR + 5 * 60_000);
    expect(r.drift).toBeNull();
    expect(w.telegram.sendText).not.toHaveBeenCalled();
    expect(w.kv.map.get('agent.quote')).toBe('{"enabled":false}');
  });

  it('kinds: malformed record, missing key of an enabled row; absent keys of rows that are off are the seed state, not drift', async () => {
    const w = await synced();
    w.kv.map.set('agent.quote', 'garbage');
    w.kv.map.delete('agent.post_order');
    const r = await w.tick(HOUR);
    expect(r.drift).toEqual(expect.arrayContaining([
      { kv_key: 'agent.quote', kind: 'kv_malformed' },
      { kv_key: 'agent.post_order', kind: 'kv_missing' },
    ]));
    expect(r.drift).toHaveLength(2);
    expect(w.kv.map.has('agent.post_order')).toBe(false);
  });

  it('a clean mirror reports nothing and writes no run row', async () => {
    const w = await synced();
    const before = w.runs().length;
    const r = await w.tick(HOUR);
    expect(r.drift).toEqual([]);
    expect(w.runs()).toHaveLength(before);
    expect(w.telegram.sendText).not.toHaveBeenCalled();
  });

  it(`leaves out rows written in the last ${DRIFT_SETTLE_MS / 1000} s (KV reads may still be cached)`, async () => {
    const w = await synced();
    w.edit('agent.growth.hn', { enabled: true });
    await w.tick(HOUR - 60_000);                    // written one minute before the hour
    w.kv.map.set('agent.growth.hn', '{"enabled":false}');
    const r = await w.tick(HOUR);
    expect(r.drift).toEqual([]);
  });

  it('reports KV values the seed import refused in the hourly notice; a failed notice does not fail the tick', async () => {
    const w = world({ 'mcp.remote': '{"on":true}' });
    w.telegram.sendText.mockRejectedValueOnce(new Error('telegram down'));
    const r = await w.tick(HOUR);
    expect(r.invalid).toEqual(['mcp.remote']);
    expect(w.telegram.sendText).toHaveBeenCalledTimes(1);
    expect(w.telegram.sendText.mock.calls[0][0]).toContain('mcp.remote');
  });
});
