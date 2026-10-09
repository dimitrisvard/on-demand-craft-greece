// Consumer of "outbound-mail" (unit M5, PHASE5_SPEC §5.3, §6.5): the send per sender kind (default Resend identity,
// Resend account with its own key, Google Workspace through the Gmail port), the event, recipient and limiter
// writes, cap fallback to the campaign's other accounts, deferral copies (cap -> next 00:00 UTC + jitter, spacing >
// 60 s, pause and stop holds that do not count, the 86,400 s clamp, the 30-deferral limit), in-process waits up to
// 60 s, retry() only for provider 5xx / 429 / network errors, final failures, already_sent, duplicates in flight,
// redeliveries, the campaign close (once, with bounces, on the newest run), invalid messages and configuration.

import { describe, expect, it, vi } from 'vitest';
import { closeCampaignIfDone } from '../../../src/marketing/campaign-close';
import { eventIdFor } from '../../../src/marketing/events';
import { clampDelay, isOutboundMail, MAX_DEFERRALS, secondsToMidnight } from '../../../src/queues/outbound-mail';
import type { OutboundMailV1 } from '../../../src/queues/messages';
import { ACC_G, ACC_R, CAMPAIGN, email, marketingHarness, message, rec, seedCampaign, sub, T0, type MarketingHarness } from './harness';

const DEFAULT_FROM = 'Microns Hub <info@micronshub.eu>';

/** Queues the campaign through the route and returns the queued bodies (queue cleared). */
async function queued(h: MarketingHarness): Promise<OutboundMailV1[]> {
  const res = await h.route({ campaign_id: CAMPAIGN });
  expect(res.status).toBe(202);
  const bodies = h.queue.bodies();
  h.queue.clear();
  return bodies;
}

function mimeOf(h: MarketingHarness, n: number): { headers: Record<string, string>; html: string } {
  const text = h.p5.gmailSend.mimeText(n);
  const [head, body] = text.split('\r\n\r\n') as [string, string];
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n')) {
    const at = line.indexOf(': ');
    headers[line.slice(0, at)] = line.slice(at + 2);
  }
  return { headers, html: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
}

