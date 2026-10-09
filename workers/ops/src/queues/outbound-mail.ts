// Consumer of the queue "outbound-mail" (Phase 5, unit M5): one campaign mail or follow-up per message, paced by
// SenderLimiter, sent through Gmail or Resend, and the campaign close. PHASE5_SPEC §5.3 and §6.5; the send itself is
// the repo function's (supabase/functions/send-campaign/index.ts:293-433, process-followups/index.ts:159-205).
//
// Per message, in order (messages of a batch one after another)
//   1 shape    a body that is not an OutboundMailV1 (idem = 'camp:<campaign>:<subscriber>:<sequence>') is logged and
//              acked: it can never succeed
//   2 hold     OUTBOUND_MAIL_STOPPED or OUTBOUND_MAIL_PAUSED = "true" -> a copy is sent with delaySeconds 3,600 and
//              the same `deferrals` (a hold is not a deferral), the original acked
//   3 reserve  SenderLimiter.reserve on the preferred account ('default' when null); exhausted -> the campaign's
//              other active accounts in round-robin order; none left (or no active account) -> deferred to the next
//              00:00 UTC + a jitter of at most 600 s; already_sent -> the database rows are finalised only
//   4 spacing  not_before at most 60 s away -> waited for in-process; else deferred by not_before - now
//   5 compose  subscriber, the message's one 'sent' event (src/marketing/events.ts; its id is derived from idem), the
//              subscriber's status at send time (not 'active', or a follow-up whose subscriber has replied -> final
//              non-send: event 'bounced' {error subscriber_inactive | subscriber_replied}, recipient row 'skipped',
//              limiter release), body (CSV row custom_body, else the campaign body; follow-up: the row's custom_body),
//              spintax (drawn from the message's own seeded source, so every delivery has the same payload) and
//              variables, then pixel, click tracking and unsubscribe link (src/marketing/tracking.ts)
//   6 send     google_workspace account -> Gmail (Phase 4 access token, Phase 5 gmailSend); resend account or the
//              default identity -> Resend with Idempotency-Key = idem (src/marketing/send-*.ts)
//   7 outcome  success: event metadata {gmail_id | resend_id, from} (follow-ups keep {sequence_number, follow_up}),
//              resend_email_id = provider id, recipient row 'sent' + sent_at, limiter commit, emails_sent_today
//              mirror; failure: provider 5xx, 429 and network errors -> retry() (the reservation is kept), every other
//              failure and the last delivery -> event 'bounced' {error}, recipient row 'failed', limiter release
//   8 close    once per batch for every campaign with a final outcome of a campaign mail in it, unless the batch read
//              the campaign as 'sent' already: src/marketing/campaign-close.ts
// Deferral = OUTBOUND_MAIL.send({...body, deferrals: deferrals + 1}, {delaySeconds}) then ack() of the original, so
// waiting never spends a retry; every delay is clamped to 86,400 s (the Queues limit for delaySeconds); a deferral
// that would make deferrals exceed 30 is a final failure instead.
// Duplicates: a 'sent' event that already carries a provider id means the mail went out (commit and finalise only).
// An unfinished event found by a first delivery (attempts 1) belongs to another copy in flight while it is younger
// than 15 min (acked, no send), unless that delivery is the delayed copy the message's own earlier delivery handed
// over: a delivery whose message was delivered before (attempts > 1) and whose event exists unfinished records the
// hand-over (SenderLimiter.handOff) before it sends its deferral or hold copy, and the copy that takes the record
// (takeHandoff) goes on to send.
// Log lines carry ids, codes and counts, never an address, a subject, a body or a token.

