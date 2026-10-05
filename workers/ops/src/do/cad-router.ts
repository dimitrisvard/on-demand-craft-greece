// CadRouter: one Durable Object ('global') that grants CAD backend leases and tracks backend health. It never
// touches file bytes; the cad-jobs consumer runs the job.
//
// Rules
//   - Slots: vps 1, inline 1 (never two inline leases at once), container 3 (Phase 5), mac_mini 1.
//   - acquire() gives the first candidate that is not down and has a free slot; a job that already holds a lease
//     gets the same lease back (a redelivered message after a crash), with a new expiry.
//   - A lease expires at now + deadline_s + 60 s; acquire() and alarm() reclaim expired leases, and the alarm is set
//     at the earliest expiry.
//   - Two consecutive backend_down outcomes or failed health probes mark a backend down for 5 minutes; a success
//     resets the count.
//   - State is SQLite in the object's storage: leases(lease_id, job_id unique, backend, expires_at) and
//     health(backend, failures, down_until), times in ms since the epoch.

import { DurableObject } from 'cloudflare:workers';
import type { BackendName } from '../cad/types';
import type { OpsEnv } from '../env';

export type AcquireResult = { granted: true; lease_id: string; backend: BackendName } | { granted: false; retry_after_s: number };

export interface CadRouterSnapshot {
  slots: Partial<Record<BackendName, { max: number; used: number }>>;
  leases: Array<{ lease_id: string; job_id: string; backend: BackendName; expires_at: string }>;
  health: Partial<Record<BackendName, { failures: number; down_until: string | null }>>;
}

export const SLOTS: Readonly<Record<BackendName, number>> = Object.freeze({ vps: 1, inline: 1, container: 3, mac_mini: 1 });
export const LEASE_GRACE_S = 60;
export const RETRY_AFTER_S = 30;
export const DOWN_AFTER_FAILURES = 2;
export const DOWN_FOR_MS = 5 * 60_000;
const MAX_DEADLINE_S = 3600;

const BACKENDS = Object.keys(SLOTS) as BackendName[];

interface LeaseRow {
  lease_id: string;
  job_id: string;
  backend: BackendName;
  expires_at: number;
}

interface HealthRow {
  backend: BackendName;
  failures: number;
  down_until: number | null;
}

export class CadRouter extends DurableObject<OpsEnv> {
  constructor(ctx: DurableObjectState, env: OpsEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS leases (lease_id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE, backend TEXT NOT NULL, expires_at INTEGER NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS health (backend TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, down_until INTEGER);',
    );
  }

  /** Current time in ms (a method so tests can drive time). */
  protected now(): number {
    return Date.now();
  }

  private leases(): LeaseRow[] {
    return this.ctx.storage.sql.exec<Record<string, SqlStorageValue>>('SELECT lease_id, job_id, backend, expires_at FROM leases ORDER BY expires_at, lease_id').toArray() as unknown as LeaseRow[];
  }

  private healthOf(backend: BackendName): HealthRow {
    const rows = this.ctx.storage.sql.exec<Record<string, SqlStorageValue>>('SELECT backend, failures, down_until FROM health WHERE backend = ?', backend).toArray() as unknown as HealthRow[];
    return rows[0] ?? { backend, failures: 0, down_until: null };
  }

  private saveHealth(h: HealthRow): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO health (backend, failures, down_until) VALUES (?, ?, ?) ON CONFLICT(backend) DO UPDATE SET failures = excluded.failures, down_until = excluded.down_until',
      h.backend,
      h.failures,
      h.down_until,
    );
  }

  private isDown(backend: BackendName, now: number): boolean {
    const h = this.healthOf(backend);
    return h.down_until !== null && h.down_until > now;
  }

  /** Deletes expired leases; returns how many were reclaimed. */
  private reclaim(now: number): number {
    return this.ctx.storage.sql.exec('DELETE FROM leases WHERE expires_at <= ?', now).rowsWritten;
  }

  private async scheduleAlarm(): Promise<void> {
    const next = this.leases()[0];
    if (next) await this.ctx.storage.setAlarm(next.expires_at);
    else await this.ctx.storage.deleteAlarm();
  }

  private record(backend: BackendName, ok: boolean, now: number): void {
    const h = this.healthOf(backend);
    if (ok) {
      this.saveHealth({ backend, failures: 0, down_until: null });
      return;
    }
    const failures = h.failures + 1;
    this.saveHealth({ backend, failures, down_until: failures >= DOWN_AFTER_FAILURES ? now + DOWN_FOR_MS : h.down_until });
  }

  async acquire(r: { job_id: string; backend_candidates: BackendName[]; deadline_s: number }): Promise<AcquireResult> {
    const now = this.now();
    this.reclaim(now);
    const deadline = Number.isFinite(r.deadline_s) && r.deadline_s > 0 ? Math.min(r.deadline_s, MAX_DEADLINE_S) : 300;
    const expires = now + (deadline + LEASE_GRACE_S) * 1000;
    const current = this.leases();
    const held = current.find((l) => l.job_id === r.job_id);
    if (held) {
      this.ctx.storage.sql.exec('UPDATE leases SET expires_at = ? WHERE lease_id = ?', expires, held.lease_id);
      await this.scheduleAlarm();
      return { granted: true, lease_id: held.lease_id, backend: held.backend };
    }
    for (const backend of r.backend_candidates) {
      if (!(backend in SLOTS) || this.isDown(backend, now)) continue;
      const used = current.filter((l) => l.backend === backend).length;
      if (used >= SLOTS[backend]) continue;
      const lease_id = crypto.randomUUID();
      this.ctx.storage.sql.exec('INSERT INTO leases (lease_id, job_id, backend, expires_at) VALUES (?, ?, ?, ?)', lease_id, r.job_id, backend, expires);
      await this.scheduleAlarm();
      return { granted: true, lease_id, backend };
    }
    return { granted: false, retry_after_s: RETRY_AFTER_S };
  }

  async release(lease_id: string, outcome: { ok: boolean; retryable?: boolean; backend_down?: boolean }): Promise<void> {
    const now = this.now();
    const lease = this.leases().find((l) => l.lease_id === lease_id);
    this.ctx.storage.sql.exec('DELETE FROM leases WHERE lease_id = ?', lease_id);
    if (lease) {
      if (outcome.ok) this.record(lease.backend, true, now);
      else if (outcome.backend_down) this.record(lease.backend, false, now);
    }
    await this.scheduleAlarm();
  }

  async report(backend: BackendName, ok: boolean): Promise<void> {
    if (!(backend in SLOTS)) return;
    this.record(backend, ok, this.now());
  }

  async snapshot(): Promise<CadRouterSnapshot> {
    const now = this.now();
    this.reclaim(now);
    const leases = this.leases();
    const slots: CadRouterSnapshot['slots'] = {};
    const health: CadRouterSnapshot['health'] = {};
    for (const backend of BACKENDS) {
      slots[backend] = { max: SLOTS[backend], used: leases.filter((l) => l.backend === backend).length };
      const h = this.healthOf(backend);
      health[backend] = { failures: h.failures, down_until: h.down_until !== null && h.down_until > now ? new Date(h.down_until).toISOString() : null };
    }
    return {
      slots,
      leases: leases.map((l) => ({ lease_id: l.lease_id, job_id: l.job_id, backend: l.backend, expires_at: new Date(l.expires_at).toISOString() })),
      health,
    };
  }

  async alarm(): Promise<void> {
    this.reclaim(this.now());
    await this.scheduleAlarm();
  }
}
