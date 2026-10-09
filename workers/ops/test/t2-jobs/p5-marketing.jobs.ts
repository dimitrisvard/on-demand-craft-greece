// T2 (profile 'jobs', real workerd, unit M5): a campaign send end to end. A STAFF session posts
// /api/marketing?action=send-campaign to microns-site (gate MK-8), which dispatches to microns-ops over the service
// binding; the route opens the run and queues one outbound-mail message per recipient; the local outbound-mail
// consumer paces them through the SenderLimiter Durable Objects (SQLite, one per sender account), sends through the
// Gmail stub (token from the Google token stub) and the Resend stub, writes the events, recipient rows and the
// emails_sent_today mirror into the mini-PostgREST, and closes the campaign and its run. Then: a second click answers
// 409 campaign_already_sent, any other method 405 at the site, and a customer 403. Synthetic data only.
// Identities are stub-minted Supabase JWTs whose /auth/v1/user and user_roles answers are canned (as test/t2/web.t2.ts).

import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, globalUrls, json, JSON_HEADERS, rows, seed, until, type Row } from '../quote/t2-helpers';

const PROFILE = process.env.T2_PROFILE ?? '';
const ENABLED = Boolean(process.env.T2_STUB_URL) && PROFILE === 'jobs';

interface StubClient {
  stubRoute(route: { method: string; path: string; status: number; headers?: Record<string, string>; body?: unknown }): Promise<void>;
  mintSupabaseJwt(claims: Record<string, unknown>): Promise<string>;
}

async function loadStubClient(): Promise<StubClient> {
  return (await import(/* @vite-ignore */ new URL('../../../site/test/integration/stub-client.ts', import.meta.url).href)) as StubClient;
}

