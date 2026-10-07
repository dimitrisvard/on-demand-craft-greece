// Gmail reply poller (10-minute cron, called last by cron/dispatcher.ts): reads the inboxes of the active Google
// Workspace sender accounts for replies to our quotes and to marketing campaigns.
//
//   gate      agent.quote enabled (quote-thread path) or agent.quote value.campaign_replies true (campaign path);
//             neither -> no run, nothing read
//   run       agent 'quote.reply_poller', trigger 'cron', key 'gmail:<scheduled time ISO>'; the previous state is
//             output.accounts of the newest succeeded poller run (trigger 'cron'; reply runs share the agent key)
//   resume    poller runs still 'running' 15 minutes after they started ended without closing: each is closed
//             'failed' (error 'interrupted'), and the message it was reading (output.reading) counts one attempt
//             more than the attempts that run had recorded for it
//   token     the stored access token while valid for 5 more minutes, else a refresh in memory (never written back);
//             invalid_grant -> the account is skipped and one notice card per account and UTC day asks for a
//             reconnect; a refresh answer that carries a new grant (rotated) -> one notice card per account and UTC
//             day recommends a reconnect (the poller stores nothing)
//   list      history since the stored historyId (paged); first run or a stale id (404) -> the inbox of the last two
//             days (at most 100) and a new historyId from the profile. At most 100 messages per account and tick: a
//             longer history listing is worked through over several ticks (output offset), and the stored historyId
//             moves on only once every listed message was handled
//   route     per message (metadata only): auto-submitted mail is ignored; a quote-thread match (reply rules 1-3)
//             -> raw MIME to R2 email/<sha>/raw.eml, inbound_emails row (mailbox gmail, source gmail_poller,
//             sender_account_id), agent-events 'inbound-reply'; a campaign reply (the sender is a subscriber, the
//             message answers another, replied_at still empty) -> replied_at and one 'replied' event, as
//             supabase/functions/check-replies/index.ts:110-140 does; anything else is left alone (no label, no
//             move: the grant is read-only)
//   size      a message is read in full only up to RAW_MAX_BYTES (Gmail's sizeEstimate when the metadata answer
//             carries it, and the decoded size); a larger one is not stored and a notice card says so
//   attempts  a failed Gmail read of a message (or an interrupted tick while reading it) counts one attempt; the
//             account's tick stops there and the next tick starts again at that message; after
//             MAX_MESSAGE_ATTEMPTS the message is passed over with a notice card. A message Gmail no longer has
//             (404) is passed over without a card
//   record    closeRun with {accounts: {<account id>: {history_id, offset, listed, matched_quote, matched_campaign,
//             skipped, errors, notice_day, rotation_notice_day, attempts, given_up}}}: no addresses, no message ids
//             beyond Gmail's opaque ids
// Rules
//   - Tokens and refresh answers are never logged, returned, stored or put on a card.
//   - message_id and message_id_sha256 follow microns-mail (workers/mail/src/headers.ts): the trimmed Message-ID
//     header value as received (brackets and case kept) and the SHA-256 hex of it, so the same mail read here and
//     received at replies@ gets one row. Reply matching uses the bracket-normalised id.
//   - A message already stored (same Message-ID hash and tenant) is not stored or queued again, so a tick that is
//     repeated after a crash adds nothing twice; the historyId only advances with a succeeded run.
//   - A campaign reply's 'replied' event is written best effort after replied_at (a failed insert is logged and
//     the reply still counts), as supabase/functions/check-replies/index.ts:127-137 does.
//   - The decoded message is written to R2 as it is (no extra copy).