describe('send per sender kind', () => {
  it('default identity: Resend with RESEND_API_KEY and Idempotency-Key, event finalised, limiter committed, campaign closed', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    const [body] = await queued(h);
    const [m] = [message(body as OutboundMailV1)];
    await h.consume([m]);
    expect(m.acked).toBe(true);
    expect(h.resend).toHaveLength(1);
    const call = h.resend[0]!;
    const eventId = await eventIdFor(`camp:${CAMPAIGN}:${sub(1)}:1`);
    expect(call.url).toBe('https://api.resend.com/emails');
    expect(call.headers).toMatchObject({ authorization: 'Bearer resend-test-value', 'idempotency-key': `camp:${CAMPAIGN}:${sub(1)}:1`, 'content-type': 'application/json' });
    expect(call.body.from).toBe(DEFAULT_FROM);
    expect(call.body.to).toEqual([email(1)]);
    expect(call.body.subject).toBe('Hello Person 1');
    expect(call.body.html).toContain(`<img src="https://micronshub.eu/api/marketing?action=track&type=open&eid=${eventId}&cid=${CAMPAIGN}"`);
    expect(call.body.html).toContain(`href="https://micronshub.eu/api/marketing?action=track&type=click&eid=${eventId}&cid=${CAMPAIGN}&url=${encodeURIComponent('https://www.micronshub.eu/en/cnc')}"`);
    expect(call.body.html).toContain('href="mailto:x@example.test"');
    expect(call.body.html).toContain(`type=unsubscribe&eid=${eventId}&cid=${CAMPAIGN}`);
    expect(Object.keys(call.body).sort()).toEqual(['from', 'html', 'subject', 'to']);
    expect(h.rows('marketing_events')).toEqual([expect.objectContaining({ id: eventId, campaign_id: CAMPAIGN, subscriber_id: sub(1), event_type: 'sent', resend_email_id: 'resend-1', metadata: { resend_id: 'resend-1', from: DEFAULT_FROM } })]);
    expect(await h.limiter('default').reserve({ idem: body!.idem, now: T0 })).toEqual({ status: 'already_sent' });
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 1 });
  });

  it('Google Workspace account: Gmail access token, RFC 5322 MIME (UTF-8 subject encoded), metadata gmail_id, emails_sent_today mirrored', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1, senders: [{ id: ACC_G, provider: 'google_workspace', provider_config: { refresh_token: 'r', access_token: 'stored' } }], campaign: { subject_a: 'Grüße {{name}}' } });
    const bodies = await queued(h);
    await h.consume(bodies.map((b) => message(b)));
    expect(h.gmail.asked).toEqual([ACC_G]);
    expect(h.p5.gmailSend.sent.map((s) => s.accessToken)).toEqual(['gmail-token-1']);
    const mime = mimeOf(h, 0);
    expect(mime.headers.From).toBe('Sender 1 <sender1@example.test>');
    expect(mime.headers.To).toBe(email(1));
    expect(mime.headers.Subject).toBe(`=?UTF-8?B?${Buffer.from('Grüße Person 1').toString('base64')}?=`);
    expect(mime.headers['Content-Type']).toBe('text/html; charset=UTF-8');
    expect(mime.headers['Content-Transfer-Encoding']).toBe('base64');
    expect(mime.html).toContain('Dear Person 1');
    expect(h.resend).toEqual([]);
    expect(h.rows('marketing_events')[0]).toMatchObject({ resend_email_id: 'gmail-1', metadata: { gmail_id: 'gmail-1', from: 'Sender 1 <sender1@example.test>' } });
    expect(h.rows('marketing_sender_accounts')[0]).toMatchObject({ emails_sent_today: 1 });
  });

  it('Resend account: its own provider_config.api_key, else RESEND_API_KEY; From = display name and address', async () => {
    const keyed = ['account', 'key', 'value'].join('-');
    for (const [config, auth] of [[{ api_key: keyed }, `Bearer ${keyed}`], [{}, 'Bearer resend-test-value']] as const) {
      const h = marketingHarness();
      seedCampaign(h, { subscribers: 1, senders: [{ id: ACC_R, provider: 'resend', provider_config: config }] });
      await h.consume((await queued(h)).map((b) => message(b)));
      expect(h.resend[0]?.headers.authorization).toBe(auth);
      expect(h.resend[0]?.body.from).toBe('Sender 1 <sender1@example.test>');
    }
  });

  it('CSV row: custom body and subject; the row becomes sent with sent_at', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 2, csv: [{ n: 1, sub: 2, custom_subject: 'For {{name}}', custom_body: '<p>{Hi|Hello} {{name}}, {{email}}</p>' }] });
    await h.consume((await queued(h)).map((b) => message(b)));
    expect(h.resend[0]?.body.subject).toBe('For there');
    expect(h.resend[0]?.body.html.startsWith(`<p>Hi there, ${email(2)}</p><img src=`)).toBe(true);
    expect(h.rows('marketing_campaign_recipients').find((r) => r.id === rec(1))).toMatchObject({ status: 'sent', sent_at: new Date(T0).toISOString() });
  });

  it('tracking domain: marketing_settings.tracking_domain first, then TRACKING_DOMAIN; no unsubscribe block when disabled', async () => {
    const h = marketingHarness({ env: { TRACKING_DOMAIN: 'https://track.example.test' } });
    seedCampaign(h, { subscribers: 1, settings: { tracking_domain: 'https://own.example.test', unsubscribe_link_enabled: false } });
    await h.consume((await queued(h)).map((b) => message(b)));
    const html = h.resend[0]?.body.html ?? '';
    expect(html).toContain('src="https://own.example.test/api/marketing?action=track&type=open');
    expect(html).not.toContain('type=unsubscribe');
    const g = marketingHarness({ env: { TRACKING_DOMAIN: 'https://track.example.test' } });
    seedCampaign(g, { subscribers: 1 });
    await g.consume((await queued(g)).map((b) => message(b)));
    expect(g.resend[0]?.body.html).toContain('https://track.example.test/api/marketing?action=track&type=unsubscribe');
  });
});

