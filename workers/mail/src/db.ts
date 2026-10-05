// M4 insert-row: one inbound_emails row per (tenant_id, message_id_sha256) through PostgREST with the service role:
// POST /rest/v1/inbound_emails?on_conflict=tenant_id,message_id_sha256 with
// Prefer: resolution=ignore-duplicates,return=representation. An empty answer means the row exists (a redelivery):
// the handler stops there.
//
// Rules
//   - Fields come from the headers and the envelope only; the body is never read here.
//   - Network errors, 408, 429 and 5xx are retried twice (200 ms, 800 ms); any other answer is final.
//   - Errors carry the HTTP status and the PostgREST code only, never a body or a value.

import type { AuthResults } from '../../ops/src/mail-in/auth-results';
import type { Mailbox } from './headers';
import { realSleep, type Sleep } from './store';

export const INSERT_DELAYS_MS = [200, 800] as const;

export interface InboundEmailInsert {
  tenant_id: string;
  message_id: string;
  message_id_sha256: string;
  mailbox: Mailbox;
  source: 'email_routing';
  from_email: string;
  from_name: string | null;
  to_email: string;
  subject: string | null;
  in_reply_to: string | null;
  references_ids: string[];
  received_at: string;
  raw_r2_key: string;
  raw_size_bytes: number;
  auth_results: AuthResults;
  status: 'received';
}

export class InsertError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`inbound_emails insert failed: ${status}${code ? ` ${code}` : ''}`);
    this.name = 'InsertError';
  }
}

function retryable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export async function insertInboundEmail(
  o: { supabaseUrl: string; serviceRoleKey: string; row: InboundEmailInsert },
  fetchImpl: typeof fetch = fetch,
  sleep: Sleep = realSleep,
): Promise<{ status: 'inserted'; id: string } | { status: 'duplicate' }> {
  const url = `${o.supabaseUrl.replace(/\/+$/, '')}/rest/v1/inbound_emails?on_conflict=tenant_id,message_id_sha256&select=id`;
  let last: InsertError = new InsertError(0, null);
  for (let attempt = 0; attempt <= INSERT_DELAYS_MS.length; attempt++) {
    let status = 0;
    let code: string | null = null;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          apikey: o.serviceRoleKey,
          authorization: `Bearer ${o.serviceRoleKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          prefer: 'resolution=ignore-duplicates,return=representation',
        },
        body: JSON.stringify(o.row),
      });
      status = res.status;
      const text = await res.text();
      if (res.ok) {
        const rows = text ? (JSON.parse(text) as Array<{ id?: unknown }>) : [];
        const id = Array.isArray(rows) ? rows[0]?.id : undefined;
        return typeof id === 'string' ? { status: 'inserted', id } : { status: 'duplicate' };
      }
      try {
        const parsed = JSON.parse(text) as { code?: unknown };
        if (typeof parsed.code === 'string') code = parsed.code;
      } catch {
        // not JSON: the status alone is reported
      }
    } catch {
      status = 0;
    }
    last = new InsertError(status, code);
    if (!retryable(status)) break;
    if (attempt < INSERT_DELAYS_MS.length) await sleep(INSERT_DELAYS_MS[attempt]);
  }
  throw last;
}