import { formatLogLine } from '../../../shared/src/http/log';
import { maskEmail, type CardV1 } from '../agents/cards/index';
import { gmailMessageSkippedCard, gmailReconnectCard, gmailReconnectRecommendedCard } from '../agents/cards/reply';
import { DEFAULT_TENANT_ID, readFlag } from '../agents/flags';
import { sha256hex } from '../agents/ids';
import { checkpointRun, closeRun, EMPTY_USAGE, isFinal, openRun, type UsageAcc } from '../agents/runs';
import { activeGoogleAccounts, campaignSubscriber, GmailTokenStore, recordCampaignReply, type SenderAccount } from '../db/repos/senders';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { rawKey } from '../mail-in/safe-name';
import type { GmailHeaders, GmailPort, Ports } from '../ports/index';
import type { AgentEventV1 } from '../queues/messages';
import { matchReply, normaliseMessageId } from '../replies/match';

export const POLLER_AGENT = 'quote.reply_poller' as const;
export const MAX_MESSAGES_PER_ACCOUNT = 100;
export const FULL_SYNC_QUERY = 'in:inbox newer_than:2d';
/** Largest message read in full (bytes). */
export const RAW_MAX_BYTES = 10 * 1024 * 1024;
/** Attempts of one message before it is passed over with a notice card. */
export const MAX_MESSAGE_ATTEMPTS = 3;
/** A poller run still 'running' this long after its start has ended without closing (cron invocations end within
 *  15 minutes). */
export const INTERRUPTED_AFTER_MS = 15 * 60_000;
/** Message ids kept in attempts and given_up per account. */
const MAX_TRACKED_IDS = 20;

export interface AccountState {
  /** Start of the history listing being worked through (null: full sync next). */
  history_id: string | null;
  /** Ids of that listing handled already (a listing longer than MAX_MESSAGES_PER_ACCOUNT takes several ticks). */
  offset: number;
  listed: number;
  matched_quote: number;
  matched_campaign: number;
  /** Messages passed over this tick (too large, or out of attempts). */
  skipped: number;
  errors: string[];
  /** UTC day (YYYY-MM-DD) of the last reconnect notice. */
  notice_day?: string | null;
  /** UTC day of the last "reconnect recommended" notice. */
  rotation_notice_day?: string | null;
  /** Failed attempts per Gmail message id of the current listing. */
  attempts: Record<string, number>;
  /** Gmail message ids of the current listing passed over (and reported) already. */
  given_up: string[];
}

export interface PollerDeps {
  ports: Ports;
  tokenStore?: GmailTokenStore;
  match?: typeof matchReply;
}

export type PollerResult = { ran: false; reason: 'gate_off' | 'exists' } | { ran: true; run_id: string; accounts: Record<string, AccountState> };

/** accessToken() answer; `rotated` is true when Google's refresh answer carried a new grant. */
type TokenAnswer = Awaited<ReturnType<GmailPort['accessToken']>> & { rotated?: boolean };
/** metadata() answer; `size_estimate` is Gmail's sizeEstimate of the message when the answer carries it. */
type MessageMeta = GmailHeaders & { size_estimate?: number | null };

/** The address of a From header value ('Name <a@b>' or 'a@b'), or null. */
export function fromAddress(value: string | null | undefined): { email: string; name: string | null } | null {
  const v = String(value ?? '').trim();
  const angle = /^(.*)<([^<>\s]+@[^<>\s]+)>\s*$/.exec(v);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim();
    return { email: angle[2], name: name || null };
  }
  const bare = /([^\s<>"]+@[^\s<>"]+\.[^\s<>"]+)/.exec(v);
  return bare ? { email: bare[1], name: null } : null;
}

function asState(value: unknown): Partial<AccountState> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Partial<AccountState>) : {};
}

async function previousAccounts(ports: Ports): Promise<Record<string, Partial<AccountState>>> {
  const rows = await ports.db.select<{ output: Record<string, unknown> | null }>('agent_runs', {
    columns: 'output',
    filters: [
      ['agent', 'eq', POLLER_AGENT],
      ['trigger', 'eq', 'cron'],
      ['status', 'eq', 'succeeded'],
    ],
    order: [{ column: 'started_at', ascending: false }],
    limit: 1,
  });
  const accounts = rows[0]?.output?.accounts;
  if (typeof accounts !== 'object' || accounts === null || Array.isArray(accounts)) return {};
  return Object.fromEntries(Object.entries(accounts as Record<string, unknown>).map(([id, v]) => [id, asState(v)]));
}

