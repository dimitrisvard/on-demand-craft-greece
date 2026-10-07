// Every-minute flag mirror (cron '* * * * *'; PLAN.md P4-2; contract docs/migration/specs/PHASE4_SPEC.md §4.13
// "KV mirror (P4-2) contract"). public.feature_flags is the source of truth; KV FLAGS is its mirror for the readers
// (src/agents/flags.ts in microns-ops, workers/site/src/flags.ts in microns-site).
//
// Tick order
//   1 seed    rows still waiting for the one-time import: one bulk KV read (at most 100 keys per call, CF docs
//             (fetched 2026-10-03) https://developers.cloudflare.com/kv/api/read-key-value-pairs/), then
//             rpc/feature_flags_seed_from_kv per row ('imported', 'absent', 'invalid', 'not_pending'); a row whose
//             call fails is reported ('seed_failed') and retried next tick, and the other rows and steps still run
//   2 batch   rpc/feature_flags_sync_batch: the rows whose current rev is not in KV yet
//   3 put     FLAGS.put(kv_key, kv_value) per row; a failed put (e.g. KV's one write per second per key, CF docs
//             (fetched 2026-10-03) https://developers.cloudflare.com/kv/platform/limits/) is left for the next tick
//   4 mark    rpc/feature_flags_mark_synced only after its put succeeded; false = the row changed meanwhile ('stale'):
//             the function leaves the row unsynced, so the next tick writes the newer rev even when this older put
//             landed after it
//   5 drift   at minute 0 only: KV is read back for every row in sync and compared with the table (enabled, value
//             and the top-level mode the readers take, src/agents/flags.ts). A mirror record of an older rev is
//             rewritten with the current one ('kv_behind'); every other difference is reported, never overwritten (a
//             KV value set by hand holds until the row's next edit)
//
// Rules
//   - One agent_runs row (agent 'flags', trigger 'cron', idempotency key 'flags-sync:<scheduled minute>') only when
//     the tick imported, wrote, refused or failed something, or found drift: a steady-state tick writes nothing.
//   - The run is opened with openRun (rpc/agent_run_begin) and closed with closeRun (one PATCH, usage zero), both from
//     src/agents/runs.ts.
//   - The hourly check sends one Telegram notice when it finds drift, KV values the seed import refused, or rows
//     whose seed import failed.
//   - Rows edited or written in the DRIFT_SETTLE_MS before the scheduled time are not compared: a KV read may still be
//     served from the location's cache for up to a minute after a write (CF docs (fetched 2026-10-03)
//     https://developers.cloudflare.com/kv/concepts/how-kv-works/).
//   - Log lines carry counts and flag keys only.

import { ConfigMissingError } from '../agents/config';
import { closeRun, EMPTY_USAGE, openRun } from '../agents/runs';
import {
  DEFAULT_TENANT_ID,
  flagKvKey,
  kvWriteOf,
  listFlags,
  listSeedPending,
  parseKvRecord,
  putAndMark,
  seedArgument,
  seedFromKv,
  syncBatch,
  type FeatureFlagRow,
  type PutOutcome,
} from '../db/repos/feature-flags';
import type { Db } from '../db/postgrest';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { makePorts, type Ports } from '../ports/index';

/** Keys per bulk KV read (KV limit). */
export const KV_BULK_MAX = 100;
/** Rows synced or edited more recently than this are left out of the drift comparison. */
export const DRIFT_SETTLE_MS = 120_000;
/** Keys listed per category in agent_runs.output. */
const OUTPUT_LIST_MAX = 50;

export interface FlagDrift {
  kv_key: string;
  /**
   * kv_differs: enabled, value or the top-level mode differ (reported only); kv_malformed: not a flag record
   * (reported only); kv_missing: absent while the row is on (reported only); kv_behind: a mirror record of an older
   * rev of the row (rewritten with the current rev).
   */
  kind: 'kv_differs' | 'kv_malformed' | 'kv_missing' | 'kv_behind';
}

export interface FlagsSyncSummary {
  /** KV keys by outcome. */
  imported: string[];
  absent: string[];
  invalid: string[];
  /** The seed import call failed for these rows; they stay pending and are retried next tick. */
  seed_failed: string[];
  written: string[];
  stale: string[];
  /** The KV put failed; the row stays unsynced and is retried next tick. */
  failed: string[];
  /** null when the tick was not at minute 0. */
  drift: FlagDrift[] | null;
  /** The agent_runs row written for this tick, or null (steady state). */
  run_id: string | null;
}

export type FlagsSyncPorts = Pick<Ports, 'db' | 'telegram'>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** jsonb equality: object key order ignored. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && sameJson(a[k], b[k]));
  }
  return false;
}

/** 'flags-sync:2026-10-05T07:00Z' for the scheduled minute. */
export function tickKey(scheduledTime: number): string {
  return `flags-sync:${new Date(scheduledTime).toISOString().slice(0, 16)}Z`;
}

