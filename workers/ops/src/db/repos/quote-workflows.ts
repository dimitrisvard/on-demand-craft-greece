// public.quote_workflows (agent-layer migration) through the Db port, plus the RFQ writes of the quote Workflow
// (approved prices and the 'sent' status on rfqs).
//
// Rules
//   - One row per (rfq_id, quote_version); workflow_instance_id = 'quote-<rfq_id>-v<n>'. The row is created with
//     on_conflict=rfq_id,quote_version and ignore-duplicates and read back, so a replayed step finds the same row.
//   - At most one active row per RFQ (partial unique index): a revision cancels the active row of the RFQ before its
//     own row is inserted.
//   - Status values are the CHECK list of the migration; status changes name the statuses they may leave (a
//     conditional PATCH), so a late step never overwrites a decision taken elsewhere (e.g. a dashboard reject).
//   - outbound_message_ids and resend_email_ids only grow (deduplicated, trimmed ids with their angle brackets).
//   - Approved prices go back to rfqs.parts_details (unit_price, total_price of each part, matched by part id),
//     rfqs.total_amount (sum of the part totals, as the dashboard writes it, src/pages/RfqDetails.tsx:1436-1444) and
//     rfqs.shipping_cost, so the portal's Accept Quote and create_order_from_quote see the approved quote.

import type { Db } from '../postgrest';
import type { PricingV1 } from '../../pricing/types';
import { SURCHARGE_SOURCE, type PartRow } from '../../pricing/lines';
import { round2 } from '../../pricing/calc';

/** = quote_workflows_status_check */
export type QuoteStatus =
  | 'started'
  | 'cad_pending'
  | 'pricing'
  | 'awaiting_approval'
  | 'approved'
  | 'sent'
  | 'follow_up'
  | 'won'
  | 'lost'
  | 'counter_offer'
  | 'expired'
  | 'rejected'
  | 'failed'
  | 'cancelled';

/** Statuses outside the one-active-per-RFQ index (quote_workflows_one_active_idx). */
export const QUOTE_FINAL_STATUSES: readonly QuoteStatus[] = ['won', 'lost', 'expired', 'rejected', 'failed', 'cancelled'];

export const QUOTE_ACTIVE_STATUSES: readonly QuoteStatus[] = ['started', 'cad_pending', 'pricing', 'awaiting_approval', 'approved', 'sent', 'follow_up', 'counter_offer'];

export interface QuoteWorkflowRow {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  rfq_id: string;
  quote_version: number;
  workflow_instance_id: string;
  status: QuoteStatus;
  current_step: string | null;
  process: 'cnc' | 'sheet_metal' | 'mixed' | 'other' | null;
  pricing: PricingV1 | null;
  total_amount: number | string | null;
  currency: string;
  quote_pdf_r2_key: string | null;
  pdf_sha256: string | null;
  drafts: Record<string, unknown> | null;
  outbound_message_ids: string[];
  resend_email_ids: string[];
  approved_by: string | null;
  approved_via: 'telegram' | 'dashboard' | 'mcp' | null;
  approved_at: string | null;
  sent_at: string | null;
  follow_ups_sent: number;
  outcome_reason: string | null;
  last_event_at: string | null;
  error: string | null;
}

export type QuoteWorkflowPatch = Partial<
  Pick<
    QuoteWorkflowRow,
    | 'status'
    | 'current_step'
    | 'process'
    | 'pricing'
    | 'total_amount'
    | 'quote_pdf_r2_key'
    | 'pdf_sha256'
    | 'drafts'
    | 'outbound_message_ids'
    | 'resend_email_ids'
    | 'approved_by'
    | 'approved_via'
    | 'approved_at'
    | 'sent_at'
    | 'follow_ups_sent'
    | 'outcome_reason'
    | 'last_event_at'
    | 'error'
  >
>;

export function quotePdfKey(rfqId: string, version: number): string {
  return `quotes/${rfqId}/v${version}/quote.pdf`;
}

export async function getQuoteWorkflow(db: Db, id: string): Promise<QuoteWorkflowRow | null> {
  const rows = await db.select<QuoteWorkflowRow & Record<string, unknown>>('quote_workflows', { filters: [['id', 'eq', id]], limit: 1 });
  return rows[0] ?? null;
}

export async function getQuoteByVersion(db: Db, rfqId: string, version: number): Promise<QuoteWorkflowRow | null> {
  const rows = await db.select<QuoteWorkflowRow & Record<string, unknown>>('quote_workflows', {
    filters: [['rfq_id', 'eq', rfqId], ['quote_version', 'eq', version]],
    limit: 1,
  });
  return rows[0] ?? null;
}

/** Active rows of an RFQ other than the given version (at most one exists). */
export async function activeQuotesOf(db: Db, rfqId: string, exceptVersion: number): Promise<QuoteWorkflowRow[]> {
  const rows = await db.select<QuoteWorkflowRow & Record<string, unknown>>('quote_workflows', {
    filters: [['rfq_id', 'eq', rfqId], ['status', 'in', [...QUOTE_ACTIVE_STATUSES]]],
    order: [{ column: 'quote_version', ascending: true }],
    limit: 20,
  });
  return rows.filter((r) => r.quote_version !== exceptVersion);
}

