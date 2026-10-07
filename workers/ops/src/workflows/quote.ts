// QuoteWorkflow ('quote'): one instance per RFQ and quote version (id 'quote-<rfq_id>-v<n>'): CAD results, price
// draft, notes and cover e-mail, PDF, human approval, send, follow-ups and the customer's reply (won -> order).
//
//   open-run            agent_runs row (agent quote, key '<rfq_id>:v<n>'); a final run exits; prompts pinned
//   daily-cap           above value.max_runs_per_day: run 'skipped' (daily_cap), no LLM call
//   flag-start          agent.quote off -> run parked (flag_off) until 'agent-resumed' (7 days, then cancelled)
//   supersede           version > 1: the active quote of the RFQ is cancelled and its instance terminated
//   load                quote_workflows row (on_conflict rfq_id,quote_version); RFQ parts and files (no address)
//   ensure-cad          'analyse' jobs for R2-stored CAD files that have none; RfqThread.expectCadJobs/bindQuote
//   await-cad           waitForEvent('cad-done', 2 hours); on timeout the lines without geometry are priced by hand
//   drawings            'drawing_pdf' jobs for sheet-metal STEP parts (not awaited); agent.quote re-read first,
//                       because the CAD wait can last 2 hours
//   lines               quote lines from parts, files and CAD results (pricing/lines.ts)
//   similar-quotes      bge-m3 embedding of each line + Vectorize quotes-v1 query (top 5, same process and family)
//   price               pricing_rules + catalog_materials -> PricingV1 (pricing/calc.ts); stored on the row
//   price-notes         quote.price_notes@v1 (staff-only review; suggestions are never applied)
//   cover-email         quote.cover_email@v1 (cover text and two follow-ups, no prices); stored in drafts
//   draft-pdf           offer PDF -> R2 quotes/<rfq_id>/v<n>/quote.pdf, pdf_sha256, status awaiting_approval
//   flag-approval       shadow mode: notice card only, quote cancelled ('shadow'), nothing is sent
//   request-approval    approval card (approve / reject; edits on the dashboard travel with 'approve')
//   wait-quote-approved 7 days, reminder, 7 days; then status expired. Reject: decide() terminates the instance
//   apply-edits         approved overrides and shipping repriced on the draft's own rule basis; PDF re-rendered;
//                       approved_by / approved_via / approved_at. A quote still missing prices gets another
//                       approval round (at most 3, then cancelled 'pricing_incomplete')
//   write-rfq           approved prices back to rfqs.parts_details, total_amount, shipping_cost (flag gate first)
//   send                Resend with Idempotency-Key quote/<qwid>/send, our Message-ID, Reply-To (flag gate first)
//   record-send         provider message id read back; outbound ids, sent_at, status sent; rfqs.status 'sent';
//                       RfqThread.registerOutbound
//   index-quote         one vector per line (outcome 'open'); the quote's run closes 'succeeded'
//   follow-ups          waits for 'customer-reply' (value.follow_up_days, default 3, 4, 7 days); follow-up 1 and 2
//                       in the same thread (Idempotency-Key quote/<qwid>/fu<k>); after the last wait: expired.
//                       Before each follow-up and before the expiry the RFQ is read again: an order for the RFQ, or
//                       rfqs.status 'approved' (the portal's Accept Quote, the dashboard), ends the quote 'won'
//                       (reason rfq_approved) with that order; nothing more is sent and no second order is created
//   reply-<n>           reply-check (thread, sender, contact), then quote.classify_reply@v1. Applied without asking:
//                       'lost' at confidence >= 0.8 when the reply answers one of this quote's own Message-IDs
//                       (In-Reply-To or References), its sender passed DMARC (trusted Authentication-Results, header
//                       From aligned) and From is the RFQ contact; 'question' / 'other' at >= 0.8 get a notice;
//                       'auto_reply' is ignored. Everything else waits for a human on a reply card (won / lost /
//                       counter / ignore): every 'won' (an order is created only after a person chose it), every
//                       counter-offer, low confidence, a failed check (flag dmarc_fail when the sender is not
//                       authenticated) and a reply whose text carries a delimiter of the model's data blocks
//                       (flag injection_suspected)
//   outcome             won: order-<tag> (rpc/create_order_from_quote, its own step, so a retried event send never
//                       calls it again), then agent-events 'order-created'; won / lost / counter_offer / expired:
//                       row status, Vectorize outcome update
// Runs: the quote run covers draft to send; each follow-up, reply and the final expiry has its own short run
// (keys '<rfq_id>:v<n>:fu<k>', ':reply:<inbound_email_id>', ':expire'), so no run stays 'running' while the
// Workflow waits days for the customer. Every step runs inside one try/catch: a step that throws ends in step
// 'fail-run', which puts the run the step belongs to behind a failure card (Retry restarts the instance from that
// step) and marks the quote 'failed'; a step that opens a phase run belongs to that phase run, so the closed quote
// run is never reopened. When a retried run goes back to waiting for the customer, the quote returns from 'failed'
// to 'sent' / 'follow_up'. The wait times are computed from the clock reading of the step before each wait.
// LLM steps park the run as 'budget' (gateway 429) or 'llm_unavailable' (retries used up).
// Flag: every side-effecting step re-reads agent.quote first and parks its run while the flag is off (flag-<step>):
// before CAD jobs, drawings, each model call, the PDF, the approval, write-rfq, each send and each outcome.
// Model input: untrusted text (reply, RFQ notes) only inside its delimited block with tag-like sequences
// neutralised; JSON blocks escape '<', so no value can close or open a block.
// Step results carry ids, numbers and short business fields only: e-mail texts and addresses are read by the step
// that needs them (recipient, buyer block, reply text) and never returned. Nothing here logs an address or a token.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig, type WorkflowTimeoutDuration } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { formatLogLine } from '../../../shared/src/http/log';
import { isWaitTimeout, request, waitWithReminder } from '../agents/approval';
import { quoteCard, quoteNotice, quoteReplyCard, REPLY_VERB_OUTCOME, type QuoteCardInput } from '../agents/cards/quote';
import { maskEmail, type CardV1 } from '../agents/cards/index';
import { isConfigMissing, need } from '../agents/config';
import type { DecisionEventPayload } from '../agents/decision';
import { readFlag, type AgentFlag } from '../agents/flags';
import { quoteInstanceId } from '../agents/ids';
import { loadPrompt, registerPromptSource, selectPrompt, type PromptId } from '../agents/prompts/registry';
import { addUsage, applyDailyCap, checkpointRun, closeRun, EMPTY_USAGE, failRun, isFinal, openRun, parkRun, type OpenRun, type UsageAcc } from '../agents/runs';
import { cadKindOf, isFinalCadStatus } from '../cad/types';
import { DbError, type Db } from '../db/postgrest';
import { cadJobsOf, enqueueCadJob, type CadJobRow } from '../db/repos/cad-jobs';
import { loadCatalog } from '../db/repos/catalog';
import { loadActiveRules } from '../db/repos/pricing';
import {
  activeQuotesOf,
  ensureQuoteWorkflow,
  getQuoteWorkflow,
  patchQuoteWorkflow,
  quotePdfKey,
  QUOTE_ACTIVE_STATUSES,
  recordOutbound,
  setRfqStatus,
  writeApprovedPrices,
  type QuoteStatus,
} from '../db/repos/quote-workflows';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { dmarcPass, type AuthResults } from '../mail-in/auth-results';
import { parseMime } from '../mail-in/parse';
import { stripQuoted } from '../mail-in/quote-strip';
import { uuidV5 } from '../mail-in/safe-name';
import { Sha256 } from '../mail-in/sha256';
import { quoteIdempotencyKey, quoteMessageId, replyHeaders, withBrackets } from '../mail-out/mime-ids';
import { cleanSubject, offerFileName, quoteMail } from '../mail-out/templates';
import { bytesToBase64 } from '../pdf/trim';
import { DEFAULT_CONDITIONS, offerNumber, pdfLines, renderQuotePdf, VALIDITY_DAYS, isoDate } from '../pdf/quote-pdf';
import { calculateQuote, reprice } from '../pricing/calc';
import { analysableFiles, buildLines, lineEmbeddingText, partProcess, type FileRow, type JobRow, type PartRow } from '../pricing/lines';
import { recogniseMaterial, unfoldMaterial } from '../pricing/materials';
import { rulesVersion } from '../pricing/rules';
import type { LineInput, PriceNotes, PricingV1, QuoteProcess, SimilarLine } from '../pricing/types';
import { makePorts, type JsonSchemaObject, type LlmContent, type LlmUsage, type Ports, type QuoteVectorMeta } from '../ports/index';
import type { AgentEventV1 } from '../queues/messages';
import { normaliseMessageId } from '../replies/match';
import { DB, EMBED, LLM_CLASSIFY, LLM_EXTRACT, NOTIFY, PDF, SEND } from './steps';
import notesPrompt from '../agents/prompts/quote/price_notes.v1.md';
import notesSchema from '../agents/prompts/quote/price_notes.v1.schema.json';
import coverPrompt from '../agents/prompts/quote/cover_email.v1.md';
import coverSchema from '../agents/prompts/quote/cover_email.v1.schema.json';
import replyPrompt from '../agents/prompts/quote/classify_reply.v1.md';
import replySchema from '../agents/prompts/quote/classify_reply.v1.schema.json';

