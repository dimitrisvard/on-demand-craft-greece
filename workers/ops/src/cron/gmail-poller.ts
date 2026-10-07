// Gmail reply poller (10-minute cron, called by cron/dispatcher.ts): reads the inboxes of the active Google
// Workspace sender accounts for replies to our quotes and to marketing campaigns.
//
//   gate      agent.quote enabled (quote-thread path) or agent.quote value.campaign_replies true (campaign path);
//             neither -> no run, nothing read
//   run       agent 'quote.reply_poller', trigger 'cron', key 'gmail:<scheduled time ISO>'; the previous state is
//             output.accounts of the newest succeeded run of this agent
//   token     the stored access token while valid for 5 more minutes, else a refresh in memory (never written back);
//             invalid_grant -> the account is skipped and one notice card per account and UTC day asks for a reconnect
//   list      history since the stored historyId (paged); first run or a stale id (404) -> the inbox of the last two
//             days (at most 100) and a new historyId from the profile
//   route     per message (metadata only): auto-submitted mail is ignored; a quote-thread match (reply rules 1-3)
//             -> raw MIME to R2 email/<sha>/raw.eml, inbound_emails row (mailbox gmail, source gmail_poller,
//             sender_account_id), agent-events 'inbound-reply'; a campaign reply (the sender is a subscriber, the
//             message answers another, replied_at still empty) -> replied_at and one 'replied' event, as
//             supabase/functions/check-replies/index.ts:110-140 does; anything else is left alone (no label, no
//             move: the grant is read-only)
//   record    closeRun with {accounts: {<account id>: {history_id, listed, matched_quote, matched_campaign, errors,
//             notice_day}}}: no addresses, no message ids beyond Gmail's opaque ids
// Rules
//   - Tokens and refresh answers are never logged, returned, stored or put on a card.
//   - message_id and message_id_sha256 follow microns-mail (workers/mail/src/headers.ts): the trimmed Message-ID
//     header value as received (brackets and case kept) and the SHA-256 hex of it, so the same mail read here and
//     received at replies@ gets one row. Reply matching uses the bracket-normalised id.
//   - A message already stored (same Message-ID hash and tenant) is not stored or queued again, so a tick that is
//     repeated after a crash adds nothing twice; the historyId only advances with a succeeded run.
//   - A campaign reply's 'replied' event is written best effort after replied_at (a failed insert is logged and
//     the reply still counts), as supabase/functions/check-replies/index.ts:127-137 does.
//   - Budget per tick: at most 100 messages per account.

import { formatLogLine } from '../../../shared/src/http/log';
import { maskEmail } from '../agents/cards/index';
import { gmailReconnectCard } from '../agents/cards/reply';
import { DEFAULT_TENANT_ID, readFlag } from '../agents/flags';
import { sha256hex } from '../agents/ids';
import { closeRun, EMPTY_USAGE, isFinal, openRun } from '../agents/runs';
import { activeGoogleAccounts, campaignSubscriber, GmailTokenStore, recordCampaignReply, type SenderAccount } from '../db/repos/senders';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { rawKey } from '../mail-in/safe-name';
import type { GmailHeaders, Ports } from '../ports/index';
import type { AgentEventV1 } from '../queues/messages';
import { matchReply, normaliseMessageId } from '../replies/match';

export const POLLER_AGENT = 'quote.reply_poller' as const;
export const MAX_MESSAGES_PER_ACCOUNT = 100;
export const FULL_SYNC_QUERY = 'in:inbox newer_than:2d';

export interface AccountState {
  history_id: string | null;
  listed: number;
  matched_quote: number;
  matched_campaign: number;
  errors: string[];
  /** UTC day (YYYY-MM-DD) of the last reconnect notice. */
  notice_day?: string | null;
}

export interface PollerDeps {
  ports: Ports;
  tokenStore?: GmailTokenStore;
  match?: typeof matchReply;
}

export type PollerResult = { ran: false; reason: 'gate_off' | 'exists' } | { ran: true; run_id: string; accounts: Record<string, AccountState> };

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

