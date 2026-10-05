// Messages of the queue "scrapes" (long scans run by the consumer instead of the request) and, from Phase 4, of
// the queues "cad-jobs" and "agent-events" and the directory-scan envelope on "scrapes".
//
// Rules
//   - One message is one scan: {v: 1, kind, params, run_id, enqueued_at, requested_by}, sent as JSON.
//   - A message body stays under the Queues limit of 128 KB (1 KB = 1,000 bytes, about 100 bytes of it are queue
//     metadata); a larger one is refused before it is sent.
//   - `requested_by` names the principal class (and machine name), never a user's e-mail address.

import { logLine } from '../../../shared/src/http/log';
import type { CardKind } from '../../../shared/src/agent-api';
import type { CardV1 } from '../agents/cards/index';
import { LOG_PREFIX, type OpsEnv } from '../env';

export interface ScrapeMessage {
  v: 1;
  kind: 'tender-scan' | 'funded-scan';
  params: Record<string, unknown>;
  run_id: string;
  enqueued_at: string;
  requested_by: string;
}

/** Largest JSON body of one message, in bytes. */
export const MAX_MESSAGE_BYTES = 127_900;

/** Sends one message and returns its run_id. */
export async function enqueueScrape(
  env: OpsEnv,
  kind: ScrapeMessage['kind'],
  params: Record<string, unknown>,
  requestedBy: string,
): Promise<string> {
  const message: ScrapeMessage = {
    v: 1,
    kind,
    params,
    run_id: crypto.randomUUID(),
    enqueued_at: new Date().toISOString(),
    requested_by: requestedBy,
  };
  const size = new TextEncoder().encode(JSON.stringify(message)).byteLength;
  if (size > MAX_MESSAGE_BYTES) throw new Error(`scrapes message too large: ${size} bytes`);
  await env.SCRAPES.send(message, { contentType: 'json' });
  logLine(LOG_PREFIX, 'scrapes enqueued', { kind, run_id: message.run_id, requested_by: requestedBy });
  return message.run_id;
}

// ----- Phase 4: agent layer -----
// Rules
//   - Producers write the database row first, then send the message.
//   - Messages carry ids and compact parameters only (no e-mail bodies or addresses) and stay far below 128 KB.
//   - ScrapeMessage above is not changed: Phase 4 kinds on the queue "scrapes" use their own envelope
//     (DirectoryScanMessage), routed in src/index.ts before the Phase 2 consumer.

/** Queue "cad-jobs": one CAD job (cad_jobs row written first). */
export interface CadJobMessageV1 {
  v: 1;
  job_id: string;
  idempotency_key: string;
  job_type: 'analyse' | 'drawing_pdf' | 'flat_dxf' | 'flat_svg';
  tenant_id: string;
  rfq_id: string | null;
  rfq_file_id: string | null;
  quote_workflow_id: string | null;
  input: { store: 'r2'; r2_key: string; sha256: string; content_type: string; size_bytes: number; file_name: string };
  params: {
    material: string;
    thickness_override: number;
    k_factor_override: number;
    drawing_size: 'A3' | 'A4';
    process: 'sheet_metal' | 'cnc' | 'mixed' | 'other';
  };
  backend: 'auto' | 'vps' | 'container' | 'inline';
  deadline_s: number;
  run_id: string;
}

/** A decision on a card of a run without a Workflow instance (a queue consumer's card, e.g. reply_pick), sent by
 *  decide() for the consumer that owns the card; the run is 'running' again (claimed) until that consumer closes it. */
export interface DecisionMessageV1 {
  v: 1;
  type: 'decision';
  run_id: string;
  card_kind: CardKind;
  verb: string;
  actor: string;
  channel: 'dashboard' | 'telegram' | 'mcp';
  note?: string;
  /** reply_pick attach_<n>: the 1-based index into the run's output.candidates. */
  candidate?: number;
}

/** Queue "agent-events": replies, order events, parked-run resumes, cards outside Workflows and decisions on them. */
export type AgentEventV1 =
  | { v: 1; type: 'inbound-reply'; inbound_email_id: string; tenant_id: string }
  | { v: 1; type: 'order-created'; order_id: string; tenant_id: string; source: 'quote' | 'portal' | 'dashboard' }
  | { v: 1; type: 'resume-parked'; run_id: string }
  | { v: 1; type: 'card'; card: CardV1; run_id: string }
  | DecisionMessageV1;

/** Parameters of a background directory scan (at most 10 pages). */
export interface DirectoryScanParams {
  url: string;
  source: 'europages' | 'wlw';
  max_pages: number;
  saved_search_id?: string;
  enrich_profiles: boolean;
}

/** Queue "scrapes", Phase 4 envelope; run_id is the agent_runs id of the scan. */
export interface DirectoryScanMessage {
  v: 1;
  kind: 'directory-scan';
  params: DirectoryScanParams;
  run_id: string;
  enqueued_at: string;
  requested_by: string;
}

/** v === 1 and kind === 'directory-scan' (the envelope check that routes a scrapes message). */
export function isDirectoryScanMessage(body: unknown): body is DirectoryScanMessage {
  if (typeof body !== 'object' || body === null) return false;
  const message = body as { v?: unknown; kind?: unknown };
  return message.v === 1 && message.kind === 'directory-scan';
}
