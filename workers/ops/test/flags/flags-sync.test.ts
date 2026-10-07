// flagsSyncTick (src/cron/flags-sync.ts) against the in-memory RPCs and a fake KV (PHASE4_SPEC.md §5.1 DB-4):
// the shared vectors of supabase/tests/agent_layer/vectors/flags-sync.json (the SQL tests run the same file against
// the SQL functions), mark-after-put ordering, two writers of one key (the tick and the edit's write-through), run
// records only on change or failure, per-row seed failures, the hourly drift report (what it compares, which rows it
// leaves out, which records it rewrites), bulk KV reads, and the missing-binding check.

import { describe, expect, it, vi } from 'vitest';
import { ConfigMissingError } from '../../src/agents/config';
import { DRIFT_SETTLE_MS, flagsSyncTick, KV_BULK_MAX, tickKey, type FlagsSyncPorts, type FlagsSyncSummary } from '../../src/cron/flags-sync';
import { DbError } from '../../src/db/postgrest';
import { DEFAULT_TENANT_ID, flagKvKey, updateFlagIfRev, writeThrough, type FeatureFlagRow } from '../../src/db/repos/feature-flags';
import type { OpsEnv } from '../../src/env';
import { seededFlags } from '../helpers/check-lists';
import { insertRow, rowsOf, updateRow, type MemoryRow, type MemoryTableSet } from '../helpers/memory-rpc';
import { FakeKv, TableDb } from './table-db';
import { checkSeedCases, runScenario, seedCaseKv, VECTORS } from './vectors';

const T0 = Date.parse('2026-10-05T07:01:00.000Z');
const minute = (n: number): number => T0 + n * 60_000;
const ADMIN = '11111111-1111-4111-8111-111111111111';

/** A FLAGS binding over `kv` whose first put of `key` runs `before` and only then lands (another writer in between). */
function interleaved(kv: FakeKv, key: string, before: () => Promise<void>): KVNamespace {
  let pending: (() => Promise<void>) | null = before;
  return {
    get: (k: string | string[], t?: unknown) => kv.get(k, t),
    put: async (k: string, v: string) => {
      if (k === key && pending) {
        const run = pending;
        pending = null;
        await run();
      }
      return kv.put(k, v);
    },
  } as unknown as KVNamespace;
}

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
  /** One tick scheduled at `at` (ms); the clock reads `at` too. `e` replaces the env (e.g. another FLAGS binding). */
  const tick = async (at: number, e: OpsEnv = env): Promise<FlagsSyncSummary> => {
    now = new Date(at);
    return flagsSyncTick(e, { scheduledTime: at, cron: '* * * * *', noRetry() {} }, { ports });
  };
  /** Sets the clock that edits and RPCs read. */
  const setClock = (at: number): void => {
    now = new Date(at);
  };
  const runs = (): MemoryRow[] => rowsOf(tables, 'agent_runs');
  /** The dashboard's flag switch: optimistic edit by rev (feature-flags.ts updateFlagIfRev). */
  const switchFlag = async (key: string, enabled: boolean): Promise<FeatureFlagRow> => {
    const r = flagRow(key);
    const row = await updateFlagIfRev(db, { key, expected_rev: r.rev as number, enabled, value: r.value as Record<string, unknown>, updated_by: ADMIN });
    if (!row) throw new Error(`edit of ${key} refused`);
    return row;
  };
  return {
    tables, log, db, kv, telegram, ports, env, flag: flagRow, edit, tick, setClock, runs, switchFlag,
    vectorWorld: { db, kv, tick: (at: number) => tick(at), flag: async (key: string, tenant?: string) => flagRow(key, tenant) },
  };
}

describe('flagsSyncTick: shared KV vectors (vectors/flags-sync.json)', () => {
  it('seed rules: valid records are imported, absent keys marked in sync without a write, malformed keys stay pending', async () => {
    const w = world(seedCaseKv());
    await checkSeedCases(w.vectorWorld, minute(1));
  });

  it('scenario: ticks, edits, a batch/mark race, a failed put, another tenant', async () => {
    const w = world(VECTORS.scenario.kv);
    await runScenario(w.vectorWorld, minute(1));
  });
});

