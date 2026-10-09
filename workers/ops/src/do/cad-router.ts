// CadRouter: one Durable Object ('global') that grants CAD backend leases and tracks backend health. It never
// touches file bytes; the cad-jobs consumer (and, in Phase 5, the CAD compat route) runs the job.
//
// Rules
//   - Slots: vps 1, inline 1 (never two inline leases at once), container = CAD_SLOTS (Phase 5; 3 when the var is
//     not configured), mac_mini 1.
//   - acquire() gives the first candidate that is not down and has a free slot; a job that already holds a lease
//     gets the same lease back (a redelivered message after a crash), with a new expiry.
//   - A lease expires at now + deadline_s + 60 s; acquire() and alarm() reclaim expired leases, and the alarm is set
//     at the earliest expiry.
//   - Two consecutive backend_down outcomes or failed health probes mark a backend down for 5 minutes; a success
//     resets the count.
//   - State is SQLite in the object's storage: leases(lease_id, job_id unique, backend, expires_at) and
//     health(backend, failures, down_until), times in ms since the epoch.
// Phase 5 (P5-6) additions
//   - A container lease holds one named slot ('cad-0' … 'cad-<n-1>', src/cad-container/slots.ts), the lowest free
//     one; the slot travels in the AcquireResult and names the CadContainer instance the job runs on. Table
//     slots(slot primary key, lease_id unique, since, priority).
//   - Priorities: 'interactive' (the compat path of the CAD edge functions) may take any free slot; 'batch' (agent
//     jobs, the default) holds at most CAD_SLOTS - 1 container leases of its own, so agent jobs alone never fill
//     every slot. Without a valid CAD_SLOTS var the Phase 4 accounting applies (3 container leases, no
//     reservation).
//   - release(lease_id, {recycle: true}) of a container lease destroys that slot's container
//     (P5Ports.container.destroy); the slot stays taken (a 'recycle:<slot>' row) until the destroy call returned,
//     so no new lease reaches an instance that is being destroyed. recycle(slot) does the same for a slot by hand.
//   - The container backend is never probed actively (a probe would wake and bill a sleeping instance); its
//     health comes from job outcomes. snapshot() lists every container slot with its lease.

import { DurableObject } from 'cloudflare:workers';
import { formatLogLine } from '../../../shared/src/http/log';
import { configuredSlotCount, slotCount, slotIndex, slotName } from '../cad-container/slots';
import type { AcquireRequest, AcquireResult, BackendName, CadPriority, ReleaseOutcome } from '../cad/types';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { makeP5Ports, type ContainerPort } from '../ports/p5';

export type { AcquireRequest, AcquireResult, ReleaseOutcome } from '../cad/types';

export interface CadRouterSnapshot {
  slots: Partial<Record<BackendName, { max: number; used: number }>>;
  leases: Array<{ lease_id: string; job_id: string; backend: BackendName; expires_at: string }>;
  health: Partial<Record<BackendName, { failures: number; down_until: string | null }>>;
  /** Phase 5: every container slot, lowest first, with the lease that holds it. */
  container_slots: Array<{ slot: string; lease?: string; since?: string }>;
}

export const SLOTS: Readonly<Record<BackendName, number>> = Object.freeze({ vps: 1, inline: 1, container: 3, mac_mini: 1 });
export const LEASE_GRACE_S = 60;
export const RETRY_AFTER_S = 30;
export const DOWN_AFTER_FAILURES = 2;
export const DOWN_FOR_MS = 5 * 60_000;
const MAX_DEADLINE_S = 3600;
/** Longest time a slot stays held for a recycle whose destroy call never returned. */
export const RECYCLE_HOLD_MS = 60_000;
/** job_id prefix of the rows that hold a slot while its container is destroyed. */
export const RECYCLE_JOB_PREFIX = 'recycle:';

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

interface SlotRow {
  slot: string;
  lease_id: string;
  since: number;
  /** 'batch', 'interactive', or 'hold' (a slot held while its container is destroyed). */
  priority: string;
}

export class CadRouter extends DurableObject<OpsEnv> {
  private p5Container: ContainerPort | undefined;

