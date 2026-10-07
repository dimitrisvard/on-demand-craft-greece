// RP-1 / R-2: the Gmail poller with a scripted GmailPort: gate, first run (inbox of two days + profile historyId),
// incremental history, stale history (404) -> full sync, quote-thread replies stored once and queued, campaign
// replies marked once, auto replies ignored, invalid_grant -> account skipped with one notice per account and UTC
// day, a refresh answer with a new grant -> one "reconnect recommended" notice per account and day; at most 100
// messages per tick with the listing worked through over several ticks; the size limit (Gmail's estimate and the
// decoded size), the raw bytes written without a copy, per-message attempts (failed reads, interrupted ticks) and
// passing a message over with a notice; Gmail copies use rules 1-3 only; no token value in any log line or
// agent_runs.output.

import { describe, expect, it } from 'vitest';
import { messageIdSha256, trimmedMessageId } from '../../../mail/src/headers';
import { fromAddress, gmailPollerTick, FULL_SYNC_QUERY, INTERRUPTED_AFTER_MS, MAX_MESSAGE_ATTEMPTS, RAW_MAX_BYTES } from '../../src/cron/gmail-poller';

const ATTEMPTS = 3;
import { DbError } from '../../src/db/postgrest';
import type { GmailHeaders, GmailPort, SenderAccountRow } from '../../src/ports/index';
import type { AgentEventV1 } from '../../src/queues/messages';
import { assertNoSecretsLogged, RecordingLogger } from '../helpers/recorders';
import { matchReply } from '../../src/replies/match';
import { harness, OUT_A, QW_A, RFQ_A, seedQuotes, TENANT, type Harness } from './helpers';

const ACC_1 = '9a000000-0000-4000-8000-000000000001';
const ACC_2 = '9a000000-0000-4000-8000-000000000002';
const ACCESS_1 = 'ya29.access-value-of-account-one';
const REFRESH_1 = '1//refresh-value-of-account-one';
const REFRESH_2 = '1//refresh-value-of-account-two';
const SUBSCRIBER = '8b000000-0000-4000-8000-00000000000b';

interface ScriptedMessage {
  headers: GmailHeaders & { size_estimate?: number };
  raw: string;
}

