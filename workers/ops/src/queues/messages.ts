// Messages of the queue "scrapes" (long scans run by the consumer instead of the request) and, from Phase 4, of
// the queues "cad-jobs" and "agent-events" and the directory-scan envelope on "scrapes"; from Phase 5, of the
// queues "translations" and "outbound-mail" and the Phase 5 envelope on "scrapes".
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

// ----- Phase 5: consolidated compute -----
// Rules
//   - Queue "translations": one message per (English article, language); the consumer reads the article itself.
//   - Queue "outbound-mail": one message per campaign recipient (or follow-up); the consumer reads the campaign,
//     subscriber and sender rows itself, so no address or body travels in a message.
//   - ScrapeMessage above is not changed: the Phase 5 scheduled collectors use their own envelope P5ScrapeMessage on
//     the queue "scrapes", routed in src/index.ts (by kind) to src/queues/scrapes-p5.ts before the Phase 4
//     directory-scan branch and the Phase 2 consumer.

/** Target languages in the order of the live translation job. */
export type TargetLang = 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pt' | 'sv' | 'da' | 'nb' | 'pl' | 'cs' | 'hu' | 'fi';

/** Queue "translations": translate one English article into one language. */
export interface TranslationMessageV1 {
  v: 1;
  translation_id: string;
  en_article_id: string;
  language: TargetLang;
  origin: 'daily' | 'backfill' | 'manual';
  /** content-daily date (YYYY-MM-DD) of the group this message belongs to. */
  for_date: string;
  parent_run_id: string;
}

/** Queue "outbound-mail": one campaign mail or follow-up to one subscriber. */
export interface OutboundMailV1 {
  v: 1;
  kind: 'campaign' | 'followup';
  campaign_id: string;
  subscriber_id: string;
  recipient_record_id: string | null;
  sequence: number;
  /** A/B choice made by the producer. */
  subject: string;
  /** Round-robin assignment; null = the default sender (campaign without sender accounts). */
  preferred_account_id: string | null;
  /** 'camp:<campaign_id>:<subscriber_id>:<sequence>' */
  idem: string;
  /** agent_runs id of marketing.send:<campaign_id> (or its re-queue run). */
  run_id: string;
  /** 0 when produced; +1 on every cap or spacing deferral copy; > 30 is a final failure; pause/stop holds do not count. */
  deferrals: number;
}

/** Kinds of the Phase 5 envelope on the queue "scrapes". */
export const P5_SCRAPE_KINDS = ['reddit-tier', 'hn-scan', 'tender-scheduled', 'xometry-scan'] as const;
export type P5ScrapeKind = (typeof P5_SCRAPE_KINDS)[number];

export interface RedditTierParams {
  tier: 1 | 2 | 3;
  max: 40;
  slot: string;
}
export interface HnScanParams {
  slot: string;
}
export interface TenderScheduledParams {
  country_code: string;
  date: string;
}
export interface XometryScanParams {
  slot: string;
}

/** Queue "scrapes", Phase 5 envelope; run_id is the agent_runs id opened by the dispatcher (the parent run for
 *  tender-scheduled). */
export interface P5ScrapeMessage {
  v: 1;
  kind: P5ScrapeKind;
  params: RedditTierParams | HnScanParams | TenderScheduledParams | XometryScanParams;
  run_id: string;
  enqueued_at: string;
  requested_by: 'schedule' | 'manual';
}

/** v === 1 and kind is one of P5_SCRAPE_KINDS. */
export function isP5ScrapeMessage(body: unknown): body is P5ScrapeMessage {
  if (typeof body !== 'object' || body === null) return false;
  const message = body as { v?: unknown; kind?: unknown };
  return message.v === 1 && typeof message.kind === 'string' && (P5_SCRAPE_KINDS as readonly string[]).includes(message.kind);
}