registerPromptSource('quote.price_notes@v1', notesPrompt, notesSchema as Record<string, unknown>);
registerPromptSource('quote.cover_email@v1', coverPrompt, coverSchema as Record<string, unknown>);
registerPromptSource('quote.classify_reply@v1', replyPrompt, replySchema as Record<string, unknown>);

export interface QuoteParams {
  v: 1;
  rfq_id: string;
  quote_version: number;
  tenant_id: string;
  trigger: 'intake' | 'dashboard' | 'revision';
  requested_by?: string;
}

export type QuoteOutcome = 'exists' | 'daily_cap' | 'cancelled' | 'shadow' | 'expired' | 'pricing_incomplete' | 'won' | 'lost' | 'counter_offer' | 'failed';

/** Return value of an instance (kept by Workflows for 30 days): ids and the outcome only. */
export interface QuoteResult {
  outcome: QuoteOutcome;
  run_id: string;
  quote_workflow_id?: string;
  order_id?: string;
  failed_step?: string;
}

export interface QuoteDeps {
  env: OpsEnv;
  ports: Ports;
  step: WorkflowStep;
}

/** Output of quote.cover_email@v1. */
export interface CoverEmailV1 {
  language: string;
  subject: string;
  body_text: string;
  followup_1: { subject: string; body_text: string };
  followup_2: { subject: string; body_text: string };
}

/** Output of quote.classify_reply@v1. */
export interface ClassifyReplyV1 {
  outcome: 'won' | 'lost' | 'counter_offer' | 'question' | 'auto_reply' | 'other';
  confidence: number;
  summary: string;
}

/** Thread and sender checks of a customer reply (booleans and the masked sender only; no address). */
export interface ReplyChecks {
  /** In-Reply-To or References names one of this quote's outbound Message-IDs. */
  in_thread: boolean;
  /** Trusted DMARC pass whose header.from is the domain of From (mail-in/auth-results.ts dmarcPass). */
  sender_authenticated: boolean;
  /** From is the RFQ's contact address (case-insensitive). */
  sender_is_contact: boolean;
  /** maskEmail() of From. */
  sender_masked: string | null;
}

/** What happens with a classified reply: applied directly, a notice, nothing, or a person decides on a card. */
export type ReplyRoute = 'apply' | 'notice' | 'ignore' | 'card';

/**
 * The route of a classified reply (rules in the header): only 'lost' is ever applied without a person, and only from
 * the authenticated RFQ contact in this quote's thread; 'won' and counter-offers always go to the reply card.
 */
export function replyRoute(c: { outcome: ClassifyReplyV1['outcome']; confidence: number }, checks: ReplyChecks, injectionSuspected: boolean): ReplyRoute {
  if (injectionSuspected) return 'card';
  if (c.outcome === 'won' || c.outcome === 'counter_offer') return 'card';
  if (!(c.confidence >= DIRECT_CONFIDENCE)) return 'card';
  if (c.outcome === 'lost') return checks.in_thread && checks.sender_authenticated && checks.sender_is_contact ? 'apply' : 'card';
  if (c.outcome === 'question' || c.outcome === 'other') return 'notice';
  return 'ignore';
}

/** quote_workflows.drafts: the approved texts of this version. */
export interface QuoteDrafts {
  language: string;
  subject: string;
  body_text: string;
  followups: Array<{ subject: string; body_text: string }>;
  prompt: string;
  edited_by?: string;
}

const AGENT = 'quote' as const;
const FLAG = 'agent.quote' as const;
export const CAD_WAIT: WorkflowTimeoutDuration = '2 hours';
export const APPROVAL_FIRST: WorkflowTimeoutDuration = '7 days';
export const APPROVAL_SECOND: WorkflowTimeoutDuration = '7 days';
export const REPLY_CONFIRM_FIRST: WorkflowTimeoutDuration = '7 days';
export const REPLY_CONFIRM_SECOND: WorkflowTimeoutDuration = '7 days';
export const PARK_TIMEOUT: WorkflowTimeoutDuration = '7 days';
/** Days of the waits for a reply after the send, after follow-up 1 and after follow-up 2 (flag value.follow_up_days). */
export const DEFAULT_FOLLOW_UP_DAYS: readonly number[] = Object.freeze([3, 4, 7]);
export const MAX_APPROVAL_ROUNDS = 3;
/** A classified reply at or above this confidence is applied without asking (counter-offers always ask). */
export const DIRECT_CONFIDENCE = 0.8;
export const REPLY_TEXT_CHARS = 6000;
export const NOTES_TEXT_CHARS = 6000;
const DAY_MS = 86_400_000;
const BODY_MAX = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Statuses this instance may move its row out of: the active ones and 'failed' (a restarted run continues). A row
 *  that a human or a newer version ended ('rejected', 'cancelled') is never changed by a late step. */
export const LIVE_STATUSES: readonly QuoteStatus[] = [...QUOTE_ACTIVE_STATUSES, 'failed'];

export function isQuoteParams(p: unknown): p is QuoteParams {
  const x = p as Record<string, unknown> | null;
  return (
    typeof x === 'object' &&
    x !== null &&
    x.v === 1 &&
    typeof x.rfq_id === 'string' &&
    UUID.test(x.rfq_id) &&
    typeof x.quote_version === 'number' &&
    Number.isSafeInteger(x.quote_version) &&
    x.quote_version >= 1 &&
    typeof x.tenant_id === 'string' &&
    UUID.test(x.tenant_id) &&
    (x.trigger === 'intake' || x.trigger === 'dashboard' || x.trigger === 'revision')
  );
}

/** value.follow_up_days when it is a list of three positive numbers of days, else the default. */
export function followUpDays(value: Record<string, unknown>): number[] {
  const d = value.follow_up_days;
  if (Array.isArray(d) && d.length >= 3 && d.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 60)) return (d as number[]).slice(0, 3);
  return [...DEFAULT_FOLLOW_UP_DAYS];
}

/** Language of the customer texts: the intake's language when known, else from the customer's country, else 'en'. */
export function quoteLanguage(country: string | null, intakeLanguage: string | null): string {
  const hint = String(intakeLanguage ?? '').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(hint)) return hint;
  const c = String(country ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const table: Array<[RegExp, string]> = [
    [/^(de|at|ch|li|germany|deutschland|austria|osterreich|switzerland|schweiz)$/, 'de'],
    [/^(gr|cy|greece|hellas|ελλαδα|cyprus)$/, 'el'],
    [/^(pl|poland|polska)$/, 'pl'],
    [/^(fr|france|be|lu)$/, 'fr'],
    [/^(it|italy|italia)$/, 'it'],
    [/^(es|spain|espana)$/, 'es'],
    [/^(nl|netherlands|nederland)$/, 'nl'],
  ];
  for (const [re, lang] of table) if (re.test(c)) return lang;
  return 'en';
}

/** Ends the run early with a result (not an error: the top-level catch passes it through). */
class Halt {
  constructor(readonly result: QuoteResult) {}
}

/** Error code written to the run and the quote: fixed codes and names only, never message text from elsewhere. */
export function errorCode(e: unknown): string {
  if (isConfigMissing(e)) return `config_missing: ${e.names.join(', ')}`.slice(0, 200);
  if (e instanceof DbError) return `db_error ${e.status}${e.code ? ` ${e.code}` : ''}`;
  const message = e instanceof Error ? e.message : String(e);
  const known = /^(config_missing: [A-Z0-9_, ]+|llm_[a-z0-9_]+(?:: [a-z0-9_]+)?|send_[a-z_]+(?: [0-9]+)?|[a-z_]+_missing|invalid_params|db_error [0-9]+(?: [A-Z0-9]+)?)$/.exec(message.trim());
  if (known) return known[1].slice(0, 200);
  const name = e instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(e.name) ? e.name : 'Error';
  return name === 'Error' ? 'error' : name;
}

function isLlmUnavailable(e: unknown): boolean {
  return (e instanceof Error ? e.message : String(e)).startsWith('llm_unavailable');
}

