// Reference implementation of the flags-sync cron tick (PLAN.md P4-2; contract: docs/migration/specs/
// PHASE4_SPEC.md §4.13 "KV mirror (P4-2) contract"). The microns-ops port (workers/ops/src/cron/flags-sync.ts)
// calls the same RPCs over PostgREST with the service role; here `sql(text, params)` runs them as service_role
// against the test database. Tick order: seed -> sync_batch -> KV put -> mark_synced.
//
// kv: { getMany(keys) -> Map<key, string|null>, put(key, string) }
// Returns a summary the cron writes to agent_runs.output when something happened.

export async function flagsSyncTick(sql, kv) {
  const summary = { imported: [], absent: [], invalid: [], written: [], stale: [], failed: [] };

  // 1. One-time seed: rows still waiting for the KV import (only on the first runs after the migration).
  const pending = await sql(
    `select key, tenant_id, public.feature_flags_kv_key(key, tenant_id) as kv_key
       from public.feature_flags where kv_seed_pending order by key`);
  if (pending.length > 0) {
    const values = await kv.getMany(pending.map((r) => r.kv_key));        // one bulk KV read (max 100 keys)
    for (const row of pending) {
      const raw = values.get(row.kv_key);
      // Absent key -> NULL. Text that is not JSON, or the JSON literal null, is a present key without a flag record:
      // passed as an object without `enabled`, which the function answers with 'invalid'.
      let arg = null;
      if (raw != null) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        arg = JSON.stringify(parsed === null ? { unparsable: true } : parsed);
      }
      const [{ result }] = await sql(
        `select public.feature_flags_seed_from_kv($1, $2, $3::jsonb) as result`,
        [row.key, row.tenant_id, arg]);
      if (result === 'imported') summary.imported.push(row.kv_key);
      else if (result === 'absent') summary.absent.push(row.kv_key);
      else if (result === 'invalid') summary.invalid.push(row.kv_key);   // reported (Telegram card), row stays pending
    }
  }

  // 2. Mirror every row whose current rev is not yet in KV.
  const batch = await sql(`select * from public.feature_flags_sync_batch()`);
  for (const row of batch) {
    try {
      await kv.put(row.kv_key, JSON.stringify(row.kv_value));
    } catch (err) {
      summary.failed.push(row.kv_key);   // e.g. KV 429 (1 write/s per key): retried on the next tick
      continue;
    }
    const [{ ok }] = await sql(`select public.feature_flags_mark_synced($1, $2, $3) as ok`,
      [row.flag_key, row.flag_tenant_id, row.rev]);
    (ok ? summary.written : summary.stale).push(row.kv_key);   // stale: row changed meanwhile, next tick writes it
  }
  return summary;
}

export class FakeKV {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); this.puts = []; this.failNext = new Set(); }
  async getMany(keys) { return new Map(keys.map((k) => [k, this.map.has(k) ? this.map.get(k) : null])); }
  async put(key, value) {
    if (this.failNext.has(key)) { this.failNext.delete(key); throw new Error('KV PUT failed: 429'); }
    this.map.set(key, value); this.puts.push(key);
  }
}

// What the Workers read today: Phase 1 getFlag (workers/site/src/flags.ts) and Phase 2 getFlagValue.
export function readerView(raw, fallback) {
  if (raw == null) return { enabled: fallback, source: 'fallback' };
  const v = JSON.parse(raw);
  if (typeof v === 'object' && v !== null && typeof v.enabled === 'boolean') return { enabled: v.enabled, value: v.value, source: 'kv' };
  return { enabled: fallback, source: 'fallback-malformed' };
}
