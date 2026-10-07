// Inbound replies (queue agent-events, type 'inbound-reply'), and the human decision on a "Which RFQ?" card.
//
//   flag      agent.quote off -> nothing happens: no run, the inbound_emails row stays as it is (the 10-minute
//             dispatcher sends rows left 'received' again)
//   open-run  agent 'quote.reply_poller' (the reply key of the quote agent, shared with the Gmail poller; the
//             quote Workflow's daily run count covers quote drafting only), trigger 'queue', key
//             'inbound-reply:<inbound_email_id>'; a final run (or one waiting on its card) means the reply was
//             handled: nothing more happens
//   match     replies/match.ts: rules 1-4 (Gmail copies: 1-3, the poller stores only those)
//   sender    senderCheck(): authenticated = trusted DMARC pass for the From domain (mail-in/auth-results.ts
//             dmarcPass); same_domain = the From domain is the RFQ contact's domain
//   1-3       confirmed (authenticated, and for rule 3 also same_domain) -> attach: attachments stored
//             (email/<sha>/att/…), RFQ-file kinds copied to rfq/<rfq_id>/… with rfq_files rows, body_excerpt
//             written; RfqThread(<rfq_id>).appendInbound() forwards 'customer-reply' to the bound quote instance; row
//             'matched' with rfq_id and quote_workflow_id; rule 3 also posts a notice card. Not confirmed -> the
//             confirmation card (kind reply_pick, the one RFQ as candidate 1, flag dmarc_fail unless authenticated);
//             row 'needs_review'; files are copied and the reply forwarded only after attach_1
//   4         "Which RFQ?" card (kind reply_pick, candidates in output.candidates); row 'needs_review'
//   5         replies mailbox: a new RFQ (rfq-intake started for the row; with agent.rfq_intake off the row goes to
//             'needs_review'); Gmail copy: ignored (row 'rejected'); rfq mailbox (handed over by intake as a reply):
//             'needs_review'
//   decision  attach_<n> -> the attach path for candidate n; new_rfq -> rfq-intake; ignore -> row 'rejected'; the
//             run then closes 'succeeded'. A decision that keeps failing closes the run 'failed' and the row 'failed'
//             (failReplyPick, called by the consumer on the message's last attempt)
// Rules
//   - Every write is idempotent (the same keys, conditional status changes), so a redelivered message finishes the
//     work of an earlier attempt; the row's final status is written after the event to the quote went out.
//   - Nothing here logs an address, a subject or a token; log lines carry ids and outcomes.

import { UUID_RE } from '../../../shared/src/agent-api';
import { formatLogLine } from '../../../shared/src/http/log';
import { request } from '../agents/approval';
import { maskEmail } from '../agents/cards/index';
import { replyAttachedCard, replyPickCard, type ReplyCandidateSummary } from '../agents/cards/reply';
import { need } from '../agents/config';
import { readFlag } from '../agents/flags';
import { closeRun, EMPTY_USAGE, isFinal, openRun, type AgentKey, type UsageAcc } from '../agents/runs';
import type { Db } from '../db/postgrest';
import { getRun } from '../db/repos/agent-runs';
import { getInboundEmail, updateInboundEmail, type InboundEmailRow, type InboundStatus } from '../db/repos/inbound-emails';
import { agentFileRow, insertAgentFiles, type RfqFileRow } from '../db/repos/rfq-files';
import { startIntakeFor } from '../entrypoints/mail-ingest';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { storeAttachments, type AttachmentRecord } from '../mail-in/attachments';
import { dmarcPass, domainOf } from '../mail-in/auth-results';
import { parseMime } from '../mail-in/parse';
import { stripQuoted } from '../mail-in/quote-strip';
import { RFQ_FILE_KINDS } from '../mail-in/sniff';
import type { Ports } from '../ports/index';
import { matchReply, type ReplyMatch } from './match';


export type ReplyOutcome =
  | 'bad_input'
  | 'flag_off'
  | 'missing'
  | 'exists'
  | 'done'
  | 'matched'
  | 'card'
  | 'intake'
  | 'intake_flag_off'
  | 'ignored'
  | 'needs_review';

export interface ReplyDeps {
  env: OpsEnv;
  ports: Ports;
  /** Reply attribution (tests pass their own). */
  match?: typeof matchReply;
}

