// Parity with the repository functions (unit M5): the repo's send-campaign, process-followups and process-warmup
// run unchanged as oracles (./repo-oracle.ts) on the same data, and the Worker port must give the same output:
//   - spintax, variables, pixel, click tracking and unsubscribe blocks: equal strings for the same inputs and draws
//   - a whole campaign (tag mode with A/B, CSV mode, default identity and a Resend account): the same mails (from,
//     to, subject, html incl. every tracking URL for the same event ids), the same event, recipient and campaign rows
//   - follow-ups: the same mails for the same due rows (the Worker queues, the consumer sends)
//   - warm-up: the same account updates
// Known, documented differences that the comparison masks: Gmail mails are compared on their decoded headers and
// HTML (the Worker writes a proper single-part MIME message); Gmail event metadata uses gmail_id (PHASE5_SPEC §6.5).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventIdFor } from '../../../src/marketing/events';
import { enqueueDueFollowups } from '../../../src/marketing/followups';
import { parseSpintax, replaceVariables } from '../../../src/marketing/personalise';
import { injectClickTracking, injectTrackingPixel, injectUnsubscribeLink } from '../../../src/marketing/tracking';
import { runWarmup } from '../../../src/marketing/warmup';
import { ACC_R, CAMPAIGN, marketingHarness, message, rec, seedCampaign, sub, T0, type MarketingHarness } from './harness';
import { loadRepo, oracleSupabase, seeded, type OracleSupabase } from './repo-oracle';

const DOMAIN = 'https://micronshub.eu';
const EID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

afterEach(() => {
  vi.useRealTimers();
});

const HTML_SAMPLES = [
  '<html><body><p>Hi</p></body></html>',
  '<p>no body tag <a href="https://example.test/a?b=1&c=2">x</a></p>',
  '<a href="mailto:a@example.test">m</a><a href="tel:+30">t</a><a href="#top">h</a><a href="https://x.test/unsubscribe">u</a><a href="https://micronshub.eu/api/marketing?action=track">t</a>',
  '<a class="btn" href="https://x.test/é ü" target="_blank">e</a><A HREF="https://x.test/upper">U</A><a href="https://y.test/1">1</a><a\n href="https://z.test">n</a></body></body>',
  '',
];

function campaignFns(random: () => number) {
  return loadRepo('send-campaign', {
    env: { TRACKING_DOMAIN: DOMAIN },
    supabase: oracleSupabase({}),
    random,
    exportNames: ['parseSpintax', 'replaceVariables', 'injectTrackingPixel', 'injectClickTracking', 'injectUnsubscribeLink'],
  }).fns as unknown as {
    parseSpintax(t: string): string;
    replaceVariables(t: string, v: Record<string, string>): string;
    injectTrackingPixel(h: string, e: string, c: string): string;
    injectClickTracking(h: string, e: string, c: string): string;
    injectUnsubscribeLink(h: string, e: string, c: string): string;
  };
}