/** The row of this version (inserted on the first call, read back on every later one). */
export async function ensureQuoteWorkflow(db: Db, q: { tenant_id: string; rfq_id: string; quote_version: number; workflow_instance_id: string }): Promise<QuoteWorkflowRow> {
  await db.insert(
    'quote_workflows',
    { tenant_id: q.tenant_id, rfq_id: q.rfq_id, quote_version: q.quote_version, workflow_instance_id: q.workflow_instance_id, status: 'started' },
    { onConflict: ['rfq_id', 'quote_version'], ignoreDuplicates: true },
  );
  const row = await getQuoteByVersion(db, q.rfq_id, q.quote_version);
  if (!row) throw new Error('quote_workflows row neither inserted nor found');
  return row;
}

/** PATCH of one row; with onlyIf, only while its status is one of them. Returns whether a row changed. */
export async function patchQuoteWorkflow(db: Db, id: string, patch: QuoteWorkflowPatch, onlyIf?: readonly QuoteStatus[]): Promise<boolean> {
  const filters = onlyIf?.length ? ([['id', 'eq', id], ['status', 'in', [...onlyIf]]] as const) : ([['id', 'eq', id]] as const);
  const rows = await db.update('quote_workflows', patch as Record<string, unknown>, { filters, returning: 'id' });
  return rows.length > 0;
}

/** Trimmed, deduplicated message ids in order. */
export function mergeIds(existing: readonly string[], added: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const id of [...existing, ...added]) {
    const v = typeof id === 'string' ? id.trim() : '';
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Adds outbound message ids and Resend ids to the row (read, merge, write). */
export async function recordOutbound(db: Db, id: string, add: { message_ids: ReadonlyArray<string | null>; resend_ids: ReadonlyArray<string | null> }, extra: QuoteWorkflowPatch = {}): Promise<string[]> {
  const row = await getQuoteWorkflow(db, id);
  if (!row) throw new Error('quote_workflows row missing');
  const outbound_message_ids = mergeIds(row.outbound_message_ids ?? [], add.message_ids);
  const resend_email_ids = mergeIds(row.resend_email_ids ?? [], add.resend_ids);
  await patchQuoteWorkflow(db, id, { ...extra, outbound_message_ids, resend_email_ids });
  return outbound_message_ids;
}

/**
 * parts_details with the approved prices: each priced line sets unit_price and total_price of its part (by id);
 * a minimum-order surcharge becomes one extra part marked original_values.source = 'quote_surcharge' (replaced, not
 * added again, on a later write), so order items created from the RFQ carry the same total as the quote.
 */
export function pricedParts(parts: readonly PartRow[], pricing: PricingV1, surchargeId: string, at: Date): PartRow[] {
  const byPart = new Map(pricing.lines.filter((l) => l.part_id).map((l) => [l.part_id as string, l]));
  const now = at.toISOString();
  const out: PartRow[] = parts
    .filter((p) => (p.original_values ?? {})['source'] !== SURCHARGE_SOURCE)
    .map((p) => {
      const line = p.id ? byPart.get(String(p.id)) : undefined;
      if (!line || line.unit_price === null || line.line_total === null) return { ...p };
      return { ...p, unit_price: line.unit_price, total_price: line.line_total };
    });
  if (pricing.min_order_surcharge !== null && pricing.min_order_surcharge > 0) {
    out.push({
      id: surchargeId,
      rfq_id: parts[0]?.['rfq_id'] ?? '',
      product_name: 'Minimum order surcharge',
      description: 'Minimum order value',
      quantity: 1,
      unit_price: pricing.min_order_surcharge,
      total_price: pricing.min_order_surcharge,
      created_at: now,
      updated_at: now,
      original_values: { source: SURCHARGE_SOURCE },
    });
  }
  return out;
}

/** rfqs.parts_details, total_amount and shipping_cost from an approved, complete pricing. */
export async function writeApprovedPrices(db: Db, rfqId: string, parts: readonly PartRow[], pricing: PricingV1, surchargeId: string, at: Date): Promise<void> {
  if (!pricing.complete || pricing.shipping === null) throw new Error('writeApprovedPrices: pricing is not complete');
  const parts_details = pricedParts(parts, pricing, surchargeId, at);
  const total_amount = round2(parts_details.reduce((s, p) => s + (typeof p.total_price === 'number' ? p.total_price : Number(p.total_price ?? 0) || 0), 0));
  await db.update('rfqs', { parts_details, total_amount, shipping_cost: pricing.shipping }, { filters: [['id', 'eq', rfqId]] });
}

/** rfqs.status (existing values draft, sent, received, approved). */
export async function setRfqStatus(db: Db, rfqId: string, status: 'sent'): Promise<void> {
  await db.update('rfqs', { status }, { filters: [['id', 'eq', rfqId]] });
}