/** Agent key of reply runs (and of the Gmail poller's runs, which have trigger 'cron'). */
export const REPLY_AGENT: AgentKey = 'quote.reply_poller';
/** Statuses after which a reply needs nothing more. */
export const HANDLED_STATUSES: readonly InboundStatus[] = ['matched', 'attached', 'rfq_created', 'rejected', 'spam', 'duplicate'];
/** Statuses an attribution may move a row out of. */
const OPEN_STATUSES: readonly InboundStatus[] = ['received', 'parsed', 'needs_review', 'failed'];
const EXCERPT_CHARS = 4000;

export function replyRunKey(inboundEmailId: string): string {
  return `inbound-reply:${inboundEmailId}`;
}

export interface SenderCheck {
  /** Trusted DMARC pass for the From domain. */
  authenticated: boolean;
  /** The From domain equals the RFQ contact's domain (null when there is no RFQ contact to compare with). */
  same_domain: boolean | null;
}

/** The sender check of a reply against the RFQ it matched (contact e-mail of that RFQ, when known). */
export function senderCheck(row: Pick<InboundEmailRow, 'auth_results' | 'from_email'>, contactEmail: string | null | undefined): SenderCheck {
  const from = domainOf(row.from_email);
  const contact = domainOf(contactEmail);
  return { authenticated: dmarcPass(row.auth_results, row.from_email), same_domain: contact === null ? null : from !== null && from === contact };
}

/** A reply matched by rule 1-3 is attached without a human only when this holds. */
export function attachWithoutConfirmation(rule: 1 | 2 | 3, check: SenderCheck): boolean {
  return check.authenticated && (rule !== 3 || check.same_domain === true);
}

function log(event: string, fields: Record<string, string | number | boolean>): void {
  console.log(formatLogLine(LOG_PREFIX, event, fields));
}

function usage(): UsageAcc {
  return { ...EMPTY_USAGE, by_step: {} };
}

/** Stores the attachments and the quote-stripped text excerpt of a reply (from its raw MIME, when stored). */
async function storeReplyContent(d: ReplyDeps, row: InboundEmailRow): Promise<AttachmentRecord[]> {
  // body_excerpt and attachments are written together, so a set excerpt means the content is stored already.
  if (row.body_excerpt !== null && row.body_excerpt !== undefined) return Array.isArray(row.attachments) ? row.attachments : [];
  const raw = row.raw_r2_key ? await d.ports.blob.get(row.raw_r2_key) : null;
  if (!raw) return Array.isArray(row.attachments) ? row.attachments : [];
  const mail = await parseMime(await new Response(raw.body).arrayBuffer());
  const records = await storeAttachments(d.ports.blob, row.message_id_sha256, mail.attachments);
  await updateInboundEmail(d.ports.db, row.id, { attachments: records, body_excerpt: stripQuoted(mail.text).slice(0, EXCERPT_CHARS), kind: 'reply' });
  return records;
}

/** Copies the RFQ-file kinds of a reply to the RFQ (rfq/<rfq_id>/<file_id>-<safe name>) with rfq_files rows. */
async function copyReplyFiles(d: ReplyDeps, row: InboundEmailRow, rfqId: string, records: readonly AttachmentRecord[]): Promise<RfqFileRow[]> {
  const wanted = records.filter((r) => RFQ_FILE_KINDS.has(r.kind) && !r.inline);
  if (wanted.length === 0) return [];
  const rows: RfqFileRow[] = [];
  for (const r of wanted) {
    const file = await agentFileRow({ rfq_id: rfqId, name: r.filename, sha256: r.sha256, size_bytes: r.size_bytes, content_type: r.content_type, source: 'email', part_id: null, tenant_id: row.tenant_id });
    if (!(await d.ports.blob.head(file.r2_key as string))) await d.ports.blob.copy(r.r2_key, file.r2_key as string);
    rows.push(file);
  }
  return insertAgentFiles(d.ports.db, rfqId, rows);
}

