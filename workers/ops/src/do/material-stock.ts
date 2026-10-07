// MaterialStock: one Durable Object per tenant and material (idFromName('<tenant_id>:<material_id>')). Serialises
// stock holds of order items; the truth is public.stock_reservations, written only through rpc/stock_hold,
// rpc/stock_commit and rpc/stock_release.
//
// Rules
//   - reserve is idempotent per order item; holds expire after 14 days (daily alarm releases them as 'expired').
//   - Remaining stock is re-read on every call; holds above the remaining stock raise a card. The check covers every
//     stock item that carries an active hold, whatever its status (a held item that was used up or taken out of
//     stock is held above its remaining stock), plus the available ones.
//   - Calls of one object run one after the other (an in-memory queue spans the database round trips), so two
//     reserve calls never both count the same remaining stock.
//   - Availability of a stock item = remaining_area_mm2 (or remaining_quantity) minus its active holds (held or
//     committed); holds without a stock item reduce the material's total. stock_transactions rows are never read.
//   - Choice of stock: remnants first, smallest available area first; then the other items oldest first (the order
//     of select_stock_for_session, supabase/migrations/20260401_create_inventory_system.sql:625-678). Area needs
//     are split over several items when one is not enough; nesting is not modelled.
//   - A material without any available stock item and without holds is 'not_stocked'. When less is available than
//     needed, what is available is held and the rest is reported as missing ('shortfall'); nothing available means
//     no hold at all.
//   - SQLite storage holds(order_item_id, status, holds JSON, updated_at) mirrors the outcome per order item; the
//     database is always re-checked before a stored outcome is returned.
//   - Daily alarm: holds past their expiry are released ('expired'); when it released something or a stock item is
//     held above its remaining stock and agent.post_order is on, it records one agent_runs row (agent
//     post_order.stock, trigger cron: a key of its own, so these notices never count toward PostOrderWorkflow's
//     daily run cap) and posts a notice card through the queue agent-events; with the flag off it only releases
//     expired holds (no run, no card). The alarm is re-armed while held holds remain.
//   - Log lines carry ids and counts only.

import { DurableObject } from 'cloudflare:workers';
import { formatLogLine } from '../../../shared/src/http/log';
import { stockNoticeCard } from '../agents/cards/reorder';
import { readFlag } from '../agents/flags';
import { closeRun, EMPTY_USAGE, openRun, type AgentKey } from '../agents/runs';
import { PostgrestDb, type Db } from '../db/postgrest';
import {
  activeReservations,
  availableStockItems,
  expiredHolds,
  holdExpiry,
  num,
  parseStockObjectName,
  stockCommit,
  stockHold,
  stockObjectName,
  stockItemsByIds,
  stockRelease,
  type HoldInput,
  type ReservationRow,
  type StockItemRow,
} from '../db/repos/stock';
import { LOG_PREFIX, type OpsEnv } from '../env';
import type { AgentEventV1 } from '../queues/messages';

export interface StockHold {
  stock_item_id: string | null;
  area_mm2: number | null;
  quantity: number | null;
  expires_at: string;
}

export type StockHoldResult =
  | { status: 'held' | 'already_held'; holds: StockHold[] }
  | { status: 'shortfall'; holds: StockHold[]; missing: { area_mm2?: number; quantity?: number } }
  | { status: 'not_stocked' };

export interface StockCheck {
  material_id: string;
  items: Array<{
    stock_item_id: string;
    remaining_area_mm2: number | null;
    remaining_quantity: number | null;
    held_area_mm2: number;
    held_quantity: number;
  }>;
  /** stock_item ids whose holds exceed the remaining stock. */
  over_held: string[];
}

export const ALARM_INTERVAL_MS = 86_400_000;
/** Agent key of the daily stock notices (outside PostOrderWorkflow's daily cap, which counts 'post_order'). */
export const STOCK_NOTICE_AGENT: AgentKey = 'post_order.stock';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EPS = 1e-6;

type Row = Record<string, SqlStorageValue>;

function round(n: number, scale: number): number {
  const f = 10 ** scale;
  return Math.round(n * f) / f;
}

function toHold(r: ReservationRow): StockHold {
  return { stock_item_id: r.stock_item_id ?? null, area_mm2: num(r.area_mm2), quantity: num(r.quantity), expires_at: r.expires_at ?? '' };
}

