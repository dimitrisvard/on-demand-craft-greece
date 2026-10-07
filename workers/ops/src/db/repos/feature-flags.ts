// public.feature_flags through the Db port (service role), and the record format of its KV mirror FLAGS.
// Contract: docs/migration/specs/PHASE4_SPEC.md §4.13 "KV mirror (P4-2) contract"; the SQL functions are in
// supabase/migrations/*_agent_layer.sql (feature_flags_kv_key, _kv_value, _sync_batch, _mark_synced, _seed_from_kv).
//
// Rules
//   - The table is the source of truth; rev changes on every change of enabled or value (trigger), and a row needs a
//     KV write exactly when it is not waiting for the seed import and kv_synced_rev differs from rev.
//   - KV key: the flag key for the default tenant, 't:<tenant_id>:<key>' otherwise. KV value:
//     {"enabled", "value", "updated_at", "rev"} plus "mode" when value.mode is set.
//   - A row is marked synced only after its KV put succeeded, and only for the rev that was put. When the row changed
//     in between, mark_synced answers false and leaves the row unsynced: puts of one key land in any order, so the
//     older put may have landed after a newer one, and the next tick writes the current rev.
//   - Flag rows are never deleted (the table refuses DELETE); a flag is retired with enabled = false.

import type { Db } from '../postgrest';

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export type FlagMode = 'shadow' | 'assist' | 'auto';
/** = feature_flags_mode_check. */
export const FLAG_MODES: readonly FlagMode[] = ['shadow', 'assist', 'auto'];

export interface FeatureFlagRow {
  key: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  enabled: boolean;
  value: Record<string, unknown>;
  description: string | null;
  updated_by: string | null;
  rev: number;
  kv_synced_rev: number | null;
  kv_synced_at: string | null;
  kv_seed_pending: boolean;
}

/** One flag as stored in KV FLAGS (feature_flags_kv_value). */
export interface FlagKvRecord {
  enabled: boolean;
  value: Record<string, unknown>;
  updated_at: string;
  rev: number;
  mode?: FlagMode;
}

/** A row of rpc/feature_flags_sync_batch. */
export interface SyncBatchRow {
  flag_key: string;
  flag_tenant_id: string;
  kv_key: string;
  kv_value: FlagKvRecord;
  rev: number;
}

/** Outcome of rpc/feature_flags_seed_from_kv. */
export type SeedResult = 'imported' | 'absent' | 'invalid' | 'not_pending';

