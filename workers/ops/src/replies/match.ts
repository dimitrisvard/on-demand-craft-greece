// Reply attribution: which RFQ and quote an inbound reply belongs to.
//
//   1 In-Reply-To equals a stored outbound Message-ID (quote_workflows.outbound_message_ids)   confidence 1
//   2 a References id (or the In-Reply-To id) equals a stored outbound id or the message_id of a known inbound
//     e-mail of an RFQ (inbound_emails.message_id)                                               confidence 1
//   3 the subject names an existing RFQ number (RFQ-<8 digits>-<n>)                              confidence 0.8
//   4 the sender is the contact of open quotes (at most 3 candidates, card "Which RFQ?")         confidence 0.5
//   5 none
// Message ids are compared trimmed, case-sensitively, with their angle brackets. The intake step thread-check uses
// rules 1-3 only.
//
// Rules
//   - Every lookup is limited to the tenant of the message.
//   - Rule 1 and 2 look up quote_workflows with one `ov` filter over the ids (GIN index); at most 100 ids are used.
//   - Rule 2 ignores the message's own id, so a stored copy of the same mail never matches itself; stored inbound
//     e-mails that are not attached to an RFQ are skipped.
//   - Rule 3 attaches to the RFQ; the quote is its open quote (status sent, follow_up or counter_offer), if any.
//   - Rule 4 counts only quotes that wait for the customer (status sent or follow_up) whose RFQ contact e-mail equals
//     the sender (exact, case-insensitive); the 3 most recently sent ones are the candidates.
//   - Nothing here logs; the sender address is used only as a filter value.

import type { Db } from '../db/postgrest';
import { findRfqByNumber, RFQ_NUMBER_RE } from '../db/repos/rfqs';

export interface ReplyHeaders {
  message_id: string | null;
  in_reply_to: string | null;
  /** At most 100 ids. */
  references: string[];
  subject: string | null;
  from_email: string | null;
}

export type ReplyMatch =
  | { rule: 1 | 2 | 3; confidence: number; rfq_id: string; quote_workflow_id: string | null }
  | { rule: 4; confidence: number; candidates: Array<{ rfq_id: string; quote_workflow_id: string }> }
  | { rule: 5; confidence: 0 };

/** Ids compared per lookup (the References header is cut to this many). */
export const MAX_MATCH_IDS = 100;
/** Candidates of a rule-4 card (verbs attach_1 … attach_3). */
export const MAX_CANDIDATES = 3;

export const RULE_CONFIDENCE: Readonly<Record<1 | 2 | 3 | 4, number>> = Object.freeze({ 1: 1, 2: 1, 3: 0.8, 4: 0.5 });

/** Quote statuses of rule 4 (the quote waits for the customer's answer). */
export const WAITING_QUOTE_STATUSES = ['sent', 'follow_up'] as const;
/** Quote statuses that count as the open quote of an RFQ matched by rule 3. */
export const OPEN_QUOTE_STATUSES = ['sent', 'follow_up', 'counter_offer'] as const;

/** Trimmed, brackets and case kept; a bare id without brackets gets them, anything malformed becomes ''. */
export function normaliseMessageId(id: string): string {
  const v = String(id ?? '').trim();
  if (!v) return '';
  if (v.startsWith('<') && v.endsWith('>')) {
    const inner = v.slice(1, -1);
    return inner && !/[\s<>]/.test(inner) ? v : '';
  }
  return /[\s<>]/.test(v) ? '' : `<${v}>`;
}

function uniqueIds(ids: ReadonlyArray<string | null | undefined>, exclude: string): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    const id = normaliseMessageId(raw ?? '');
    if (id && id !== exclude && !out.includes(id)) out.push(id);
    if (out.length >= MAX_MATCH_IDS) break;
  }
  return out;
}

