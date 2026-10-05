// The KV mirror vectors (supabase/tests/agent_layer/vectors/flags-sync.json), shared by the SQL tests and the
// microns-ops tests, with one runner for any database behind flagsSyncTick (in-memory RPCs or the mini-PostgREST).

import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { FlagsSyncSummary } from '../../src/cron/flags-sync';
import { DEFAULT_TENANT_ID } from '../../src/db/repos/feature-flags';
import type { Db } from '../../src/db/postgrest';

export interface KvExpect { enabled: boolean; value: Record<string, unknown>; mode?: string }
export interface SeedCase { name: string; key: string; kv: string | null; result: 'imported' | 'absent' | 'invalid'; row: { enabled: boolean; value: unknown }; kv_after?: KvExpect | null }
export interface ScenarioStep {
  op: 'tick' | 'edit' | 'insert' | 'race' | 'kv_fail_next';
  name?: string;
  key?: string;
  tenant?: string;
  set?: Record<string, unknown>;
  first?: Record<string, unknown>;
  then?: Record<string, unknown>;
  expect_mark?: boolean;
  expect?: { imported?: string[]; absent_count?: number; invalid?: string[]; written?: string[]; stale?: string[]; failed?: string[]; kv?: Record<string, KvExpect | null> };
}
export interface Vectors {
  admin_user: string;
  other_tenant: string;
  seed_cases: SeedCase[];
  scenario: { kv: Record<string, string>; steps: ScenarioStep[] };
}

const RAW = JSON.parse(readFileSync(new URL('../../../../supabase/tests/agent_layer/vectors/flags-sync.json', import.meta.url), 'utf8')) as Vectors;
const sub = (s: string): string => s.replaceAll('$admin', RAW.admin_user).replaceAll('$other_tenant', RAW.other_tenant);
function subAll<T>(o: T): T {
  if (typeof o === 'string') return sub(o) as T;
  if (Array.isArray(o)) return o.map(subAll) as T;
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [sub(k), subAll(v)])) as T;
  return o;
}

/** The vectors with $admin and $other_tenant substituted. */
export const VECTORS: Vectors = subAll(RAW);

/** KV text against an expectation (null = absent); null when it matches. */
export function kvMismatch(raw: string | undefined, exp: KvExpect | null): string | null {
  if (exp === null) return raw === undefined ? null : `expected absent, got ${raw}`;
  if (raw === undefined) return 'expected a record, key absent';
  const rec = JSON.parse(raw) as Record<string, unknown>;
  if (rec.enabled !== exp.enabled) return `enabled ${String(rec.enabled)}`;
  try {
    expect(rec.value).toEqual(exp.value);
  } catch {
    return `value ${JSON.stringify(rec.value)}`;
  }
  if (('mode' in exp) !== ('mode' in rec) || rec.mode !== exp.mode) return `mode ${String(rec.mode)}`;
  if (typeof rec.rev !== 'number' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(String(rec.updated_at))) return `rev/updated_at ${raw}`;
  return null;
}

/** What a scenario needs from a test world. */
export interface VectorWorld {
  db: Db;
  kv: { map: Map<string, string>; failNext: Set<string>; put(key: string, value: string): Promise<void> };
  tick(at: number): Promise<FlagsSyncSummary>;
  /** Row of the flag (key, tenant). */
  flag(key: string, tenant?: string): Promise<Record<string, unknown>>;
}

/** Applies the seed cases' KV, runs one tick and checks every case. */
export async function checkSeedCases(w: VectorWorld, at: number): Promise<void> {
  const t = await w.tick(at);
  for (const c of VECTORS.seed_cases) {
    const bucket = { imported: t.imported, absent: t.absent, invalid: t.invalid }[c.result];
    expect(bucket, `${c.name}: ${c.result}`).toContain(c.key);
    const row = await w.flag(c.key);
    expect({ enabled: row.enabled, value: row.value }, `${c.name}: row`).toEqual(c.row);
    expect(row.kv_seed_pending, `${c.name}: pending only when invalid`).toBe(c.result === 'invalid');
    if (c.kv_after !== undefined) expect(kvMismatch(w.kv.map.get(c.key), c.kv_after), `${c.name}: KV`).toBeNull();
    else expect(w.kv.map.get(c.key), `${c.name}: KV left as it was`).toBe(c.kv);
  }
}

/** Runs the scenario steps; edits and inserts go through the Db port (service role), as microns-ops writes. */
export async function runScenario(w: VectorWorld, start: number): Promise<void> {
  let at = start;
  for (const [i, s] of VECTORS.scenario.steps.entries()) {
    const label = `step ${i + 1} ${s.op}${s.name ? ` (${s.name})` : ''}`;
    const where = (key: string, tenant?: string) => [['key', 'eq', key], ['tenant_id', 'eq', tenant ?? DEFAULT_TENANT_ID]] as const;
    if (s.op === 'edit') {
      expect(await w.db.update('feature_flags', s.set ?? {}, { filters: [...where(s.key as string, s.tenant)], returning: true }), label).toHaveLength(1);
    } else if (s.op === 'insert') {
      await w.db.insert('feature_flags', { key: s.key, tenant_id: s.tenant ?? DEFAULT_TENANT_ID, ...s.set });
    } else if (s.op === 'kv_fail_next') {
      w.kv.failNext.add(s.key as string);
    } else if (s.op === 'race') {
      await w.db.update('feature_flags', s.first ?? {}, { filters: [...where(s.key as string)] });
      const batch = await w.db.rpc<Array<{ flag_key: string; flag_tenant_id: string; kv_key: string; kv_value: unknown; rev: number }>>('feature_flags_sync_batch', {});
      const stale = batch.find((r) => r.flag_key === s.key);
      expect(stale, `${label}: row in the batch`).toBeDefined();
      await w.db.update('feature_flags', s.then ?? {}, { filters: [...where(s.key as string)] });
      await w.kv.put(stale!.kv_key, JSON.stringify(stale!.kv_value));
      const marked = await w.db.rpc('feature_flags_mark_synced', { p_key: stale!.flag_key, p_tenant_id: stale!.flag_tenant_id, p_rev: stale!.rev });
      expect(marked, `${label}: mark_synced`).toBe(s.expect_mark);
    } else {
      at += 60_000;
      const r = await w.tick(at);
      const e = s.expect ?? {};
      for (const k of ['imported', 'invalid', 'written', 'stale', 'failed'] as const) {
        if (e[k]) expect([...r[k]].sort(), `${label}: ${k}`).toEqual([...e[k]].sort());
      }
      if (e.absent_count !== undefined) expect(r.absent, `${label}: absent count`).toHaveLength(e.absent_count);
      for (const [key, exp] of Object.entries(e.kv ?? {})) expect(kvMismatch(w.kv.map.get(key), exp), `${label}: KV ${key}`).toBeNull();
    }
  }
}