describe('pacing and deferral', () => {
  it('preferred account exhausted -> the campaign\'s next active account in round-robin order', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1, senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 0 }, { id: ACC_R, provider: 'resend' }] });
    const bodies = await queued(h);
    expect(bodies[0]?.preferred_account_id).toBe(ACC_G);
    await h.consume(bodies.map((b) => message(b)));
    expect(h.p5.gmailSend.sent).toEqual([]);
    expect(h.resend[0]?.body.from).toBe('Sender 2 <sender2@example.test>');
  });

  it('every sender at its cap -> a copy to the next 00:00 UTC + jitter (<= 600 s), deferrals + 1, original acked, never retry()', async () => {
    const h = marketingHarness({ random: () => 0.5 });
    seedCampaign(h, { subscribers: 1, senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 0 }, { id: ACC_R, provider: 'resend', daily_limit: 0 }] });
    const m = message((await queued(h))[0] as OutboundMailV1);
    await h.consume([m]);
    expect([m.acked, m.retried]).toEqual([true, false]);
    expect(h.queue.sent).toEqual([{ body: { ...m.body, deferrals: 1 }, delaySeconds: 14 * 3600 + 300 }]);
    expect(h.resend).toEqual([]);
  });

  it('the cap deferral at 00:05 UTC is clamped to 86,400 s', async () => {
    const h = marketingHarness({ now: Date.UTC(2026, 9, 8, 0, 5, 0), random: () => 0.99 });
    seedCampaign(h, { subscribers: 1, senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 0 }] });
    const m = message((await queued(h))[0] as OutboundMailV1);
    await h.consume([m]);
    expect(h.queue.sent[0]?.delaySeconds).toBe(86_400);
    expect(secondsToMidnight(Date.UTC(2026, 9, 8, 0, 5, 0), 600)).toBeGreaterThan(86_400);
    expect([clampDelay(86_700), clampDelay(0.2), clampDelay(-5), clampDelay(Number.NaN)]).toEqual([86_400, 1, 0, 0]);
  });

  it('no active sender left (all deactivated) -> treated as a cap: deferred to the next day, never the default identity', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1, senders: [{ id: ACC_G, provider: 'google_workspace' }] });
    const bodies = await queued(h);
    await h.db.update('marketing_sender_accounts', { is_active: false }, { filters: [['id', 'eq', ACC_G]] });
    await h.consume(bodies.map((b) => message(b)));
    expect(h.queue.sent[0]?.body.deferrals).toBe(1);
    expect(h.resend).toEqual([]);
  });

  it('spacing up to 60 s is waited in-process; beyond it the message is deferred by not_before - now', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 3, settings: { delay_between_emails_seconds: 45 } });
    const bodies = await queued(h);
    await h.consume(bodies.slice(0, 2).map((b) => message(b)));
    expect(h.sleeps).toEqual([45_000]);
    expect(h.resend).toHaveLength(2);
    const slow = marketingHarness();
    seedCampaign(slow, { subscribers: 2, settings: { delay_between_emails_seconds: 90 } });
    const [a, b] = (await queued(slow)).map((x) => message(x)) as [ReturnType<typeof message>, ReturnType<typeof message>];
    await slow.consume([a, b]);
    expect(slow.resend).toHaveLength(1);
    expect(slow.queue.sent).toEqual([{ body: { ...b.body, deferrals: 1 }, delaySeconds: 90 }]);
    expect([b.acked, b.retried]).toEqual([true, false]);
    // the copy arrives at its slot: the reservation is reused (not counted twice) and the mail goes out
    slow.clock.advance(90_000);
    const copy = message(slow.queue.sent[0]!.body);
    slow.queue.clear();
    await slow.consume([copy]);
    expect(slow.resend).toHaveLength(2);
    expect((await slow.limiter('default').stats()).sent_today).toBe(2);
  });

  it('pause and stop: a hold copy after 3,600 s with deferrals unchanged; nothing reserved or sent', async () => {
    for (const flag of ['OUTBOUND_MAIL_PAUSED', 'OUTBOUND_MAIL_STOPPED'] as const) {
      const h = marketingHarness();
      seedCampaign(h, { subscribers: 1 });
      const body = { ...((await queued(h))[0] as OutboundMailV1), deferrals: 7 };
      h.env[flag] = 'true';
      const m = message(body);
      await h.consume([m]);
      expect([flag, m.acked, m.retried, h.queue.sent]).toEqual([flag, true, false, [{ body, delaySeconds: 3600 }]]);
      expect(h.resend).toEqual([]);
      expect((await h.limiter('default').stats()).sent_today).toBe(0);
    }
  });

  it(`a deferral beyond ${MAX_DEFERRALS} is a final failure: event bounced deferral_limit, recipient failed, no copy`, async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1, senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 0 }], csv: [{ n: 1, sub: 1 }] });
    const body = { ...((await queued(h))[0] as OutboundMailV1), deferrals: MAX_DEFERRALS };
    const m = message(body);
    await h.consume([m]);
    expect([m.acked, h.queue.sent]).toEqual([true, []]);
    expect(h.rows('marketing_events')[0]).toMatchObject({ event_type: 'bounced', metadata: { error: 'deferral_limit' } });
    expect(h.rows('marketing_campaign_recipients')[0]).toMatchObject({ status: 'failed' });
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 0 });
  });
});

