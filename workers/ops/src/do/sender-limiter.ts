// SenderLimiter (Phase 5, unit M5): one Durable Object per marketing sender account id, or 'default' for the
// default Resend identity. It allots send slots (daily cap and spacing per sender) and remembers which idempotency
// keys were sent, so a redelivered message never sends twice. SQLite storage; migration tag v2.
//
// Rules
//   - Daily cap = warmup_enabled ? warmup_current_limit : daily_limit of the sender row (src/marketing/sender-rows.ts
//     capOf; the row is cached 60 s); 'default' uses DEFAULT_SENDER_DAILY_CAP; an account without a row has cap 0
//     (no fallback to another sender). The day is the UTC day of `now`; the count starts at 0 on every new day, and
//     days only move forward. The object is addressed by name (idFromName); without a name it refuses to allot.
//   - Slot = max(now, last slot + spacing), spacing = marketing_settings.delay_between_emails_seconds or 30 s
//     (cached 60 s). A slot is allotted and counted once per key.
//   - A key that is 'sent' answers already_sent (before any cap check). A key that is 'reserved' on the same UTC day
//     answers its stored slot again while that slot lies at most 10 min in the past (the deferred copy or the retry of
//     the same message); once its slot is more than 10 min old the reservation is re-used with a new slot and is not
//     counted twice. A reservation of an earlier day is dropped and the key reserves anew.
//   - A cap reached answers exhausted with the next 00:00 UTC.
//   - commit marks a key 'sent' with the provider id (kept 30 days, pruned by an alarm); release removes a 'reserved'
//     key and gives its count back (a 'sent' key is never released).
//   - reserve reads its configuration first and then reads and writes the object's SQLite rows without an await in
//     between, so two concurrent calls never allot one slot twice or pass the cap.
//   - Nothing here stores or logs an address, a subject or a body: keys are 'camp:<campaign>:<subscriber>:<seq>'.

import { DurableObject } from 'cloudflare:workers';
import { PostgrestDb, type Db } from '../db/postgrest';
import type { OpsEnv } from '../env';
import { capOf, readSettings, senderRow, spacingSecondsOf } from '../marketing/sender-rows';

/** Daily cap of the default sender (campaigns without sender accounts). */
export const DEFAULT_SENDER_DAILY_CAP = 500;
/** Object name of the default sender. */
export const DEFAULT_SENDER = 'default';
/** Age of a slot after which its reservation is re-allotted. */
export const STALE_SLOT_MS = 10 * 60_000;
/** How long sent keys are kept. */
export const KEEP_SENT_MS = 30 * 86_400_000;
/** How long sender and settings rows are cached. */
export const CONFIG_TTL_MS = 60_000;
/** Pause between two prune alarms. */
const PRUNE_EVERY_MS = 86_400_000;

export type ReserveResult =
  | { status: 'ok'; /** epoch ms of the allotted slot */ not_before: number }
  | { status: 'already_sent' }
  | { status: 'exhausted'; resets_at: string };

interface KeyRow {
  idem: string;
  status: 'reserved' | 'sent';
  slot: number;
  day: string;
  reserved_at: number;
}

type SqlRow = Record<string, SqlStorageValue>;

interface StateRow {
  day: string;
  sent_today: number;
  last_slot: number;
  last_sent_at: number | null;
}