/** Pure: the per-item availability of a material (remaining minus active holds) and the held sums. */
export function availability(items: readonly StockItemRow[], holds: readonly ReservationRow[]): {
  items: Array<StockItemRow & { held_area: number; held_qty: number; free_area: number | null; free_qty: number | null }>;
  material_level: { area: number; qty: number };
} {
  const heldArea = new Map<string, number>();
  const heldQty = new Map<string, number>();
  const materialLevel = { area: 0, qty: 0 };
  for (const h of holds) {
    if (h.status !== 'held' && h.status !== 'committed') continue;
    const a = num(h.area_mm2) ?? 0;
    const q = num(h.quantity) ?? 0;
    if (!h.stock_item_id) {
      materialLevel.area += a;
      materialLevel.qty += q;
      continue;
    }
    heldArea.set(h.stock_item_id, (heldArea.get(h.stock_item_id) ?? 0) + a);
    heldQty.set(h.stock_item_id, (heldQty.get(h.stock_item_id) ?? 0) + q);
  }
  return {
    items: items.map((it) => {
      const area = num(it.remaining_area_mm2);
      const qty = num(it.remaining_quantity);
      const ha = heldArea.get(it.id) ?? 0;
      const hq = heldQty.get(it.id) ?? 0;
      return { ...it, held_area: ha, held_qty: hq, free_area: area === null ? null : area - ha, free_qty: qty === null ? null : qty - hq };
    }),
    material_level: materialLevel,
  };
}

/** Pure: items in the order stock is taken (remnants smallest first, then the others oldest first). */
export function pickOrder<T extends { origin: string | null; created_at: string; id: string; free_area: number | null }>(items: readonly T[]): T[] {
  const remnants = items.filter((i) => i.origin === 'remnant').sort((a, b) => (a.free_area ?? 0) - (b.free_area ?? 0) || a.id.localeCompare(b.id));
  const others = items
    .filter((i) => i.origin !== 'remnant')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  return [...remnants, ...others];
}

/** Pure: holds covering as much of the need as is free; `missing` > 0 when the free stock is not enough. */
export function allocate(
  items: ReturnType<typeof availability>['items'],
  materialLevel: { area: number; qty: number },
  need: { area_mm2?: number; quantity?: number },
): { holds: HoldInput[]; missing: { area_mm2?: number; quantity?: number } } {
  const holds: HoldInput[] = [];
  const missing: { area_mm2?: number; quantity?: number } = {};
  const ordered = pickOrder(items);
  if (need.area_mm2 !== undefined) {
    // Holds without a stock item use up the free area of the material first.
    let unassigned = materialLevel.area;
    let rest = need.area_mm2;
    for (const it of ordered) {
      let free = Math.max(0, it.free_area ?? 0);
      const used = Math.min(free, unassigned);
      free -= used;
      unassigned -= used;
      if (rest <= EPS || free <= EPS) continue;
      const take = round(Math.min(free, rest), 2);
      if (take <= 0) continue;
      holds.push({ stock_item_id: it.id, area_mm2: take });
      rest = round(rest - take, 2);
    }
    if (rest > EPS) missing.area_mm2 = round(rest, 2);
  } else if (need.quantity !== undefined) {
    let unassigned = materialLevel.qty;
    let rest = need.quantity;
    for (const it of ordered) {
      let free = Math.max(0, it.free_qty ?? 0);
      const used = Math.min(free, unassigned);
      free -= used;
      unassigned -= used;
      if (rest <= EPS || free <= EPS) continue;
      const take = round(Math.min(free, rest), 3);
      if (take <= 0) continue;
      holds.push({ stock_item_id: it.id, quantity: take });
      rest = round(rest - take, 3);
    }
    if (rest > EPS) missing.quantity = round(rest, 3);
  }
  return { holds, missing };
}

/** Pure: the stock check of a material (held above remaining per stock item). */
export function stockCheckOf(materialId: string, items: readonly StockItemRow[], holds: readonly ReservationRow[]): StockCheck {
  const a = availability(items, holds);
  const heldIds = new Set(holds.map((h) => h.stock_item_id).filter((id): id is string => !!id));
  const listed = a.items.filter((i) => heldIds.has(i.id) || i.status === 'available');
  return {
    material_id: materialId,
    items: listed.map((i) => ({
      stock_item_id: i.id,
      remaining_area_mm2: num(i.remaining_area_mm2),
      remaining_quantity: num(i.remaining_quantity),
      held_area_mm2: round(i.held_area, 2),
      held_quantity: round(i.held_qty, 3),
    })),
    over_held: listed.filter((i) => (i.free_area !== null && i.free_area < -EPS) || (i.free_qty !== null && i.free_qty < -EPS)).map((i) => i.id),
  };
}