describe('pure functions equal the repo functions', () => {
  it('spintax with the same draws, variables (any case, empty values, $ patterns)', () => {
    const texts = ['{Hi|Hello|Hey} {{name}}', 'a {b|{c|d}} e {f}', 'no braces', '{{{name}}}', '{x|y}{1|2|3}{a|b}', '', '{only}'];
    for (let seed = 1; seed <= 20; seed++) {
      const repo = campaignFns(seeded(seed));
      const mine = seeded(seed);
      for (const t of texts) expect([seed, t, parseSpintax(t, mine)]).toEqual([seed, t, repo.parseSpintax(t)]);
    }
    const repo = campaignFns(seeded(1));
    const vars = [{ name: 'Ann', company: '', email: 'a@example.test' }, { name: '', company: 'X', email: '' }, { name: '$& $1 $$', company: '', email: 'e' }];
    for (const v of vars) for (const t of ['{{NAME}} {{name}} {{Company}} {{email}}', '{{nam}} {{ name }}']) expect(replaceVariables(t, v)).toBe(repo.replaceVariables(t, v));
  });

  it('pixel, click tracking and the campaign unsubscribe block', () => {
    const repo = campaignFns(seeded(1));
    for (const html of HTML_SAMPLES) {
      expect(injectTrackingPixel(html, EID, CAMPAIGN, DOMAIN)).toBe(repo.injectTrackingPixel(html, EID, CAMPAIGN));
      expect(injectClickTracking(html, EID, CAMPAIGN, DOMAIN)).toBe(repo.injectClickTracking(html, EID, CAMPAIGN));
      expect(injectUnsubscribeLink(html, EID, CAMPAIGN, DOMAIN, 'campaign')).toBe(repo.injectUnsubscribeLink(html, EID, CAMPAIGN));
    }
  });

  it('the follow-up pixel and unsubscribe block (process-followups)', () => {
    const repo = loadRepo('process-followups', { env: { TRACKING_DOMAIN: DOMAIN }, supabase: oracleSupabase({}), random: seeded(1), exportNames: ['injectTrackingPixel', 'injectUnsubscribeLink', 'parseSpintax'] }).fns as unknown as {
      injectTrackingPixel(h: string, e: string, c: string): string;
      injectUnsubscribeLink(h: string, e: string, c: string): string;
    };
    for (const html of HTML_SAMPLES) {
      expect(injectTrackingPixel(html, EID, CAMPAIGN, DOMAIN)).toBe(repo.injectTrackingPixel(html, EID, CAMPAIGN));
      expect(injectUnsubscribeLink(html, EID, CAMPAIGN, DOMAIN, 'followup')).toBe(repo.injectUnsubscribeLink(html, EID, CAMPAIGN));
    }
  });
});

/** The harness's tables as plain rows for the oracle (same ids and values). */
function oracleTables(h: MarketingHarness): Record<string, Array<Record<string, unknown>>> {
  return structuredClone(Object.fromEntries(['marketing_campaigns', 'marketing_settings', 'marketing_sender_accounts', 'marketing_campaign_recipients', 'marketing_subscribers'].map((t) => [t, h.rows(t)])));
}

/** Runs the repo send-campaign on the same data; event ids are those the Worker derives from each message's idem. */
async function repoCampaign(h: MarketingHarness, seed: number): Promise<{ sb: OracleSupabase; mails: ReturnType<typeof loadRepo>['mails'] }> {
  const sb = oracleSupabase(oracleTables(h));
  const ids = new Map<string, string>();
  for (const s of h.rows('marketing_subscribers')) ids.set(String(s.id), await eventIdFor(`camp:${CAMPAIGN}:${s.id}:1`));
  sb.nextEventId = (row) => ids.get(String(row.subscriber_id)) as string;
  const repo = loadRepo('send-campaign', { env: { TRACKING_DOMAIN: DOMAIN, RESEND_API_KEY: 'resend-test-value' }, supabase: sb, random: seeded(seed), exportNames: [] });
  const res = await repo.handler(new Request('https://fn.test/send-campaign', { method: 'POST', body: JSON.stringify({ campaign_id: CAMPAIGN }) }));
  expect(res.status).toBe(200);
  return { sb, mails: repo.mails };
}

/** Runs the Worker route and the consumer with one seeded stream (selection draws first, then spintax, as the repo). */
async function workerCampaign(seed: number, setup: (h: MarketingHarness) => void): Promise<MarketingHarness> {
  const random = seeded(seed);
  const h = marketingHarness({ random });
  setup(h);
  const res = await h.route({ campaign_id: CAMPAIGN });
  expect(res.status).toBe(202);
  await h.drain();
  return h;
}

