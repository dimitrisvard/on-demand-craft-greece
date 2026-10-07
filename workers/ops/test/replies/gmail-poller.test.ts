// RP-1 / R-2: the Gmail poller with a scripted GmailPort: gate, first run (inbox of two days + profile historyId),
// incremental history, stale history (404) -> full sync, quote-thread replies stored once and queued, campaign
// replies marked once, auto replies ignored, invalid_grant -> account skipped with one notice per account and UTC
// day; no token value in any log line or agent_runs.output.

import { describe, expect, it } from 'vitest';
import { messageIdSha256, trimmedMessageId } from '../../../mail/src/headers';
import { fromAddress, gmailPollerTick, FULL_SYNC_QUERY } from '../../src/cron/gmail-poller';
import { DbError } from '../../src/db/postgrest';
import type { GmailHeaders, GmailPort, SenderAccountRow } from '../../src/ports/index';
import type { AgentEventV1 } from '../../src/queues/messages';
import { assertNoSecretsLogged, RecordingLogger } from '../helpers/recorders';
import { harness, OUT_A, seedQuotes, TENANT, type Harness } from './helpers';

const ACC_1 = '9a000000-0000-4000-8000-000000000001';
const ACC_2 = '9a000000-0000-4000-8000-000000000002';
const ACCESS_1 = 'ya29.access-value-of-account-one';
const REFRESH_1 = '1//refresh-value-of-account-one';
const REFRESH_2 = '1//refresh-value-of-account-two';
const SUBSCRIBER = '8b000000-0000-4000-8000-00000000000b';

interface ScriptedMessage {
  headers: GmailHeaders;
  raw: string;
}

class ScriptedGmail implements GmailPort {
  readonly calls: string[] = [];
  invalid = new Set<string>();
  staleHistory = false;
  historyIds: string[] = [];
  listed: string[] = [];
  profile = '5000';
  messages = new Map<string, ScriptedMessage>();

  async accessToken(account: SenderAccountRow) {
    this.calls.push(`token ${account.id}`);
    if (this.invalid.has(account.id)) return { error: 'invalid_grant' as const };
    const token = account.provider_config?.access_token;
    return { token: typeof token === 'string' ? token : `refreshed-for-${account.id}` };
  }
  async history(_token: string, startHistoryId: string) {
    this.calls.push(`history ${startHistoryId}`);
    if (this.staleHistory) return { error: 'stale_history' as const };
    return { messageIds: this.historyIds, historyId: String(Number(startHistoryId) + 10) };
  }
  async listRecent(_token: string, query: string, max: number) {
    this.calls.push(`list ${query} ${max}`);
    return { messageIds: this.listed };
  }
  async profileHistoryId() {
    this.calls.push('profile');
    return this.profile;
  }
  async metadata(_token: string, id: string) {
    this.calls.push(`metadata ${id}`);
    const m = this.messages.get(id);
    if (!m) throw new Error('gmail metadata: 404');
    return m.headers;
  }
  async raw(_token: string, id: string) {
    this.calls.push(`raw ${id}`);
    return new TextEncoder().encode(this.messages.get(id)?.raw ?? '');
  }
}

function headers(h: Partial<GmailHeaders>): GmailHeaders {
  return { message_id: null, in_reply_to: null, references: [], from: null, subject: null, auto_submitted: null, ...h };
}