import { formatLogLine } from '../../../shared/src/http/log';
import { isConfigMissing, need } from '../agents/config';
import { DbError, type Db } from '../db/postgrest';
import type { SenderLimiter } from '../do/sender-limiter';
import { DEFAULT_SENDER } from '../do/sender-limiter';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { closeCampaignIfDone } from '../marketing/campaign-close';
import { ensureEvent, eventIdFor, getEvent, IN_FLIGHT_MS, isFinalEvent, type EventRow } from '../marketing/events';
import { defaultRandom, messageRandom, personalise, type RandomSource } from '../marketing/personalise';
import { loadCampaign, type CampaignRow } from '../marketing/recipients';
import { sendViaGmail, type SendOutcome } from '../marketing/send-gmail';
import { DEFAULT_FROM, sendViaResend } from '../marketing/send-resend';
import { activeSenders, candidateOrder, mirrorSentToday, providerConfig, readSettings, type MarketingSettings, type SenderRow } from '../marketing/sender-rows';
import { applyTracking, trackingDomainOf } from '../marketing/tracking';
import { makePorts, type Ports } from '../ports/index';
import { makeP5Ports, type P5Ports } from '../ports/p5';
import type { OutboundMailV1 } from './messages';

/** max_retries of the consumer (wrangler.jsonc); attempts counts deliveries from 1. */
export const MAX_RETRIES = 3;
export const MAX_DEFERRALS = 30;
export const WAIT_IN_PROCESS_MS = 60_000;
export const HOLD_DELAY_S = 3600;
export const MAX_DELAY_S = 86_400;
export const MIDNIGHT_JITTER_S = 600;
/** Age under which an unfinished event of a first delivery belongs to a copy in flight (src/marketing/events.ts). */
export { IN_FLIGHT_MS };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OutboundMailDeps {
  ports?: Ports;
  p5?: P5Ports;
  /** In-process wait (default setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Midnight jitter (default Math.random). */
  random?: RandomSource;
  /** Spintax source of one message (default messageRandom(idem), src/marketing/personalise.ts). */
  spintax?: (idem: string) => RandomSource | Promise<RandomSource>;
  /** fetch of the Resend calls (default the global fetch). */
  fetch?: typeof fetch;
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** True for a well-formed OutboundMailV1 whose idem names its own campaign, subscriber and sequence. */
export function isOutboundMail(body: unknown): body is OutboundMailV1 {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Partial<OutboundMailV1>;
  return (
    b.v === 1 &&
    (b.kind === 'campaign' || b.kind === 'followup') &&
    isUuid(b.campaign_id) &&
    isUuid(b.subscriber_id) &&
    (b.recipient_record_id === null || isUuid(b.recipient_record_id)) &&
    typeof b.sequence === 'number' && Number.isSafeInteger(b.sequence) && b.sequence >= 1 &&
    (b.kind === 'campaign' ? b.sequence === 1 : b.sequence > 1) &&
    typeof b.subject === 'string' &&
    (b.preferred_account_id === null || isUuid(b.preferred_account_id)) &&
    b.idem === `camp:${b.campaign_id}:${b.subscriber_id}:${b.sequence}` &&
    typeof b.run_id === 'string' && b.run_id !== '' &&
    typeof b.deferrals === 'number' && Number.isSafeInteger(b.deferrals) && b.deferrals >= 0
  );
}

/** delaySeconds of a deferral: whole seconds, 0 to 86,400. */
export function clampDelay(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(MAX_DELAY_S, Math.ceil(seconds));
}

/** Seconds from now to the next 00:00 UTC plus the jitter (not yet clamped). */
export function secondsToMidnight(now: number, jitterS: number): number {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return (midnight - now) / 1000 + jitterS;
}

function log(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.log(formatLogLine(LOG_PREFIX, `outbound-mail ${event}`, fields));
}

function logError(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  console.error(formatLogLine(LOG_PREFIX, `outbound-mail ${event}`, fields));
}

function errorName(e: unknown): string {
  if (isConfigMissing(e)) return 'config_missing';
  if (e instanceof DbError) return `db_error_${e.status}`;
  return e instanceof Error && /^[A-Za-z][A-Za-z0-9_]*$/.test(e.name) ? e.name : 'error';
}

interface SubscriberRow {
  id: string;
  email: string;
  name: string | null;
  status: string | null;
  replied_at: string | null;
}

/** Reads shared by the messages of one batch. */
class BatchReads {
  private readonly campaigns = new Map<string, Promise<CampaignRow | null>>();
  private readonly senders = new Map<string, Promise<SenderRow[]>>();
  private settingsRead?: Promise<MarketingSettings | null>;

  constructor(private readonly db: Db) {}

  campaign(id: string): Promise<CampaignRow | null> {
    let read = this.campaigns.get(id);
    if (!read) this.campaigns.set(id, (read = loadCampaign(this.db, id)));
    return read;
  }

  activeSenders(campaign: CampaignRow): Promise<SenderRow[]> {
    let read = this.senders.get(campaign.id);
    if (!read) this.senders.set(campaign.id, (read = activeSenders(this.db, campaign.sender_account_ids ?? [])));
    return read;
  }

  settings(): Promise<MarketingSettings | null> {
    return (this.settingsRead ??= readSettings(this.db));
  }
}

interface MessageContext {
  msg: Message<unknown>;
  body: OutboundMailV1;
  env: OpsEnv & Required<Pick<OpsEnv, 'SENDER_LIMITER' | 'OUTBOUND_MAIL'>>;
  ports: Ports;
  p5: () => P5Ports;
  reads: BatchReads;
  deps: OutboundMailDeps;
  random: RandomSource;
  /** Campaigns of the batch with a final outcome of a campaign mail (closed at the end of the batch). */
  closeAfter: Set<string>;
  /** The sender object whose reservation this delivery holds (set once reserve answered ok). */
  account?: string;
}

type Limiter = DurableObjectStub<SenderLimiter>;

function limiterOf(c: MessageContext, account: string): Limiter {
  return c.env.SENDER_LIMITER.get(c.env.SENDER_LIMITER.idFromName(account)) as Limiter;
}

/** The object that keeps the message's hand-over records: its preferred account, or the default sender. */
function handoffLimiter(c: MessageContext): Limiter {
  return limiterOf(c, c.body.preferred_account_id ?? DEFAULT_SENDER);
}

/** Before a delivered-before message is deferred or held: records the hand-over when its event exists unfinished. */
async function handOffIfComposed(c: MessageContext): Promise<void> {
  if (c.msg.attempts <= 1) return;
  const event = await getEvent(c.ports.db, await eventIdFor(c.body.idem));
  if (!event || isFinalEvent(event)) return;
  await handoffLimiter(c).handOff({ idem: c.body.idem, now: c.ports.clock.now().getTime() });
}

function baseMetadata(body: OutboundMailV1): Record<string, unknown> {
  return body.kind === 'followup' ? { sequence_number: body.sequence, follow_up: true } : {};
}

/** Sends a copy with the given delay (counted as a deferral or not) and acks the original. */
async function defer(c: MessageContext, seconds: number, counted: boolean, reason: string): Promise<void> {
  const deferrals = counted ? c.body.deferrals + 1 : c.body.deferrals;
  if (counted && deferrals > MAX_DEFERRALS) {
    await finalFailure(c, 'deferral_limit', null);
    return;
  }
  const delaySeconds = clampDelay(seconds);
  await handOffIfComposed(c);
  await c.env.OUTBOUND_MAIL.send({ ...c.body, deferrals }, { delaySeconds });
  c.msg.ack();
  log('deferred', { campaign_id: c.body.campaign_id, reason, delay_s: delaySeconds, deferrals });
}

/** Marks the campaign for the close at the end of the batch after a final outcome of a campaign mail. */
function closeIfDone(c: MessageContext): void {
  if (c.body.kind === 'campaign') c.closeAfter.add(c.body.campaign_id);
}

/** The campaign close of the batch (a failure is logged, never thrown); a campaign read as 'sent' is skipped. */
async function closeCampaigns(ids: Iterable<string>, ports: Ports, reads: BatchReads): Promise<void> {
  for (const id of ids) {
    try {
      if ((await reads.campaign(id))?.status === 'sent') continue;
      const out = await closeCampaignIfDone(ports.db, id, ports.clock.now());
      if (out.closed) log('campaign closed', { campaign_id: id, sent: out.sent, bounced: out.bounced, expected: out.expected });
    } catch (e) {
      logError('campaign close failed', { campaign_id: id, error: errorName(e) });
    }
  }
}

/** Mirrors the limiter's count of the account into emails_sent_today (best effort). */
async function mirror(c: MessageContext, account: string): Promise<void> {
  if (account === DEFAULT_SENDER) return;
  try {
    const stats = await limiterOf(c, account).stats();
    await mirrorSentToday(c.ports.db, account, stats.sent_today);
  } catch (e) {
    logError('mirror failed', { account_id: account, error: errorName(e) });
  }
}

/** The recipient row's status (only while it is still pending, so a later outcome never overwrites a final one). */
async function markRecipient(c: MessageContext, status: 'sent' | 'failed' | 'skipped'): Promise<void> {
  if (!c.body.recipient_record_id) return;
  const patch: Record<string, unknown> = { status };
  if (status === 'sent') patch.sent_at = c.ports.clock.now().toISOString();
  await c.ports.db.update('marketing_campaign_recipients', patch, { filters: [['id', 'eq', c.body.recipient_record_id], ['status', 'eq', 'pending']] });
}

/** Final failure: event 'bounced' {error} (unless the mail went out), recipient 'failed' (or 'skipped' for a final
 *  non-send), limiter release, ack. */
async function finalFailure(c: MessageContext, error: string, account: string | null, recipient: 'failed' | 'skipped' = 'failed'): Promise<void> {
  const db = c.ports.db;
  const id = await eventIdFor(c.body.idem);
  const metadata = { ...baseMetadata(c.body), error };
  try {
    await db.insert('marketing_events', { id, campaign_id: c.body.campaign_id, subscriber_id: c.body.subscriber_id, event_type: 'bounced', metadata });
  } catch (e) {
    if (!(e instanceof DbError) || e.code !== '23505') throw e;
    await db.update('marketing_events', { event_type: 'bounced', metadata }, { filters: [['id', 'eq', id], ['resend_email_id', 'is', null]] });
  }
  await markRecipient(c, recipient);
  if (account) await limiterOf(c, account).release({ idem: c.body.idem });
  c.msg.ack();
  log('final failure', { campaign_id: c.body.campaign_id, kind: c.body.kind, error });
  closeIfDone(c);
}

/** The mail went out earlier (limiter key 'sent' or a final 'sent' event): finalise the database rows only. */
async function finaliseOnly(c: MessageContext, account: string, providerId: string | null): Promise<void> {
  if (providerId) await limiterOf(c, account).commit({ idem: c.body.idem, provider_id: providerId });
  await markRecipient(c, 'sent');
  await mirror(c, account);
  c.msg.ack();
  log('already sent', { campaign_id: c.body.campaign_id, kind: c.body.kind });
  closeIfDone(c);
}

/** Candidate sender objects of the message: 'default', or the campaign's active accounts from the preferred one. */
async function candidates(c: MessageContext, campaign: CampaignRow): Promise<Array<{ name: string; row: SenderRow | null }>> {
  if (c.body.preferred_account_id === null) return [{ name: DEFAULT_SENDER, row: null }];
  const senders = await c.reads.activeSenders(campaign);
  return candidateOrder(senders, c.body.preferred_account_id, campaign.sender_account_ids ?? []).map((row) => ({ name: row.id, row }));
}

async function readSubscriber(db: Db, id: string): Promise<SubscriberRow | null> {
  const rows = await db.select<SubscriberRow & Record<string, unknown>>('marketing_subscribers', { columns: 'id,email,name,status,replied_at', filters: [['id', 'eq', id]], limit: 1 });
  const row = rows[0] as SubscriberRow | undefined;
  return row && typeof row.email === 'string' && row.email !== '' ? row : null;
}

async function bodyTemplate(c: MessageContext, campaign: CampaignRow): Promise<string> {
  let custom: string | null = null;
  if (c.body.recipient_record_id) {
    const rows = await c.ports.db.select<{ custom_body: string | null }>('marketing_campaign_recipients', { columns: 'custom_body', filters: [['id', 'eq', c.body.recipient_record_id]], limit: 1 });
    custom = rows[0]?.custom_body ?? null;
  }
  if (c.body.kind === 'followup') return custom || '';
  return custom || campaign.body;
}

async function send(c: MessageContext, chosen: { name: string; row: SenderRow | null }, m: { to: string; subject: string; html: string }): Promise<{ outcome: SendOutcome; from: string; idField: 'gmail_id' | 'resend_id' }> {
  const env = c.env;
  if (!chosen.row) {
    const outcome = await sendViaResend({ apiKey: env.RESEND_API_KEY, baseUrl: env.RESEND_API_BASE, fetch: c.deps.fetch }, { from: DEFAULT_FROM, idem: c.body.idem, ...m });
    return { outcome, from: DEFAULT_FROM, idField: 'resend_id' };
  }
  const account = chosen.row;
  const from = `${account.display_name} <${account.email}>`;
  const config = await providerConfig(c.ports.db, account.id);
  if (account.provider === 'google_workspace') {
    return { outcome: await sendViaGmail(c.ports.gmail, c.p5().gmailSend, account, config, m), from, idField: 'gmail_id' };
  }
  const own = typeof config?.api_key === 'string' && config.api_key !== '' ? config.api_key : undefined;
  const outcome = await sendViaResend({ apiKey: own ?? env.RESEND_API_KEY, baseUrl: env.RESEND_API_BASE, fetch: c.deps.fetch }, { from, idem: c.body.idem, ...m });
  return { outcome, from, idField: 'resend_id' };
}

async function handle(c: MessageContext): Promise<void> {
  const { body, ports } = c;
  const db = ports.db;
  // 2. Hold.
  if (c.env.OUTBOUND_MAIL_STOPPED === 'true' || c.env.OUTBOUND_MAIL_PAUSED === 'true') {
    await defer(c, HOLD_DELAY_S, false, c.env.OUTBOUND_MAIL_STOPPED === 'true' ? 'stopped' : 'paused');
    return;
  }
  const campaign = await c.reads.campaign(body.campaign_id);
  if (!campaign) {
    logError('campaign missing', { campaign_id: body.campaign_id });
    c.msg.ack();
    return;
  }
  // 3. Reserve.
  const now = ports.clock.now().getTime();
  const order = await candidates(c, campaign);
  let chosen: { name: string; row: SenderRow | null } | null = null;
  let notBefore = now;
  for (const candidate of order) {
    const result = await limiterOf(c, candidate.name).reserve({ idem: body.idem, now });
    if (result.status === 'already_sent') {
      await finaliseOnly(c, candidate.name, null);
      return;
    }
    if (result.status === 'ok') {
      chosen = candidate;
      notBefore = result.not_before;
      break;
    }
  }
  if (!chosen) {
    await defer(c, secondsToMidnight(now, Math.floor(c.random() * (MIDNIGHT_JITTER_S + 1))), true, order.length === 0 ? 'no_sender' : 'cap');
    return;
  }
  c.account = chosen.name;
  // 4. Spacing.
  const wait = notBefore - now;
  if (wait > WAIT_IN_PROCESS_MS) {
    await defer(c, wait / 1000, true, 'spacing');
    return;
  }
  if (wait > 0) await (c.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
  // 5. Compose.
  const subscriber = await readSubscriber(db, body.subscriber_id);
  if (!subscriber) {
    await limiterOf(c, chosen.name).release({ idem: body.idem });
    logError('subscriber missing', { campaign_id: body.campaign_id });
    c.msg.ack();
    return;
  }
  const eventId = await eventIdFor(body.idem);
  const ensured = await ensureEvent(db, { id: eventId, campaign_id: body.campaign_id, subscriber_id: body.subscriber_id, metadata: baseMetadata(body) });
  if (!ensured.created) {
    const existing: EventRow = ensured.event;
    if (isFinalEvent(existing)) {
      if (existing.event_type === 'sent') await finaliseOnly(c, chosen.name, existing.resend_email_id);
      else {
        await limiterOf(c, chosen.name).release({ idem: body.idem });
        c.msg.ack();
      }
      return;
    }
    if (c.msg.attempts === 1 && !(await handoffLimiter(c).takeHandoff({ idem: body.idem }))) {
      const age = existing.created_at ? ports.clock.now().getTime() - Date.parse(existing.created_at) : Number.POSITIVE_INFINITY;
      if (Number.isFinite(age) && age < IN_FLIGHT_MS) {
        log('duplicate in flight', { campaign_id: body.campaign_id, kind: body.kind });
        c.msg.ack();
        return;
      }
    }
  }
  // The subscriber's status at send time (the message may have waited for a cap, a slot or a hold).
  const inactive = subscriber.status !== 'active' ? 'subscriber_inactive' : body.kind === 'followup' && subscriber.replied_at ? 'subscriber_replied' : null;
  if (inactive) {
    await finalFailure(c, inactive, chosen.name, 'skipped');
    return;
  }
  const template = await bodyTemplate(c, campaign);
  const settings = await c.reads.settings();
  const spintax = await (c.deps.spintax ?? messageRandom)(body.idem);
  const text = personalise(body.subject, template, subscriber, spintax, body.kind);
  const html = applyTracking(text.body, {
    eventId,
    campaignId: body.campaign_id,
    domain: trackingDomainOf(settings, c.env),
    kind: body.kind,
    unsubscribeEnabled: settings?.unsubscribe_link_enabled ?? true,
  });
  // 6. Send.
  const { outcome, from, idField } = await send(c, chosen, { to: subscriber.email, subject: text.subject, html });
  // 7. Outcome.
  if (outcome.ok) {
    await db.update('marketing_events', { metadata: { ...baseMetadata(body), [idField]: outcome.provider_id, from }, resend_email_id: outcome.provider_id }, { filters: [['id', 'eq', eventId]] });
    await markRecipient(c, 'sent');
    await limiterOf(c, chosen.name).commit({ idem: body.idem, provider_id: outcome.provider_id });
    await mirror(c, chosen.name);
    c.msg.ack();
    log('sent', { campaign_id: body.campaign_id, kind: body.kind, via: idField === 'gmail_id' ? 'gmail' : 'resend' });
    closeIfDone(c);
    return;
  }
  if (outcome.retryable && c.msg.attempts <= MAX_RETRIES) {
    log('retry', { campaign_id: body.campaign_id, kind: body.kind, error: outcome.error, attempts: c.msg.attempts });
    c.msg.retry();
    return;
  }
  await finalFailure(c, outcome.error, chosen.name);
}

export async function outboundMailConsumer(
  batch: MessageBatch<OutboundMailV1>,
  env: OpsEnv,
  ctx: ExecutionContext,
  deps: OutboundMailDeps = {},
): Promise<void> {
  void ctx;
  let p5 = deps.p5;
  let shared: { ports: Ports; reads: BatchReads } | undefined;
  const closeAfter = new Set<string>();
  for (const msg of batch.messages as ReadonlyArray<Message<unknown>>) {
    const body = msg.body;
    if (!isOutboundMail(body)) {
      logError('invalid message', { id: msg.id });
      msg.ack();
      continue;
    }
    let c: MessageContext | undefined;
    try {
      need(env, 'SENDER_LIMITER', 'OUTBOUND_MAIL');
      if (!shared) {
        const ports = deps.ports ?? makePorts(env);
        shared = { ports, reads: new BatchReads(ports.db) };
      }
      c = {
        msg,
        body,
        env,
        ports: shared.ports,
        p5: () => (p5 ??= makeP5Ports(env)),
        reads: shared.reads,
        deps,
        random: deps.random ?? defaultRandom,
        closeAfter,
      };
      await handle(c);
    } catch (e) {
      logError('message error', { campaign_id: body.campaign_id, kind: body.kind, attempts: msg.attempts, error: errorName(e) });
      // The last delivery records the failure (so the campaign can close); otherwise the message is retried.
      if (c && msg.attempts > MAX_RETRIES) {
        try {
          await finalFailure(c, errorName(e), c.account ?? null);
          continue;
        } catch (inner) {
          logError('final failure not recorded', { campaign_id: body.campaign_id, error: errorName(inner) });
        }
      }
      msg.retry();
    }
  }
  if (shared && closeAfter.size > 0) await closeCampaigns(closeAfter, shared.ports, shared.reads);
}