describe('a whole campaign equals the repo function', () => {
  const cases: Array<[string, (h: MarketingHarness) => void]> = [
    ['tag mode, A/B, default identity', (h) => seedCampaign(h, { subscribers: 6, inactive: [5], tags: { 1: ['cnc'], 2: ['laser'], 3: ['x'], 4: ['cnc'], 5: ['cnc'], 6: ['laser', 'cnc'] }, campaign: { target_tags: ['cnc', 'laser'], ab_test_config: { enabled: true }, body: '<p>{Dear|Hello} {{name}} <a href="https://www.micronshub.eu/en/x?a=1&b=2">x</a></p>' } })],
    ['CSV mode with custom subject and body', (h) => seedCampaign(h, { subscribers: 4, inactive: [3], csv: [{ n: 1, sub: 4, custom_subject: 'Re: {{name}} {a|b}', custom_body: '<html><body>{x|y|z} {{email}}</body></html>' }, { n: 2, sub: 2 }, { n: 3, sub: 3 }] })],
    ['a Resend sender account (repo round-robin over one account)', (h) => seedCampaign(h, { subscribers: 3, senders: [{ id: ACC_R, provider: 'resend', provider_config: { api_key: ['acct', 'value'].join('-') } }], settings: { unsubscribe_link_enabled: false } })],
  ];

  for (const [name, setup] of cases) {
    it(name, async () => {
      for (const seed of [3, 11, 29]) {
        const h = await workerCampaign(seed, setup);
        const repo = await repoCampaign(await (async () => {
          const fresh = marketingHarness();
          setup(fresh);
          return fresh;
        })(), seed);
        // the same mails in the same order: from, to, subject, html (every tracking URL), key
        expect(h.resend.map((r) => ({ key: r.headers.authorization, from: r.body.from, to: r.body.to, subject: r.body.subject, html: r.body.html }))).toEqual(
          repo.mails.map((m) => ({ key: `Bearer ${m.apiKey}`, from: m.from, to: m.to, subject: m.subject, html: m.html })),
        );
        // the same event rows (id, type, metadata, provider id)
        const repoEvents = (repo.sb.tables.marketing_events ?? []).map((e) => ({ id: e.id, subscriber_id: e.subscriber_id, event_type: e.event_type, metadata: e.metadata, resend_email_id: e.resend_email_id }));
        const mine = h.rows('marketing_events').map((e) => ({ id: e.id, subscriber_id: e.subscriber_id, event_type: e.event_type, metadata: e.metadata, resend_email_id: e.resend_email_id }));
        expect(mine).toEqual(repoEvents);
        // the same recipient statuses and campaign status / count
        const statuses = (rows: Array<Record<string, unknown>>) => rows.map((r) => [r.id, r.status, r.sent_at ? 'set' : null]);
        expect(statuses(h.rows('marketing_campaign_recipients'))).toEqual(statuses(repo.sb.tables.marketing_campaign_recipients ?? []));
        const c = h.rows('marketing_campaigns')[0] ?? {};
        const rc = repo.sb.tables.marketing_campaigns?.[0] ?? {};
        expect([c.status, c.sent_count]).toEqual([rc.status, rc.sent_count]);
      }
    });
  }
});

