// Stock reads and stock-hold writes of the post-order agent through the Db port (service role).
//
// Rules
//   - public.stock_reservations is the truth for holds; it is written only through rpc/stock_hold, rpc/stock_commit
//     and rpc/stock_release (one transaction each, with the matching stock_transactions rows). stock_items is never
//     written here: availability = remaining_* of the stock item minus its active holds (held or committed).
//   - stock_transactions rows are never read to decide availability.
//   - A quote line maps to a public.materials row in code: the canonical grade (pricing/materials.ts) of the row's
//     grade (else its name) equals the line's grade, thickness within +/- 0.05 mm, active, same tenant; exactly one
//     such row, else the line's material is "not stocked".
//   - Holds expire 14 days after they are taken; p_held_by is the Durable Object name '<tenant_id>:<material_id>'.
//   - Supplier and supplier SKU of a material come from catalog_materials (materials has no supplier columns).

import { matchCatalog, recogniseMaterial, THICKNESS_TOLERANCE_MM } from '../../pricing/materials';
import type { CatalogMaterialRow } from '../../pricing/types';
import type { Db } from '../postgrest';

/** = stock_reservations_status_check */
export type ReservationStatus = 'held' | 'committed' | 'released';
/** = stock_reservations_reason_check */
export type ReleaseReason = 'cancelled' | 'consumed' | 'expired' | 'manual';

export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = ['held', 'committed'];
export const HOLD_DAYS = 14;
const DAY_MS = 86_400_000;

export interface MaterialRow {
  id: string;
  tenant_id: string;
  name: string;
  category: string | null;
  grade: string | null;
  thickness_mm: number | string | null;
  base_unit: string | null;
  is_active: boolean | null;
}

export interface StockItemRow {
  id: string;
  material_id: string;
  status: string;
  origin: string | null;
  width_mm: number | string | null;
  height_mm: number | string | null;
  remaining_area_mm2: number | string | null;
  remaining_quantity: number | string | null;
  created_at: string;
}

export interface ReservationRow {
  id: string;
  order_item_id: string;
  order_id: string;
  material_id: string;
  stock_item_id: string | null;
  area_mm2: number | string | null;
  quantity: number | string | null;
  status: ReservationStatus;
  expires_at: string | null;
  nesting_session_id: string | null;
  created_at: string;
}

/** One element of p_holds of rpc/stock_hold. */
export interface HoldInput {
  stock_item_id: string | null;
  area_mm2?: number;
  quantity?: number;
}