/** Closes poller runs that ended without closing; returns per account the attempts of the messages they were
 *  reading (the attempts the run had recorded, plus one for the interrupted read). */
async function interruptedReads(ports: Ports, now: Date): Promise<Map<string, Record<string, number>>> {
  const rows = await ports.db.select<{ id: string; output: Record<string, unknown> | null }>('agent_runs', {
    columns: 'id,output',
    filters: [
      ['agent', 'eq', POLLER_AGENT],
      ['trigger', 'eq', 'cron'],
      ['status', 'eq', 'running'],
      ['started_at', 'lt', new Date(now.getTime() - INTERRUPTED_AFTER_MS).toISOString()],
    ],
    order: [{ column: 'started_at', ascending: true }],
    limit: 20,
  });
  const reads = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const reading = asState(row.output?.reading) as { account_id?: unknown; gmail_id?: unknown };
    if (typeof reading.account_id === 'string' && typeof reading.gmail_id === 'string') {
      const recorded = asState(asState(row.output?.accounts)[reading.account_id as keyof AccountState]).attempts;
      const before = typeof recorded === 'object' && recorded !== null && typeof recorded[reading.gmail_id] === 'number' ? recorded[reading.gmail_id] : 0;
      const seen = reads.get(reading.account_id) ?? {};
      seen[reading.gmail_id] = Math.max(seen[reading.gmail_id] ?? 0, before + 1);
      reads.set(reading.account_id, seen);
    }
    await closeRun(ports.db, row.id, { status: 'failed', error: 'interrupted' }, { ...EMPTY_USAGE, by_step: {} });
  }
  return reads;
}

async function alreadyStored(ports: Ports, tenantId: string, sha: string): Promise<boolean> {
  const rows = await ports.db.select('inbound_emails', { columns: 'id', filters: [['tenant_id', 'eq', tenantId], ['message_id_sha256', 'eq', sha]], limit: 1 });
  return rows.length > 0;
}