class ScriptedGmail implements GmailPort {
  readonly calls: string[] = [];
  /** Bytes returned by the last raw() call. */
  lastRaw: Uint8Array | null = null;
  /** raw() answers this many bytes instead of the message (size tests). */
  rawSize: number | null = null;
  /** Errors thrown by the next metadata() calls of a message id. */
  metadataErrors = new Map<string, Error[]>();
  rotated = false;
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
    const answer = { token: typeof token === 'string' ? token : `refreshed-for-${account.id}` };
    return this.rotated ? { ...answer, rotated: true } : answer;
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
    const failure = this.metadataErrors.get(id)?.shift();
    if (failure) throw failure;
    const m = this.messages.get(id);
    if (!m) throw new Error('gmail metadata: 404');
    return m.headers;
  }
  async raw(_token: string, id: string) {
    this.calls.push(`raw ${id}`);
    this.lastRaw = this.rawSize !== null ? new Uint8Array(this.rawSize) : new TextEncoder().encode(this.messages.get(id)?.raw ?? '');
    return this.lastRaw;
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
    expect(run.output).toEqual({ accounts: { [ACC_1]: { history_id: '5000', offset: 0, listed: 4, matched_quote: 1, matched_campaign: 1, skipped: 0, errors: [], notice_day: null, rotation_notice_day: null, attempts: {}, given_up: [] } } });
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

describe('gmail poller: listing budget, size, attempts', () => {
  const quoteReply = (n: number) => ({
    headers: headers({ message_id: `<gq${n}@example.de>`, in_reply_to: OUT_A, references: [OUT_A], from: 'Erika Beispiel <erika.beispiel@example.de>', subject: 'Re: Angebot' }),
    raw: `From: erika.beispiel@example.de\r\nMessage-ID: <gq${n}@example.de>\r\nIn-Reply-To: ${OUT_A}\r\n\r\nOK ${n}\r\n`,
  });
  const other = (id: string) => ({ headers: headers({ message_id: `<${id}@example.net>`, from: 'news@example.net', subject: 'Hello' }), raw: '' });
  const cards = (h: Harness) => h.events.sent.map((s) => s.body).filter((b): b is Extract<AgentEventV1, { type: 'card' }> => b.type === 'card');
  const at = (minutes: number) => Date.UTC(2026, 9, 5, 9, minutes, 0);
  async function tickAt(h: Harness, minutes: number) {
    h.ports.clock.set(at(minutes));
    return tick(h, at(minutes));
  }

  it('more than 100 new messages: the first 100 are handled, the historyId stays until the rest is read next tick', async () => {
    const { h, gmail } = setup();
    await tick(h);
    const ids = Array.from({ length: 119 }, (_, i) => `n${i}`);
    for (const id of ids) gmail.messages.set(id, other(id));
    gmail.messages.set('g-late', quoteReply(1));
    gmail.historyIds = [...ids, 'g-late'];
    gmail.calls.length = 0;
    await tickAt(h, 10);
    expect(gmail.calls.filter((c) => c.startsWith('metadata'))).toHaveLength(100);
    expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_1]: { history_id: '5000', offset: 100, listed: 100, matched_quote: 0 } } });
    gmail.calls.length = 0;
    await tickAt(h, 20);
    expect(gmail.calls.filter((c) => c.startsWith('metadata'))).toEqual([...ids.slice(100), 'g-late'].map((id) => `metadata ${id}`));
    expect(gmail.calls).toContain('raw g-late');
    expect(h.ports.db.rows('inbound_emails').map((r) => r.message_id)).toEqual(['<gq@example.de>', '<gq1@example.de>']);
    expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_1]: { history_id: '5010', offset: 0, listed: 20, matched_quote: 1 } } });
    gmail.historyIds = [];
    gmail.calls.length = 0;
    await tickAt(h, 30);
    expect(gmail.calls).toContain('history 5010');
  });

  it('a message whose size estimate is above the limit is not read in full: not stored, one notice card, the listing goes on', async () => {
    const { h, gmail } = setup();
    gmail.messages.set('g-quote', { ...gmail.messages.get('g-quote')!, headers: { ...gmail.messages.get('g-quote')!.headers, size_estimate: 30 * 1024 * 1024 } });
    await tick(h);
    expect(gmail.calls.some((c) => c.startsWith('raw'))).toBe(false);
    expect(h.ports.db.rows('inbound_emails')).toHaveLength(0);
    expect(cards(h)).toHaveLength(1);
    expect(cards(h)[0].card).toMatchObject({ kind: 'reply', title: 'Gmail message not imported', allowed_verbs: [] });
    expect(JSON.stringify(cards(h)[0].card)).toContain('too large to import (about 30 MB)');
    expect(JSON.stringify(cards(h)[0].card)).not.toContain('sales@example.com');
    expect(pollerRuns(h)[0].output).toMatchObject({ accounts: { [ACC_1]: { history_id: '5000', skipped: 1, matched_quote: 0 } } });
  });

  it('a message whose decoded size is above the limit is not stored either', async () => {
    const { h, gmail } = setup();
    gmail.rawSize = RAW_MAX_BYTES + 1;
    await tick(h);
    expect(gmail.calls).toContain('raw g-quote');
    expect(h.ports.db.rows('inbound_emails')).toHaveLength(0);
    expect(h.bucket.objects.size).toBe(0);
    expect(JSON.stringify(cards(h)[0].card)).toContain('too large to import (about 11 MB)');
  });

  it('the decoded message is written to R2 as returned (no second copy of the bytes)', async () => {
    const { h, gmail } = setup();
    const put = h.ports.blob.put.bind(h.ports.blob);
    const bodies: unknown[] = [];
    h.ports.blob.put = async (key, body, o) => {
      bodies.push(body);
      return put(key, body, o);
    };
    await tick(h);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toBe(gmail.lastRaw?.buffer);
  });

  it('a failed Gmail read stops the account at that message; the next tick tries it again', async () => {
    const { h, gmail } = setup();
    await tick(h);
    gmail.messages.set('g-a', other('g-a'));
    gmail.messages.set('g-b', quoteReply(2));
    gmail.messages.set('g-c', other('g-c'));
    gmail.metadataErrors.set('g-b', [new Error('gmail metadata: 500')]);
    gmail.historyIds = ['g-a', 'g-b', 'g-c'];
    gmail.calls.length = 0;
    await tickAt(h, 10);
    expect(gmail.calls.filter((c) => c.startsWith('metadata'))).toEqual(['metadata g-a', 'metadata g-b']);
    expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_1]: { history_id: '5000', offset: 1, attempts: { 'g-b': 1 } } } });
    gmail.calls.length = 0;
    await tickAt(h, 20);
    expect(gmail.calls.filter((c) => c.startsWith('metadata'))).toEqual(['metadata g-b', 'metadata g-c']);
    expect(h.ports.db.rows('inbound_emails').map((r) => r.message_id)).toContain('<gq2@example.de>');
    expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_1]: { history_id: '5010', offset: 0, attempts: {} } } });
    expect(cards(h)).toHaveLength(0);
  });

  it('MAX_MESSAGE_ATTEMPTS is 3', () => expect(MAX_MESSAGE_ATTEMPTS).toBe(ATTEMPTS));

  it('after 3 failed reads (MAX_MESSAGE_ATTEMPTS) a message is passed over with one notice card and the listing moves on', async () => {
    const { h, gmail } = setup();
    await tick(h);
    gmail.messages.set('g-b', quoteReply(2));
    gmail.messages.set('g-c', quoteReply(3));
    gmail.metadataErrors.set('g-b', Array.from({ length: ATTEMPTS }, () => new Error('gmail metadata: 500')));
    gmail.historyIds = ['g-b', 'g-c'];
    for (let k = 1; k <= ATTEMPTS; k++) await tickAt(h, 10 * k);
    expect(h.ports.db.rows('inbound_emails').map((r) => r.message_id)).toEqual(['<gq@example.de>', '<gq3@example.de>']);
    expect(cards(h)).toHaveLength(1);
    expect(JSON.stringify(cards(h)[0].card)).toContain('could not be read after repeated attempts');
    expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_1]: { history_id: '5010', offset: 0, skipped: 1, attempts: {}, given_up: [] } } });
  });

  it('a message Gmail no longer has (404) is passed over without a card', async () => {
    const { h, gmail } = setup();
    await tick(h);
    gmail.historyIds = ['g-deleted'];
    await tickAt(h, 10);
    expect(cards(h)).toHaveLength(0);
    expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_1]: { history_id: '5010', errors: [] } } });
  });

  it('a tick that ends while reading a message is closed failed (interrupted) by the next tick, and the read counts one attempt', async () => {
    const { h, gmail } = setup();
    await tick(h);
    gmail.messages.set('g-big', quoteReply(4));
    gmail.historyIds = ['g-big'];
    const raw = gmail.raw.bind(gmail);
    gmail.raw = () => new Promise<Uint8Array>(() => undefined);
    h.ports.clock.set(at(10));
    void tick(h, at(10));
    const stuck = async () => pollerRuns(h).find((r) => r.idempotency_key === `gmail:${new Date(at(10)).toISOString()}`);
    for (let i = 0; i < 50 && !((await stuck())?.output as { reading?: unknown } | undefined)?.reading; i++) await new Promise((r) => setTimeout(r, 1));
    expect((await stuck())?.output).toMatchObject({ reading: { account_id: ACC_1, gmail_id: 'g-big' } });
    expect((await stuck())?.status).toBe('running');
    // the next tick 20 minutes later: the open run is closed, the message is read again
    gmail.raw = raw;
    await tickAt(h, 30);
    expect(INTERRUPTED_AFTER_MS).toBeLessThan(20 * 60_000);
    expect(await stuck()).toMatchObject({ status: 'failed', error: 'interrupted' });
    expect((await stuck())?.finished_at).toBeTruthy();
    expect(h.ports.db.rows('inbound_emails').map((r) => r.message_id)).toContain('<gq4@example.de>');
  });

  it('a message whose read was interrupted 3 times (MAX_MESSAGE_ATTEMPTS) is passed over with a notice card', async () => {
    const { h, gmail } = setup();
    await tick(h);
    gmail.messages.set('g-big', quoteReply(5));
    gmail.historyIds = ['g-big'];
    gmail.raw = () => new Promise<Uint8Array>(() => undefined);
    let minutes = 10;
    for (let k = 1; k <= ATTEMPTS; k++) {
      h.ports.clock.set(at(minutes));
      void tick(h, at(minutes));
      const key = `gmail:${new Date(at(minutes)).toISOString()}`;
      const reading = () => (pollerRuns(h).find((r) => r.idempotency_key === key)?.output as { reading?: unknown } | undefined)?.reading;
      for (let i = 0; i < 50 && !reading(); i++) await new Promise((r) => setTimeout(r, 1));
      expect(pollerRuns(h).find((r) => r.idempotency_key === key)?.output).toMatchObject({ reading: { gmail_id: 'g-big' } });
      minutes += 20;
    }
    gmail.calls.length = 0;
    await tickAt(h, minutes);
    expect(gmail.calls.some((c) => c.startsWith('raw'))).toBe(false);
    expect(cards(h)).toHaveLength(1);
    expect(JSON.stringify(cards(h)[0].card)).toContain('could not be read after repeated attempts');
    expect(pollerRuns(h).filter((r) => r.error === 'interrupted')).toHaveLength(ATTEMPTS);
    expect(pollerRuns(h).at(-1)).toMatchObject({ status: 'succeeded', output: { accounts: { [ACC_1]: { history_id: '5010', skipped: 1 } } } });
  });

  it('a mail from a waiting-quote contact without thread headers or an RFQ number is neither read in full nor stored (rules 1-3 only)', async () => {
    const { h, gmail } = setup();
    gmail.messages.set('g-contact', { headers: headers({ message_id: '<gk@example.de>', from: 'Erika Beispiel <erika.beispiel@example.de>', subject: 'Frage zur Lieferung' }), raw: 'From: erika.beispiel@example.de\r\n\r\nFrage\r\n' });
    gmail.listed = ['g-contact'];
    const rulesAsked: unknown[] = [];
    const match: typeof matchReply = async (db, hd, o) => {
      rulesAsked.push(o.rules);
      return matchReply(db, hd, o);
    };
    await gmailPollerTick(h.env, { scheduledTime: Date.UTC(2026, 9, 5, 9, 0, 0) }, { ports: h.ports, match });
    expect(gmail.calls).toContain('metadata g-contact');
    expect(rulesAsked).toEqual([[1, 2, 3]]);
    expect(gmail.calls.some((c) => c.startsWith('raw'))).toBe(false);
    expect(h.ports.db.rows('inbound_emails')).toHaveLength(0);
    expect(h.events.sent).toHaveLength(0);
    // even an attribution that answers rule 4 (sender of waiting quotes) stores nothing from Gmail
    const { h: h2, gmail: gmail2 } = setup();
    gmail2.messages.set('g-contact', gmail.messages.get('g-contact')!);
    gmail2.listed = ['g-contact'];
    const rule4: typeof matchReply = async () => ({ rule: 4, confidence: 0.5, candidates: [{ rfq_id: RFQ_A, quote_workflow_id: QW_A }] });
    await gmailPollerTick(h2.env, { scheduledTime: Date.UTC(2026, 9, 5, 9, 0, 0) }, { ports: h2.ports, match: rule4 });
    expect(gmail2.calls.some((c) => c.startsWith('raw'))).toBe(false);
    expect(h2.ports.db.rows('inbound_emails')).toHaveLength(0);
  });
});