async function bulkGet(kv: KVNamespace, keys: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < keys.length; i += KV_BULK_MAX) {
    const chunk = keys.slice(i, i + KV_BULK_MAX);
    const got = await kv.get(chunk, 'text');
    for (const k of chunk) out.set(k, got.get(k) ?? null);
  }
  return out;
}

/** Step 1; answers the first error of a row whose import call failed (null when none did). */
async function seed(db: Db, kv: KVNamespace, s: FlagsSyncSummary): Promise<unknown> {
  const pending = await listSeedPending(db);
  if (pending.length === 0) return null;
  const keys = pending.map((r) => flagKvKey(r.key, r.tenant_id));
  const values = await bulkGet(kv, keys);
  let firstError: unknown = null;
  for (let i = 0; i < pending.length; i++) {
    let result: string;
    try {
      result = await seedFromKv(db, pending[i].key, pending[i].tenant_id, seedArgument(values.get(keys[i]) ?? null));
    } catch (e) {
      s.seed_failed.push(keys[i]);
      firstError ??= e;
      continue;
    }
    if (result === 'imported') s.imported.push(keys[i]);
    else if (result === 'absent') s.absent.push(keys[i]);
    else if (result === 'invalid') s.invalid.push(keys[i]);
  }
  return firstError;
}

const OUTCOME_LIST: Record<PutOutcome, 'written' | 'failed' | 'stale'> = { written: 'written', put_failed: 'failed', stale: 'stale' };

/** Steps 2-4. */
async function mirror(db: Db, kv: KVNamespace, s: FlagsSyncSummary): Promise<void> {
  for (const row of await syncBatch(db)) {
    const outcome = await putAndMark(db, kv, { key: row.flag_key, tenant_id: row.flag_tenant_id, kv_key: row.kv_key, kv_value: row.kv_value, rev: row.rev });
    s[OUTCOME_LIST[outcome]].push(row.kv_key);
  }
}

/** The mode a reader takes from a table value: value.mode, or none. */
const tableMode = (value: Record<string, unknown>): string | undefined => (typeof value.mode === 'string' ? value.mode : undefined);

/** Step 5 (minute 0): compares KV with the table; rewrites mirror records of an older rev; answers what it found. */
async function driftCheck(db: Db, kv: KVNamespace, now: Date, s: FlagsSyncSummary): Promise<FlagDrift[]> {
  const settled = (iso: string | null): boolean => iso === null || now.getTime() - Date.parse(iso) >= DRIFT_SETTLE_MS;
  const rows = (await listFlags(db)).filter((r) => !r.kv_seed_pending && r.kv_synced_rev !== null && Number(r.kv_synced_rev) === Number(r.rev)
    && settled(r.kv_synced_at) && settled(r.updated_at));
  const keys = rows.map((r) => flagKvKey(r.key, r.tenant_id));
  const values = await bulkGet(kv, keys);
  const drift: FlagDrift[] = [];
  const behind: FeatureFlagRow[] = [];
  rows.forEach((row, i) => {
    const raw = values.get(keys[i]) ?? null;
    if (raw === null) {
      // Absent is the state the seed leaves for keys that were never set; it reads as "off" (or the site's var).
      if (row.enabled) drift.push({ kv_key: keys[i], kind: 'kv_missing' });
      return;
    }
    const rec = parseKvRecord(raw);
    if (rec === 'malformed') {
      drift.push({ kv_key: keys[i], kind: 'kv_malformed' });
    } else if (rec.rev > 0 && rec.rev < Number(row.rev)) {
      // The record the mirror wrote for an older rev (revs start at 1; a record without rev is a hand edit).
      drift.push({ kv_key: keys[i], kind: 'kv_behind' });
      behind.push(row);
    } else if (rec.enabled !== row.enabled || !sameJson(rec.value, row.value) || rec.mode !== tableMode(row.value)) {
      drift.push({ kv_key: keys[i], kind: 'kv_differs' });
    }
  });
  for (const row of behind) {
    const w = await kvWriteOf(db, row);
    s[OUTCOME_LIST[await putAndMark(db, kv, w)]].push(w.kv_key);
  }
  return drift;
}

const capped = (keys: string[]): string[] => keys.slice(0, OUTPUT_LIST_MAX);

function output(s: FlagsSyncSummary): Record<string, unknown> {
  return {
    counts: {
      imported: s.imported.length, absent: s.absent.length, invalid: s.invalid.length, seed_failed: s.seed_failed.length,
      written: s.written.length, stale: s.stale.length, failed: s.failed.length, drift: s.drift?.length ?? 0,
    },
    imported: capped(s.imported),
    invalid: capped(s.invalid),
    seed_failed: capped(s.seed_failed),
    written: capped(s.written),
    stale: capped(s.stale),
    failed: capped(s.failed),
    ...(s.drift ? { drift: s.drift.slice(0, OUTPUT_LIST_MAX) } : {}),
  };
}