/** The trimmed Message-ID header value as received (null when absent or blank), as microns-mail stores it. */
export function receivedMessageId(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

/** Gmail's size estimate of a message from its metadata answer, or null. */
export function sizeEstimateOf(h: MessageMeta): number | null {
  const v = h.size_estimate;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** True for a Gmail read error of a message that no longer exists. */
function isGone(error: unknown): boolean {
  return error instanceof Error && /:\s*404\b/.test(error.message);
}

/** The decoded bytes as an ArrayBuffer without a copy when they fill their buffer. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
}

function track<T>(list: T[], item: T): T[] {
  return [...list.filter((x) => x !== item), item].slice(-MAX_TRACKED_IDS);
}

function trackAttempt(attempts: Record<string, number>, gmailId: string): Record<string, number> {
  const entries = Object.entries(attempts).filter(([id]) => id !== gmailId);
  entries.push([gmailId, (attempts[gmailId] ?? 0) + 1]);
  return Object.fromEntries(entries.slice(-MAX_TRACKED_IDS));
}

interface AccountTick {
  env: OpsEnv;
  ports: Ports;
  run_id: string;
  tenant: string;
  account: SenderAccount;
  token: string;
  state: AccountState;
  accounts: Record<string, AccountState>;
  usage: UsageAcc;
  now: Date;
  quotePath: boolean;
  campaignPath: boolean;
  match: typeof matchReply;
}

async function queueCard(env: OpsEnv, run_id: string, card: CardV1): Promise<void> {
  if (!env.AGENT_EVENTS) return;
  await env.AGENT_EVENTS.send({ v: 1, type: 'card', card, run_id }, { contentType: 'json' });
}

/** Passes a message over: counted, remembered for this listing, reported once on a notice card. */
async function giveUp(t: AccountTick, gmailId: string, reason: 'too_large' | 'unreadable', size: number | null): Promise<void> {
  t.state.skipped++;
  if (t.state.given_up.includes(gmailId)) return;
  t.state.given_up = track(t.state.given_up, gmailId);
  const sizeMb = size !== null ? Math.ceil(size / (1024 * 1024)) : null;
  await queueCard(t.env, t.run_id, gmailMessageSkippedCard({ run_id: t.run_id, site_origin: t.env.SITE_ORIGIN, account_masked: maskEmail(t.account.email), reason, size_mb: sizeMb }));
}

/** One more failed attempt of a message: 'retry' (the tick of this account stops here) or 'done' (passed over). */
async function failedAttempt(t: AccountTick, gmailId: string): Promise<'retry' | 'done'> {
  t.state.attempts = trackAttempt(t.state.attempts, gmailId);
  if ((t.state.attempts[gmailId] ?? 0) < MAX_MESSAGE_ATTEMPTS) return 'retry';
  await giveUp(t, gmailId, 'unreadable', null);
  return 'done';
}

/** Stores a quote-thread reply found in Gmail and queues it; false when it was stored before or passed over.
 *  message_id is the received form (receivedMessageId), which is also what is hashed. */
async function storeQuoteReply(t: AccountTick, o: { gmail_id: string; h: MessageMeta; message_id: string }): Promise<'stored' | 'exists' | 'skipped' | 'retry'> {
  const { env, ports } = t;
  const estimate = sizeEstimateOf(o.h);
  if (estimate !== null && estimate > RAW_MAX_BYTES) {
    await giveUp(t, o.gmail_id, 'too_large', estimate);
    return 'skipped';
  }
  const sha = await sha256hex(o.message_id);
  if (await alreadyStored(ports, t.tenant, sha)) return 'exists';
  // The message being read is recorded first: a tick that ends during the read counts one attempt (see resume).
  await checkpointRun(ports.db, t.run_id, t.usage, { output: { accounts: t.accounts, reading: { account_id: t.account.id, gmail_id: o.gmail_id } } });
  let bytes: Uint8Array;
  try {
    bytes = await ports.gmail.raw(t.token, o.gmail_id);
  } catch (error) {
    if (isGone(error)) return 'skipped';
    return (await failedAttempt(t, o.gmail_id)) === 'retry' ? 'retry' : 'skipped';
  }
  if (bytes.byteLength > RAW_MAX_BYTES) {
    await giveUp(t, o.gmail_id, 'too_large', bytes.byteLength);
    return 'skipped';
  }
  const key = rawKey(sha);
  await ports.blob.put(key, bufferOf(bytes), { contentType: 'message/rfc822', sha256: await sha256hex(bytes) });
  const from = fromAddress(o.h.from);
  const inserted = await ports.db.insert<{ id: string }>(
    'inbound_emails',
    {
      tenant_id: t.tenant,
      message_id: o.message_id,
      message_id_sha256: sha,
      mailbox: 'gmail',
      source: 'gmail_poller',
      sender_account_id: t.account.id,
      in_reply_to: o.h.in_reply_to ? normaliseMessageId(o.h.in_reply_to) || null : null,
      references_ids: o.h.references.map((r) => normaliseMessageId(r)).filter(Boolean).slice(0, 100),
      from_email: from?.email ?? '',
      from_name: from?.name ?? null,
      subject: o.h.subject ? o.h.subject.slice(0, 998) : null,
      received_at: t.now.toISOString(),
      raw_r2_key: key,
      raw_size_bytes: bytes.byteLength,
      status: 'received',
    },
    { onConflict: ['tenant_id', 'message_id_sha256'], ignoreDuplicates: true, returning: 'id' },
  );
  const id = inserted[0]?.id;
  if (!id) return 'exists';
  if (!env.AGENT_EVENTS) throw new Error('AGENT_EVENTS binding missing');
  const message: AgentEventV1 = { v: 1, type: 'inbound-reply', inbound_email_id: id, tenant_id: t.tenant };
  await env.AGENT_EVENTS.send(message, { contentType: 'json' });
  return 'stored';
}

/** Routes one listed message: 'done' (handled or passed over) or 'retry' (stop this account's tick here). */
async function routeMessage(t: AccountTick, gmailId: string): Promise<'done' | 'retry'> {
  const { ports, state } = t;
  if (state.given_up.includes(gmailId)) {
    state.skipped++;
    return 'done';
  }
  if ((state.attempts[gmailId] ?? 0) >= MAX_MESSAGE_ATTEMPTS) {
    await giveUp(t, gmailId, 'unreadable', null);
    return 'done';
  }
  let h: MessageMeta;
  try {
    h = await ports.gmail.metadata(t.token, gmailId);
  } catch (error) {
    if (isGone(error)) return 'done';
    return failedAttempt(t, gmailId);
  }
  if (h.auto_submitted && h.auto_submitted.trim().toLowerCase() !== 'no') return 'done';
  const received = receivedMessageId(h.message_id);
  const messageId = normaliseMessageId(received ?? '');
  if (t.quotePath && received && messageId) {
    const m = await t.match(ports.db, { message_id: messageId, in_reply_to: h.in_reply_to, references: h.references, subject: h.subject, from_email: fromAddress(h.from)?.email ?? null }, { tenant_id: t.tenant, rules: [1, 2, 3] });
    if (m.rule === 1 || m.rule === 2 || m.rule === 3) {
      const stored = await storeQuoteReply(t, { gmail_id: gmailId, h, message_id: received });
      if (stored === 'retry') return 'retry';
      if (stored === 'stored') state.matched_quote++;
      return 'done';
    }
  }
  const from = fromAddress(h.from);
  if (t.campaignPath && h.in_reply_to && from) {
    const subscriber = await campaignSubscriber(ports.db, from.email);
    if (subscriber && !subscriber.replied_at && (await recordCampaignReply(ports.db, subscriber.id, { gmail_message_id: gmailId, from_account: t.account.email }, t.now))) state.matched_campaign++;
  }
  return 'done';
}

export async function gmailPollerTick(env: OpsEnv, controller: Pick<ScheduledController, 'scheduledTime'>, deps: PollerDeps): Promise<PollerResult> {
  const { ports } = deps;
  const tenant = env.AGENT_TENANT_ID ?? DEFAULT_TENANT_ID;
  const flag = await readFlag(env, 'agent.quote', tenant);
  const quotePath = flag.enabled;
  const campaignPath = flag.value.campaign_replies === true;
  if (!quotePath && !campaignPath) return { ran: false, reason: 'gate_off' };

  const run = await openRun(ports.db, { agent: POLLER_AGENT, trigger: 'cron', idempotency_key: `gmail:${new Date(controller.scheduledTime).toISOString()}`, tenant_id: tenant });
  if (!run.created && isFinal(run.status)) return { ran: false, reason: 'exists' };
  const usage: UsageAcc = { ...EMPTY_USAGE, by_step: {} };
  const accounts: Record<string, AccountState> = {};
  try {
    const now = ports.clock.now();
    const interrupted = await interruptedReads(ports, now);
    const previous = await previousAccounts(ports);
    const store = deps.tokenStore ?? new GmailTokenStore(ports.db);
    const today = now.toISOString().slice(0, 10);
    for (const account of await activeGoogleAccounts(ports.db)) {
      const prev = previous[account.id] ?? {};
      const state: AccountState = {
        history_id: typeof prev.history_id === 'string' && prev.history_id ? prev.history_id : null,
        offset: typeof prev.offset === 'number' && Number.isSafeInteger(prev.offset) && prev.offset > 0 ? prev.offset : 0,
        listed: 0,
        matched_quote: 0,
        matched_campaign: 0,
        skipped: 0,
        errors: [],
        notice_day: prev.notice_day ?? null,
        rotation_notice_day: prev.rotation_notice_day ?? null,
        attempts: typeof prev.attempts === 'object' && prev.attempts !== null && !Array.isArray(prev.attempts) ? Object.fromEntries(Object.entries(prev.attempts).filter(([, n]) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0)) : {},
        given_up: Array.isArray(prev.given_up) ? prev.given_up.filter((x): x is string => typeof x === 'string') : [],
      };
      for (const [gmailId, n] of Object.entries(interrupted.get(account.id) ?? {})) {
        const entries = Object.entries(state.attempts).filter(([id]) => id !== gmailId);
        entries.push([gmailId, Math.max(n, state.attempts[gmailId] ?? 0)]);
        state.attempts = Object.fromEntries(entries.slice(-MAX_TRACKED_IDS));
      }
      accounts[account.id] = state;
      try {
        const config = await store.readProviderConfig(account.id);
        const auth: TokenAnswer = await ports.gmail.accessToken({ ...account, provider_config: config });
        if ('error' in auth) {
          state.errors.push(auth.error);
          if (auth.error === 'invalid_grant' && state.notice_day !== today && env.AGENT_EVENTS) {
            await queueCard(env, run.run_id, gmailReconnectCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN, account_masked: maskEmail(account.email) }));
            state.notice_day = today;
          }
          continue;
        }
        if (auth.rotated === true && state.rotation_notice_day !== today && env.AGENT_EVENTS) {
          await queueCard(env, run.run_id, gmailReconnectRecommendedCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN, account_masked: maskEmail(account.email) }));
          state.rotation_notice_day = today;
        }
        const t: AccountTick = { env, ports, run_id: run.run_id, tenant, account, token: auth.token, state, accounts, usage, now, quotePath, campaignPath, match: deps.match ?? matchReply };

        let ids: string[];
        let nextHistoryId: string | null;
        let start = 0;
        let incremental = false;
        const history = state.history_id ? await ports.gmail.history(auth.token, state.history_id) : ({ error: 'stale_history' } as const);
        if ('error' in history && history.error === 'unavailable') {
          state.errors.push('history_unavailable');
          continue;
        }
        if ('error' in history) {
          ids = (await ports.gmail.listRecent(auth.token, FULL_SYNC_QUERY, MAX_MESSAGES_PER_ACCOUNT)).messageIds;
          nextHistoryId = await ports.gmail.profileHistoryId(auth.token);
          state.offset = 0;
        } else {
          ids = history.messageIds;
          nextHistoryId = history.historyId;
          start = Math.min(state.offset, ids.length);
          incremental = true;
        }
        const batch = ids.slice(start, start + MAX_MESSAGES_PER_ACCOUNT);
        state.listed = batch.length;
        let handled = 0;
        for (const gmailId of batch) {
          if ((await routeMessage(t, gmailId)) === 'retry') break;
          handled++;
        }
        if (handled < batch.length) {
          // stopped at a message that is tried again next tick: the listing is not done, the historyId stays
          if (incremental) state.offset = start + handled;
        } else if (start + batch.length < ids.length) {
          state.offset = start + batch.length;
        } else {
          state.history_id = nextHistoryId || state.history_id;
          state.offset = 0;
          state.attempts = {};
          state.given_up = [];
        }
      } catch {
        state.errors.push('error');
        console.error(formatLogLine(LOG_PREFIX, 'gmail poller account failed', { account_id: account.id }));
      }
    }
    await closeRun(ports.db, run.run_id, { status: 'succeeded', output: { accounts } }, usage);
  } catch (error) {
    await closeRun(ports.db, run.run_id, { status: 'failed', error: 'poller_failed', output: { accounts } }, usage);
    throw error;
  }
  const totals = Object.values(accounts).reduce((t, a) => ({ listed: t.listed + a.listed, quote: t.quote + a.matched_quote, campaign: t.campaign + a.matched_campaign, skipped: t.skipped + a.skipped, errors: t.errors + a.errors.length }), { listed: 0, quote: 0, campaign: 0, skipped: 0, errors: 0 });
  console.log(formatLogLine(LOG_PREFIX, 'gmail poller', { run_id: run.run_id, accounts: Object.keys(accounts).length, ...totals }));
  return { ran: true, run_id: run.run_id, accounts };
}