export class MaterialStock extends DurableObject<OpsEnv> {
  /** Database (set by tests; the service-role PostgREST client otherwise). */
  protected dbInstance?: Db;
  /** Clock (set by tests). */
  protected clock: () => Date = () => new Date();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: OpsEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS holds (order_item_id TEXT PRIMARY KEY, status TEXT NOT NULL, holds TEXT NOT NULL, updated_at TEXT NOT NULL)');
  }

  private db(): Db {
    return (this.dbInstance ??= new PostgrestDb({ url: this.env.SUPABASE_URL, serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY }));
  }

  /** Runs fn after every earlier call of this object has finished. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private names(): { tenant_id: string; material_id: string } {
    const parsed = parseStockObjectName(this.ctx.id.name ?? '');
    if (!parsed) throw new Error('MaterialStock: object name must be <tenant_id>:<material_id>');
    return parsed;
  }

  private record(orderItemId: string, status: string, holds: StockHold[]): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO holds (order_item_id, status, holds, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (order_item_id) DO UPDATE SET status = excluded.status, holds = excluded.holds, updated_at = excluded.updated_at',
      orderItemId,
      status,
      JSON.stringify(holds),
      this.clock().toISOString(),
    );
  }

  private stored(orderItemId: string): { status: string } | null {
    const row = this.ctx.storage.sql.exec<Row>('SELECT status FROM holds WHERE order_item_id = ?', orderItemId).toArray()[0];
    return row ? { status: String(row.status) } : null;
  }

  private async armAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(this.clock().getTime() + ALARM_INTERVAL_MS);
  }

  async reserve(orderItemId: string, need: { area_mm2?: number; quantity?: number }): Promise<StockHoldResult> {
    if (!UUID.test(orderItemId)) throw new Error('reserve: order item id must be a uuid');
    const area = need?.area_mm2;
    const qty = need?.quantity;
    const areaOk = typeof area === 'number' && Number.isFinite(area) && area > 0;
    const qtyOk = typeof qty === 'number' && Number.isFinite(qty) && qty > 0;
    if (!areaOk && !qtyOk) throw new Error('reserve: need area_mm2 or quantity above 0');
    const wanted = areaOk ? { area_mm2: round(area as number, 2) } : { quantity: round(qty as number, 3) };
    return this.serial(async () => {
      const { tenant_id, material_id } = this.names();
      const db = this.db();
      const [items, holds] = await Promise.all([availableStockItems(db, material_id), activeReservations(db, material_id)]);
      const mine = holds.filter((h) => h.order_item_id === orderItemId);
      if (mine.length > 0) {
        const result = mine.map(toHold);
        if (this.stored(orderItemId)?.status !== 'held') this.record(orderItemId, 'held', result);
        return { status: 'already_held', holds: result };
      }
      if (items.length === 0 && holds.length === 0) {
        this.record(orderItemId, 'not_stocked', []);
        return { status: 'not_stocked' };
      }
      const a = availability(items, holds);
      const { holds: plan, missing } = allocate(a.items, a.material_level, wanted);
      if (plan.length === 0) {
        this.record(orderItemId, 'shortfall', []);
        return { status: 'shortfall', holds: [], missing };
      }
      const written = await stockHold(db, {
        order_item_id: orderItemId,
        material_id,
        holds: plan,
        expires_at: holdExpiry(this.clock()),
        held_by: stockObjectName(tenant_id, material_id),
      });
      const result = written.filter((r) => r.status === 'held' || r.status === 'committed').map(toHold);
      const short = Object.keys(missing).length > 0;
      this.record(orderItemId, short ? 'shortfall' : 'held', result);
      await this.armAlarm();
      console.log(formatLogLine(LOG_PREFIX, 'stock reserve', { material_id, order_item_id: orderItemId, outcome: short ? 'shortfall' : 'held', holds: result.length }));
      return short ? { status: 'shortfall', holds: result, missing } : { status: 'held', holds: result };
    });
  }

  async commit(orderItemId: string, nestingSessionId: string): Promise<void> {
    if (!UUID.test(orderItemId) || !UUID.test(nestingSessionId)) throw new Error('commit: ids must be uuids');
    await this.serial(async () => {
      const rows = await stockCommit(this.db(), orderItemId, nestingSessionId);
      this.record(orderItemId, 'committed', rows.map(toHold));
    });
  }

  async release(orderItemId: string, reason: 'cancelled' | 'consumed' | 'expired' | 'manual'): Promise<void> {
    if (!UUID.test(orderItemId)) throw new Error('release: order item id must be a uuid');
    await this.serial(async () => {
      await stockRelease(this.db(), orderItemId, reason);
      this.record(orderItemId, 'released', []);
    });
  }

  /** Available stock items plus every other item that carries an active hold. */
  private async checkInputs(db: Db, materialId: string): Promise<{ items: StockItemRow[]; holds: ReservationRow[] }> {
    const [available, holds] = await Promise.all([availableStockItems(db, materialId), activeReservations(db, materialId)]);
    const known = new Set(available.map((i) => i.id));
    const missing = [...new Set(holds.map((h) => h.stock_item_id).filter((id): id is string => !!id && !known.has(id)))];
    const others = (await stockItemsByIds(db, missing)).filter((i) => i.material_id === materialId);
    return { items: [...available, ...others], holds };
  }

  async check(): Promise<StockCheck> {
    return this.serial(async () => {
      const { material_id } = this.names();
      const { items, holds } = await this.checkInputs(this.db(), material_id);
      return stockCheckOf(material_id, items, holds);
    });
  }

  /** Daily: releases expired holds, checks held against remaining stock, re-arms while holds remain. */
  async alarm(): Promise<void> {
    await this.serial(async () => {
      const { tenant_id, material_id } = this.names();
      const db = this.db();
      const now = this.clock();
      const expired = await expiredHolds(db, material_id, now);
      const orderItems = [...new Set(expired.map((r) => r.order_item_id))];
      for (const id of orderItems) {
        await stockRelease(db, id, 'expired');
        this.record(id, 'released', []);
      }
      const { items, holds } = await this.checkInputs(db, material_id);
      const check = stockCheckOf(material_id, items, holds);
      if ((orderItems.length > 0 || check.over_held.length > 0) && (await readFlag(this.env, 'agent.post_order', tenant_id)).enabled) {
        await this.notice(tenant_id, material_id, orderItems.length, check.over_held.length, now);
      }
      if (holds.some((h) => h.status === 'held')) await this.ctx.storage.setAlarm(now.getTime() + ALARM_INTERVAL_MS);
    });
  }

  /** One run row and one notice card for an alarm that changed something or found holds above the stock. */
  private async notice(tenantId: string, materialId: string, released: number, overHeld: number, now: Date): Promise<void> {
    const db = this.db();
    const run = await openRun(db, {
      agent: STOCK_NOTICE_AGENT,
      trigger: 'cron',
      idempotency_key: `${STOCK_NOTICE_AGENT}:${materialId}:${now.toISOString().slice(0, 16)}`,
      subject_type: 'material',
      subject_id: materialId,
      tenant_id: tenantId,
    });
    if (!run.created) return;
    const output = { material_id: materialId, released, over_held: overHeld };
    try {
      if (this.env.AGENT_EVENTS) {
        const label = await this.materialLabel(materialId);
        const card = stockNoticeCard({ run_id: run.run_id, site_origin: this.env.SITE_ORIGIN, material_label: label, released, over_held: overHeld });
        const message: AgentEventV1 = { v: 1, type: 'card', card, run_id: run.run_id };
        await this.env.AGENT_EVENTS.send(message, { contentType: 'json' });
      }
      await closeRun(db, run.run_id, { status: 'succeeded', output }, { ...EMPTY_USAGE, by_step: {} });
    } catch (error) {
      await closeRun(db, run.run_id, { status: 'failed', error: 'stock_notice_failed', output }, { ...EMPTY_USAGE, by_step: {} });
      throw error;
    }
  }

  private async materialLabel(materialId: string): Promise<string> {
    const rows = await this.db().select<{ name: string | null; grade: string | null; thickness_mm: unknown }>('materials', { columns: 'name,grade,thickness_mm', filters: [['id', 'eq', materialId]], limit: 1 });
    const m = rows[0];
    if (!m) return 'material';
    const t = num(m.thickness_mm);
    return [m.name, m.grade && m.grade !== m.name ? m.grade : null, t !== null ? `${t} mm` : null].filter(Boolean).join(' · ') || 'material';
  }
}