describe('outcomes', () => {
  it('provider 5xx, 429 and network errors -> retry() with the reservation kept; the retry sends under the same event', async () => {
    for (const failure of [{ status: 503, body: { name: 'application_error' } }, { status: 429, body: { name: 'rate_limit_exceeded' } }, 'network' as const]) {
      const h = marketingHarness();
      seedCampaign(h, { subscribers: 1 });
      const body = (await queued(h))[0] as OutboundMailV1;
      h.resendScript.push(failure);
      const first = message(body, 1);
      await h.consume([first]);
      expect([first.acked, first.retried]).toEqual([false, true]);
      expect((await h.limiter('default').stats()).sent_today).toBe(1);
      const second = message(body, 2);
      await h.consume([second]);
      expect([second.acked, second.retried]).toEqual([true, false]);
      expect(h.resend.map((r) => r.headers['idempotency-key'])).toEqual([body.idem, body.idem]);
      expect(h.rows('marketing_events')).toHaveLength(1);
      expect(h.rows('marketing_events')[0]).toMatchObject({ event_type: 'sent', resend_email_id: 'resend-2' });
      expect((await h.limiter('default').stats()).sent_today).toBe(1);
    }
  });

  it('provider 4xx -> final failure: event bounced {error}, recipient failed, limiter released, campaign closed with the bounce', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 2, csv: [{ n: 1, sub: 1 }, { n: 2, sub: 2 }] });
    const bodies = await queued(h);
    h.resendScript.push({ status: 422, body: { name: 'validation_error' } });
    const ms = bodies.map((b) => message(b));
    await h.consume(ms);
    expect(ms.map((m) => [m.acked, m.retried])).toEqual([[true, false], [true, false]]);
    expect(h.rows('marketing_events').map((e) => [e.subscriber_id, e.event_type, (e.metadata as Record<string, unknown>).error ?? null])).toEqual([
      [sub(1), 'bounced', 'resend_422_validation_error'],
      [sub(2), 'sent', null],
    ]);
    expect(h.rows('marketing_campaign_recipients').map((r) => r.status)).toEqual(['failed', 'sent']);
    expect((await h.limiter('default').stats()).sent_today).toBe(1);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 1 });
    expect(h.rows('agent_runs').find((r) => r.agent === 'marketing.send')).toMatchObject({ status: 'succeeded', output: { expected: 2, queued: 2, sent: 1, bounced: 1, waiting: 0, mode: 'csv' } });
  });

  it('the last delivery (attempts 4) with a retryable error is a final failure; a thrown error retries before it and records it then', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    const body = (await queued(h))[0] as OutboundMailV1;
    h.resendScript.push({ status: 500, body: {} });
    const last = message(body, 4);
    await h.consume([last]);
    expect([last.acked, last.retried]).toEqual([true, false]);
    expect(h.rows('marketing_events')[0]).toMatchObject({ event_type: 'bounced', metadata: { error: 'resend_500_error' } });
    const g = marketingHarness();
    seedCampaign(g, { subscribers: 1 });
    const gb = (await queued(g))[0] as OutboundMailV1;
    const select = vi.spyOn(g.db, 'select').mockRejectedValueOnce(new Error('db down'));
    const early = message(gb, 1);
    await g.consume([early]);
    expect([early.acked, early.retried]).toEqual([false, true]);
    select.mockRestore();
  });

  it('Gmail invalid_grant is final (not retried); an unavailable token is retried', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1, senders: [{ id: ACC_G, provider: 'google_workspace' }] });
    const body = (await queued(h))[0] as OutboundMailV1;
    h.gmail.answer = { error: 'unavailable' };
    const a = message(body);
    await h.consume([a]);
    expect([a.acked, a.retried]).toEqual([false, true]);
    h.gmail.answer = { error: 'invalid_grant' };
    const b = message(body, 2);
    await h.consume([b]);
    expect([b.acked, b.retried]).toEqual([true, false]);
    expect(h.rows('marketing_events')[0]).toMatchObject({ event_type: 'bounced', metadata: { error: 'gmail_invalid_grant' } });
  });

  it('already_sent (limiter key sent) -> the rows are finalised only, nothing is sent again', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1, csv: [{ n: 1, sub: 1 }] });
    const body = (await queued(h))[0] as OutboundMailV1;
    await h.consume([message(body)]);
    await h.db.update('marketing_campaign_recipients', { status: 'pending' }, { filters: [['id', 'eq', rec(1)]] });
    const again = message(body, 2);
    await h.consume([again]);
    expect(again.acked).toBe(true);
    expect(h.resend).toHaveLength(1);
    expect(h.rows('marketing_campaign_recipients')[0]).toMatchObject({ status: 'sent' });
  });

  it('a duplicate of a message in flight (first delivery, unfinished event younger than 15 min) is acked without a send; a redelivery sends', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    const body = (await queued(h))[0] as OutboundMailV1;
    const id = await eventIdFor(body.idem);
    await h.db.insert('marketing_events', { id, campaign_id: CAMPAIGN, subscriber_id: sub(1), event_type: 'sent', metadata: {} });
    const dup = message(body, 1);
    await h.consume([dup]);
    expect([dup.acked, h.resend.length]).toEqual([true, 0]);
    const redelivery = message(body, 2);
    await h.consume([redelivery]);
    expect([redelivery.acked, h.resend.length]).toEqual([true, 1]);
    expect(h.rows('marketing_events')).toHaveLength(1);
    // an unfinished event older than 15 min is taken over by a first delivery
    const late = marketingHarness();
    seedCampaign(late, { subscribers: 1 });
    const lb = (await queued(late))[0] as OutboundMailV1;
    await late.db.insert('marketing_events', { id: await eventIdFor(lb.idem), campaign_id: CAMPAIGN, subscriber_id: sub(1), event_type: 'sent', metadata: {} });
    late.clock.advance(16 * 60_000);
    await late.consume([message(lb, 1)]);
    expect(late.resend).toHaveLength(1);
  });

  it('a finalised sent event found on insert -> commit with its provider id, nothing sent', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    const body = (await queued(h))[0] as OutboundMailV1;
    await h.db.insert('marketing_events', { id: await eventIdFor(body.idem), campaign_id: CAMPAIGN, subscriber_id: sub(1), event_type: 'sent', metadata: { resend_id: 'resend-x' }, resend_email_id: 'resend-x' });
    await h.consume([message(body, 2)]);
    expect(h.resend).toEqual([]);
    expect(await h.limiter('default').reserve({ idem: body.idem, now: T0 })).toEqual({ status: 'already_sent' });
  });
});