function clean(text: unknown, max: number): string {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// ----- data read by the steps -----

/** RFQ columns the quote reads (no address: contact data is read by the steps that need it). */
interface RfqRow {
  id: string;
  rfq_number: string | null;
  company_name: string | null;
  country: string | null;
  customer_id: string | null;
  created_at: string | null;
  description: string | null;
  parts_details: PartRow[] | null;
  inbound_email_id: string | null;
  tenant_id: string;
}

async function readRfq(db: Db, rfqId: string): Promise<RfqRow> {
  const rows = await db.select<RfqRow & Record<string, unknown>>('rfqs', {
    columns: 'id,rfq_number,company_name,country,customer_id,created_at,description,parts_details,inbound_email_id,tenant_id',
    filters: [['id', 'eq', rfqId]],
    limit: 1,
  });
  if (!rows[0]) throw new NonRetryableError('rfq_missing');
  return rows[0];
}

interface Contact {
  company: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address_lines: string[];
  country: string | null;
}

/** The buyer's contact data: the RFQ's contact fields, completed from the linked customer. */
async function readContact(db: Db, rfqId: string): Promise<Contact> {
  const rfq = (
    await db.select<Record<string, unknown>>('rfqs', {
      columns: 'company_name,contact_first_name,contact_last_name,contact_email,contact_phone,address,city,zip_code,country,customer_id',
      filters: [['id', 'eq', rfqId]],
      limit: 1,
    })
  )[0];
  if (!rfq) throw new NonRetryableError('rfq_missing');
  let customer: Record<string, unknown> | undefined;
  if (typeof rfq.customer_id === 'string') {
    customer = (
      await db.select<Record<string, unknown>>('customers', {
        columns: 'company_name,first_name,last_name,email,phone,street_address,city,zip_code,country',
        filters: [['id', 'eq', rfq.customer_id]],
        limit: 1,
      })
    )[0];
  }
  const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const street = s(rfq.address) ?? s(customer?.street_address);
  const city = [s(rfq.zip_code) ?? s(customer?.zip_code), s(rfq.city) ?? s(customer?.city)].filter(Boolean).join(' ');
  return {
    company: s(rfq.company_name) ?? s(customer?.company_name),
    first_name: s(rfq.contact_first_name) ?? s(customer?.first_name),
    last_name: s(rfq.contact_last_name) ?? s(customer?.last_name),
    email: s(rfq.contact_email) ?? s(customer?.email),
    phone: s(rfq.contact_phone) ?? s(customer?.phone),
    address_lines: [street, city].filter((x): x is string => Boolean(x)),
    country: s(rfq.country) ?? s(customer?.country),
  };
}

/** The language the intake recorded for the RFQ's e-mail (inbound_emails.parsed.language), if any. */
async function intakeLanguage(db: Db, inboundEmailId: string | null): Promise<string | null> {
  if (!inboundEmailId) return null;
  const row = (await db.select<{ parsed: Record<string, unknown> | null }>('inbound_emails', { columns: 'parsed', filters: [['id', 'eq', inboundEmailId]], limit: 1 }))[0];
  const lang = row?.parsed?.language;
  return typeof lang === 'string' && /^[a-z]{2}$/.test(lang) ? lang : null;
}

function jobRows(jobs: readonly CadJobRow[]): JobRow[] {
  return jobs.map((j) => ({ id: j.id, rfq_file_id: j.rfq_file_id, job_type: j.job_type, status: j.status, result: j.result, error: j.error }));
}

/** SHA-256 of an R2 object, streamed (null when the object is missing). */
async function hashObject(ports: Ports, key: string): Promise<{ sha256: string; size: number } | null> {
  const object = await ports.blob.get(key);
  if (!object) return null;
  const h = new Sha256();
  let size = 0;
  const reader = object.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    h.update(value);
  }
  return { sha256: h.hex(), size };
}

// ----- model inputs (pure: the same data always gives the same content, and so the same fixture hash) -----

/** Untrusted text for a delimited block: every tag-like sequence ('<', optional '/', then a letter, '_', '!' or
 *  '?') starts with '‹' instead, so the text can neither close its own block nor open another one. */
export function neutralise(text: string): string {
  return String(text ?? '').replace(/<(?=\s*\/?\s*[A-Za-z_!?])/g, '‹');
}

/** JSON for a delimited block, '<' written as the JSON escape u+003c (same JSON value), so no string in it can
 *  close the block. */
export function blockJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** True when untrusted text carries a delimiter of the model's data blocks (the reply is then flagged
 *  injection_suspected and always decided by a person). */
export function hasBlockDelimiter(text: string): boolean {
  return /<\s*\/?\s*(untrusted_[a-z_]+|quote_lines|similar_quotes|quote|attachments?)\b/i.test(String(text ?? ''));
}

/** User content of quote.price_notes@v1. */
export function notesContent(lines: readonly LineInput[], pricing: PricingV1, notesText: string, similar: readonly SimilarLine[]): LlmContent[] {
  const table = pricing.lines.map((l, i) => {
    const g = lines[i]?.geometry ?? null;
    return {
      line_no: l.line_no,
      process: l.process,
      material: l.material.grade ?? l.material.family ?? (l.material.text || null),
      thickness_mm: l.material.thickness_mm,
      qty: l.qty,
      finish: lines[i]?.finish_code ?? null,
      tolerance: lines[i]?.tolerance ?? null,
      geometry: g
        ? { flat_mm: g.flat ? [g.flat.width_mm, g.flat.height_mm] : null, bends: g.bends?.count ?? null, cut_length_mm: g.flat?.cut_length_mm ?? null, bbox_mm: g.bbox_mm ? [g.bbox_mm.x, g.bbox_mm.y, g.bbox_mm.z] : null }
        : null,
      unit_price_eur: l.unit_price,
      manual_reasons: l.manual_reasons,
    };
  });
  const hits = similar.map((s) => ({ line_no: s.line_no, hits: s.hits.map((h) => ({ unit_price_eur: h.unit_price_eur, outcome: h.outcome, score: h.score })) }));
  return [
    {
      type: 'text',
      text: [
        `<quote_lines>\n${blockJson(table)}\n</quote_lines>`,
        `<untrusted_rfq_notes>\n${neutralise(notesText.slice(0, NOTES_TEXT_CHARS))}\n</untrusted_rfq_notes>`,
        `<similar_quotes>\n${blockJson(hits)}\n</similar_quotes>`,
      ].join('\n'),
    },
  ];
}

/** Customer notes of an RFQ for the price review: the RFQ description and each part's comments. */
export function rfqNotesText(description: string | null, parts: readonly PartRow[]): string {
  const out: string[] = [];
  if (description?.trim()) out.push(clean(description, NOTES_TEXT_CHARS));
  parts.forEach((p, i) => {
    const comments = (p.original_values ?? {})['comments'];
    if (typeof comments === 'string' && comments.trim()) out.push(`Part ${i + 1}: ${clean(comments, 1000)}`);
  });
  return out.join('\n');
}

/** User content of quote.cover_email@v1. */
export function coverContent(d: { language: string; offer_no: string; company: string | null; first_name: string | null; last_name: string | null; parts: number; offer_date: string; valid_until: string }): LlmContent[] {
  const quote = {
    language: d.language,
    offer_no: d.offer_no,
    company: d.company,
    contact_first_name: d.first_name,
    contact_last_name: d.last_name,
    parts: d.parts,
    offer_date: d.offer_date,
    valid_until: d.valid_until,
    delivery_time: DEFAULT_CONDITIONS.delivery_time,
  };
  return [{ type: 'text', text: `<quote>\n${blockJson(quote)}\n</quote>` }];
}

/** User content of quote.classify_reply@v1. */
export function replyContent(subject: string | null, text: string): LlmContent[] {
  return [{ type: 'text', text: `<untrusted_email>\nSubject: ${neutralise(clean(subject, 300))}\n\n${neutralise(clean(text, REPLY_TEXT_CHARS))}\n</untrusted_email>` }];
}

/** The stored drafts of a cover-email answer (one-line subjects, bounded bodies). */
export function draftsOf(v: CoverEmailV1, prompt: string): QuoteDrafts {
  return {
    language: /^[a-z]{2}$/.test(String(v.language ?? '').toLowerCase()) ? v.language.toLowerCase() : 'en',
    subject: cleanSubject(v.subject),
    body_text: clean(v.body_text, BODY_MAX),
    followups: [v.followup_1, v.followup_2].map((f) => ({ subject: cleanSubject(f.subject), body_text: clean(f.body_text, BODY_MAX) })),
    prompt,
  };
}

/** Vector metadata of a priced line. */
export function vectorMeta(qwid: string, rfqId: string, l: PricingV1['lines'][number], outcome: QuoteVectorMeta['outcome'], sentAtUnix: number, rulesVersion: string): QuoteVectorMeta {
  return {
    quote_workflow_id: qwid,
    rfq_id: rfqId,
    line_no: l.line_no,
    process: l.process,
    material_family: l.material.family ?? 'unknown',
    material_grade: l.material.grade ?? '',
    thickness_mm: l.material.thickness_mm ?? 0,
    qty: l.qty,
    unit_price_eur: l.unit_price ?? 0,
    line_total_eur: l.line_total ?? 0,
    outcome,
    sent_at_unix: sentAtUnix,
    rules_version: rulesVersion,
  };
}

type LlmStepResult<R> = { ok: true; value: R; usage: LlmUsage } | { ok: false; park: 'budget'; usage: LlmUsage | null };

interface RunCtx {
  id: string;
  acc: UsageAcc;
}

/** An order of the RFQ that exists already (the RFQ was accepted outside the quote e-mails), or none. */
interface ExistingOrder {
  order_id: string | null;
  po_number: string | null;
}

/** A phase run being opened: its key suffix and subject (a failure of the opening step goes on this run). */
interface PhaseRef {
  phase: string;
  subject?: { type: string; id: string };
}

interface Snapshot {
  qwid: string;
  /** The row was already final (cancelled, rejected, ...): the instance ends. */
  final: boolean;
  quote_date: string;
  rfq_number: string;
  company: string | null;
  country: string | null;
  inquiry_date: string;
  process: QuoteProcess | null;
  description: string | null;
  inbound_email_id: string | null;
  parts: PartRow[];
  files: FileRow[];
}

/** The production entry point: ports from the environment, then runQuote(). */
export class QuoteWorkflow extends WorkflowEntrypoint<OpsEnv, QuoteParams> {
  async run(event: Readonly<WorkflowEvent<QuoteParams>>, step: WorkflowStep): Promise<QuoteResult> {
    return runQuote(event.payload, event.instanceId, { env: this.env, ports: makePorts(this.env), step });
  }
}