export function num(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Durable Object name of a material's stock: '<tenant_id>:<material_id>'. */
export function stockObjectName(tenantId: string, materialId: string): string {
  return `${tenantId}:${materialId}`;
}

/** The two halves of a stock object name, or null when it is not '<uuid>:<uuid>'. */
export function parseStockObjectName(name: string): { tenant_id: string; material_id: string } | null {
  const m = /^([0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(name);
  return m ? { tenant_id: m[1], material_id: m[2] } : null;
}

export function holdExpiry(now: Date): string {
  return new Date(now.getTime() + HOLD_DAYS * DAY_MS).toISOString();
}

/** Active materials of a tenant (for the code-side mapping of quote lines). */
export async function activeMaterials(db: Db, tenantId: string): Promise<MaterialRow[]> {
  const rows = await db.select<MaterialRow & Record<string, unknown>>('materials', {
    columns: 'id,tenant_id,name,category,grade,thickness_mm,base_unit,is_active',
    filters: [
      ['tenant_id', 'eq', tenantId],
      ['is_active', 'eq', true],
    ],
    limit: 1000,
  });
  return rows;
}

/** The single active material of a grade and thickness, or null (none or several: "not stocked"). */
export function mapMaterial(materials: readonly MaterialRow[], line: { grade: string | null; thickness_mm: number | null }): MaterialRow | null {
  if (!line.grade) return null;
  const hits = materials.filter((m) => {
    if (m.is_active === false) return false;
    const grade = recogniseMaterial(m.grade ?? m.name ?? '').grade;
    if (grade !== line.grade) return false;
    const t = num(m.thickness_mm);
    if (line.thickness_mm === null) return t === null;
    return t !== null && Math.abs(t - line.thickness_mm) <= THICKNESS_TOLERANCE_MM + 1e-9;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Available stock items of a material. */
export async function availableStockItems(db: Db, materialId: string): Promise<StockItemRow[]> {
  return db.select<StockItemRow & Record<string, unknown>>('stock_items', {
    columns: 'id,material_id,status,origin,width_mm,height_mm,remaining_area_mm2,remaining_quantity,created_at',
    filters: [
      ['material_id', 'eq', materialId],
      ['status', 'eq', 'available'],
    ],
    order: [{ column: 'created_at', ascending: true }],
    limit: 500,
  });
}

/** Active holds (held or committed) of a material. */
export async function activeReservations(db: Db, materialId: string): Promise<ReservationRow[]> {
  return db.select<ReservationRow & Record<string, unknown>>('stock_reservations', {
    columns: 'id,order_item_id,order_id,material_id,stock_item_id,area_mm2,quantity,status,expires_at,nesting_session_id,created_at',
    filters: [
      ['material_id', 'eq', materialId],
      ['status', 'in', [...ACTIVE_RESERVATION_STATUSES]],
    ],
    // the order rpc/stock_hold returns holds in, so a repeated reserve answers the same list
    order: [{ column: 'created_at', ascending: true }, { column: 'id', ascending: true }],
    limit: 2000,
  });
}

/** Holds of a material whose expiry has passed (still 'held'). */
export async function expiredHolds(db: Db, materialId: string, now: Date): Promise<ReservationRow[]> {
  return db.select<ReservationRow & Record<string, unknown>>('stock_reservations', {
    columns: 'id,order_item_id,order_id,material_id,stock_item_id,area_mm2,quantity,status,expires_at,nesting_session_id,created_at',
    filters: [
      ['material_id', 'eq', materialId],
      ['status', 'eq', 'held'],
      ['expires_at', 'lt', now.toISOString()],
    ],
    limit: 500,
  });
}

function rowsOf(result: unknown): ReservationRow[] {
  return (Array.isArray(result) ? result : result ? [result] : []) as ReservationRow[];
}

/** rpc/stock_hold: the active holds of the order item (existing ones are returned unchanged). */
export async function stockHold(db: Db, a: { order_item_id: string; material_id: string; holds: readonly HoldInput[]; expires_at: string; held_by: string }): Promise<ReservationRow[]> {
  const holds = a.holds.map((h) => {
    const out: Record<string, unknown> = { stock_item_id: h.stock_item_id ?? '' };
    if (h.area_mm2 !== undefined) out.area_mm2 = h.area_mm2;
    if (h.quantity !== undefined) out.quantity = h.quantity;
    return out;
  });
  return rowsOf(await db.rpc('stock_hold', { p_order_item_id: a.order_item_id, p_material_id: a.material_id, p_holds: holds, p_expires_at: a.expires_at, p_held_by: a.held_by }));
}

/** rpc/stock_commit: the committed holds of the order item. */
export async function stockCommit(db: Db, orderItemId: string, nestingSessionId: string): Promise<ReservationRow[]> {
  return rowsOf(await db.rpc('stock_commit', { p_order_item_id: orderItemId, p_nesting_session_id: nestingSessionId }));
}

/** rpc/stock_release: the holds released now. */
export async function stockRelease(db: Db, orderItemId: string, reason: ReleaseReason): Promise<ReservationRow[]> {
  return rowsOf(await db.rpc('stock_release', { p_order_item_id: orderItemId, p_reason: reason }));
}

/** Unresolved low-stock alerts of the given materials. */
export async function openLowStockAlerts(db: Db, materialIds: readonly string[]): Promise<Array<{ material_id: string; current_stock: number | null; threshold: number | null; base_unit: string | null }>> {
  if (materialIds.length === 0) return [];
  const rows = await db.select<{ material_id: string; current_stock: unknown; threshold: unknown; base_unit: string | null; resolved: boolean | null }>('low_stock_alerts', {
    columns: 'material_id,current_stock,threshold,base_unit,resolved',
    filters: [['material_id', 'in', [...materialIds]]],
    limit: 200,
  });
  return rows.filter((r) => r.resolved !== true).map((r) => ({ material_id: r.material_id, current_stock: num(r.current_stock), threshold: num(r.threshold), base_unit: r.base_unit ?? null }));
}

/** catalog_materials columns of a reorder draft (supplier data lives there, not in materials). */
export interface SupplierRow extends CatalogMaterialRow {
  supplier: string | null;
  supplier_sku: string | null;
}

/** Supplier and SKU of a grade and thickness from catalog_materials, or null. */
export async function supplierOf(db: Db, tenantId: string, line: { grade: string | null; thickness_mm: number | null }): Promise<{ supplier: string | null; supplier_sku: string | null; catalog_material_id: string } | null> {
  if (!line.grade) return null;
  const rows = await db.select<SupplierRow & Record<string, unknown>>('catalog_materials', {
    columns: 'id,name,material_grade,form_factor,dimensions,weight_per_unit,stock_unit,price_per_unit,price_per_kg,currency,is_available,supplier,supplier_sku',
    filters: [['tenant_id', 'eq', tenantId]],
    order: [{ column: 'id', ascending: true }],
    limit: 2000,
  });
  const hit = matchCatalog(rows, { grade: line.grade, thickness_mm: line.thickness_mm, process: 'sheet_metal' }) as SupplierRow | null;
  return hit ? { supplier: hit.supplier ?? null, supplier_sku: hit.supplier_sku ?? null, catalog_material_id: hit.id } : null;
}