/** feature_flags_kv_key() without a round trip. */
export function flagKvKey(key: string, tenantId: string = DEFAULT_TENANT_ID): string {
  return tenantId.toLowerCase() === DEFAULT_TENANT_ID ? key : `t:${tenantId.toLowerCase()}:${key}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A KV text value as the seed import passes it to rpc/feature_flags_seed_from_kv: the parsed JSON, or null when the
 * key is absent. Text that is not JSON, or the JSON literal null, is passed as an object without `enabled`, which the
 * function answers with 'invalid' (the key exists but holds no flag record).
 */
export function seedArgument(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null ? { unparsable: true } : parsed;
  } catch {
    return { unparsable: true };
  }
}

/** A KV text value as a flag record, or 'malformed' when it is not one (no boolean enabled, value not an object). */
export function parseKvRecord(raw: string): FlagKvRecord | 'malformed' {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return 'malformed';
  }
  if (!isObject(v) || typeof v.enabled !== 'boolean') return 'malformed';
  if ('value' in v && !isObject(v.value)) return 'malformed';
  if ('mode' in v && !FLAG_MODES.includes(v.mode as FlagMode)) return 'malformed';
  return {
    enabled: v.enabled,
    value: isObject(v.value) ? v.value : {},
    updated_at: typeof v.updated_at === 'string' ? v.updated_at : '',
    rev: typeof v.rev === 'number' ? v.rev : 0,
    ...(typeof v.mode === 'string' ? { mode: v.mode as FlagMode } : {}),
  };
}

const ROW_COLUMNS = 'key,tenant_id,created_at,updated_at,enabled,value,description,updated_by,rev,kv_synced_rev,kv_synced_at,kv_seed_pending';

/** Every flag row (all tenants), ordered by tenant and key. */
export async function listFlags(db: Db): Promise<FeatureFlagRow[]> {
  return db.select<FeatureFlagRow & Record<string, unknown>>('feature_flags', {
    columns: ROW_COLUMNS,
    order: [{ column: 'tenant_id' }, { column: 'key' }],
  });
}

export async function getFlagRow(db: Db, key: string, tenantId: string = DEFAULT_TENANT_ID): Promise<FeatureFlagRow | null> {
  const rows = await db.select<FeatureFlagRow & Record<string, unknown>>('feature_flags', {
    columns: ROW_COLUMNS,
    filters: [['key', 'eq', key], ['tenant_id', 'eq', tenantId]],
    limit: 1,
  });
  return rows[0] ?? null;
}

/** Rows still waiting for the one-time import from KV. */
export async function listSeedPending(db: Db): Promise<Array<{ key: string; tenant_id: string }>> {
  return db.select<{ key: string; tenant_id: string }>('feature_flags', {
    columns: 'key,tenant_id',
    filters: [['kv_seed_pending', 'is', true]],
    order: [{ column: 'tenant_id' }, { column: 'key' }],
  });
}

/** rpc/feature_flags_seed_from_kv; `kv` is seedArgument() of the KV text. */
export async function seedFromKv(db: Db, key: string, tenantId: string, kv: unknown): Promise<SeedResult> {
  return db.rpc<SeedResult>('feature_flags_seed_from_kv', { p_key: key, p_tenant_id: tenantId, p_kv: kv });
}

/** rpc/feature_flags_sync_batch: rows whose current rev is not in KV yet. */
export async function syncBatch(db: Db): Promise<SyncBatchRow[]> {
  return db.rpc<SyncBatchRow[]>('feature_flags_sync_batch', {});
}

/**
 * rpc/feature_flags_mark_synced; false when the row's rev moved on since `rev` was put (the function then leaves the
 * row unsynced, so the next tick writes the current rev).
 */
export async function markSynced(db: Db, key: string, tenantId: string, rev: number): Promise<boolean> {
  return (await db.rpc<boolean>('feature_flags_mark_synced', { p_key: key, p_tenant_id: tenantId, p_rev: rev })) === true;
}

/** Outcome of one KV write: put and marked; put refused (left for the next tick); put, but the row moved on. */
export type PutOutcome = 'written' | 'put_failed' | 'stale';

/** One revision to write: the row's key and tenant, its KV key and record, and the rev the record carries. */
export interface KvWrite {
  key: string;
  tenant_id: string;
  kv_key: string;
  kv_value: FlagKvRecord;
  rev: number;
}

/** FLAGS.put of one record, then rpc/feature_flags_mark_synced, only after the put succeeded. */
export async function putAndMark(db: Db, kv: Pick<KVNamespace, 'put'>, w: KvWrite): Promise<PutOutcome> {
  try {
    await kv.put(w.kv_key, JSON.stringify(w.kv_value));
  } catch {
    return 'put_failed';
  }
  return (await markSynced(db, w.key, w.tenant_id, w.rev)) ? 'written' : 'stale';
}

/** The KV key and record of a row, from rpc/feature_flags_kv_key and rpc/feature_flags_kv_value. */
export async function kvWriteOf(
  db: Db,
  row: Pick<FeatureFlagRow, 'key' | 'tenant_id' | 'enabled' | 'value' | 'updated_at' | 'rev'>,
): Promise<KvWrite> {
  const kvKey = await db.rpc<string>('feature_flags_kv_key', { p_key: row.key, p_tenant_id: row.tenant_id });
  const kvValue = await db.rpc<FlagKvRecord>('feature_flags_kv_value', {
    p_enabled: row.enabled,
    p_value: row.value,
    p_updated_at: row.updated_at,
    p_rev: row.rev,
  });
  return { key: row.key, tenant_id: row.tenant_id, kv_key: kvKey, kv_value: kvValue, rev: Number(row.rev) };
}

/**
 * Optimistic edit (the dashboard's flag switch, PHASE4_SPEC.md §4.4 FlagEditBody): one PATCH filtered by key, tenant
 * and the rev the editor read. The new row, or null when the rev moved on (the caller answers 'stale').
 */
export async function updateFlagIfRev(
  db: Db,
  e: { key: string; tenant_id?: string; expected_rev: number; enabled: boolean; value: Record<string, unknown>; updated_by: string },
): Promise<FeatureFlagRow | null> {
  const rows = await db.update<FeatureFlagRow & Record<string, unknown>>(
    'feature_flags',
    { enabled: e.enabled, value: e.value, updated_by: e.updated_by },
    {
      filters: [['key', 'eq', e.key], ['tenant_id', 'eq', e.tenant_id ?? DEFAULT_TENANT_ID], ['rev', 'eq', e.expected_rev]],
      returning: ROW_COLUMNS,
    },
  );
  return rows[0] ?? null;
}

/**
 * Write-through of an edited row: rpc/feature_flags_kv_key, rpc/feature_flags_kv_value, KV put, rpc/feature_flags_
 * mark_synced, in that order. 'pending' when the put failed or the row changed meanwhile (the row is then unsynced);
 * the every-minute flags-sync tick then converges.
 */
export async function writeThrough(
  db: Db,
  kv: Pick<KVNamespace, 'put'>,
  row: Pick<FeatureFlagRow, 'key' | 'tenant_id' | 'enabled' | 'value' | 'updated_at' | 'rev'>,
): Promise<'written' | 'pending'> {
  return (await putAndMark(db, kv, await kvWriteOf(db, row))) === 'written' ? 'written' : 'pending';
}
