// public.inbound_emails reads and writes of microns-ops through the Db port (service role). microns-mail inserts the
// rows (workers/mail/src/db.ts); ops reads them by id and moves them through the status vocabulary below.
// Column names and CHECK lists follow the agent-layer migration (a T1 test compares the unions with its CHECK lists).
// updated_at is maintained by the table's trigger.

import type { Db } from '../postgrest';
import type { AttachmentRecord } from '../../mail-in/attachments';
import type { AuthResults } from '../../mail-in/auth-results';

/** = inbound_emails_status_check */
export type InboundStatus = 'received' | 'parsed' | 'needs_review' | 'rfq_created' | 'attached' | 'matched' | 'rejected' | 'duplicate' | 'spam' | 'failed';
/** = inbound_emails_mailbox_check */
export type InboundMailbox = 'rfq' | 'replies' | 'gmail';
/** = inbound_emails_source_check */
export type InboundSource = 'email_routing' | 'gmail_poller';
/** = inbound_emails_kind_check */
export type InboundKind = 'rfq' | 'techpilot' | 'reply' | 'auto_reply' | 'spam' | 'other';

export interface InboundEmailRow {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  message_id: string;
  message_id_sha256: string;
  mailbox: InboundMailbox;
  source: InboundSource;
  sender_account_id: string | null;
  in_reply_to: string | null;
  references_ids: string[];
  from_email: string;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  received_at: string;
  raw_r2_key: string | null;
  raw_size_bytes: number | null;
  body_excerpt: string | null;
  attachments: AttachmentRecord[];
  auth_results: AuthResults | null;
  kind: InboundKind | null;
  status: InboundStatus;
  parsed: Record<string, unknown> | null;
  /** numeric(4,3); PostgREST may answer it as a string. */
  parse_confidence: number | string | null;
  classification: Record<string, unknown> | null;
  rfq_id: string | null;
  customer_id: string | null;
  quote_workflow_id: string | null;
  agent_run_id: string | null;
  error: string | null;
}

/** Columns ops may change (never the identity, the headers or the R2 key microns-mail wrote). */
export type InboundEmailPatch = Partial<
  Pick<
    InboundEmailRow,
    | 'body_excerpt'
    | 'attachments'
    | 'kind'
    | 'status'
    | 'parsed'
    | 'parse_confidence'
    | 'classification'
    | 'rfq_id'
    | 'customer_id'
    | 'quote_workflow_id'
    | 'agent_run_id'
    | 'error'
  >
>;

export const BODY_EXCERPT_MAX = 4000;

/**
 * body_excerpt as stored: at most BODY_EXCERPT_MAX characters (inbound_emails_excerpt_check), without NUL characters
 * and with every unpaired surrogate (e.g. half of an emoji cut at the limit) replaced by U+FFFD, since a Postgres
 * text value can hold neither.
 */
export function bodyExcerpt(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .slice(0, BODY_EXCERPT_MAX)
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function getInboundEmail(db: Db, id: string): Promise<InboundEmailRow | null> {
  if (!UUID.test(id)) return null;
  const rows = await db.select<InboundEmailRow & Record<string, unknown>>('inbound_emails', { filters: [['id', 'eq', id]], limit: 1 });
  return rows[0] ?? null;
}

/** One PATCH by id; `onlyIf` limits it to rows in one of the given statuses (returns false when none matched). */
export async function updateInboundEmail(db: Db, id: string, patch: InboundEmailPatch, onlyIf?: readonly InboundStatus[]): Promise<boolean> {
  const update: Record<string, unknown> = { ...patch };
  if (typeof update.body_excerpt === 'string') update.body_excerpt = bodyExcerpt(update.body_excerpt as string);
  if (typeof update.error === 'string') update.error = (update.error as string).slice(0, 500);
  const filters: [readonly ['id', 'eq', string], ...Array<readonly ['status', 'in', readonly string[]]>] = [['id', 'eq', id]];
  if (onlyIf?.length) filters.push(['status', 'in', onlyIf]);
  const rows = await db.update('inbound_emails', update, { filters, returning: 'id' });
  return rows.length > 0;
}

/** Ids of rows whose message_id is one of `messageIds` (thread lookups). */
export async function inboundIdsByMessageIds(db: Db, tenantId: string, messageIds: readonly string[]): Promise<Array<{ id: string; rfq_id: string | null }>> {
  if (messageIds.length === 0) return [];
  return db.select<{ id: string; rfq_id: string | null }>('inbound_emails', {
    columns: 'id,rfq_id',
    filters: [
      ['tenant_id', 'eq', tenantId],
      ['message_id', 'in', messageIds.slice(0, 100)],
    ],
    limit: 100,
  });
}