/** The attach path: content stored, files copied, customer-reply forwarded, row 'matched'. */
async function attach(d: ReplyDeps, row: InboundEmailRow, target: { rfq_id: string; quote_workflow_id: string | null }): Promise<{ attachments: number; files: number }> {
  const { env, ports } = d;
  const records = await storeReplyContent(d, row);
  const files = await copyReplyFiles(d, row, target.rfq_id, records);
  need(env, 'RFQ_THREAD');
  await env.RFQ_THREAD.get(env.RFQ_THREAD.idFromName(target.rfq_id)).appendInbound(row.id, row.message_id);
  await updateInboundEmail(ports.db, row.id, { kind: 'reply', status: 'matched', rfq_id: target.rfq_id, quote_workflow_id: target.quote_workflow_id, error: null }, OPEN_STATUSES);
  return { attachments: records.filter((r) => !r.inline).length, files: files.length };
}

async function rfqInfo(db: Db, rfqId: string): Promise<{ rfq_number: string | null; company: string | null; contact_email: string | null }> {
  const rows = await db.select<{ rfq_number: string | null; company_name: string | null; contact_email: string | null }>('rfqs', { columns: 'rfq_number,company_name,contact_email', filters: [['id', 'eq', rfqId]], limit: 1 });
  return { rfq_number: rows[0]?.rfq_number ?? null, company: rows[0]?.company_name ?? null, contact_email: rows[0]?.contact_email ?? null };
}

async function candidateSummaries(db: Db, candidates: ReadonlyArray<{ rfq_id: string; quote_workflow_id: string | null }>): Promise<ReplyCandidateSummary[]> {
  const out: ReplyCandidateSummary[] = [];
  for (const c of candidates) {
    const rfq = await rfqInfo(db, c.rfq_id);
    const q = c.quote_workflow_id
      ? (await db.select<{ quote_version: number; sent_at: string | null }>('quote_workflows', { columns: 'quote_version,sent_at', filters: [['id', 'eq', c.quote_workflow_id]], limit: 1 }))[0]
      : undefined;
    out.push({ rfq_number: rfq.rfq_number, company: rfq.company, version: q?.quote_version ?? null, sent_at: q?.sent_at ?? null });
  }
  return out;
}

/** Posts a reply_pick card for the candidates (one candidate: the confirmation of a rule 1-3 match); row
 *  'needs_review'. */
async function pickCard(d: ReplyDeps, run_id: string, row: InboundEmailRow, o: { rule: 1 | 2 | 3 | 4; candidates: Array<{ rfq_id: string; quote_workflow_id: string | null }>; sender: SenderCheck }): Promise<void> {
  const { env, ports } = d;
  const records = await storeReplyContent(d, row);
  const summaries = await candidateSummaries(ports.db, o.candidates);
  const card = replyPickCard({
    run_id,
    site_origin: env.SITE_ORIGIN,
    sender_masked: row.from_email ? maskEmail(row.from_email) : null,
    candidates: summaries,
    attachments: records.filter((r) => !r.inline).length,
    allow_new_rfq: row.mailbox === 'replies',
    sender: o.sender,
    ...(o.rule === 4 ? {} : { confirm_rule: o.rule }),
  });
  await request(env, ports, { run_id, card }, { output: { inbound_email_id: row.id, mailbox: row.mailbox, rule: o.rule, candidates: o.candidates, sender: o.sender } });
  await updateInboundEmail(ports.db, row.id, { kind: 'reply', status: 'needs_review' }, OPEN_STATUSES);
}

/** Starts rfq-intake for a reply that belongs to no RFQ; with agent.rfq_intake off the row waits for a human. */
async function startNewRfq(d: ReplyDeps, row: InboundEmailRow): Promise<{ outcome: 'intake' | 'intake_flag_off'; intake: string }> {
  const r = await startIntakeFor(d.env, { v: 1, inbound_email_id: row.id, message_id_sha256: row.message_id_sha256, tenant_id: row.tenant_id }, { db: d.ports.db, mailboxes: [row.mailbox] });
  if (r.status === 'started' || r.status === 'exists') return { outcome: 'intake', intake: r.status };
  await updateInboundEmail(d.ports.db, row.id, { status: 'needs_review', error: r.status === 'flag_off' ? 'intake_flag_off' : 'intake_refused' }, OPEN_STATUSES);
  return { outcome: 'intake_flag_off', intake: r.status };
}