describe('follow-ups equal the repo function', () => {
  it('the same due rows are sent with the same subject and HTML; skipped rows the same', async () => {
    const setup = (h: MarketingHarness) => {
      seedCampaign(h, { subscribers: 5, inactive: [4] });
      h.db.seed('marketing_campaign_recipients', [
        { id: rec(11), campaign_id: CAMPAIGN, subscriber_id: sub(1), sequence_number: 1, status: 'sent', sent_at: new Date(T0 - 5 * 86_400_000).toISOString() },
        { id: rec(12), campaign_id: CAMPAIGN, subscriber_id: sub(1), sequence_number: 2, delay_days: 3, status: 'pending', custom_subject: 'Again {{name}}', custom_body: '<p>{one|two} {{name}}</p>' },
        { id: rec(13), campaign_id: CAMPAIGN, subscriber_id: sub(2), sequence_number: 2, delay_days: 1, status: 'pending' },
        { id: rec(14), campaign_id: CAMPAIGN, subscriber_id: sub(3), sequence_number: 2, delay_days: 9, status: 'pending', custom_subject: 'Later' },
        { id: rec(15), campaign_id: CAMPAIGN, subscriber_id: sub(4), sequence_number: 2, delay_days: 0, status: 'pending' },
        { id: rec(16), campaign_id: CAMPAIGN, subscriber_id: sub(5), sequence_number: 3, delay_days: 0, status: 'pending' },
      ]);
      // sequence 1 of subscribers 2 and 3 went out as events (tag mode) 2 days ago
      h.db.seed('marketing_events', [
        { id: '0e000000-0000-4000-8000-000000000002', campaign_id: CAMPAIGN, subscriber_id: sub(2), event_type: 'sent', metadata: {}, created_at: new Date(T0 - 2 * 86_400_000).toISOString() },
        { id: '0e000000-0000-4000-8000-000000000003', campaign_id: CAMPAIGN, subscriber_id: sub(3), event_type: 'sent', metadata: {}, created_at: new Date(T0 - 2 * 86_400_000).toISOString() },
      ]);
    };
    // Worker: enqueue at the slot, then the consumer sends
    const h = marketingHarness({ random: seeded(7) });
    setup(h);
    const counts = await enqueueDueFollowups(h.env, '2026-10-08T10:05Z', { run_id: 'run-f', ports: h.ports });
    expect(counts).toEqual({ candidates: 5, enqueued: 2, skipped: 1, not_due: 2, in_flight: 0, held: 0 });
    expect(h.queue.bodies().map((b) => [b.kind, b.subscriber_id, b.sequence, b.recipient_record_id, b.preferred_account_id, b.run_id])).toEqual([
      ['followup', sub(1), 2, rec(12), null, 'run-f'],
      ['followup', sub(2), 2, rec(13), null, 'run-f'],
    ]);
    await h.drain();
    // Oracle: the repo function at the same time, with event ids derived the same way
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 8, 10, 5), toFake: ['Date'] });
    const fresh = marketingHarness();
    setup(fresh);
    const sb = oracleSupabase({ ...oracleTables(fresh), marketing_events: structuredClone(fresh.rows('marketing_events')) });
    const ids = new Map<string, string>();
    for (const r of fresh.rows('marketing_campaign_recipients')) ids.set(`${r.subscriber_id}:${r.sequence_number}`, await eventIdFor(`camp:${CAMPAIGN}:${r.subscriber_id}:${r.sequence_number}`));
    sb.nextEventId = (row) => ids.get(`${row.subscriber_id}:${(row.metadata as { sequence_number: number }).sequence_number}`) as string;
    const repo = loadRepo('process-followups', { env: { TRACKING_DOMAIN: DOMAIN, RESEND_API_KEY: 'resend-test-value' }, supabase: sb, random: seeded(7), exportNames: [] });
    const res = await repo.handler(new Request('https://fn.test/process-followups', { method: 'POST' }));
    expect(await res.json()).toEqual({ message: 'Follow-up processing complete', processed: 2, skipped: 1 });
    vi.useRealTimers();
    expect(h.resend.map((r) => ({ from: r.body.from, to: r.body.to, subject: r.body.subject, html: r.body.html }))).toEqual(repo.mails.map((m) => ({ from: m.from, to: m.to, subject: m.subject, html: m.html })));
    const statuses = (rows: Array<Record<string, unknown>>) => rows.filter((r) => Number(r.sequence_number) > 1).map((r) => [r.id, r.status]);
    expect(statuses(h.rows('marketing_campaign_recipients'))).toEqual(statuses(sb.tables.marketing_campaign_recipients ?? []));
    // the follow-up events carry the repo metadata plus the provider id
    expect(h.rows('marketing_events').filter((e) => (e.metadata as { follow_up?: boolean }).follow_up).map((e) => e.metadata)).toEqual([
      { sequence_number: 2, follow_up: true, resend_id: 'resend-1', from: 'Microns Hub <info@micronshub.eu>' },
      { sequence_number: 2, follow_up: true, resend_id: 'resend-2', from: 'Microns Hub <info@micronshub.eu>' },
    ]);
  });
});