/** The same derivation as src/marketing/events.ts eventIdFor (SHA-256 of 'marketing_event:' + idem as a UUID v8). */
function eventIdFor(idem: string): string {
  const b = Uint8Array.from(createHash('sha256').update(`marketing_event:${idem}`).digest().subarray(0, 16));
  b[6] = ((b[6] as number) & 0x0f) | 0x80;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface SentGmail {
  mime: string;
  id: string | null;
  status: number;
}

interface ResendStubEmail {
  id: string;
  idempotency_key: string | null;
  from: string;
  to: string[];
  subject: string;
}

describe.skipIf(!ENABLED)('campaign send through site, queue, SenderLimiter, Gmail and Resend (T2, profile jobs)', () => {
  const u = globalUrls();
  const campaign = randomUUID();
  const accG = randomUUID();
  const accR = randomUUID();
  const subs = [randomUUID(), randomUUID(), randomUUID()].sort();
  const staffUid = randomUUID();
  const tag = `t2-${campaign.slice(0, 8)}`;
  let stub: StubClient;
  let staffToken = '';
  let gmailBefore = 0;
  let resendBefore = 0;

  async function as(uid: string, roles: string[]): Promise<Record<string, string>> {
    await stub.stubRoute({ method: 'GET', path: '^/auth/v1/user$', status: 200, body: { id: uid, email: `${uid.slice(0, 8)}@example.test` } });
    await stub.stubRoute({ method: 'GET', path: `^/rest/v1/user_roles\\?select=role&user_id=eq\\.${uid}`, status: 200, body: roles.map((role) => ({ role })) });
    return { authorization: `Bearer ${await stub.mintSupabaseJwt({ sub: uid, email: `${uid.slice(0, 8)}@example.test` })}` };
  }

  function send(headers: Record<string, string>, init: RequestInit = {}): Promise<Response> {
    return fetch(`${u.site}/api/marketing?action=send-campaign`, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify({ campaign_id: campaign }), ...init });
  }

  const ours = async (table: string): Promise<Row[]> => (await rows(u, table)).filter((r) => r.campaign_id === campaign);

  beforeAll(async () => {
    stub = await loadStubClient();
    staffToken = (await as(staffUid, ['sales_rep'])).authorization as string;
    gmailBefore = (await json<SentGmail[]>(await call(`${u.stub}/__stub/gmail/sent`))).length;
    resendBefore = (await json<ResendStubEmail[]>(await call(`${u.stub}/__stub/resend/emails`))).length;
    await seed(u, {
      marketing_subscribers: subs.map((id, i) => ({ id, email: `${tag}-${i + 1}@example.test`, name: i === 1 ? null : `T2 Person ${i + 1}`, status: 'active', tags: [tag] })),
      marketing_sender_accounts: [
        { id: accG, email: `${tag}-g@example.test`, display_name: 'T2 Gmail', provider: 'google_workspace', provider_config: { refresh_token: ['t2', 'refresh'].join('-') }, daily_limit: 50, warmup_enabled: false, warmup_current_limit: 10, emails_sent_today: 0, is_active: true },
        { id: accR, email: `${tag}-r@example.test`, display_name: 'T2 Resend', provider: 'resend', provider_config: {}, daily_limit: 50, warmup_enabled: false, warmup_current_limit: 10, emails_sent_today: 0, is_active: true },
      ],
      marketing_campaigns: [{ id: campaign, name: 'T2 campaign', subject_a: 'Hello {{name}}', subject_b: null, body: '<html><body><p>Dear {{name}} <a href="https://www.micronshub.eu/en/cnc">CNC</a></p></body></html>', status: 'draft', target_tags: [tag], ab_test_config: { enabled: false }, sender_account_ids: [accG, accR], sent_count: 0 }],
      marketing_settings: [{ id: randomUUID(), unsubscribe_link_enabled: true, tracking_domain: null, delay_between_emails_seconds: 1 }],
    });
  }, 60_000);

  afterAll(async () => {
    // Back to the stub's default (no identity) for the files that follow.
    await stub?.stubRoute({ method: 'GET', path: '^/auth/v1/user$', status: 401, body: { code: 401, msg: 'invalid JWT' } });
  });

  it('any method but POST answers 405 at the site; a customer 403; nothing queued', async () => {
    const get = await fetch(`${u.site}/api/marketing?action=send-campaign`, { headers: { authorization: staffToken } });
    expect([get.status, get.headers.get('allow'), await get.json()]).toEqual([405, 'POST', { error: 'method_not_allowed' }]);
    const customer = await send(await as(randomUUID(), ['customer']));
    expect(customer.status).toBe(403);
    await as(staffUid, ['sales_rep']);
    expect((await rows(u, 'agent_runs')).filter((r) => r.subject_id === campaign)).toEqual([]);
  });

  it('STAFF: 202 {queued: 3, run_id}; the consumer sends through both senders and closes the campaign and its run', async () => {
    const res = await send({ authorization: staffToken });
    expect(res.status).toBe(202);
    const out = await json<{ queued: number; run_id: string }>(res);
    expect(out).toEqual({ queued: 3, run_id: expect.any(String) });
    const events = await until('three final events', async () => {
      const list = await ours('marketing_events');
      return list.length === 3 && list.every((e) => typeof e.resend_email_id === 'string') ? list : null;
    }, 90_000);
    // one event per recipient, its id derived from the message key, its metadata the provider id and From
    expect(new Set(events.map((e) => e.id))).toEqual(new Set(subs.map((s) => eventIdFor(`camp:${campaign}:${s}:1`))));
    const byProvider = events.map((e) => Object.keys(e.metadata as Row).sort().join(',')).sort();
    expect(byProvider).toEqual(['from,gmail_id', 'from,gmail_id', 'from,resend_id']);
    // Gmail: two mails from the Gmail account (round-robin G, R, G), proper MIME, tracking URLs with the event ids
    const gmail = (await json<SentGmail[]>(await call(`${u.stub}/__stub/gmail/sent`))).slice(gmailBefore).filter((s) => s.mime.includes(`${tag}-`));
    expect(gmail).toHaveLength(2);
    for (const [i, s] of gmail.entries()) {
      expect(s.mime).toContain(`From: T2 Gmail <${tag}-g@example.test>\r\n`);
      expect(s.mime).toContain(`To: ${tag}-${i === 0 ? 1 : 3}@example.test\r\n`);
      expect(s.mime).toContain('Content-Type: text/html; charset=UTF-8\r\n');
      const html = Buffer.from(s.mime.split('\r\n\r\n')[1]?.replace(/\r\n/g, '') ?? '', 'base64').toString('utf8');
      const eid = eventIdFor(`camp:${campaign}:${subs[i === 0 ? 0 : 2]}:1`);
      expect(html).toContain(`https://micronshub.eu/api/marketing?action=track&type=open&eid=${eid}&cid=${campaign}`);
      expect(html).toContain(`type=click&eid=${eid}&cid=${campaign}&url=${encodeURIComponent('https://www.micronshub.eu/en/cnc')}`);
      expect(html).toContain(`type=unsubscribe&eid=${eid}&cid=${campaign}`);
    }
    // Resend: one mail from the Resend account with the message key as Idempotency-Key
    const resend = (await json<ResendStubEmail[]>(await call(`${u.stub}/__stub/resend/emails`))).slice(resendBefore).filter((m) => m.from.includes(tag));
    expect(resend).toEqual([expect.objectContaining({ from: `T2 Resend <${tag}-r@example.test>`, to: [`${tag}-2@example.test`], subject: 'Hello there', idempotency_key: `camp:${campaign}:${subs[1]}:1` })]);
    // campaign and run closed; emails_sent_today mirrored from the limiters
    const closed = await until('campaign sent', async () => {
      const c = (await rows(u, 'marketing_campaigns')).find((r) => r.id === campaign);
      return c?.status === 'sent' ? c : null;
    }, 30_000);
    expect(closed).toMatchObject({ status: 'sent', sent_count: 3 });
    const run = (await rows(u, 'agent_runs')).find((r) => r.id === out.run_id);
    expect(run).toMatchObject({ agent: 'marketing.send', trigger: 'dashboard', idempotency_key: `marketing.send:${campaign}`, subject_type: 'marketing_campaign', subject_id: campaign, status: 'succeeded', output: { expected: 3, queued: 3, sent: 3, bounced: 0, waiting: 0, mode: 'tags' } });
    const senders = (await rows(u, 'marketing_sender_accounts')).filter((r) => r.id === accG || r.id === accR);
    expect(Object.fromEntries(senders.map((r) => [r.id === accG ? 'gmail' : 'resend', r.emails_sent_today]))).toEqual({ gmail: 2, resend: 1 });
  }, 120_000);

  it('a second click answers 409 campaign_already_sent and queues nothing', async () => {
    const res = await send({ authorization: staffToken });
    expect([res.status, await res.json()]).toEqual([409, { error: 'campaign_already_sent' }]);
    expect((await rows(u, 'agent_runs')).filter((r) => r.subject_id === campaign)).toHaveLength(1);
    expect(await ours('marketing_events')).toHaveLength(3);
  });
});