/** Handles one 'inbound-reply' message (see the header). Throws on a temporary problem (the queue retries). */
export async function handleInboundReply(m: { inbound_email_id: string; tenant_id: string }, d: ReplyDeps): Promise<ReplyOutcome> {
  const { env, ports } = d;
  const db = ports.db;
  if (!UUID_RE.test(m?.inbound_email_id ?? '') || !UUID_RE.test(m?.tenant_id ?? '')) return 'bad_input';
  const flag = await readFlag(env, 'agent.quote', m.tenant_id);
  if (!flag.enabled) {
    log('reply', { inbound_email_id: m.inbound_email_id, outcome: 'flag_off' });
    return 'flag_off';
  }
  const row = await getInboundEmail(db, m.inbound_email_id);
  if (!row || row.tenant_id !== m.tenant_id) return 'missing';

  const run = await openRun(db, { agent: REPLY_AGENT, trigger: 'queue', idempotency_key: replyRunKey(row.id), subject_type: 'inbound_email', subject_id: row.id, tenant_id: row.tenant_id });
  if (isFinal(run.status) || run.status === 'waiting_human') return 'exists';
  if (HANDLED_STATUSES.includes(row.status)) {
    await closeRun(db, run.run_id, { status: 'succeeded', output: { already: row.status } }, usage());
    return 'done';
  }

  const rules: ReadonlyArray<1 | 2 | 3 | 4> = row.mailbox === 'gmail' ? [1, 2, 3] : [1, 2, 3, 4];
  const match: ReplyMatch = await (d.match ?? matchReply)(db, { message_id: row.message_id, in_reply_to: row.in_reply_to, references: row.references_ids ?? [], subject: row.subject, from_email: row.from_email }, { tenant_id: row.tenant_id, rules });

  if (match.rule === 1 || match.rule === 2 || match.rule === 3) {
    const rfq = await rfqInfo(db, match.rfq_id);
    const sender = senderCheck(row, rfq.contact_email);
    if (!attachWithoutConfirmation(match.rule, sender)) {
      await pickCard(d, run.run_id, row, { rule: match.rule, candidates: [{ rfq_id: match.rfq_id, quote_workflow_id: match.quote_workflow_id }], sender });
      log('reply', { inbound_email_id: row.id, outcome: 'card', rule: match.rule });
      return 'card';
    }
    const done = await attach(d, row, match);
    if (match.rule === 3) {
      try {
        await ports.telegram.sendCard(replyAttachedCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN, rfq_number: rfq.rfq_number, sender_masked: row.from_email ? maskEmail(row.from_email) : null, attachments: done.attachments, quote_waiting: match.quote_workflow_id !== null, authenticated: sender.authenticated }), null);
      } catch {
        console.error(formatLogLine(LOG_PREFIX, 'card send failed', { run_id: run.run_id, kind: 'reply' }));
      }
    }
    await closeRun(db, run.run_id, { status: 'succeeded', output: { rule: match.rule, rfq_id: match.rfq_id, quote_workflow_id: match.quote_workflow_id, attachments: done.attachments, files: done.files } }, usage());
    log('reply', { inbound_email_id: row.id, outcome: 'matched', rule: match.rule });
    return 'matched';
  }

  if (match.rule === 4) {
    await pickCard(d, run.run_id, row, { rule: 4, candidates: match.candidates, sender: senderCheck(row, null) });
    log('reply', { inbound_email_id: row.id, outcome: 'card', candidates: match.candidates.length });
    return 'card';
  }

  // rule 5
  if (row.mailbox === 'replies') {
    const started = await startNewRfq(d, row);
    await closeRun(db, run.run_id, { status: started.outcome === 'intake' ? 'succeeded' : 'skipped', output: { rule: 5, intake: started.intake } }, usage());
    log('reply', { inbound_email_id: row.id, outcome: started.outcome });
    return started.outcome;
  }
  if (row.mailbox === 'gmail') {
    await updateInboundEmail(db, row.id, { kind: 'reply', status: 'rejected' }, OPEN_STATUSES);
    await closeRun(db, run.run_id, { status: 'skipped', output: { rule: 5, action: 'ignored' } }, usage());
    log('reply', { inbound_email_id: row.id, outcome: 'ignored' });
    return 'ignored';
  }
  await updateInboundEmail(db, row.id, { kind: 'reply', status: 'needs_review', error: 'reply_unmatched' }, OPEN_STATUSES);
  await closeRun(db, run.run_id, { status: 'skipped', output: { rule: 5, action: 'needs_review' } }, usage());
  log('reply', { inbound_email_id: row.id, outcome: 'needs_review' });
  return 'needs_review';
}