describe('gmail poller: a refresh answer with a new grant', () => {
  it('one "reconnect recommended" notice per account and UTC day; nothing stored, no token on the card or in the output', async () => {
    const { h, gmail } = setup();
    gmail.rotated = true;
    const logger = new RecordingLogger();
    const stop = logger.start();
    try {
      await tick(h);
      await tick(h, Date.UTC(2026, 9, 5, 9, 10, 0));
      const notices = h.events.sent.map((s) => s.body).filter((b): b is Extract<AgentEventV1, { type: 'card' }> => b.type === 'card');
      expect(notices).toHaveLength(1);
      expect(notices[0].card).toMatchObject({ kind: 'reply', title: 'Gmail connection: reconnect recommended', allowed_verbs: [] });
      expect(JSON.stringify(notices[0])).toContain('s***@example.com');
      for (const secret of [ACCESS_1, REFRESH_1, 'sales@example.com']) expect(JSON.stringify(notices[0])).not.toContain(secret);
      expect(pollerRuns(h).at(-1)?.output).toMatchObject({ accounts: { [ACC_1]: { rotation_notice_day: '2026-10-05', errors: [] } } });
      expect(h.ports.db.rows('marketing_sender_accounts')[0].provider_config).toEqual({ access_token: ACCESS_1, refresh_token: REFRESH_1, token_expiry: '2026-10-05T10:00:00.000Z' });
      h.ports.clock.set(Date.UTC(2026, 9, 6, 9, 0, 0));
      await tick(h, Date.UTC(2026, 9, 6, 9, 0, 0));
      expect(h.events.sent.filter((s) => s.body.type === 'card')).toHaveLength(2);
    } finally {
      stop();
    }
    assertNoSecretsLogged(logger.lines, [ACCESS_1, REFRESH_1]);
    expect(JSON.stringify(h.ports.db.rows('agent_runs').map((r) => r.output))).not.toContain(ACCESS_1);
  });
});