export async function runQuote(p: QuoteParams, instanceId: string, d: QuoteDeps): Promise<QuoteResult> {
  if (!isQuoteParams(p) || instanceId !== quoteInstanceId(p.rfq_id, p.quote_version)) throw new NonRetryableError('invalid_params');
  const { env, ports, step } = d;
  const db = ports.db;
  const rfqId = p.rfq_id;
  const version = p.quote_version;
  const tenant = p.tenant_id;
  let current = 'open-run';
  let qwid: string | null = null;
  /** The current run (the quote run, then each phase run while it is open); the quote run once open-run returned. */
  let cur: RunCtx = { id: '', acc: { ...EMPTY_USAGE, by_step: {} } };
  /** The run the current step belongs to: a run context, or the phase run a '<phase>-run' step is opening. */
  let owner = null as RunCtx | PhaseRef | null;
  /** Follow-ups recorded so far (the waiting status of the quote is 'follow_up' once one was sent). */
  let followUps = 0;

  const run = <T>(name: string, cfg: WorkflowStepConfig, fn: () => Promise<T>, stepOwner?: RunCtx | PhaseRef): Promise<T> => {
    current = name;
    owner = stepOwner ?? cur;
    return step.do(name, cfg, fn as () => Promise<Rpc.Serializable<T>>) as Promise<T>;
  };
  const log = (outcome: string) => console.log(formatLogLine(LOG_PREFIX, 'quote', { rfq_id: rfqId, version, outcome }));

  // 0 open-run
  const opened = await run('open-run', DB, async () => {
    const flag = await readFlag(env, FLAG, tenant);
    const prompts = {
      notes: selectPrompt('quote.price_notes', flag),
      cover: selectPrompt('quote.cover_email', flag),
      reply: selectPrompt('quote.classify_reply', flag),
    };
    const r = await openRun(db, {
      agent: AGENT,
      trigger: p.trigger === 'intake' ? 'workflow' : 'dashboard',
      idempotency_key: `${rfqId}:v${version}`,
      workflow_name: 'quote',
      workflow_instance_id: instanceId,
      subject_type: 'rfq',
      subject_id: rfqId,
      prompt_version: `${prompts.notes},${prompts.cover}`,
      tenant_id: tenant,
    });
    return { run_id: r.run_id, final: isFinal(r.status), prompts, follow_up_days: followUpDays(flag.value) };
  });
  const main: RunCtx = { id: opened.run_id, acc: { ...EMPTY_USAGE, by_step: {} } };
  cur = main;
  if (opened.final) {
    log('exists');
    return { outcome: 'exists', run_id: main.id };
  }
  const prompts = opened.prompts as { notes: PromptId; cover: PromptId; reply: PromptId };

  // 0b daily-cap
  const capped = await run('daily-cap', DB, async () => applyDailyCap(env, ports, { run_id: main.id, agent: AGENT, flag: await readFlag(env, FLAG, tenant) }));
  if (capped) {
    log('daily_cap');
    return { outcome: 'daily_cap', run_id: main.id };
  }

  // ----- helpers that need the run -----

  const patchQuote = async (patch: Parameters<typeof patchQuoteWorkflow>[2], onlyIf?: readonly QuoteStatus[]): Promise<boolean> => {
    if (!qwid) return false;
    return patchQuoteWorkflow(db, qwid, { ...patch, last_event_at: ports.clock.now().toISOString() }, onlyIf);
  };

  const sendNotice = async (card: CardV1): Promise<void> => {
    try {
      await ports.telegram.sendCard(card, null);
    } catch {
      console.error(formatLogLine(LOG_PREFIX, 'notice card failed', { run_id: card.run_id }));
    }
  };

  /** Parks the current run, waits for 'agent-resumed' and resumes it; on timeout the run is cancelled (Halt). */
  const parkAndWait = async (name: string, reason: 'flag_off' | 'budget' | 'llm_unavailable'): Promise<void> => {
    const ctx = cur;
    await run(`park-${name}`, DB, async () => {
      await checkpointRun(db, ctx.id, ctx.acc);
      await parkRun(db, ctx.id, reason);
      return true;
    });
    try {
      await step.waitForEvent(`resume-${name}`, { type: 'agent-resumed', timeout: PARK_TIMEOUT });
    } catch (error) {
      if (!isWaitTimeout(error)) throw error;
      await run(`park-expired-${name}`, DB, async () => {
        await closeRun(db, ctx.id, { status: 'cancelled', error: reason }, ctx.acc);
        await patchQuote({ status: 'cancelled', outcome_reason: reason }, LIVE_STATUSES);
        return true;
      });
      log('cancelled');
      throw new Halt({ outcome: 'cancelled', run_id: ctx.id, ...(qwid ? { quote_workflow_id: qwid } : {}) });
    }
    await run(`resumed-${name}`, DB, async () => {
      await checkpointRun(db, ctx.id, ctx.acc, { status: 'running' });
      return true;
    });
  };

  /** Re-reads agent.quote; while it is off the current run is parked (flag_off). Returns the mode. */
  const flagGate = async (name: string): Promise<AgentFlag['mode']> => {
    for (let k = 1; ; k++) {
      const stepName = k === 1 ? `flag-${name}` : `flag-${name}-${k}`;
      const r = await run(stepName, DB, async () => {
        const flag = await readFlag(env, FLAG, tenant);
        return { enabled: flag.enabled, mode: flag.mode };
      });
      if (r.enabled) return r.mode;
      await parkAndWait(stepName, 'flag_off');
    }
  };

  /** One LLM step with the park rules of the header; `after` turns the model value into the step result. */
  const llmStep = async <V, R>(base: string, metaStep: string, cfg: WorkflowStepConfig, prompt: PromptId, input: () => Promise<LlmContent[]>, after: (value: V) => Promise<R>): Promise<R> => {
    for (let k = 1; ; k++) {
      const name = k === 1 ? base : `${base}-${k}`;
      // each model call is a side effect (cost, data to the provider): the flag is read again before every attempt
      await flagGate(k === 1 ? base : `${base}-r${k}`);
      const ctx = cur;
      let reason: 'budget' | 'llm_unavailable';
      try {
        const res = await run<LlmStepResult<R>>(name, cfg, async () => {
          const loaded = await loadPrompt(prompt);
          const user = await input();
          const r = await ports.llm.call<V>({
            prompt,
            route: loaded.entry.route,
            system: loaded.system,
            user,
            schema: loaded.schema as unknown as JsonSchemaObject,
            maxTokens: loaded.entry.max_tokens,
            meta: { agent: AGENT, run_id: ctx.id, tenant_id: tenant, step: metaStep },
          });
          if (r.ok) return { ok: true, value: await after(r.value), usage: r.usage };
          if (r.code === 'budget') return { ok: false, park: 'budget', usage: r.usage ?? null };
          if (r.retryable) throw new Error(`llm_unavailable: ${r.code}`);
          throw new NonRetryableError(`llm_${r.code}`);
        });
        if (res.usage) ctx.acc = addUsage(ctx.acc, res.usage, metaStep);
        if (res.ok) return res.value;
        reason = res.park;
      } catch (error) {
        if (!isLlmUnavailable(error)) throw error;
        reason = 'llm_unavailable';
      }
      await parkAndWait(name, reason);
    }
  };

  /** A quote that a failure marked 'failed' goes back to its waiting status once its retried run continues. */
  const restoreWaiting = async (): Promise<void> => {
    if (!qwid) return;
    await patchQuoteWorkflow(db, qwid, { status: followUps > 0 ? 'follow_up' : 'sent', error: null }, ['failed']);
  };

  /** agent_runs fields of a phase run (child of the quote run). */
  const phaseRunFields = (ref: PhaseRef): OpenRun => ({
    agent: AGENT,
    trigger: 'workflow',
    idempotency_key: `${rfqId}:v${version}:${ref.phase}`,
    workflow_name: 'quote',
    workflow_instance_id: instanceId,
    parent_run_id: main.id,
    subject_type: ref.subject?.type ?? 'quote_workflow',
    subject_id: ref.subject?.id ?? (qwid as string),
    prompt_version: prompts.reply,
    tenant_id: tenant,
  });

  /** Opens a short run of the post-send phase (follow-up, reply, expiry) and makes it current. The opening step
   *  belongs to that phase run (a failure there goes on it, never on the closed quote run); `at` is its clock
   *  reading, the base of the next wait when the phase was already over. */
  const openPhaseRun = async (name: string, key: string, subject?: { type: string; id: string }): Promise<{ ctx: RunCtx; final: boolean; at: number }> => {
    const ref: PhaseRef = { phase: key, ...(subject ? { subject } : {}) };
    const r = await run(
      `${name}-run`,
      DB,
      async () => {
        const o = await openRun(db, phaseRunFields(ref));
        const final = isFinal(o.status);
        if (!final) await restoreWaiting();
        return { run_id: o.run_id, final, at: ports.clock.now().getTime() };
      },
      ref,
    );
    const ctx: RunCtx = { id: r.run_id, acc: { ...EMPTY_USAGE, by_step: {} } };
    cur = ctx;
    return { ctx, final: r.final, at: r.at };
  };

  try {
    await flagGate('start');

    // 1 supersede (a new version replaces the active one)
    if (version > 1) {
      await run('supersede', DB, async () => {
        const active = await activeQuotesOf(db, rfqId, version);
        for (const q of active) {
          await patchQuoteWorkflow(db, q.id, { status: 'cancelled', outcome_reason: `superseded_by_v${version}`, last_event_at: ports.clock.now().toISOString() }, LIVE_STATUSES);
          try {
            if (env.QUOTE) await (await env.QUOTE.get(q.workflow_instance_id)).terminate();
          } catch {
            // the earlier instance has already ended
          }
        }
        return { cancelled: active.map((q) => q.id) };
      });
    }

    // 2 load
    const snap = await run<Snapshot>('load', DB, async () => {
      const row = await ensureQuoteWorkflow(db, { tenant_id: tenant, rfq_id: rfqId, quote_version: version, workflow_instance_id: instanceId });
      const rfq = await readRfq(db, rfqId);
      const files = await db.select<FileRow & Record<string, unknown>>('rfq_files', {
        columns: 'id,file_name,part_id,r2_key,sha256,content_type,file_type,file_size',
        filters: [['rfq_id', 'eq', rfqId]],
        order: [{ column: 'created_at', ascending: true }],
        limit: 200,
      });
      const final = !(LIVE_STATUSES as readonly string[]).includes(row.status);
      if (!final) await patchQuoteWorkflow(db, row.id, { current_step: 'load' });
      return {
        qwid: row.id,
        final,
        quote_date: row.created_at,
        rfq_number: rfq.rfq_number ?? `RFQ-${rfqId.slice(0, 8)}`,
        company: rfq.company_name,
        country: rfq.country,
        inquiry_date: rfq.created_at ?? row.created_at,
        process: row.process,
        description: rfq.description,
        inbound_email_id: rfq.inbound_email_id,
        parts: Array.isArray(rfq.parts_details) ? rfq.parts_details : [],
        files: files.map((f) => ({ id: f.id, file_name: f.file_name, part_id: f.part_id, r2_key: f.r2_key, sha256: f.sha256, content_type: f.content_type, file_type: f.file_type ?? null, file_size: f.file_size ?? null })),
      };
    });
    qwid = snap.qwid;
    if (snap.final) {
      log('cancelled');
      return { outcome: 'cancelled', run_id: main.id, quote_workflow_id: qwid };
    }
    const offerNo = offerNumber(snap.rfq_number, version);
    const quoteDate = new Date(snap.quote_date);

    // 3 ensure-cad
    await flagGate('ensure-cad');
    const cad = await run('ensure-cad', DB, async () => {
      const jobs = await cadJobsOf(db, { rfq_id: rfqId });
      const covered = new Set(jobs.filter((j) => j.job_type === 'analyse' && j.rfq_file_id).map((j) => j.rfq_file_id as string));
      const created: string[] = [];
      for (const f of analysableFiles(snap.files).filter((x) => !covered.has(x.id))) {
        const object = f.sha256 && f.file_size ? { sha256: f.sha256, size: f.file_size } : await hashObject(ports, f.r2_key as string);
        if (!object) continue;
        const part = snap.parts.find((x) => x.id && x.id === f.part_id) ?? (snap.parts.length === 1 ? snap.parts[0] : undefined);
        const process = (part ? partProcess(part) : null) ?? snap.process ?? 'mixed';
        const material = recogniseMaterial(String((part?.original_values ?? {})['materialLabel'] ?? (part?.original_values ?? {})['material'] ?? ''));
        const thickness = Number(String((part?.original_values ?? {})['thickness'] ?? '').replace(',', '.'));
        const job = await enqueueCadJob(env, db, {
          tenant_id: tenant,
          rfq_id: rfqId,
          rfq_file_id: f.id,
          quote_workflow_id: snap.qwid,
          job_type: 'analyse',
          input: { r2_key: f.r2_key as string, sha256: object.sha256, content_type: f.content_type ?? f.file_type ?? 'application/octet-stream', size_bytes: object.size, file_name: f.file_name },
          params: { material: unfoldMaterial(material.family), thickness_override: Number.isFinite(thickness) && thickness > 0 ? thickness : 0, k_factor_override: 0, drawing_size: 'A3', process },
          requested_by_run_id: main.id,
        });
        created.push(job.job_id);
      }
      const all = await cadJobsOf(db, { rfq_id: rfqId });
      const pending = all.filter((j) => j.job_type === 'analyse' && !isFinalCadStatus(j.status)).map((j) => j.id);
      need(env, 'RFQ_THREAD');
      const thread = env.RFQ_THREAD.get(env.RFQ_THREAD.idFromName(rfqId)) as unknown as { expectCadJobs(ids: string[]): Promise<void>; bindQuote(i: string, q: string): Promise<void> };
      if (pending.length) await thread.expectCadJobs(pending);
      await thread.bindQuote(instanceId, snap.qwid);
      await patchQuoteWorkflow(db, snap.qwid, { status: pending.length ? 'cad_pending' : 'pricing', current_step: 'ensure-cad' }, LIVE_STATUSES);
      return { created, pending };
    });

    // 4 await-cad
    if (cad.pending.length) {
      try {
        await step.waitForEvent('await-cad', { type: 'cad-done', timeout: CAD_WAIT });
      } catch (error) {
        if (!isWaitTimeout(error)) throw error;
      }
    }

    // 5 drawings (not awaited); the CAD wait can last hours, so the flag is read again first
    await flagGate('drawings');
    await run('drawings', DB, async () => {
      const jobs = await cadJobsOf(db, { rfq_id: rfqId });
      const haveDrawing = new Set(jobs.filter((j) => j.job_type === 'drawing_pdf').map((j) => j.input_sha256));
      const out: string[] = [];
      for (const j of jobs) {
        const params = j.params as CadJobRow['params'] & { process?: string };
        if (j.job_type !== 'analyse' || j.status !== 'succeeded' || !j.result?.flat || haveDrawing.has(j.input_sha256)) continue;
        if (cadKindOf(j.input_r2_key) !== 'step' || !['sheet_metal', 'mixed'].includes(String(params.process))) continue;
        const file = snap.files.find((f) => f.id === j.rfq_file_id);
        const job = await enqueueCadJob(env, db, {
          tenant_id: tenant,
          rfq_id: rfqId,
          rfq_file_id: j.rfq_file_id,
          quote_workflow_id: snap.qwid,
          job_type: 'drawing_pdf',
          input: { r2_key: j.input_r2_key, sha256: j.input_sha256, content_type: file?.content_type ?? 'application/step', size_bytes: file?.file_size ?? 0, file_name: file?.file_name ?? 'part.step' },
          params: { ...(params as Record<string, unknown>), drawing_size: 'A3' } as never,
          requested_by_run_id: main.id,
        });
        haveDrawing.add(j.input_sha256);
        out.push(job.job_id);
      }
      return { job_ids: out };
    });

    // 6 lines
    const lines = await run<LineInput[]>('lines', DB, async () => buildLines({ parts: snap.parts, files: snap.files, jobs: jobRows(await cadJobsOf(db, { rfq_id: rfqId })), quoteProcess: snap.process }));

    // 7 similar-quotes
    const sim = await run('similar-quotes', EMBED, async () => {
      const eligible = lines.filter((l) => (l.process === 'sheet_metal' || l.process === 'cnc') && l.family);
      if (!eligible.length) return { similar: [] as SimilarLine[], usage: null };
      const { vectors, usage } = await ports.embed.embed(eligible.map(lineEmbeddingText), { agent: AGENT, run_id: main.id, tenant_id: tenant, step: 'similar-quotes' });
      const similar: SimilarLine[] = [];
      for (let i = 0; i < eligible.length; i++) {
        const l = eligible[i];
        const base: Record<string, unknown> = { process: { $eq: l.process }, material_family: { $eq: l.family } };
        const narrow = l.thickness_mm !== null ? { ...base, thickness_mm: { $gte: l.thickness_mm - 0.5, $lte: l.thickness_mm + 0.5 } } : base;
        let hits = await ports.vector.query(tenant, vectors[i], { topK: 5, filter: narrow });
        if (hits.length < 2 && narrow !== base) hits = await ports.vector.query(tenant, vectors[i], { topK: 5, filter: base });
        similar.push({
          line_no: l.line_no,
          hits: hits
            .filter((h) => h.metadata.quote_workflow_id !== snap.qwid)
            .map((h) => ({ quote_workflow_id: h.metadata.quote_workflow_id, line_no: h.metadata.line_no, score: Math.round(h.score * 10000) / 10000, unit_price_eur: h.metadata.unit_price_eur, outcome: h.metadata.outcome })),
        });
      }
      return { similar, usage };
    });
    if (sim.usage) main.acc = addUsage(main.acc, sim.usage, 'similar-quotes');

    // 8 price
    const draft = await run<PricingV1>('price', DB, async () => {
      const [rules, catalog] = await Promise.all([loadActiveRules(db, tenant, quoteDate), loadCatalog(db, tenant)]);
      const pricing = calculateQuote({ lines, rules, catalog, rules_version: await rulesVersion(rules), country: snap.country });
      pricing.similar = sim.similar;
      await patchQuoteWorkflow(db, snap.qwid, { pricing, total_amount: pricing.total_net, status: 'pricing', current_step: 'price' }, LIVE_STATUSES);
      return pricing;
    });

    // 9 price-notes (staff only)
    const notes = await llmStep<PriceNotes, PriceNotes>('price-notes', 'price-notes', LLM_EXTRACT, prompts.notes, async () => notesContent(lines, draft, rfqNotesText(snap.description, snap.parts), sim.similar), async (v) => ({
      assumptions: v.assumptions.slice(0, 8).map((x) => clean(x, 300)),
      risks: v.risks.slice(0, 8).map((x) => clean(x, 300)),
      suggestions: v.suggestions.slice(0, 20).filter((s) => draft.lines.some((l) => l.line_no === s.line_no)).map((s) => ({ ...s, reason: clean(s.reason, 300) })),
      injection_suspected: v.injection_suspected === true,
    }));
    let pricing: PricingV1 = { ...draft, notes };

    // 10 cover-email (texts stored on the row, not in the step result)
    const cover = await llmStep<CoverEmailV1, { language: string }>(
      'cover-email',
      'cover-email',
      LLM_EXTRACT,
      prompts.cover,
      async () => {
        const contact = await readContact(db, rfqId);
        return coverContent({
          language: quoteLanguage(snap.country, await intakeLanguage(db, snap.inbound_email_id)),
          offer_no: offerNo,
          company: contact.company,
          first_name: contact.first_name,
          last_name: contact.last_name,
          parts: draft.lines.length,
          offer_date: isoDate(quoteDate),
          valid_until: isoDate(new Date(quoteDate.getTime() + VALIDITY_DAYS * DAY_MS)),
        });
      },
      async (v) => {
        const drafts = draftsOf(v, prompts.cover);
        await patchQuoteWorkflow(db, snap.qwid, { drafts: drafts as unknown as Record<string, unknown> });
        return { language: drafts.language };
      },
    );

    // 11 draft-pdf
    const renderStore = async (pr: PricingV1): Promise<{ pdf_sha256: string; pages: number }> => {
      const contact = await readContact(db, rfqId);
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null;
      const pdf = await renderQuotePdf({
        offer_no: offerNo,
        date: quoteDate,
        inquiry_date: new Date(snap.inquiry_date),
        buyer: { company: contact.company, name, address_lines: contact.address_lines, country: contact.country, phone: contact.phone, email: contact.email },
        lines: pdfLines(pr),
        subtotal: pr.subtotal + (pr.min_order_surcharge ?? 0),
        shipping: pr.shipping,
        total_net: pr.total_net,
        vat_mode: pr.vat.mode,
      });
      await ports.blob.put(quotePdfKey(rfqId, version), pdf.bytes.buffer.slice(pdf.bytes.byteOffset, pdf.bytes.byteOffset + pdf.bytes.byteLength) as ArrayBuffer, { contentType: 'application/pdf', sha256: pdf.sha256 });
      return { pdf_sha256: pdf.sha256, pages: pdf.pages };
    };
    await flagGate('draft-pdf');
    const firstPdf = await run('draft-pdf', PDF, async () => {
      const r = await renderStore(pricing);
      await patchQuoteWorkflow(db, snap.qwid, { pricing, quote_pdf_r2_key: quotePdfKey(rfqId, version), pdf_sha256: r.pdf_sha256, total_amount: pricing.total_net, current_step: 'draft-pdf' }, LIVE_STATUSES);
      return r;
    });
    let pages = firstPdf.pages;

    const cardInput = (variant: QuoteCardInput['variant']): QuoteCardInput => {
      const hits = (pricing.similar ?? []).flatMap((s) => s.hits);
      return {
        run_id: main.id,
        site_origin: env.SITE_ORIGIN,
        rfq_number: snap.rfq_number,
        version,
        company: snap.company,
        country: snap.country,
        pricing,
        notes: pricing.notes ? { assumptions: pricing.notes.assumptions.length, risks: pricing.notes.risks.length, suggestions: pricing.notes.suggestions.length, injection_suspected: pricing.notes.injection_suspected } : null,
        similar: { lines: hits.length, won: hits.filter((h) => h.outcome === 'won').length, lost: hits.filter((h) => h.outcome === 'lost').length },
        pdf_pages: pages,
        variant,
      };
    };

    // 12-13 approval rounds
    for (let round = 1; ; round++) {
      const sfx = round === 1 ? '' : `-${round}`;
      const mode = await flagGate(`approval${sfx}`);
      if (mode === 'shadow') {
        await run('shadow-close', NOTIFY, async () => {
          await sendNotice(quoteNotice({ run_id: main.id, site_origin: env.SITE_ORIGIN, rfq_number: snap.rfq_number, version, company: snap.company, country: snap.country, text: 'Draft ready (shadow mode): nothing was sent', lines: [{ label: 'Total net', value: pricing.total_net === null ? 'open' : `EUR ${pricing.total_net.toFixed(2)}` }] }));
          await patchQuote({ status: 'cancelled', outcome_reason: 'shadow' }, LIVE_STATUSES);
          await closeRun(db, main.id, { status: 'succeeded', output: { quote_workflow_id: snap.qwid, mode: 'shadow', lines: pricing.lines.length, manual_lines: pricing.manual_lines.length } }, main.acc);
          return true;
        });
        log('shadow');
        return { outcome: 'shadow', run_id: main.id, quote_workflow_id: snap.qwid };
      }
      await run(`request-approval${sfx}`, NOTIFY, async () => {
        await checkpointRun(db, main.id, main.acc);
        const r = await request(env, ports, { run_id: main.id, card: quoteCard(cardInput(round === 1 ? 'first' : 'incomplete')) }, { output: { line_count: pricing.lines.length, quote_workflow_id: snap.qwid } });
        await patchQuote({ status: 'awaiting_approval', current_step: 'request-approval' }, LIVE_STATUSES);
        return { telegram_message_id: r.telegram_message_id };
      });
      const waited = await waitWithReminder<DecisionEventPayload>(
        step,
        {
          run_id: main.id,
          type: 'quote-approved',
          first: APPROVAL_FIRST,
          second: APPROVAL_SECOND,
          card: () => quoteCard(cardInput('reminder')),
          onTimeout: async () => {
            await run(`approval-expired${sfx}`, DB, async () => {
              await patchQuote({ status: 'expired', outcome_reason: 'approval_timeout' }, LIVE_STATUSES);
              await closeRun(db, main.id, { status: 'cancelled', error: 'approval_timeout' }, main.acc);
              return true;
            });
          },
        },
        { env, ports },
      );
      if ('timedOut' in waited) {
        log('expired');
        return { outcome: 'expired', run_id: main.id, quote_workflow_id: snap.qwid };
      }
      const decision = waited.event;
      const applied = await run(`apply-edits${sfx}`, PDF, async () => {
        const edited = decision.overrides?.length || decision.shipping !== undefined ? reprice(pricing, { overrides: decision.overrides, shipping: decision.shipping }) : pricing;
        let rendered: { pdf_sha256: string; pages: number } | null = null;
        if (edited !== pricing) rendered = await renderStore(edited);
        if (decision.drafts && (decision.drafts.subject !== undefined || decision.drafts.body_text !== undefined)) {
          const row = await getQuoteWorkflow(db, snap.qwid);
          const stored = (row?.drafts ?? {}) as unknown as QuoteDrafts;
          const merged: QuoteDrafts = {
            ...stored,
            subject: decision.drafts.subject !== undefined ? cleanSubject(decision.drafts.subject) : stored.subject,
            body_text: decision.drafts.body_text !== undefined ? clean(decision.drafts.body_text, BODY_MAX) : stored.body_text,
            edited_by: decision.actor,
          };
          await patchQuoteWorkflow(db, snap.qwid, { drafts: merged as unknown as Record<string, unknown> });
        }
        const via = decision.channel === 'telegram' || decision.channel === 'dashboard' || decision.channel === 'mcp' ? decision.channel : null;
        await patchQuoteWorkflow(db, snap.qwid, {
          pricing: edited,
          total_amount: edited.total_net,
          ...(rendered ? { pdf_sha256: rendered.pdf_sha256 } : {}),
          status: edited.complete ? 'approved' : 'awaiting_approval',
          approved_by: /^(user:[0-9a-f-]{36}|telegram:-?[0-9]+)$/.test(decision.actor) ? decision.actor : null,
          approved_via: via,
          approved_at: ports.clock.now().toISOString(),
          current_step: 'apply-edits',
          last_event_at: ports.clock.now().toISOString(),
        }, LIVE_STATUSES);
        await checkpointRun(db, main.id, main.acc, { output: { quote_workflow_id: snap.qwid, approved: true, complete: edited.complete } });
        return { pricing: edited, pages: rendered?.pages ?? pages };
      });
      pricing = applied.pricing;
      pages = applied.pages;
      if (pricing.complete) break;
      if (round >= MAX_APPROVAL_ROUNDS) {
        await run('pricing-incomplete', DB, async () => {
          await patchQuote({ status: 'cancelled', outcome_reason: 'pricing_incomplete' }, LIVE_STATUSES);
          await closeRun(db, main.id, { status: 'cancelled', error: 'pricing_incomplete' }, main.acc);
          return true;
        });
        log('pricing_incomplete');
        return { outcome: 'pricing_incomplete', run_id: main.id, quote_workflow_id: snap.qwid };
      }
    }

    // 14 write-rfq
    await flagGate('write-rfq');
    await run('write-rfq', DB, async () => {
      const rfq = await readRfq(db, rfqId);
      await writeApprovedPrices(db, rfqId, Array.isArray(rfq.parts_details) ? rfq.parts_details : [], pricing, await uuidV5(rfqId, `quote-surcharge:v${version}`), ports.clock.now());
      return true;
    });

    /** Sends quote mail k (0 = the quote with the PDF, 1-2 = follow-ups) and returns the provider id. */
    const sendMail = async (k: 0 | 1 | 2): Promise<{ provider_id: string }> => {
      need(env, 'QUOTE_FROM', 'QUOTE_REPLY_TO', 'MESSAGE_ID_DOMAIN');
      const row = await getQuoteWorkflow(db, snap.qwid);
      const drafts = row?.drafts as unknown as QuoteDrafts | null;
      const text = k === 0 ? drafts : drafts?.followups?.[k - 1];
      if (!drafts || !text?.subject || !text.body_text) throw new NonRetryableError('drafts_missing');
      const contact = await readContact(db, rfqId);
      if (!contact.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact.email)) throw new NonRetryableError('recipient_missing');
      let pdf: { filename: string; base64: string } | undefined;
      if (k === 0) {
        const object = await ports.blob.get(quotePdfKey(rfqId, version));
        if (!object) throw new NonRetryableError('quote_pdf_missing');
        pdf = { filename: offerFileName(snap.rfq_number, version), base64: bytesToBase64(new Uint8Array(await new Response(object.body).arrayBuffer())) };
      }
      const first = quoteMessageId(snap.qwid, 0, env.MESSAGE_ID_DOMAIN);
      const mail = quoteMail({
        from: env.QUOTE_FROM,
        reply_to: env.QUOTE_REPLY_TO,
        to: contact.email,
        subject: text.subject,
        body_text: text.body_text,
        quote_workflow_id: snap.qwid,
        message_id: quoteMessageId(snap.qwid, k, env.MESSAGE_ID_DOMAIN),
        idempotency_key: quoteIdempotencyKey(snap.qwid, k === 0 ? 'send' : k),
        pdf,
        reply_headers: k === 0 ? undefined : replyHeaders(first, row?.outbound_message_ids ?? []),
      });
      const r = await ports.mailer.send(mail);
      ports.events.point({ event: 'send', run_id: cur.id, agent: AGENT, step: k === 0 ? 'send' : `follow-up-${k}`, outcome: r.ok ? 'ok' : `error_${r.status}`, tenant_id: tenant, workflow_instance_id: instanceId });
      if (r.ok) return { provider_id: r.provider_id };
      if (r.retryable) throw new Error(`send_unavailable ${r.status}`);
      throw new NonRetryableError(`send_failed ${r.status}`);
    };

    /** Records the ids of quote mail k (ours and the provider's) and mirrors them into RfqThread. */
    const recordMail = async (k: 0 | 1 | 2, providerId: string): Promise<{ sent_at: string }> => {
      need(env, 'MESSAGE_ID_DOMAIN', 'RFQ_THREAD');
      const ours = quoteMessageId(snap.qwid, k, env.MESSAGE_ID_DOMAIN);
      const theirs = withBrackets(await ports.mailer.fetchMessageId(providerId));
      const sentAt = ports.clock.now().toISOString();
      const extra = k === 0 ? { sent_at: sentAt, status: 'sent' as const } : { follow_ups_sent: k, status: 'follow_up' as const };
      const ids = await recordOutbound(db, snap.qwid, { message_ids: [ours, theirs], resend_ids: [providerId] }, { ...extra, current_step: k === 0 ? 'record-send' : `follow-up-${k}`, last_event_at: sentAt });
      const thread = env.RFQ_THREAD.get(env.RFQ_THREAD.idFromName(rfqId)) as unknown as { registerOutbound(ids: string[], q: string): Promise<void> };
      await thread.registerOutbound(ids, snap.qwid);
      return { sent_at: sentAt };
    };

    // 15 send, 16 record-send
    await flagGate('send');
    const sent = await run('send', SEND, async () => sendMail(0));
    const recorded = await run('record-send', DB, async () => {
      const r = await recordMail(0, sent.provider_id);
      await setRfqStatus(db, rfqId, 'sent');
      return r;
    });
    const sentAtUnix = Math.floor(Date.parse(recorded.sent_at) / 1000);

    /** Upserts one vector per priced line with the outcome; returns the embedding usage. */
    const indexLines = async (outcome: QuoteVectorMeta['outcome'], ctx: RunCtx, stepName: string) => {
      const priced = pricing.lines.filter((l) => l.unit_price !== null);
      if (!priced.length) return null;
      const texts = priced.map((l) => lineEmbeddingText(lines.find((x) => x.line_no === l.line_no) as LineInput));
      const { vectors, usage } = await ports.embed.embed(texts, { agent: AGENT, run_id: ctx.id, tenant_id: tenant, step: stepName });
      await ports.vector.upsert(
        tenant,
        priced.map((l, i) => ({ id: `${snap.qwid}:${l.line_no}`, values: vectors[i], metadata: vectorMeta(snap.qwid, rfqId, l, outcome, sentAtUnix, pricing.rules_version) })),
      );
      return usage;
    };

    // 17 index-quote, then the quote run closes (its clock reading is the time base of the first wait)
    const indexed = await run('index-quote', EMBED, async () => indexLines('open', main, 'index-quote'));
    if (indexed) main.acc = addUsage(main.acc, indexed, 'index-quote');
    const closedAt = await run('close-send', DB, async () => {
      await closeRun(db, main.id, { status: 'succeeded', output: { quote_workflow_id: snap.qwid, sent: true, lines: pricing.lines.length, total_net: pricing.total_net } }, main.acc);
      await restoreWaiting();
      return ports.clock.now().getTime();
    });

    /** The RFQ accepted outside this quote's e-mails (the portal's Accept Quote, the dashboard): its first order, or
     *  no order when only rfqs.status says 'approved'; null while the RFQ is not accepted. */
    const acceptedElsewhere = (name: string): Promise<ExistingOrder | null> =>
      run(name, DB, async () => {
        const order = (
          await db.select<{ id: string; po_number: string | null }>('orders', { columns: 'id,po_number', filters: [['rfq_id', 'eq', rfqId]], order: [{ column: 'created_at', ascending: true }], limit: 1 })
        )[0];
        if (order) return { order_id: order.id, po_number: order.po_number ?? null };
        const rfq = (await db.select<{ status: string | null }>('rfqs', { columns: 'status', filters: [['id', 'eq', rfqId]], limit: 1 }))[0];
        return rfq?.status === 'approved' ? { order_id: null, po_number: null } : null;
      });

    /**
     * Final outcome of the quote under the current phase run: flag gate; for 'won' the order (order-<tag>, its own
     * step, so a retried outcome step never calls the RPC again) unless the RFQ was accepted elsewhere (`existing`:
     * that order is kept, none is created and no event is sent, the dispatcher starts post-order for it); row
     * status, notice, vectors, run closed.
     */
    const finalise = async (tag: string, outcome: 'won' | 'lost' | 'counter_offer' | 'expired', reason: string, existing?: ExistingOrder): Promise<QuoteResult> => {
      await flagGate(`outcome-${tag}`);
      const ctx = cur;
      const created =
        outcome === 'won' && !existing
          ? await run(`order-${tag}`, DB, async () => {
              need(env, 'AGENT_EVENTS');
              const res = await db.rpc<unknown>('create_order_from_quote', { p_quote_workflow_id: snap.qwid });
              const row = (Array.isArray(res) ? res[0] : res) as { order_id?: string; po_number?: string | null } | undefined;
              if (!row?.order_id) throw new NonRetryableError('order_missing');
              return { order_id: row.order_id, po_number: row.po_number ?? null };
            })
          : null;
      const order: ExistingOrder | null = created ?? existing ?? null;
      await run(`outcome-${tag}`, DB, async () => {
        if (created) {
          need(env, 'AGENT_EVENTS');
          const message: AgentEventV1 = { v: 1, type: 'order-created', order_id: created.order_id, tenant_id: tenant, source: 'quote' };
          await env.AGENT_EVENTS.send(message, { contentType: 'json' });
        }
        await patchQuoteWorkflow(db, snap.qwid, { status: outcome, outcome_reason: reason, current_step: `outcome-${tag}`, last_event_at: ports.clock.now().toISOString() }, LIVE_STATUSES);
        if (outcome === 'won' || outcome === 'counter_offer') {
          const text =
            outcome === 'counter_offer'
              ? 'Customer asked for changes (counter-offer): revise the quote on the dashboard'
              : existing
                ? `RFQ accepted on the portal or dashboard${order?.po_number ? ` (order ${order.po_number})` : ''}: no further follow-ups`
                : `Customer accepted: order ${order?.po_number ?? ''} created`;
          await sendNotice(quoteNotice({ run_id: ctx.id, site_origin: env.SITE_ORIGIN, rfq_number: snap.rfq_number, version, company: snap.company, country: snap.country, text }));
        }
        return true;
      });
      const usage = await run(`index-outcome-${tag}`, EMBED, async () => indexLines(outcome === 'counter_offer' ? 'counter_offer' : outcome, ctx, `index-outcome-${tag}`));
      if (usage) ctx.acc = addUsage(ctx.acc, usage, `index-outcome-${tag}`);
      await run(`close-${tag}`, DB, async () => {
        await closeRun(db, ctx.id, { status: 'succeeded', output: { quote_workflow_id: snap.qwid, outcome, reason, ...(order?.order_id ? { order_id: order.order_id } : {}) } }, ctx.acc);
        return true;
      });
      log(outcome);
      return { outcome, run_id: ctx.id, quote_workflow_id: snap.qwid, ...(order?.order_id ? { order_id: order.order_id } : {}) };
    };

    /** A customer reply: checks, classification, then a direct outcome, a notice or a person's decision (rules in
     *  the header). Returns the final result, or the clock reading after the reply when the quote keeps waiting. */
    const handleReply = async (inboundId: string, n: number): Promise<{ done: QuoteResult } | { at: number }> => {
      const { ctx, final, at } = await openPhaseRun(`reply-${n}`, `reply:${inboundId}`, UUID.test(inboundId) ? { type: 'inbound_email', id: inboundId } : undefined);
      if (final) return { at };
      const checks = await run<ReplyChecks>(`reply-check-${n}`, DB, async () => {
        const row = (
          await db.select<{ from_email: string | null; in_reply_to: string | null; references_ids: string[] | null; auth_results: AuthResults | null }>('inbound_emails', {
            columns: 'from_email,in_reply_to,references_ids,auth_results',
            filters: [['id', 'eq', inboundId]],
            limit: 1,
          })
        )[0];
        if (!row) throw new NonRetryableError('inbound_email_missing');
        const ours = new Set(((await getQuoteWorkflow(db, snap.qwid))?.outbound_message_ids ?? []).map(normaliseMessageId).filter(Boolean));
        const ids = [row.in_reply_to, ...(Array.isArray(row.references_ids) ? row.references_ids : [])].map((id) => normaliseMessageId(id ?? '')).filter(Boolean);
        const from = String(row.from_email ?? '').trim().toLowerCase();
        const contact = String((await readContact(db, rfqId)).email ?? '').trim().toLowerCase();
        return {
          in_thread: ids.some((id) => ours.has(id)),
          sender_authenticated: dmarcPass(row.auth_results, row.from_email),
          sender_is_contact: Boolean(from) && from === contact,
          sender_masked: row.from_email ? maskEmail(row.from_email) : null,
        };
      });
      // set by the classification step's input (same step, so the cached result carries it)
      let delimiter = false;
      const cls = await llmStep<ClassifyReplyV1, { outcome: ClassifyReplyV1['outcome']; confidence: number; injection_suspected: boolean }>(
        `classify-reply-${n}`,
        'classify-reply',
        LLM_CLASSIFY,
        prompts.reply,
        async () => {
          const row = (await db.select<{ subject: string | null; raw_r2_key: string | null; body_excerpt: string | null }>('inbound_emails', { columns: 'subject,raw_r2_key,body_excerpt', filters: [['id', 'eq', inboundId]], limit: 1 }))[0];
          if (!row) throw new NonRetryableError('inbound_email_missing');
          let text = row.body_excerpt ?? '';
          if (row.raw_r2_key) {
            const raw = await ports.blob.get(row.raw_r2_key);
            if (raw) text = stripQuoted((await parseMime(await new Response(raw.body).arrayBuffer())).text);
          }
          delimiter = hasBlockDelimiter(`${row.subject ?? ''}\n${text}`);
          return replyContent(row.subject, text);
        },
        async (v) => {
          const confidence = Math.min(1, Math.max(0, Number(v.confidence) || 0));
          await db.update(
            'inbound_emails',
            { classification: { quote_reply: { outcome: v.outcome, confidence, summary: clean(v.summary, 300), injection_suspected: delimiter, prompt: prompts.reply } }, quote_workflow_id: snap.qwid },
            { filters: [['id', 'eq', inboundId]] },
          );
          return { outcome: v.outcome, confidence, injection_suspected: delimiter };
        },
      );
      const route = replyRoute(cls, checks, cls.injection_suspected);
      let result: 'won' | 'lost' | 'counter_offer' | 'ignore';
      if (route === 'apply') result = 'lost';
      else if (route === 'notice') {
        await run(`reply-notice-${n}`, NOTIFY, async () => {
          await sendNotice(quoteNotice({ run_id: ctx.id, site_origin: env.SITE_ORIGIN, rfq_number: snap.rfq_number, version, company: snap.company, country: snap.country, kind: 'reply', text: cls.outcome === 'question' ? 'Customer replied with a question: answer it from the mailbox' : 'Customer replied (not an outcome): read it in the mailbox' }));
          return true;
        });
        result = 'ignore';
      } else if (route === 'ignore') result = 'ignore';
      else {
        const card = (reminder: boolean): CardV1 =>
          quoteReplyCard({
            run_id: ctx.id,
            site_origin: env.SITE_ORIGIN,
            rfq_number: snap.rfq_number,
            version,
            sender_masked: checks.sender_masked,
            outcome: cls.outcome,
            confidence: cls.confidence,
            checks,
            injection_suspected: cls.injection_suspected,
            reminder,
          });
        await run(`request-reply-${n}`, NOTIFY, async () => {
          await checkpointRun(db, ctx.id, ctx.acc);
          await restoreWaiting();
          await request(env, ports, { run_id: ctx.id, card: card(false) }, { output: { quote_workflow_id: snap.qwid, inbound_email_id: inboundId } });
          return true;
        });
        const waited = await waitWithReminder<DecisionEventPayload>(
          step,
          { run_id: ctx.id, type: 'reply-confirmed', first: REPLY_CONFIRM_FIRST, second: REPLY_CONFIRM_SECOND, card: () => card(true), onTimeout: async () => {} },
          { env, ports },
        );
        result = 'timedOut' in waited ? 'ignore' : (REPLY_VERB_OUTCOME[waited.event.verb] ?? 'ignore');
      }
      if (result === 'ignore') {
        const closedReply = await run(`close-reply-${n}`, DB, async () => {
          await closeRun(db, ctx.id, { status: 'succeeded', output: { quote_workflow_id: snap.qwid, inbound_email_id: inboundId, outcome: 'ignore', classified: cls.outcome, route } }, ctx.acc);
          await restoreWaiting();
          return ports.clock.now().getTime();
        });
        return { at: closedReply };
      }
      return { done: await finalise(`reply-${n}`, result, result === 'won' ? 'customer_accepted' : result === 'lost' ? 'customer_declined' : 'customer_counter_offer') };
    };

    // 18-21 follow-ups and replies; each wait's time base is the clock reading of the step before it
    const days = opened.follow_up_days as number[];
    let stageStart = Date.parse(recorded.sent_at);
    let now = closedAt;
    let replies = 0;
    for (let stage = 1; stage <= 3; stage++) {
      const deadline = stageStart + days[stage - 1] * DAY_MS;
      for (;;) {
        let payload: { inbound_email_id?: unknown };
        try {
          const event = await step.waitForEvent<{ inbound_email_id: string }>(`wait-reply-s${stage}-r${replies}`, { type: 'customer-reply', timeout: Math.max(deadline - now, 1000) });
          payload = (event.payload ?? {}) as { inbound_email_id?: unknown };
        } catch (error) {
          if (!isWaitTimeout(error)) throw error;
          break;
        }
        replies++;
        const inboundId = typeof payload.inbound_email_id === 'string' ? payload.inbound_email_id : '';
        const handled = await handleReply(inboundId, replies);
        cur = main;
        if ('done' in handled) return handled.done;
        now = handled.at;
      }
      if (stage < 3) {
        const k = stage as 1 | 2;
        const phase = await openPhaseRun(`fu${k}`, `fu${k}`);
        if (!phase.final) {
          await flagGate(`fu${k}`);
          const accepted = await acceptedElsewhere(`fu${k}-accepted`);
          if (accepted) return await finalise(`fu${k}`, 'won', 'rfq_approved', accepted);
          const fu = await run(`fu${k}-send`, SEND, async () => sendMail(k));
          const rec = await run(`fu${k}-record`, DB, async () => recordMail(k, fu.provider_id));
          followUps = k;
          const ctx = cur;
          now = await run(`fu${k}-close`, DB, async () => {
            await closeRun(db, ctx.id, { status: 'succeeded', output: { quote_workflow_id: snap.qwid, follow_up: k } }, ctx.acc);
            await restoreWaiting();
            return ports.clock.now().getTime();
          });
          stageStart = Date.parse(rec.sent_at);
        } else {
          // this follow-up's run was already closed (a replay): its mail was sent
          followUps = k;
          stageStart = deadline;
          now = phase.at;
        }
        cur = main;
      }
    }

    // 22 expiry, unless the RFQ was accepted outside the quote e-mails in the meantime
    await openPhaseRun('expire', 'expire');
    await flagGate('expire');
    const late = await acceptedElsewhere('expire-accepted');
    if (late) return await finalise('expire', 'won', 'rfq_approved', late);
    return await finalise('expire', 'expired', 'no_reply');
  } catch (error) {
    if (error instanceof Halt) return error.result;
    const code = errorCode(error);
    const failedStep = current;
    // the run the failed step belongs to (a phase run that was being opened is opened here, so it can carry the card)
    const failedOwner: RunCtx | PhaseRef = owner ?? cur;
    console.error(formatLogLine(LOG_PREFIX, 'quote step failed', { rfq_id: rfqId, version, step: failedStep, error: code }));
    const failed = await step.do('fail-run', DB, async () => {
      const ctx: RunCtx = 'phase' in failedOwner ? { id: (await openRun(db, phaseRunFields(failedOwner))).run_id, acc: { ...EMPTY_USAGE, by_step: {} } } : failedOwner;
      await failRun(env, ports, ctx.id, { error: code, failed_step: failedStep, restartable: true }, ctx.acc);
      if (qwid) await patchQuoteWorkflow(db, qwid, { status: 'failed', error: code, current_step: failedStep, last_event_at: ports.clock.now().toISOString() }, QUOTE_ACTIVE_STATUSES);
      return { run_id: ctx.id };
    });
    log('failed');
    return { outcome: 'failed', run_id: failed.run_id, ...(qwid ? { quote_workflow_id: qwid } : {}), failed_step: failedStep };
  }
}
