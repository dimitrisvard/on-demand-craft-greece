// Reply attribution: which RFQ and quote an inbound reply belongs to.
//
//   1 In-Reply-To equals a stored outbound Message-ID (quote_workflows.outbound_message_ids)   confidence 1
//   2 a References id equals a stored outbound id or a known inbound_emails.message_id          confidence 1
//   3 the subject names an existing RFQ number (RFQ-<8 digits>-<n>)                              confidence 0.8
//   4 the sender is the contact of open quotes (at most 3 candidates, card "Which RFQ?")         confidence 0.5
//   5 none
// Message ids are compared trimmed, case-sensitively, with their angle brackets. The intake step thread-check uses
// rules 1-3 only.

import type { Db } from '../db/postgrest';

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

export async function matchReply(
  db: Db,
  h: ReplyHeaders,
  o: { tenant_id: string; rules?: ReadonlyArray<1 | 2 | 3 | 4> },
): Promise<ReplyMatch> {
  throw new Error('not implemented: RP');
}

/** Trimmed, brackets and case kept. */
export function normaliseMessageId(id: string): string {
  throw new Error('not implemented: RP');
}