async function previousAccounts(ports: Ports): Promise<Record<string, AccountState>> {
  const rows = await ports.db.select<{ output: Record<string, unknown> | null }>('agent_runs', {
    columns: 'output',
    filters: [
      ['agent', 'eq', POLLER_AGENT],
      ['status', 'eq', 'succeeded'],
    ],
    order: [{ column: 'started_at', ascending: false }],
    limit: 1,
  });
  const accounts = rows[0]?.output?.accounts;
  return typeof accounts === 'object' && accounts !== null && !Array.isArray(accounts) ? (accounts as Record<string, AccountState>) : {};
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

/** Stores a quote-thread reply found in Gmail and queues it; false when it was stored before. message_id is the
 *  received form (receivedMessageId), which is also what is hashed. */
async function storeQuoteReply(env: OpsEnv, ports: Ports, o: { tenant_id: string; account: SenderAccount; token: string; gmail_id: string; h: GmailHeaders; message_id: string; now: Date }): Promise<boolean> {
  const sha = await sha256hex(o.message_id);
  if (await alreadyStored(ports, o.tenant_id, sha)) return false;
  const bytes = await ports.gmail.raw(o.token, o.gmail_id);
  const key = rawKey(sha);
  await ports.blob.put(key, bytes.slice().buffer as ArrayBuffer, { contentType: 'message/rfc822', sha256: await sha256hex(bytes) });
  const from = fromAddress(o.h.from);
  const inserted = await ports.db.insert<{ id: string }>(
    'inbound_emails',
    {
      tenant_id: o.tenant_id,
      message_id: o.message_id,
      message_id_sha256: sha,
      mailbox: 'gmail',
      source: 'gmail_poller',
      sender_account_id: o.account.id,
      in_reply_to: o.h.in_reply_to ? normaliseMessageId(o.h.in_reply_to) || null : null,
      references_ids: o.h.references.map((r) => normaliseMessageId(r)).filter(Boolean).slice(0, 100),
      from_email: from?.email ?? '',
      from_name: from?.name ?? null,
      subject: o.h.subject ? o.h.subject.slice(0, 998) : null,
      received_at: o.now.toISOString(),
      raw_r2_key: key,
      raw_size_bytes: bytes.byteLength,
      status: 'received',
    },
    { onConflict: ['tenant_id', 'message_id_sha256'], ignoreDuplicates: true, returning: 'id' },
  );
  const id = inserted[0]?.id;
  if (!id) return false;
  if (!env.AGENT_EVENTS) throw new Error('AGENT_EVENTS binding missing');
  const message: AgentEventV1 = { v: 1, type: 'inbound-reply', inbound_email_id: id, tenant_id: o.tenant_id };
  await env.AGENT_EVENTS.send(message, { contentType: 'json' });
  return true;
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
  const usage = { ...EMPTY_USAGE, by_step: {} };
  const accounts: Record<string, AccountState> = {};
  try {
    const previous = await previousAccounts(ports);
    const store = deps.tokenStore ?? new GmailTokenStore(ports.db);
    const now = ports.clock.now();
    const today = now.toISOString().slice(0, 10);
    for (const account of await activeGoogleAccounts(ports.db)) {
      const prev = previous[account.id];
      const state: AccountState = { history_id: prev?.history_id ?? null, listed: 0, matched_quote: 0, matched_campaign: 0, errors: [], notice_day: prev?.notice_day ?? null };
      accounts[account.id] = state;
      try {
        const config = await store.readProviderConfig(account.id);
        const auth = await ports.gmail.accessToken({ ...account, provider_config: config });
        if ('error' in auth) {
          state.errors.push(auth.error);
          if (auth.error === 'invalid_grant' && state.notice_day !== today && env.AGENT_EVENTS) {
            const card = gmailReconnectCard({ run_id: run.run_id, site_origin: env.SITE_ORIGIN, account_masked: maskEmail(account.email) });
            await env.AGENT_EVENTS.send({ v: 1, type: 'card', card, run_id: run.run_id }, { contentType: 'json' });
            state.notice_day = today;
          }
          continue;
        }
        const token = auth.token;
        let ids: string[];
        let historyId: string | null = null;
        const history = state.history_id ? await ports.gmail.history(token, state.history_id) : ({ error: 'stale_history' } as const);
        if ('error' in history && history.error === 'unavailable') {
          state.errors.push('history_unavailable');
          continue;
        }
        if ('error' in history) {
          ids = (await ports.gmail.listRecent(token, FULL_SYNC_QUERY, MAX_MESSAGES_PER_ACCOUNT)).messageIds;
          historyId = await ports.gmail.profileHistoryId(token);
        } else {
          ids = history.messageIds;
          historyId = history.historyId;
        }
        ids = ids.slice(0, MAX_MESSAGES_PER_ACCOUNT);
        state.listed = ids.length;
        for (const gmailId of ids) {
          const h = await ports.gmail.metadata(token, gmailId);
          if (h.auto_submitted && h.auto_submitted.trim().toLowerCase() !== 'no') continue;
          const received = receivedMessageId(h.message_id);
          const messageId = normaliseMessageId(received ?? '');
          if (quotePath && received && messageId) {
            const m = await (deps.match ?? matchReply)(ports.db, { message_id: messageId, in_reply_to: h.in_reply_to, references: h.references, subject: h.subject, from_email: fromAddress(h.from)?.email ?? null }, { tenant_id: tenant, rules: [1, 2, 3] });
            if (m.rule === 1 || m.rule === 2 || m.rule === 3) {
              if (await storeQuoteReply(env, ports, { tenant_id: tenant, account, token, gmail_id: gmailId, h, message_id: received, now })) state.matched_quote++;
              continue;
            }
          }
          const from = fromAddress(h.from);
          if (campaignPath && h.in_reply_to && from) {
            const subscriber = await campaignSubscriber(ports.db, from.email);
            if (subscriber && !subscriber.replied_at && (await recordCampaignReply(ports.db, subscriber.id, { gmail_message_id: gmailId, from_account: account.email }, now))) state.matched_campaign++;
          }
        }
        state.history_id = historyId || state.history_id;
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
  const totals = Object.values(accounts).reduce((t, a) => ({ listed: t.listed + a.listed, quote: t.quote + a.matched_quote, campaign: t.campaign + a.matched_campaign, errors: t.errors + a.errors.length }), { listed: 0, quote: 0, campaign: 0, errors: 0 });
  console.log(formatLogLine(LOG_PREFIX, 'gmail poller', { run_id: run.run_id, accounts: Object.keys(accounts).length, ...totals }));
  return { ran: true, run_id: run.run_id, accounts };
}