/** Marks a reply that kept failing: run closed 'failed' with the error code, row 'failed'. */
export async function failInboundReply(m: { inbound_email_id: string }, d: ReplyDeps, code: string): Promise<void> {
  if (!UUID_RE.test(m?.inbound_email_id ?? '')) return;
  const db = d.ports.db;
  const rows = await db.select<{ id: string; status: string }>('agent_runs', { columns: 'id,status', filters: [['agent', 'eq', REPLY_AGENT], ['idempotency_key', 'eq', replyRunKey(m.inbound_email_id)]], limit: 1 });
  const run = rows[0];
  if (run && run.status === 'running') await closeRun(db, run.id, { status: 'failed', error: code }, usage());
  await updateInboundEmail(db, m.inbound_email_id, { status: 'failed', error: code }, OPEN_STATUSES);
}

/** Closes a "Which RFQ?" decision that kept failing: the claimed run 'failed' with the code, its row 'failed'. */
export async function failReplyPick(m: { run_id: string }, d: ReplyDeps, code: string): Promise<void> {
  if (!UUID_RE.test(m?.run_id ?? '')) return;
  const db = d.ports.db;
  const run = await getRun(db, m.run_id);
  if (!run || run.status !== 'running') return;
  await closeRun(db, run.id, { status: 'failed', error: code }, usage());
  const inboundId = typeof run.output?.inbound_email_id === 'string' ? run.output.inbound_email_id : run.subject_id;
  if (inboundId && UUID_RE.test(inboundId)) await updateInboundEmail(db, inboundId, { status: 'failed', error: code }, OPEN_STATUSES);
}

export type PickVerb = 'attach_1' | 'attach_2' | 'attach_3' | 'new_rfq' | 'ignore';

/** The decision on a "Which RFQ?" card (agent-events message type 'decision', card kind reply_pick). */
export async function handleReplyPick(m: { run_id: string; verb: string; candidate?: number }, d: ReplyDeps): Promise<ReplyOutcome> {
  const db = d.ports.db;
  const run = await getRun(db, m.run_id);
  if (!run || isFinal(run.status) || run.status !== 'running') return 'exists';
  const output = run.output ?? {};
  const inboundId = typeof output.inbound_email_id === 'string' ? output.inbound_email_id : run.subject_id;
  const row = inboundId ? await getInboundEmail(db, inboundId) : null;
  if (!row) {
    await closeRun(db, run.id, { status: 'failed', error: 'inbound_email_missing' }, usage());
    return 'missing';
  }
  const candidates = Array.isArray(output.candidates) ? (output.candidates as Array<{ rfq_id?: unknown; quote_workflow_id?: unknown }>) : [];
  const attachN = /^attach_([1-3])$/.exec(m.verb);
  if (attachN) {
    const c = candidates[Number(attachN[1]) - 1];
    if (!c || typeof c.rfq_id !== 'string' || !UUID_RE.test(c.rfq_id)) {
      await closeRun(db, run.id, { status: 'failed', error: 'candidate_missing' }, usage());
      return 'missing';
    }
    const target = { rfq_id: c.rfq_id, quote_workflow_id: typeof c.quote_workflow_id === 'string' ? c.quote_workflow_id : null };
    const done = await attach(d, row, target);
    await closeRun(db, run.id, { status: 'succeeded', output: { ...output, decision: m.verb, rfq_id: target.rfq_id, quote_workflow_id: target.quote_workflow_id, files: done.files } }, usage());
    log('reply pick', { run_id: run.id, verb: m.verb, outcome: 'matched' });
    return 'matched';
  }
  if (m.verb === 'new_rfq' && row.mailbox === 'replies') {
    const started = await startNewRfq(d, row);
    await closeRun(db, run.id, { status: 'succeeded', output: { ...output, decision: m.verb, intake: started.intake } }, usage());
    log('reply pick', { run_id: run.id, verb: m.verb, outcome: started.outcome });
    return started.outcome;
  }
  await updateInboundEmail(db, row.id, { status: 'rejected', error: null }, OPEN_STATUSES);
  await closeRun(db, run.id, { status: 'succeeded', output: { ...output, decision: m.verb === 'new_rfq' ? 'ignore' : m.verb } }, usage());
  log('reply pick', { run_id: run.id, verb: m.verb, outcome: 'ignored' });
  return 'ignored';
}