  constructor(ctx: DurableObjectState, env: OpsEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS leases (lease_id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE, backend TEXT NOT NULL, expires_at INTEGER NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS health (backend TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, down_until INTEGER);' +
        "CREATE TABLE IF NOT EXISTS slots (slot TEXT PRIMARY KEY, lease_id TEXT NOT NULL UNIQUE, since INTEGER NOT NULL, priority TEXT NOT NULL DEFAULT 'batch');",
    );
  }

  /** Current time in ms (a method so tests can drive time). */
  protected now(): number {
    return Date.now();
  }

  /** The container port of recycle (a method so tests can script it). */
  protected containerPort(): ContainerPort {
    return (this.p5Container ??= makeP5Ports(this.env).container);
  }

  private leases(): LeaseRow[] {
    return this.ctx.storage.sql.exec<Record<string, SqlStorageValue>>('SELECT lease_id, job_id, backend, expires_at FROM leases ORDER BY expires_at, lease_id').toArray() as unknown as LeaseRow[];
  }

  private slotRows(): SlotRow[] {
    return this.ctx.storage.sql.exec<Record<string, SqlStorageValue>>('SELECT slot, lease_id, since, priority FROM slots').toArray() as unknown as SlotRow[];
  }

  private slotOf(lease_id: string): string | undefined {
    return this.slotRows().find((s) => s.lease_id === lease_id)?.slot;
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

  /** Deletes expired leases and the slots they held; returns how many leases were reclaimed. */
  private reclaim(now: number): number {
    const reclaimed = this.ctx.storage.sql.exec('DELETE FROM leases WHERE expires_at <= ?', now).rowsWritten;
    this.ctx.storage.sql.exec('DELETE FROM slots WHERE lease_id NOT IN (SELECT lease_id FROM leases)');
    return reclaimed;
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

  /** True when a new container lease of this priority stays within the priority's share (see the rules above). */
  private withinShare(priority: CadPriority): boolean {
    const configured = configuredSlotCount(this.env ?? {});
    if (configured === null || priority === 'interactive') return true;
    return this.slotRows().filter((s) => s.priority === 'batch').length < configured - 1;
  }

  /** The lowest container slot no lease holds, or null. */
  private freeSlot(): string | null {
    const taken = new Set(this.slotRows().map((s) => s.slot));
    const count = slotCount(this.env ?? {});
    for (let i = 0; i < count; i++) {
      const name = slotName(i);
      if (!taken.has(name)) return name;
    }
    return null;
  }

  async acquire(r: AcquireRequest): Promise<AcquireResult> {
    const now = this.now();
    this.reclaim(now);
    const deadline = Number.isFinite(r.deadline_s) && r.deadline_s > 0 ? Math.min(r.deadline_s, MAX_DEADLINE_S) : 300;
    const expires = now + (deadline + LEASE_GRACE_S) * 1000;
    const priority: CadPriority = r.priority === 'interactive' ? 'interactive' : 'batch';
    const current = this.leases();
    const held = current.find((l) => l.job_id === r.job_id);
    if (held) {
      this.ctx.storage.sql.exec('UPDATE leases SET expires_at = ? WHERE lease_id = ?', expires, held.lease_id);
      await this.scheduleAlarm();
      const slot = this.slotOf(held.lease_id);
      return slot ? { granted: true, lease_id: held.lease_id, backend: held.backend, slot } : { granted: true, lease_id: held.lease_id, backend: held.backend };
    }
    for (const backend of r.backend_candidates) {
      if (!(backend in SLOTS) || this.isDown(backend, now)) continue;
      const used = current.filter((l) => l.backend === backend).length;
      if (backend === 'container') {
        if (!this.withinShare(priority)) continue;
        const slot = this.freeSlot();
        if (slot === null) continue;
        const lease_id = crypto.randomUUID();
        this.ctx.storage.sql.exec('INSERT INTO leases (lease_id, job_id, backend, expires_at) VALUES (?, ?, ?, ?)', lease_id, r.job_id, backend, expires);
        this.ctx.storage.sql.exec('INSERT INTO slots (slot, lease_id, since, priority) VALUES (?, ?, ?, ?)', slot, lease_id, now, priority);
        await this.scheduleAlarm();
        return { granted: true, lease_id, backend, slot };
      }
      if (used >= SLOTS[backend]) continue;
      const lease_id = crypto.randomUUID();
      this.ctx.storage.sql.exec('INSERT INTO leases (lease_id, job_id, backend, expires_at) VALUES (?, ?, ?, ?)', lease_id, r.job_id, backend, expires);
      await this.scheduleAlarm();
      return { granted: true, lease_id, backend };
    }
    return { granted: false, retry_after_s: RETRY_AFTER_S };
  }

  async release(lease_id: string, outcome: ReleaseOutcome): Promise<void> {
    const now = this.now();
    const lease = this.leases().find((l) => l.lease_id === lease_id);
    const slot = lease ? this.slotOf(lease_id) : undefined;
    this.ctx.storage.sql.exec('DELETE FROM leases WHERE lease_id = ?', lease_id);
    this.ctx.storage.sql.exec('DELETE FROM slots WHERE lease_id = ?', lease_id);
    if (lease) {
      if (outcome.ok) this.record(lease.backend, true, now);
      else if (outcome.backend_down) this.record(lease.backend, false, now);
    }
    if (lease?.backend === 'container' && slot && outcome.recycle) {
      await this.destroySlot(slot, 'release');
      return;
    }
    await this.scheduleAlarm();
  }

  /** Destroys the container of a slot by hand (cold-start measurement, a stuck instance). */
  async recycle(slot: string): Promise<void> {
    if (slotIndex(slot, this.env ?? {}) === null) throw new Error('unknown CAD slot');
    await this.destroySlot(slot, 'manual');
  }

  /** Holds the slot, destroys its container, then frees the slot again (also when the destroy call failed). */
  private async destroySlot(slot: string, reason: 'release' | 'manual'): Promise<void> {
    const now = this.now();
    this.reclaim(now);
    const holder = crypto.randomUUID();
    const occupied = this.slotRows().find((s) => s.slot === slot);
    if (!occupied) {
      this.ctx.storage.sql.exec('INSERT INTO leases (lease_id, job_id, backend, expires_at) VALUES (?, ?, ?, ?)', holder, `${RECYCLE_JOB_PREFIX}${slot}:${holder}`, 'container', now + RECYCLE_HOLD_MS);
      this.ctx.storage.sql.exec("INSERT INTO slots (slot, lease_id, since, priority) VALUES (?, ?, ?, 'hold')", slot, holder, now);
      await this.scheduleAlarm();
    }
    try {
      await this.containerPort().destroy(slot);
      console.log(formatLogLine(LOG_PREFIX, 'cad slot recycled', { slot, reason }));
    } catch (error) {
      console.error(formatLogLine(LOG_PREFIX, 'cad slot recycle failed', { slot, reason, error: error instanceof Error ? error.name : 'error' }));
    } finally {
      if (!occupied) {
        this.ctx.storage.sql.exec('DELETE FROM leases WHERE lease_id = ?', holder);
        this.ctx.storage.sql.exec('DELETE FROM slots WHERE lease_id = ?', holder);
      }
      await this.scheduleAlarm();
    }
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
      const max = backend === 'container' ? (configuredSlotCount(this.env ?? {}) ?? SLOTS.container) : SLOTS[backend];
      slots[backend] = { max, used: leases.filter((l) => l.backend === backend).length };
      const h = this.healthOf(backend);
      health[backend] = { failures: h.failures, down_until: h.down_until !== null && h.down_until > now ? new Date(h.down_until).toISOString() : null };
    }
    const bySlot = new Map(this.slotRows().map((s) => [s.slot, s]));
    const container_slots: CadRouterSnapshot['container_slots'] = [];
    for (let i = 0; i < slotCount(this.env ?? {}); i++) {
      const name = slotName(i);
      const held = bySlot.get(name);
      container_slots.push(held ? { slot: name, lease: held.lease_id, since: new Date(held.since).toISOString() } : { slot: name });
    }
    return {
      slots,
      leases: leases.map((l) => ({ lease_id: l.lease_id, job_id: l.job_id, backend: l.backend, expires_at: new Date(l.expires_at).toISOString() })),
      health,
      container_slots,
    };
  }

  async alarm(): Promise<void> {
    this.reclaim(this.now());
    await this.scheduleAlarm();
  }
}