function setup(o: { flag?: Record<string, unknown>; accounts?: number } = {}) {
  const h = harness({ flags: { 'agent.quote': o.flag ?? { enabled: true, value: { mode: 'assist' } } } });
  seedQuotes(h);
  const accounts = [
    { id: ACC_1, email: 'sales@example.com', provider: 'google_workspace', is_active: true, provider_config: { access_token: ACCESS_1, refresh_token: REFRESH_1, token_expiry: '2026-10-05T10:00:00.000Z' } },
    { id: ACC_2, email: 'team@example.com', provider: 'google_workspace', is_active: true, provider_config: { refresh_token: REFRESH_2 } },
    { id: '9a000000-0000-4000-8000-000000000003', email: 'off@example.com', provider: 'google_workspace', is_active: false, provider_config: {} },
  ];
  h.ports.db.seed('marketing_sender_accounts', accounts.slice(0, o.accounts ?? 1).concat(accounts.slice(2)));
  h.ports.db.seed('marketing_subscribers', [{ id: SUBSCRIBER, email: 'lead@example.org', replied_at: null }]);
  const gmail = new ScriptedGmail();
  gmail.messages.set('g-quote', {
    headers: headers({ message_id: '<gq@example.de>', in_reply_to: OUT_A, references: [OUT_A], from: 'Erika Beispiel <erika.beispiel@example.de>', subject: 'Re: Angebot' }),
    raw: 'From: erika.beispiel@example.de\r\nMessage-ID: <gq@example.de>\r\nIn-Reply-To: ' + OUT_A + '\r\nSubject: Re: Angebot\r\n\r\nWir nehmen an.\r\n',
  });
  gmail.messages.set('g-campaign', { headers: headers({ message_id: '<gc@example.org>', in_reply_to: '<campaign-1@example.com>', from: '"Lead" <Lead@Example.org>', subject: 'Re: Newsletter' }), raw: '' });
  gmail.messages.set('g-auto', { headers: headers({ message_id: '<ga@example.de>', in_reply_to: OUT_A, from: 'erika.beispiel@example.de', auto_submitted: 'auto-replied' }), raw: '' });
  gmail.messages.set('g-other', { headers: headers({ message_id: '<go@example.net>', from: 'news@example.net', subject: 'Hello' }), raw: '' });
  gmail.listed = ['g-quote', 'g-campaign', 'g-auto', 'g-other'];
  h.ports.gmail = gmail;
  return { h, gmail };
}

const tick = (h: Harness, at = Date.UTC(2026, 9, 5, 9, 0, 0)) => gmailPollerTick(h.env, { scheduledTime: at }, { ports: h.ports });
const pollerRuns = (h: Harness) => h.ports.db.rows('agent_runs', ['agent', 'eq', 'quote.reply_poller']);