interface QuoteRef {
  id: string;
  rfq_id: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

const QUOTE_REF_COLUMNS = 'id,rfq_id,status,sent_at,created_at';

/** The newest quote whose outbound ids overlap the given ids. */
async function quoteByOutboundIds(db: Db, tenantId: string, ids: readonly string[]): Promise<QuoteRef | null> {
  if (ids.length === 0) return null;
  const rows = await db.select<QuoteRef & Record<string, unknown>>('quote_workflows', {
    columns: QUOTE_REF_COLUMNS,
    filters: [
      ['tenant_id', 'eq', tenantId],
      ['outbound_message_ids', 'ov', ids],
    ],
    order: [{ column: 'created_at', ascending: false }],
    limit: 1,
  });
  return rows[0] ?? null;
}

/** The newest stored inbound e-mail of an RFQ whose Message-ID is one of the ids. */
async function inboundByMessageIds(db: Db, tenantId: string, ids: readonly string[]): Promise<{ rfq_id: string; quote_workflow_id: string | null } | null> {
  if (ids.length === 0) return null;
  const rows = await db.select<{ rfq_id: string | null; quote_workflow_id: string | null; created_at: string }>('inbound_emails', {
    columns: 'rfq_id,quote_workflow_id,created_at',
    filters: [
      ['tenant_id', 'eq', tenantId],
      ['message_id', 'in', ids],
    ],
    order: [{ column: 'created_at', ascending: false }],
    limit: MAX_MATCH_IDS,
  });
  const hit = rows.find((r) => typeof r.rfq_id === 'string' && r.rfq_id);
  return hit ? { rfq_id: hit.rfq_id as string, quote_workflow_id: hit.quote_workflow_id ?? null } : null;
}

/** The open quote of an RFQ (newest first), or null. */
async function openQuoteOf(db: Db, tenantId: string, rfqId: string): Promise<string | null> {
  const rows = await db.select<{ id: string }>('quote_workflows', {
    columns: 'id',
    filters: [
      ['tenant_id', 'eq', tenantId],
      ['rfq_id', 'eq', rfqId],
      ['status', 'in', [...OPEN_QUOTE_STATUSES]],
    ],
    order: [{ column: 'quote_version', ascending: false }],
    limit: 1,
  });
  return rows[0]?.id ?? null;
}

/** Waiting quotes whose RFQ contact e-mail is the sender (newest sent first, at most MAX_CANDIDATES). */
async function quotesOfSender(db: Db, tenantId: string, fromEmail: string): Promise<Array<{ rfq_id: string; quote_workflow_id: string }>> {
  const rfqs = await db.select<{ id: string }>('rfqs', {
    columns: 'id',
    filters: [
      ['tenant_id', 'eq', tenantId],
      ['contact_email', 'ilike', fromEmail],
    ],
    limit: 50,
  });
  if (rfqs.length === 0) return [];
  const quotes = await db.select<QuoteRef & Record<string, unknown>>('quote_workflows', {
    columns: QUOTE_REF_COLUMNS,
    filters: [
      ['tenant_id', 'eq', tenantId],
      ['rfq_id', 'in', rfqs.map((r) => r.id)],
      ['status', 'in', [...WAITING_QUOTE_STATUSES]],
    ],
    order: [
      { column: 'sent_at', ascending: false },
      { column: 'created_at', ascending: false },
    ],
    limit: MAX_CANDIDATES,
  });
  return quotes.slice(0, MAX_CANDIDATES).map((q) => ({ rfq_id: q.rfq_id, quote_workflow_id: q.id }));
}

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export async function matchReply(
  db: Db,
  h: ReplyHeaders,
  o: { tenant_id: string; rules?: ReadonlyArray<1 | 2 | 3 | 4> },
): Promise<ReplyMatch> {
  const rules = new Set(o.rules ?? [1, 2, 3, 4]);
  const tenant = o.tenant_id;
  const own = normaliseMessageId(h.message_id ?? '');
  const inReplyTo = normaliseMessageId(h.in_reply_to ?? '');

  // 1 In-Reply-To = a stored outbound id
  if (rules.has(1) && inReplyTo && inReplyTo !== own) {
    const q = await quoteByOutboundIds(db, tenant, [inReplyTo]);
    if (q) return { rule: 1, confidence: RULE_CONFIDENCE[1], rfq_id: q.rfq_id, quote_workflow_id: q.id };
  }

  // 2 any References id (or the In-Reply-To id) = a stored outbound id or a known inbound id of an RFQ
  if (rules.has(2)) {
    const ids = uniqueIds([...(h.references ?? []), h.in_reply_to], own);
    const q = await quoteByOutboundIds(db, tenant, ids);
    if (q) return { rule: 2, confidence: RULE_CONFIDENCE[2], rfq_id: q.rfq_id, quote_workflow_id: q.id };
    const inbound = await inboundByMessageIds(db, tenant, ids);
    if (inbound) {
      const quoteId = inbound.quote_workflow_id ?? (await openQuoteOf(db, tenant, inbound.rfq_id));
      return { rule: 2, confidence: RULE_CONFIDENCE[2], rfq_id: inbound.rfq_id, quote_workflow_id: quoteId };
    }
  }

  // 3 RFQ number in the subject
  if (rules.has(3)) {
    const number = RFQ_NUMBER_RE.exec(h.subject ?? '')?.[0] ?? null;
    if (number) {
      const rfq = await findRfqByNumber(db, tenant, number);
      if (rfq) return { rule: 3, confidence: RULE_CONFIDENCE[3], rfq_id: rfq.id, quote_workflow_id: await openQuoteOf(db, tenant, rfq.id) };
    }
  }

  // 4 the sender is the contact of waiting quotes
  if (rules.has(4)) {
    const from = String(h.from_email ?? '').trim();
    if (ADDRESS.test(from)) {
      const candidates = await quotesOfSender(db, tenant, from);
      if (candidates.length > 0) return { rule: 4, confidence: RULE_CONFIDENCE[4], candidates };
    }
  }

  return { rule: 5, confidence: 0 };
}