describe('campaign close', () => {
  it('closes once, after the last recipient, on the newest run; a later outcome changes nothing', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 3 });
    const bodies = await queued(h);
    await h.consume([message(bodies[0]!), message(bodies[1]!)]);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sending' });
    expect(h.rows('agent_runs').find((r) => r.agent === 'marketing.send')).toMatchObject({ status: 'running' });
    await h.consume([message(bodies[2]!)]);
    const campaign = h.rows('marketing_campaigns')[0];
    expect(campaign).toMatchObject({ status: 'sent', sent_count: 3 });
    const run = h.rows('agent_runs').find((r) => r.agent === 'marketing.send');
    expect(run).toMatchObject({ status: 'succeeded', output: { expected: 3, queued: 3, sent: 3, bounced: 0, waiting: 0, mode: 'tags' } });
    const closedAt = run?.finished_at;
    const updates = h.db.calls.filter((c) => c.method === 'update' && c.target === 'marketing_campaigns').length;
    await h.consume([message(bodies[2]!, 2)]);
    expect(h.db.calls.filter((c) => c.method === 'update' && c.target === 'marketing_campaigns').length).toBe(updates + 1);
    expect(h.rows('agent_runs').find((r) => r.agent === 'marketing.send')?.finished_at).toBe(closedAt);
  });

  it('a webhook bounce of a sent mail and follow-up events never count twice', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 2 });
    const bodies = await queued(h);
    await h.consume([message(bodies[0]!)]);
    await h.db.insert('marketing_events', { campaign_id: CAMPAIGN, subscriber_id: sub(1), event_type: 'bounced', metadata: {}, resend_email_id: 'resend-1' });
    await h.db.insert('marketing_events', { campaign_id: CAMPAIGN, subscriber_id: sub(1), event_type: 'sent', metadata: { follow_up: true, sequence_number: 2 }, resend_email_id: 'f-1' });
    await h.db.insert('marketing_events', { campaign_id: CAMPAIGN, subscriber_id: sub(2), event_type: 'sent', metadata: { follow_up: true, sequence_number: 2 }, resend_email_id: 'f-2' });
    // counting rows would reach 2 here; subscriber 2 has no outcome of the campaign mail yet
    expect(await closeCampaignIfDone(h.db, CAMPAIGN, h.clock.now())).toEqual({ closed: false, reason: 'not_done', sent: 1, bounced: 0, expected: 2 });
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sending' });
    await h.consume([message(bodies[1]!)]);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 2 });
  });
});