function errorCode(e: unknown): string {
  const code = isObject(e) ? e.code : undefined;
  const status = isObject(e) ? e.status : undefined;
  if (typeof code === 'string' && code !== '') return typeof status === 'number' ? `${code}:${status}` : code;
  return typeof status === 'number' ? `http_${status}` : 'error';
}

async function recordRun(db: Db, env: OpsEnv, at: number, s: FlagsSyncSummary, error: string | null): Promise<string | null> {
  const run = await openRun(db, {
    agent: 'flags',
    trigger: 'cron',
    idempotency_key: tickKey(at),
    tenant_id: env.AGENT_TENANT_ID ?? DEFAULT_TENANT_ID,
  });
  if (!run.created) return run.run_id;          // this minute was recorded already (a repeated invocation)
  const failed = error !== null || s.failed.length > 0 || s.seed_failed.length > 0;
  await closeRun(db, run.run_id, {
    status: failed ? 'failed' : 'succeeded',
    ...(failed ? { error: error ?? 'kv_put_failed' } : {}),
    output: output(s),
  }, EMPTY_USAGE);
  return run.run_id;
}

function notice(s: FlagsSyncSummary): string {
  const lines = ['Flag mirror report (KV FLAGS compared with feature_flags)'];
  const reported = (s.drift ?? []).filter((d) => d.kind !== 'kv_behind');
  const behind = (s.drift ?? []).filter((d) => d.kind === 'kv_behind');
  if (reported.length > 0) lines.push(`KV differs: ${reported.map((d) => `${d.kv_key} (${d.kind})`).join(', ')}`);
  if (s.invalid.length > 0) lines.push(`KV values the seed import refused: ${s.invalid.join(', ')}`);
  if (reported.length > 0 || s.invalid.length > 0) {
    lines.push('These KV values were not overwritten. Saving the flag on the dashboard writes the table value to KV.');
  }
  if (behind.length > 0) lines.push(`KV held an older revision, rewritten with the table value: ${behind.map((d) => d.kv_key).join(', ')}`);
  if (s.seed_failed.length > 0) lines.push(`Seed import failed (retried every minute): ${s.seed_failed.join(', ')}`);
  return lines.join('\n');
}

/** One tick of the mirror (see the header). Rejects after recording the run when the database or KV failed. */
export async function flagsSyncTick(env: OpsEnv, controller: ScheduledController, deps?: { ports?: FlagsSyncPorts }): Promise<FlagsSyncSummary> {
  const kv = env.FLAGS;
  if (!kv) throw new ConfigMissingError(['FLAGS']);
  const ports: FlagsSyncPorts = deps?.ports ?? makePorts(env);
  const s: FlagsSyncSummary = {
    imported: [], absent: [], invalid: [], seed_failed: [], written: [], stale: [], failed: [], drift: null, run_id: null,
  };
  const hourly = new Date(controller.scheduledTime).getUTCMinutes() === 0;
  let failure: unknown = null;
  let seedError: unknown = null;
  try {
    seedError = await seed(ports.db, kv, s);
    await mirror(ports.db, kv, s);
    if (hourly) s.drift = await driftCheck(ports.db, kv, new Date(controller.scheduledTime), s);
  } catch (e) {
    failure = e;
  }
  const error = failure !== null ? `flags_sync_failed:${errorCode(failure)}`
    : seedError !== null ? `flags_seed_failed:${errorCode(seedError)}` : null;
  const changed = s.imported.length + s.absent.length + s.invalid.length + s.seed_failed.length + s.written.length
    + s.stale.length + s.failed.length + (s.drift?.length ?? 0) > 0;
  if (changed || error !== null) {
    try {
      s.run_id = await recordRun(ports.db, env, controller.scheduledTime, s, error);
    } catch (e) {
      console.error(`${LOG_PREFIX} flags-sync run record failed ${errorCode(e)}`);
    }
    console.log(`${LOG_PREFIX} flags-sync imported=${s.imported.length} absent=${s.absent.length} invalid=${s.invalid.length} `
      + `seed_failed=${s.seed_failed.length} written=${s.written.length} stale=${s.stale.length} failed=${s.failed.length} `
      + `drift=${s.drift?.length ?? '-'}${error ? ` error=${error}` : ''}`);
  }
  if (hourly && ((s.drift?.length ?? 0) > 0 || s.invalid.length > 0 || s.seed_failed.length > 0)) {
    try {
      await ports.telegram.sendText(notice(s));
    } catch (e) {
      console.error(`${LOG_PREFIX} flags-sync notice failed ${errorCode(e)}`);
    }
  }
  if (failure !== null) throw failure;
  return s;
}
