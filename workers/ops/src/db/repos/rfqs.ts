// RFQs created from inbound mail: rpc/create_email_rfq (exactly one RFQ per inbound e-mail; it wraps the web form's
// create_public_rfq, which numbers the RFQ and links or creates the customer), RFQ lookups by id and number, and
// the customer candidates of a sender. Service role through the Db port.

import type { Db } from '../postgrest';

/** = rfqs_source_check */
export type RfqSource = 'web' | 'email' | 'techpilot' | 'manual';

/** A part of rfqs.parts_details in the web form's shape (src/components/quote-form/MultiStepQuoteForm.tsx). */
export interface RfqPart {
  id: string;
  rfq_id: string;
  product_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
  updated_at: string;
  original_values: Record<string, unknown>;
}

/** p_payload of create_email_rfq: the keys create_public_rfq reads. */
export interface EmailRfqPayload {
  company_name: string;
  vat_id?: string;
  address?: string;
  city?: string;
  zip_code?: string;
  country?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_position?: string;
  contact_email?: string;
  contact_phone?: string;
  mobile?: string;
  /** ISO date or timestamp; empty -> now + 7 days (create_public_rfq). */
  due_date?: string;
  description?: string;
  is_order: false;
  parts: RfqPart[];
}

export interface CreatedRfq {
  rfq_id: string;
  rfq_number: string;
  customer_id: string | null;
}

/** rpc/create_email_rfq: the RFQ of this inbound e-mail (created on the first call, returned on every later one). */
export async function createEmailRfq(db: Db, inboundEmailId: string, payload: EmailRfqPayload, source: 'email' | 'techpilot'): Promise<CreatedRfq> {
  const result = await db.rpc<unknown>('create_email_rfq', { p_inbound_email_id: inboundEmailId, p_payload: payload, p_source: source });
  const row = (Array.isArray(result) ? result[0] : result) as Partial<CreatedRfq> | undefined;
  if (!row || typeof row.rfq_id !== 'string' || typeof row.rfq_number !== 'string') throw new Error('create_email_rfq returned no RFQ');
  return { rfq_id: row.rfq_id, rfq_number: row.rfq_number, customer_id: typeof row.customer_id === 'string' ? row.customer_id : null };
}

export interface RfqSummary {
  id: string;
  rfq_number: string | null;
  company_name: string | null;
  country: string | null;
  customer_id: string | null;
  parts_details: RfqPart[] | null;
  tenant_id: string;
}

const RFQ_SUMMARY_COLUMNS = 'id,rfq_number,company_name,country,customer_id,parts_details,tenant_id';

export async function getRfq(db: Db, id: string): Promise<RfqSummary | null> {
  const rows = await db.select<RfqSummary & Record<string, unknown>>('rfqs', { columns: RFQ_SUMMARY_COLUMNS, filters: [['id', 'eq', id]], limit: 1 });
  return rows[0] ?? null;
}

/** RFQ number as written by create_public_rfq: RFQ-<DDMMYYYY>-<n>. */
export const RFQ_NUMBER_RE = /RFQ-\d{8}-\d+/;

export async function findRfqByNumber(db: Db, tenantId: string, rfqNumber: string): Promise<RfqSummary | null> {
  if (!/^RFQ-\d{8}-\d+$/.test(rfqNumber)) return null;
  const rows = await db.select<RfqSummary & Record<string, unknown>>('rfqs', {
    columns: RFQ_SUMMARY_COLUMNS,
    filters: [['rfq_number', 'eq', rfqNumber], ['tenant_id', 'eq', tenantId]],
    limit: 1,
  });
  return rows[0] ?? null;
}

export interface CustomerCandidates {
  /** The customer whose e-mail equals the address (case-insensitive), as create_public_rfq matches it. */
  customer_id: string | null;
  /** Other customers of the same domain or VAT id: suggestions for staff only (at most 3). */
  suggestions: Array<{ id: string; reason: 'same_domain' | 'same_vat' }>;
}

/** Domains of free mail providers, where "same domain" says nothing about the company. */
const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'icloud.com', 'aol.com', 'mail.com', 'proton.me', 'protonmail.com']);

/** Customer match for an RFQ sender: exact e-mail (ilike with %, _ and \ escaped by the Db), then suggestions. */
export async function customerCandidates(db: Db, tenantId: string, email: string | null, vatId: string | null): Promise<CustomerCandidates> {
  const out: CustomerCandidates = { customer_id: null, suggestions: [] };
  const address = email?.trim() ?? '';
  if (address.includes('@')) {
    const exact = await db.select<{ id: string }>('customers', {
      columns: 'id',
      filters: [['email', 'ilike', address], ['tenant_id', 'eq', tenantId]],
      order: [{ column: 'created_at', ascending: true }],
      limit: 1,
    });
    out.customer_id = exact[0]?.id ?? null;
  }
  if (out.customer_id) return out;
  const seen = new Set<string>();
  const domain = address.includes('@') ? address.slice(address.lastIndexOf('@') + 1).toLowerCase() : '';
  if (domain && !FREE_MAIL_DOMAINS.has(domain) && /^[a-z0-9.-]+$/.test(domain)) {
    // The Db matches ilike literally (no wildcard), so the domain is compared on the most recent customers here.
    const rows = await db.select<{ id: string; email: string | null }>('customers', {
      columns: 'id,email',
      filters: [['tenant_id', 'eq', tenantId]],
      order: [{ column: 'created_at', ascending: false }],
      limit: 500,
    });
    for (const r of rows) {
      if (typeof r.email === 'string' && r.email.toLowerCase().endsWith(`@${domain}`) && !seen.has(r.id) && out.suggestions.length < 3) {
        seen.add(r.id);
        out.suggestions.push({ id: r.id, reason: 'same_domain' });
      }
    }
  }
  const vat = vatId?.replace(/\s+/g, '').toUpperCase() ?? '';
  if (/^[A-Z]{2}[A-Z0-9]{2,14}$/.test(vat) && out.suggestions.length < 3) {
    const rows = await db.select<{ id: string }>('customers', { columns: 'id', filters: [['vat_tax_id', 'eq', vat], ['tenant_id', 'eq', tenantId]], limit: 3 });
    for (const r of rows) {
      if (!seen.has(r.id) && out.suggestions.length < 3) {
        seen.add(r.id);
        out.suggestions.push({ id: r.id, reason: 'same_vat' });
      }
    }
  }
  return out;
}