describe('warm-up equals the repo function', () => {
  it('the same updates of every sender account', async () => {
    const accounts = [
      { id: 'a1', last_reset_date: '2026-10-07', warmup_enabled: true, warmup_current_limit: 10, warmup_daily_increment: 5, daily_limit: 500, emails_sent_today: 7 },
      { id: 'a2', last_reset_date: '2026-10-08', warmup_enabled: true, warmup_current_limit: 498, warmup_daily_increment: 5, daily_limit: 500, emails_sent_today: 1 },
      { id: 'a3', last_reset_date: null, warmup_enabled: false, warmup_current_limit: 10, warmup_daily_increment: 5, daily_limit: 100, emails_sent_today: 3 },
      { id: 'a4', last_reset_date: '2026-10-01', warmup_enabled: true, warmup_current_limit: null, warmup_daily_increment: null, daily_limit: 12, emails_sent_today: 0 },
      { id: 'a5', last_reset_date: '2026-10-08', warmup_enabled: true, warmup_current_limit: 500, warmup_daily_increment: 5, daily_limit: 500, emails_sent_today: 0 },
    ];
    const h = marketingHarness();
    h.db.seed('marketing_sender_accounts', structuredClone(accounts));
    const counts = await runWarmup(h.env, '2026-10-08', { run_id: 'run-w', ports: h.ports });
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 8, 0, 5), toFake: ['Date'] });
    const sb = oracleSupabase({ marketing_sender_accounts: structuredClone(accounts) });
    const repo = loadRepo('process-warmup', { env: {}, supabase: sb, random: seeded(1), exportNames: [] });
    const res = await repo.handler(new Request('https://fn.test/process-warmup', { method: 'POST' }));
    const body = (await res.json()) as Record<string, unknown>;
    vi.useRealTimers();
    expect(counts).toEqual({ accounts_processed: body.accounts_processed, warmed_up: body.warmed_up, counters_reset: body.counters_reset });
    const strip = (rows: Array<Record<string, unknown>>) => rows.map(({ updated_at: _u, ...r }) => r);
    expect(strip(h.rows('marketing_sender_accounts'))).toEqual(strip(sb.tables.marketing_sender_accounts ?? []));
  });
});

describe('the consumer of a follow-up message', () => {
  it('sends from the default identity with the follow-up tracking (no click tracking) and marks the row sent', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    h.db.seed('marketing_campaign_recipients', [{ id: rec(21), campaign_id: CAMPAIGN, subscriber_id: sub(1), sequence_number: 2, delay_days: 0, status: 'pending', custom_body: '<a href="https://x.test">x</a>' }]);
    await h.consume([message({ v: 1, kind: 'followup', campaign_id: CAMPAIGN, subscriber_id: sub(1), recipient_record_id: rec(21), sequence: 2, subject: 'Following up', preferred_account_id: null, idem: `camp:${CAMPAIGN}:${sub(1)}:2`, run_id: 'run-f', deferrals: 0 })]);
    const eid = await eventIdFor(`camp:${CAMPAIGN}:${sub(1)}:2`);
    expect(h.resend[0]?.body).toEqual({
      from: 'Microns Hub <info@micronshub.eu>',
      to: ['person1@example.test'],
      subject: 'Following up',
      html: injectUnsubscribeLink(injectTrackingPixel('<a href="https://x.test">x</a>', eid, CAMPAIGN, DOMAIN), eid, CAMPAIGN, DOMAIN, 'followup'),
    });
    expect(h.rows('marketing_campaign_recipients')[0]).toMatchObject({ status: 'sent' });
    // a follow-up never closes the campaign
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'draft' });
  });
});