describe('flagsSyncTick and the write-through: two writers of one key', () => {
  it('a tick whose put of an older rev lands after the write-through of a newer rev rewrites the key on the next tick', async () => {
    const w = world();
    await w.tick(minute(1));                                        // seed: every key absent
    const on = await w.switchFlag('agent.rfq_intake', true);
    w.kv.failNext.add('agent.rfq_intake');                          // the edit's own put is refused (1 write/s per key)
    expect(await writeThrough(w.db, w.kv.asBinding(), on)).toBe('pending');
    // The tick reads the batch with the 'on' rev; before its put lands, the 'off' edit is written through and marked.
    const flags = interleaved(w.kv, 'agent.rfq_intake', async () => {
      const off = await w.switchFlag('agent.rfq_intake', false);
      expect(await writeThrough(w.db, w.kv.asBinding(), off)).toBe('written');
    });
    const racing = await w.tick(minute(2), { ...w.env, FLAGS: flags } as OpsEnv);
    expect(racing.stale).toEqual(['agent.rfq_intake']);
    expect(JSON.parse(w.kv.map.get('agent.rfq_intake') as string).enabled).toBe(true);   // the older record landed last

    const next = await w.tick(minute(3));
    expect(next.written).toEqual(['agent.rfq_intake']);
    const row = w.flag('agent.rfq_intake');
    expect(JSON.parse(w.kv.map.get('agent.rfq_intake') as string)).toMatchObject({ enabled: false, rev: row.rev });
    expect(row.kv_synced_rev).toBe(row.rev);
    expect((await w.tick(minute(4))).written).toEqual([]);           // converged: nothing left to write
  });

  it('a write-through of an older rev that lands after a newer one answers pending, and the next tick writes the newer rev', async () => {
    const w = world();
    await w.tick(minute(1));
    const first = await w.switchFlag('agent.quote', true);
    const flags = interleaved(w.kv, 'agent.quote', async () => {
      const second = await w.switchFlag('agent.quote', false);
      expect(await writeThrough(w.db, w.kv.asBinding(), second)).toBe('written');
    });
    expect(await writeThrough(w.db, flags, first)).toBe('pending');
    expect(JSON.parse(w.kv.map.get('agent.quote') as string).enabled).toBe(true);

    const next = await w.tick(minute(2));
    expect(next.written).toEqual(['agent.quote']);
    expect(JSON.parse(w.kv.map.get('agent.quote') as string)).toMatchObject({ enabled: false, rev: w.flag('agent.quote').rev });
  });

  it('two ticks of one minute: the put of the slower one lands last, and the following tick rewrites the current rev', async () => {
    const w = world();
    await w.tick(minute(1));
    await w.switchFlag('agent.post_order', true);
    // A slow tick reads the batch; a second invocation runs and finishes inside its put, after another edit.
    const slow = interleaved(w.kv, 'agent.post_order', async () => {
      await w.switchFlag('agent.post_order', false);
      expect((await w.tick(minute(2))).written).toEqual(['agent.post_order']);
    });
    expect((await w.tick(minute(2), { ...w.env, FLAGS: slow } as OpsEnv)).stale).toEqual(['agent.post_order']);
    expect((await w.tick(minute(3))).written).toEqual(['agent.post_order']);
    expect(JSON.parse(w.kv.map.get('agent.post_order') as string)).toMatchObject({ enabled: false, rev: w.flag('agent.post_order').rev });
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

    // A repeated invocation for the same minute writes the key but keeps the one run row as the first one recorded it.
    const again = await w.tick(minute(2));
    expect(again.written).toEqual(['agent.growth.hn']);
    const rows = w.runs().filter((r) => r.idempotency_key === tickKey(minute(2)));
    expect(rows).toHaveLength(1);
    expect(again.run_id).toBe(run!.id);
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'kv_put_failed' });
    expect((rows[0].output as { failed: string[]; written: string[] })).toMatchObject({ failed: ['agent.growth.hn'], written: [] });
    expect(w.flag('agent.growth.hn').kv_synced_rev).toBe(w.flag('agent.growth.hn').rev);
  });

  it('a database failure records a failed run and rejects', async () => {
    const w = world();
    w.db.failNext = { target: 'feature_flags_sync_batch', error: new DbError(503, null, 'PostgREST 503') };
    await expect(w.tick(minute(1))).rejects.toBeInstanceOf(DbError);
    const run = w.runs()[0];
    expect(run).toMatchObject({ agent: 'flags', status: 'failed', error: 'flags_sync_failed:http_503' });
  });

  it('a database error with a code records flags_sync_failed:<code>:<status>', async () => {
    const w = world();
    w.db.failNext = { target: 'feature_flags_sync_batch', error: new DbError(400, '23514', 'check') };
    await expect(w.tick(minute(1))).rejects.toBeInstanceOf(DbError);
    expect(w.runs()[0]).toMatchObject({ status: 'failed', error: 'flags_sync_failed:23514:400' });
  });

  it('a failing seed import call for one row stops neither the other rows nor the mirror; the key is reported and retried', async () => {
    const HOUR = Date.parse('2026-10-05T08:00:00.000Z');
    const w = world({ 'agent.content_daily': '{"enabled":true}', 'seo.strict_404': '{"enabled":true}' });
    // Pending rows are imported in (tenant, key) order: agent.content_daily is the first call.
    w.db.failNext = { target: 'feature_flags_seed_from_kv', error: new DbError(503, null, 'PostgREST 503') };
    const r = await w.tick(HOUR);
    expect(r.seed_failed).toEqual(['agent.content_daily']);
    expect(r.imported).toEqual(['seo.strict_404']);
    expect(r.absent).toHaveLength(11);
    expect(r.written).toEqual(['seo.strict_404']);
    expect(w.flag('agent.content_daily').kv_seed_pending).toBe(true);
    const run = w.runs().find((x) => x.idempotency_key === tickKey(HOUR));
    expect(run).toMatchObject({ status: 'failed', error: 'flags_seed_failed:http_503' });
    expect((run!.output as { seed_failed: string[] }).seed_failed).toEqual(['agent.content_daily']);
    expect(w.telegram.sendText).toHaveBeenCalledTimes(1);
    expect(w.telegram.sendText.mock.calls[0][0]).toContain('Seed import failed (retried every minute): agent.content_daily');

    const next = await w.tick(HOUR + 60_000);
    expect(next.seed_failed).toEqual([]);
    expect(next.imported).toEqual(['agent.content_daily']);
    expect(next.written).toEqual(['agent.content_daily']);
  });

  it('KV records the table refuses (JSON null mode) are invalid: the other keys are imported and written in the same tick', async () => {
    const w = world({ 'agent.growth.hn': '{"enabled":true,"mode":null}', 'seo.strict_404': '{"enabled":true}' });
    const r = await w.tick(minute(1));
    expect(r).toMatchObject({ invalid: ['agent.growth.hn'], imported: ['seo.strict_404'], written: ['seo.strict_404'], seed_failed: [], failed: [] });
    expect(w.runs()[0]).toMatchObject({ status: 'succeeded', error: null });
    expect(w.flag('agent.growth.hn')).toMatchObject({ kv_seed_pending: true, enabled: false });
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
    expect(text).toContain('These KV values were not overwritten');
    expect(text).not.toContain('rewritten');
  });

  it('checks only at minute 0', async () => {
    const w = await synced();
    w.kv.map.set('agent.quote', '{"enabled":false}');
    for (const m of [1, 2, 5, 30, 59]) {
      const r = await w.tick(HOUR + m * 60_000);
      expect(r.drift, `minute ${m}`).toBeNull();
    }
    expect(w.telegram.sendText).not.toHaveBeenCalled();
    expect(w.kv.map.get('agent.quote')).toBe('{"enabled":false}');
    expect((await w.tick(HOUR + 60 * 60_000)).drift).toEqual([{ kv_key: 'agent.quote', kind: 'kv_differs' }]);
  });

  it('reports a record whose value differs while enabled is the same', async () => {
    const w = await synced();
    const rec = JSON.parse(w.kv.map.get('agent.quote') as string) as { value: Record<string, unknown> };
    const handSet = JSON.stringify({ ...rec, value: { ...rec.value, follow_up_days: [1] } });
    w.kv.map.set('agent.quote', handSet);
    const r = await w.tick(HOUR);
    expect(r.drift).toEqual([{ kv_key: 'agent.quote', kind: 'kv_differs' }]);
    expect(w.kv.map.get('agent.quote')).toBe(handSet);
  });

  it('compares the top-level mode of a record with the mode of the row (value.mode, or none)', async () => {
    const w = await synced();
    w.edit('agent.growth.scrapers', { enabled: true });               // value without a mode
    await w.tick(minute(3));
    const scrapers = JSON.stringify({ ...JSON.parse(w.kv.map.get('agent.growth.scrapers') as string), mode: 'auto' });
    const quote = JSON.stringify({ ...JSON.parse(w.kv.map.get('agent.quote') as string), mode: 'auto' });   // value.mode is assist
    w.kv.map.set('agent.growth.scrapers', scrapers);
    w.kv.map.set('agent.quote', quote);
    const r = await w.tick(HOUR);
    expect(r.drift).toEqual(expect.arrayContaining([
      { kv_key: 'agent.growth.scrapers', kind: 'kv_differs' },
      { kv_key: 'agent.quote', kind: 'kv_differs' },
    ]));
    expect(r.drift).toHaveLength(2);
    expect(r.written).toEqual([]);
    expect(w.kv.map.get('agent.growth.scrapers')).toBe(scrapers);
    expect(w.kv.map.get('agent.quote')).toBe(quote);
  });

  it('rewrites a mirror record of an older rev with the current rev, and reports it', async () => {
    const w = await synced();
    const older = w.kv.map.get('agent.quote') as string;
    w.edit('agent.quote', { enabled: false });
    await w.tick(minute(3));
    w.kv.map.set('agent.quote', older);                              // the row is marked synced, KV holds an older rev
    const r = await w.tick(HOUR);
    expect(r.drift).toEqual([{ kv_key: 'agent.quote', kind: 'kv_behind' }]);
    expect(r.written).toEqual(['agent.quote']);
    const row = w.flag('agent.quote');
    expect(JSON.parse(w.kv.map.get('agent.quote') as string)).toMatchObject({ enabled: false, rev: row.rev });
    expect(row.kv_synced_rev).toBe(row.rev);
    const text = w.telegram.sendText.mock.calls[0][0];
    expect(text).toContain('KV held an older revision, rewritten with the table value: agent.quote');
    expect(text).not.toContain('not overwritten');
    expect(w.runs().find((x) => x.idempotency_key === tickKey(HOUR))).toMatchObject({ status: 'succeeded' });
  });

  it('a record with the current rev (or none) that differs is reported, never rewritten', async () => {
    const w = await synced();
    const quote = JSON.parse(w.kv.map.get('agent.quote') as string) as Record<string, unknown>;
    const post = JSON.parse(w.kv.map.get('agent.post_order') as string) as Record<string, unknown>;
    const sameRev = JSON.stringify({ ...quote, enabled: false });
    const newerRev = JSON.stringify({ ...post, enabled: false, rev: Number(post.rev) + 100 });
    const noRev = '{"enabled":false,"value":{"mode":"assist"}}';
    w.kv.map.set('agent.quote', sameRev);
    w.kv.map.set('agent.post_order', newerRev);
    w.edit('agent.growth.hn', { enabled: true });
    await w.tick(minute(3));
    w.kv.map.set('agent.growth.hn', noRev);
    const r = await w.tick(HOUR);
    expect(r.drift).toEqual(expect.arrayContaining([
      { kv_key: 'agent.quote', kind: 'kv_differs' },
      { kv_key: 'agent.post_order', kind: 'kv_differs' },
      { kv_key: 'agent.growth.hn', kind: 'kv_differs' },
    ]));
    expect(r.drift).toHaveLength(3);
    expect(r.written).toEqual([]);
    expect([w.kv.map.get('agent.quote'), w.kv.map.get('agent.post_order'), w.kv.map.get('agent.growth.hn')]).toEqual([sameRev, newerRev, noRev]);
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

  it(`leaves out rows edited in the last ${DRIFT_SETTLE_MS / 1000} s even when the edit kept the rev (description, updated_by)`, async () => {
    const w = await synced();
    w.kv.map.set('agent.quote', '{"enabled":false}');
    w.setClock(HOUR - 30_000);
    w.edit('agent.quote', { description: 'edited', updated_by: ADMIN });   // rev unchanged: still marked synced
    expect(w.flag('agent.quote').kv_synced_rev).toBe(w.flag('agent.quote').rev);
    expect((await w.tick(HOUR)).drift).toEqual([]);
    expect((await w.tick(HOUR + 60 * 60_000)).drift).toEqual([{ kv_key: 'agent.quote', kind: 'kv_differs' }]);
  });

  it('leaves out rows whose current rev is not in KV yet (the mirror writes them)', async () => {
    const w = await synced();
    w.setClock(HOUR - 5 * 60_000);
    w.edit('agent.quote', { enabled: false });       // a new rev, settled by the hour
    w.kv.failNext.add('agent.quote');                // its put fails at the hour: KV still holds the previous rev
    const r = await w.tick(HOUR);
    expect(r.failed).toEqual(['agent.quote']);
    expect(r.drift).toEqual([]);
    expect(JSON.parse(w.kv.map.get('agent.quote') as string).enabled).toBe(true);
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