describe('gmail poller', () => {
  it('fromAddress', () => {
    expect(fromAddress('"Lead" <Lead@Example.org>')).toEqual({ email: 'Lead@Example.org', name: 'Lead' });
    expect(fromAddress('plain@example.org')).toEqual({ email: 'plain@example.org', name: null });
    expect(fromAddress('no address')).toBeNull();
  });

  it('gate: agent.quote off and no campaign_replies -> no run, nothing read', async () => {
    const { h, gmail } = setup({ flag: { enabled: false } });
    expect(await tick(h)).toEqual({ ran: false, reason: 'gate_off' });
    expect(gmail.calls).toEqual([]);
    expect(pollerRuns(h)).toHaveLength(0);
  });

  it('first run: inbox of two days + profile historyId; quote reply stored and queued, campaign reply marked, auto reply and others ignored', async () => {
    const { h, gmail } = setup({ flag: { enabled: true, value: { mode: 'assist', campaign_replies: true } } });
    const result = await tick(h);
    expect(result.ran).toBe(true);
    expect(gmail.calls).toContain(`list ${FULL_SYNC_QUERY} 100`);
    expect(gmail.calls).toContain('profile');
    expect(gmail.calls.filter((c) => c.startsWith('raw'))).toEqual(['raw g-quote']);
    const stored = h.ports.db.rows('inbound_emails');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ mailbox: 'gmail', source: 'gmail_poller', sender_account_id: ACC_1, message_id: '<gq@example.de>', in_reply_to: OUT_A, from_email: 'erika.beispiel@example.de', status: 'received' });
    expect(h.bucket.text(String(stored[0].raw_r2_key))).toContain('Wir nehmen an.');
    expect(h.events.sent.map((s) => s.body)).toEqual([{ v: 1, type: 'inbound-reply', inbound_email_id: stored[0].id, tenant_id: TENANT }]);
    expect(h.ports.db.rows('marketing_subscribers')[0].replied_at).toBe('2026-10-05T09:00:00.000Z');
    expect(h.ports.db.rows('marketing_events')).toEqual([expect.objectContaining({ subscriber_id: SUBSCRIBER, campaign_id: null, event_type: 'replied', metadata: { gmail_message_id: 'g-campaign', from_account: 'sales@example.com' } })]);
    const [run] = pollerRuns(h);
    expect(run).toMatchObject({ trigger: 'cron', idempotency_key: 'gmail:2026-10-05T09:00:00.000Z', status: 'succeeded' });
    expect(run.output).toEqual({ accounts: { [ACC_1]: { history_id: '5000', listed: 4, matched_quote: 1, matched_campaign: 1, errors: [], notice_day: null } } });
  });

  it('next tick: history since the stored id; nothing is stored, queued or marked twice', async () => {
    const { h, gmail } = setup({ flag: { enabled: true, value: { campaign_replies: true } } });
    await tick(h);
    gmail.calls.length = 0;
    gmail.historyIds = ['g-quote', 'g-campaign'];
    await tick(h, Date.UTC(2026, 9, 5, 9, 10, 0));
    expect(gmail.calls).toContain('history 5000');
    expect(gmail.calls.some((c) => c.startsWith('list'))).toBe(false);
    expect(gmail.calls.some((c) => c.startsWith('raw'))).toBe(false);
    expect(h.ports.db.rows('inbound_emails')).toHaveLength(1);
    expect(h.events.sent).toHaveLength(1);
    expect(h.ports.db.rows('marketing_events')).toHaveLength(1);
    expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_1]: { history_id: '5010', listed: 2, matched_quote: 0, matched_campaign: 0 } } });
  });

  it('a stale historyId (404) falls back to the full sync', async () => {
    const { h, gmail } = setup();
    await tick(h);
    gmail.staleHistory = true;
    gmail.calls.length = 0;
    gmail.profile = '7000';
    await tick(h, Date.UTC(2026, 9, 5, 9, 10, 0));
    expect(gmail.calls.slice(0, 4)).toEqual(['token 9a000000-0000-4000-8000-000000000001', 'history 5000', `list ${FULL_SYNC_QUERY} 100`, 'profile']);
    expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_1]: { history_id: '7000' } } });
  });

  it('the same scheduled tick runs once', async () => {
    const { h } = setup();
    await tick(h);
    expect(await tick(h)).toEqual({ ran: false, reason: 'exists' });
    expect(pollerRuns(h)).toHaveLength(1);
  });

  it('invalid_grant: the account is skipped, one notice per account and UTC day, the other account still runs', async () => {
    const { h, gmail } = setup({ accounts: 2 });
    gmail.invalid.add(ACC_2);
    await tick(h);
    await tick(h, Date.UTC(2026, 9, 5, 9, 10, 0));
    const cards = h.events.sent.map((s) => s.body).filter((b): b is Extract<AgentEventV1, { type: 'card' }> => b.type === 'card');
    expect(cards).toHaveLength(1);
    expect(cards[0].card).toMatchObject({ kind: 'reply', allowed_verbs: [], title: 'Gmail connection needs reconnecting' });
    expect(JSON.stringify(cards[0].card)).toContain('t***@example.com');
    expect(JSON.stringify(cards[0].card)).not.toContain('team@example.com');
    expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_2]: { errors: ['invalid_grant'], notice_day: '2026-10-05', listed: 0 }, [ACC_1]: { errors: [] } } });
    h.ports.clock.set(Date.UTC(2026, 9, 6, 9, 0, 0));
    await tick(h, Date.UTC(2026, 9, 6, 9, 0, 0));
    expect(h.events.sent.filter((s) => s.body.type === 'card')).toHaveLength(2);
  });

  it('Message-ID as microns-mail stores it: a bare id is hashed and stored as received, so the same mail is never stored twice', async () => {
    const { h, gmail } = setup();
    const bare = ' gq-bare@example.de ';
    gmail.messages.set('g-quote', { ...gmail.messages.get('g-quote')!, headers: headers({ message_id: bare, in_reply_to: OUT_A, from: 'erika.beispiel@example.de' }) });
    // microns-mail hashes the trimmed header value as received (workers/mail/src/headers.ts messageIdSha256)
    const mailSha = await messageIdSha256(trimmedMessageId(bare), new ArrayBuffer(0));
    await tick(h);
    const [stored] = h.ports.db.rows('inbound_emails');
    expect(stored).toMatchObject({ message_id: 'gq-bare@example.de', message_id_sha256: mailSha, raw_r2_key: `email/${mailSha}/raw.eml` });

    // the same mail already received at replies@ (row written by microns-mail): not stored or queued again
    const { h: h2, gmail: gmail2 } = setup();
    gmail2.messages.set('g-quote', { ...gmail2.messages.get('g-quote')!, headers: headers({ message_id: bare, in_reply_to: OUT_A, from: 'erika.beispiel@example.de' }) });
    h2.ports.db.seed('inbound_emails', [{ tenant_id: TENANT, message_id: 'gq-bare@example.de', message_id_sha256: mailSha, mailbox: 'replies', source: 'email_routing', from_email: 'erika.beispiel@example.de', received_at: '2026-10-05T08:00:00.000Z', status: 'matched' }]);
    await tick(h2);
    expect(h2.ports.db.rows('inbound_emails')).toHaveLength(1);
    expect(gmail2.calls.some((c) => c.startsWith('raw'))).toBe(false);
    expect(h2.events.sent).toHaveLength(0);
  });

  it('campaign reply: a failed replied event insert keeps replied_at and the count (best effort, as check-replies)', async () => {
    const { h } = setup({ flag: { enabled: true, value: { campaign_replies: true } } });
    const db = h.ports.db as unknown as { insert: (table: string, rows: unknown, o?: unknown) => Promise<unknown[]> };
    const insert = db.insert.bind(db);
    db.insert = async (table, rows, o) => {
      if (table === 'marketing_events') throw new DbError(409, '23503', 'insert or update violates a foreign key');
      return insert(table, rows, o);
    };
    const logger = new RecordingLogger();
    const stop = logger.start();
    try {
      await tick(h);
    } finally {
      stop();
    }
    expect(h.ports.db.rows('marketing_subscribers')[0].replied_at).toBe('2026-10-05T09:00:00.000Z');
    expect(pollerRuns(h)[0].output).toMatchObject({ accounts: { [ACC_1]: { matched_campaign: 1, matched_quote: 1, errors: [] } } });
    expect(logger.lines.join('\n')).toContain('campaign reply event not written');
    expect(logger.lines.join('\n')).not.toContain('lead@example.org');
  });

  it('campaign path only (agent.quote off, campaign_replies on): quote replies are not stored', async () => {
    const { h } = setup({ flag: { enabled: false, value: { campaign_replies: true } } });
    await tick(h);
    expect(h.ports.db.rows('inbound_emails')).toHaveLength(0);
    expect(h.ports.db.rows('marketing_events')).toHaveLength(1);
  });

  it('no token or refresh value in any log line or run output', async () => {
    const { h, gmail } = setup({ accounts: 2, flag: { enabled: true, value: { campaign_replies: true } } });
    gmail.invalid.add(ACC_2);
    const logger = new RecordingLogger();
    const stop = logger.start();
    try {
      await tick(h);
      gmail.messages.delete('g-other'); // metadata of a listed message fails: logged by account id only
      await tick(h, Date.UTC(2026, 9, 5, 9, 10, 0));
    } finally {
      stop();
    }
    expect(logger.lines.length).toBeGreaterThan(0);
    assertNoSecretsLogged(logger.lines, [ACCESS_1, REFRESH_1, REFRESH_2, `refreshed-for-${ACC_1}`]);
    const outputs = JSON.stringify(h.ports.db.rows('agent_runs').map((r) => r.output));
    for (const secret of [ACCESS_1, REFRESH_1, REFRESH_2, 'sales@example.com', 'team@example.com']) expect(outputs).not.toContain(secret);
    expect(JSON.stringify(h.events.sent)).not.toContain(ACCESS_1);
  });
});