describe('message shape and configuration', () => {
  it('invalid bodies are logged and acked; a missing campaign is acked', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    const body = (await queued(h))[0] as OutboundMailV1;
    const bad = [
      { ...body, v: 2 },
      { ...body, idem: `camp:${CAMPAIGN}:${sub(2)}:1` },
      { ...body, kind: 'followup' },
      { ...body, deferrals: -1 },
      { ...body, preferred_account_id: 'x' },
      'text',
    ].map((b) => message(b as OutboundMailV1));
    for (const b of bad) expect(isOutboundMail(b.body)).toBe(false);
    expect(isOutboundMail(body)).toBe(true);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.consume(bad);
    expect(bad.every((m) => m.acked && !m.retried)).toBe(true);
    (h.db.tables as Record<string, unknown[]>).marketing_campaigns = [];
    const gone = message(body);
    await h.consume([gone]);
    expect([gone.acked, h.resend.length]).toEqual([true, 0]);
    errors.mockRestore();
  });

  it('missing SENDER_LIMITER: the message is retried (and recorded as a failure on its last delivery)', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    const body = (await queued(h))[0] as OutboundMailV1;
    h.env.SENDER_LIMITER = undefined;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = message(body);
    await h.consume([m]);
    expect([m.acked, m.retried]).toEqual([false, true]);
    errors.mockRestore();
  });

  it('log lines carry no address, subject or body', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 2 });
    const lines: string[] = [];
    const capture = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
    const spies = [vi.spyOn(console, 'log').mockImplementation(capture), vi.spyOn(console, 'error').mockImplementation(capture)];
    h.resendScript.push({ status: 422, body: { name: 'validation_error' } });
    await h.consume((await queued(h)).map((b) => message(b)));
    for (const s of spies) s.mockRestore();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toMatch(/@|Person|Hello|Dear/);
  });
});