/** 'YYYY-MM-DD' (UTC) of an epoch ms. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO time of the next 00:00 UTC after ms. */
export function nextUtcMidnight(ms: number): string {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

export class SenderLimiter extends DurableObject<OpsEnv> {
  /** Database (set by tests; the service-role PostgREST client otherwise). */
  protected dbInstance?: Db;
  /** Clock of commit, release, stats and the alarm (set by tests). */
  protected clock: () => number = () => Date.now();
  private config?: { at: number; cap: number; spacingMs: number };

  constructor(ctx: DurableObjectState, env: OpsEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS keys (idem TEXT PRIMARY KEY, status TEXT NOT NULL, slot INTEGER NOT NULL, day TEXT NOT NULL, reserved_at INTEGER NOT NULL, provider_id TEXT, sent_at INTEGER)',
    );
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), day TEXT NOT NULL, sent_today INTEGER NOT NULL, last_slot INTEGER NOT NULL, last_sent_at INTEGER)');
  }

  private db(): Db {
    return (this.dbInstance ??= new PostgrestDb({ url: this.env.SUPABASE_URL, serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY }));
  }

  /** The object's name: a sender account id or 'default' (an object without a name refuses to allot). */
  private sender(): string {
    const name = this.ctx.id.name;
    if (typeof name !== 'string' || name === '') throw new Error('SenderLimiter: the object must be addressed by name (sender account id or default)');
    return name;
  }

  /** Cap and spacing (cached CONFIG_TTL_MS; read before any SQLite access of a call). */
  private async loadConfig(now: number): Promise<{ cap: number; spacingMs: number }> {
    if (this.config && now - this.config.at < CONFIG_TTL_MS && now >= this.config.at) return this.config;
    const sender = this.sender();
    const db = this.db();
    const [row, settings] = await Promise.all([sender === DEFAULT_SENDER ? Promise.resolve(null) : senderRow(db, sender), readSettings(db)]);
    const cap = sender === DEFAULT_SENDER ? DEFAULT_SENDER_DAILY_CAP : row ? capOf(row) : 0;
    this.config = { at: now, cap, spacingMs: spacingSecondsOf(settings) * 1000 };
    return this.config;
  }

  /** The state row for the UTC day of now (a new day starts at 0). Synchronous. */
  private state(now: number): StateRow {
    const today = utcDay(now);
    const row = this.ctx.storage.sql.exec<SqlRow>('SELECT day, sent_today, last_slot, last_sent_at FROM state WHERE id = 1').toArray()[0];
    if (!row) {
      const fresh: StateRow = { day: today, sent_today: 0, last_slot: 0, last_sent_at: null };
      this.ctx.storage.sql.exec('INSERT INTO state (id, day, sent_today, last_slot, last_sent_at) VALUES (1, ?, 0, 0, NULL)', today);
      return fresh;
    }
    const state: StateRow = { day: String(row.day), sent_today: Number(row.sent_today), last_slot: Number(row.last_slot), last_sent_at: row.last_sent_at === null ? null : Number(row.last_sent_at) };
    // Days only move forward (a caller whose clock is behind keeps the current day's count).
    if (today > state.day) {
      state.day = today;
      state.sent_today = 0;
      this.saveState(state);
    }
    return state;
  }

  private saveState(s: StateRow): void {
    this.ctx.storage.sql.exec('UPDATE state SET day = ?, sent_today = ?, last_slot = ?, last_sent_at = ? WHERE id = 1', s.day, s.sent_today, s.last_slot, s.last_sent_at);
  }

  private key(idem: string): KeyRow | null {
    const row = this.ctx.storage.sql.exec<SqlRow>('SELECT idem, status, slot, day, reserved_at FROM keys WHERE idem = ?', idem).toArray()[0];
    return row ? { idem: String(row.idem), status: row.status === 'sent' ? 'sent' : 'reserved', slot: Number(row.slot), day: String(row.day), reserved_at: Number(row.reserved_at) } : null;
  }

  async reserve(i: { idem: string; now: number }): Promise<ReserveResult> {
    if (typeof i?.idem !== 'string' || i.idem === '' || !Number.isFinite(i.now)) throw new Error('SenderLimiter.reserve: idem and now are required');
    const config = await this.loadConfig(i.now);
    // From here on: synchronous SQLite reads and writes only.
    const now = i.now;
    const state = this.state(now);
    const existing = this.key(i.idem);
    if (existing?.status === 'sent') return { status: 'already_sent' };
    if (existing && existing.day === state.day) {
      if (now - existing.slot <= STALE_SLOT_MS) return { status: 'ok', not_before: existing.slot };
      const slot = Math.max(now, state.last_slot + config.spacingMs);
      state.last_slot = slot;
      this.saveState(state);
      this.ctx.storage.sql.exec('UPDATE keys SET slot = ?, reserved_at = ? WHERE idem = ?', slot, now, i.idem);
      return { status: 'ok', not_before: slot };
    }
    if (existing) this.ctx.storage.sql.exec('DELETE FROM keys WHERE idem = ?', i.idem);
    if (state.sent_today >= config.cap) return { status: 'exhausted', resets_at: nextUtcMidnight(now) };
    const slot = Math.max(now, state.last_slot + config.spacingMs);
    state.sent_today += 1;
    state.last_slot = slot;
    this.saveState(state);
    this.ctx.storage.sql.exec('INSERT INTO keys (idem, status, slot, day, reserved_at) VALUES (?, ?, ?, ?, ?)', i.idem, 'reserved', slot, state.day, now);
    return { status: 'ok', not_before: slot };
  }

  async commit(i: { idem: string; provider_id: string }): Promise<void> {
    if (typeof i?.idem !== 'string' || i.idem === '') throw new Error('SenderLimiter.commit: idem is required');
    const now = this.clock();
    const state = this.state(now);
    const existing = this.key(i.idem);
    if (existing) {
      this.ctx.storage.sql.exec('UPDATE keys SET status = ?, provider_id = ?, sent_at = ? WHERE idem = ?', 'sent', String(i.provider_id ?? ''), now, i.idem);
    } else {
      // A send without a stored reservation (e.g. pruned): remembered as sent, not counted again.
      this.ctx.storage.sql.exec('INSERT INTO keys (idem, status, slot, day, reserved_at, provider_id, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)', i.idem, 'sent', now, state.day, now, String(i.provider_id ?? ''), now);
    }
    state.last_sent_at = now;
    this.saveState(state);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + PRUNE_EVERY_MS);
  }

  async release(i: { idem: string }): Promise<void> {
    if (typeof i?.idem !== 'string' || i.idem === '') throw new Error('SenderLimiter.release: idem is required');
    const now = this.clock();
    const state = this.state(now);
    const existing = this.key(i.idem);
    if (!existing || existing.status !== 'reserved') return;
    this.ctx.storage.sql.exec('DELETE FROM keys WHERE idem = ?', i.idem);
    if (existing.day === state.day && state.sent_today > 0) {
      state.sent_today -= 1;
      this.saveState(state);
    }
  }

  async stats(): Promise<{ day: string; sent_today: number; cap: number; last_sent_at: string | null }> {
    const now = this.clock();
    const config = await this.loadConfig(now);
    const state = this.state(now);
    return { day: state.day, sent_today: state.sent_today, cap: config.cap, last_sent_at: state.last_sent_at === null ? null : new Date(state.last_sent_at).toISOString() };
  }

  /** Prunes sent keys older than 30 days and reservations of days before that; re-arms while keys remain. */
  async alarm(): Promise<void> {
    const now = this.clock();
    const cutoff = now - KEEP_SENT_MS;
    this.ctx.storage.sql.exec('DELETE FROM keys WHERE (status = ? AND sent_at < ?) OR (status = ? AND reserved_at < ?)', 'sent', cutoff, 'reserved', cutoff);
    const left = Number(this.ctx.storage.sql.exec<SqlRow>('SELECT COUNT(*) AS n FROM keys').toArray()[0]?.n ?? 0);
    if (left > 0) await this.ctx.storage.setAlarm(now + PRUNE_EVERY_MS);
  }
}
