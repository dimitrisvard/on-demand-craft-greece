// Message ids, reply headers and idempotency keys of outbound agent mail.
//
//   quote Message-ID     '<q.<quote_workflow_id>.<k>@<MESSAGE_ID_DOMAIN>>', k = 0 for the quote, 1-2 for follow-ups
//   Idempotency-Key      'quote/<qwid>/send', 'quote/<qwid>/fu<k>', 'order/<order_id>/handoff'
//   follow-up headers    In-Reply-To = the first quote's Message-ID; References = every stored id of the thread
// Rules
//   - Message ids are stored and compared trimmed, case kept, with their angle brackets (reply attribution compares
//     them that way); an id read back from the provider without brackets gets them added.
//   - References carries at most MAX_REFERENCES ids (the oldest first is kept, then the newest).

import { outboundMessageId } from '../agents/ids';

export const MAX_REFERENCES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Our Message-ID of quote mail k of a quote workflow. */
export function quoteMessageId(quoteWorkflowId: string, k: number, domain: string): string {
  return outboundMessageId(quoteWorkflowId, k, domain);
}

/** A message id as stored: trimmed, with angle brackets; null for an empty or malformed value. */
export function withBrackets(id: string | null | undefined): string | null {
  const v = String(id ?? '').trim();
  if (!v || /[\s<>]/.test(v.replace(/^<|>$/g, ''))) return null;
  return v.startsWith('<') && v.endsWith('>') ? v : `<${v.replace(/^<|>$/g, '')}>`;
}

export function quoteIdempotencyKey(quoteWorkflowId: string, kind: 'send' | 1 | 2): string {
  if (!UUID.test(quoteWorkflowId)) throw new Error('quoteIdempotencyKey: quote workflow id must be a uuid');
  return kind === 'send' ? `quote/${quoteWorkflowId}/send` : `quote/${quoteWorkflowId}/fu${kind}`;
}

export function handoffIdempotencyKey(orderId: string): string {
  if (!UUID.test(orderId)) throw new Error('handoffIdempotencyKey: order id must be a uuid');
  return `order/${orderId}/handoff`;
}

/** In-Reply-To and References of a reply in a thread whose first mail is `first` (ids of the thread in order). */
export function replyHeaders(first: string, thread: readonly string[]): { 'In-Reply-To': string; References: string } {
  const ids: string[] = [];
  for (const id of [first, ...thread]) {
    const v = withBrackets(id);
    if (v && !ids.includes(v)) ids.push(v);
  }
  const kept = ids.length > MAX_REFERENCES ? [ids[0], ...ids.slice(ids.length - (MAX_REFERENCES - 1))] : ids;
  return { 'In-Reply-To': withBrackets(first) ?? first, References: kept.join(' ') };
}
