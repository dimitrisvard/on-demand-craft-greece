// Orders, their items and the quote and CAD data the post-order agent reads (service role, Db port).
//
// Rules
//   - Orders are written by the portal's Accept Quote or rpc/create_order_from_quote; the agent changes one column
//     only: orders.partner_id at the hand-off, and only while it is empty or already the same partner.
//   - Order items map to the RFQ's parts (and so to the quote lines built from them) by product name: the portal
//     copies part.product_name into order_items (src/pages/customer/QuoteDetailPage.tsx:440-447).
//   - CAD outputs come from succeeded cad_jobs of the RFQ; only the keys a partner link may carry are used
//     (cad/<job>/output/drawing.pdf and flat.dxf).

import type { Db } from '../postgrest';

export interface OrderRow {
  id: string;
  title: string | null;
  po_number: string | null;
  from_rfq_number: string | null;
  rfq_id: string | null;
  customer_id: string | null;
  status: string;
  partner_id: string | null;
  delivery_date: string | null;
  created_at: string | null;
  currency: string | null;
  tenant_id: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_name: string;
  description: string | null;
  quantity: number | string;
}

const ORDER_COLUMNS = 'id,title,po_number,from_rfq_number,rfq_id,customer_id,status,partner_id,delivery_date,created_at,currency,tenant_id';

export async function getOrder(db: Db, id: string): Promise<OrderRow | null> {
  const rows = await db.select<OrderRow & Record<string, unknown>>('orders', { columns: ORDER_COLUMNS, filters: [['id', 'eq', id]], limit: 1 });
  return rows[0] ?? null;
}

export async function orderItems(db: Db, orderId: string): Promise<OrderItemRow[]> {
  return db.select<OrderItemRow & Record<string, unknown>>('order_items', {
    columns: 'id,order_id,product_name,description,quantity',
    filters: [['order_id', 'eq', orderId]],
    order: [{ column: 'created_at', ascending: true }, { column: 'id', ascending: true }],
    limit: 500,
  });
}

/** Sets the order's partner while it has none (or the same one); false when another partner is already set. */
export async function setOrderPartner(db: Db, orderId: string, partnerId: string): Promise<boolean> {
  const unset = await db.update('orders', { partner_id: partnerId }, { filters: [['id', 'eq', orderId], ['partner_id', 'is', null]], returning: 'id' });
  if (unset.length > 0) return true;
  const current = await getOrder(db, orderId);
  return current?.partner_id === partnerId;
}

/** Orders in status 'new' created at or after `since` (oldest first, then by id: a stable page order). */
export async function recentNewOrders(db: Db, since: Date, limit: number): Promise<Array<Pick<OrderRow, 'id' | 'rfq_id' | 'tenant_id' | 'created_at'>>> {
  return db.select('orders', {
    columns: 'id,rfq_id,tenant_id,created_at',
    filters: [
      ['status', 'eq', 'new'],
      ['created_at', 'gte', since.toISOString()],
    ],
    order: [{ column: 'created_at', ascending: true }, { column: 'id', ascending: true }],
    limit,
  });
}

/** True when a won quote of the RFQ exists (the order came from the quote Workflow). */
export async function hasWonQuote(db: Db, rfqId: string): Promise<boolean> {
  const rows = await db.select('quote_workflows', { columns: 'id', filters: [['rfq_id', 'eq', rfqId], ['status', 'eq', 'won']], limit: 1 });
  return rows.length > 0;
}

export interface CadOutputRow {
  id: string;
  rfq_file_id: string | null;
  job_type: string;
  output_r2_keys: string[];
}

/** Succeeded CAD jobs of an RFQ with their output keys. */
export async function cadOutputsOf(db: Db, rfqId: string): Promise<CadOutputRow[]> {
  const rows = await db.select<CadOutputRow & Record<string, unknown>>('cad_jobs', {
    columns: 'id,rfq_file_id,job_type,output_r2_keys',
    filters: [
      ['rfq_id', 'eq', rfqId],
      ['status', 'eq', 'succeeded'],
    ],
    order: [{ column: 'created_at', ascending: true }],
    limit: 500,
  });
  return rows.map((r) => ({ ...r, output_r2_keys: Array.isArray(r.output_r2_keys) ? r.output_r2_keys.filter((k): k is string => typeof k === 'string') : [] }));
}

/** Partner-link keys of the CAD outputs of a file (drawing PDF and flat DXF). */
export function partnerKeysOf(jobs: readonly CadOutputRow[], rfqFileId: string | null): string[] {
  if (!rfqFileId) return [];
  const out: string[] = [];
  for (const j of jobs) {
    if (j.rfq_file_id !== rfqFileId) continue;
    for (const k of j.output_r2_keys) if (/^cad\/[0-9a-f-]{36}\/output\/(drawing\.pdf|flat\.dxf)$/.test(k) && !out.includes(k)) out.push(k);
  }
  return out;
}
