// Consumer of "outbound-mail" over a message's whole life (unit M5, PHASE5_SPEC §5.3, §6.5): a retried message that
// is re-slotted and deferred hands over to its delayed copy, which sends (the hand-over is taken once; a copy of
// another delivery without one stays held back, outbound-mail.test.ts); the subscriber's status is read again at
// send time (unsubscribed, follow-up after a reply); every delivery of one message carries the same subject and body
// under one Idempotency-Key; the outcome rules at their
// boundaries (last retry, the 60 s in-process wait, provider 409 kinds, writes that never undo a sent mail, a failed
// newest run left as it is); the campaign close reads once per batch; and pacing keeps each UTC day's slots on that
// day (an event-time run of the queue with the real consumer and SenderLimiter).

import { describe, expect, it, vi } from 'vitest';
import { closeRun, EMPTY_USAGE } from '../../../src/agents/runs';
import { eventIdFor } from '../../../src/marketing/events';
import { messageRandom, personalise } from '../../../src/marketing/personalise';
import { WAIT_IN_PROCESS_MS } from '../../../src/queues/outbound-mail';
import type { OutboundMailV1 } from '../../../src/queues/messages';
import { ACC_G, CAMPAIGN, email, marketingHarness, message, rec, seedCampaign, sub, T0, type MarketingHarness } from './harness';

async function queued(h: MarketingHarness): Promise<OutboundMailV1[]> {
  const res = await h.route({ campaign_id: CAMPAIGN });
  expect(res.status).toBe(202);
  const bodies = h.queue.bodies();
  h.queue.clear();
  return bodies;
}

function sendRun(h: MarketingHarness): Record<string, unknown> | undefined {
  return h.rows('agent_runs').find((r) => r.agent === 'marketing.send');
}

function quiet(): () => void {
  const spies = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
  return () => spies.forEach((s) => s.mockRestore());
}

describe('hand-over to a delayed copy', () => {
  it('a retry re-slotted more than 60 s ahead defers a copy that sends; the campaign and its run close', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 3, settings: { delay_between_emails_seconds: 60 } });
    const [b1, b2, b3] = (await queued(h)) as [OutboundMailV1, OutboundMailV1, OutboundMailV1];
    // attempt 1 of the first message: the event is written, Resend answers 503 -> retry()
    h.resendScript.push({ status: 503, body: { name: 'application_error' } });
    const first = message(b1, 1);
    await h.consume([first]);
    expect([first.acked, first.retried]).toEqual([false, true]);
    // the other two messages take the next slots 10 min later (another consumer)
    h.clock.advance(10 * 60_000);
    await h.limiter('default').reserve({ idem: b2.idem, now: h.clock.now().getTime() });
    await h.limiter('default').reserve({ idem: b3.idem, now: h.clock.now().getTime() });
    // attempt 2 arrives after its slot went stale: a new slot 90 s ahead -> a counted deferral copy
    h.clock.advance(30_000);
    const second = message(b1, 2);
    await h.consume([second]);
    expect([second.acked, second.retried]).toEqual([true, false]);
    expect(h.queue.sent).toEqual([{ body: { ...b1, deferrals: 1 }, delaySeconds: 90 }]);
    const copy = h.queue.sent[0]!;
    h.queue.clear();
    // the handed-over copy arrives at its slot (attempts 1, its event 12 min old) and sends under the same event and key
    h.clock.advance(90_000);
    const delayed = message(copy.body, 1);
    await h.consume([delayed]);
    expect([delayed.acked, delayed.retried]).toEqual([true, false]);
    expect(h.resend.map((r) => r.headers['idempotency-key'])).toEqual([b1.idem, b1.idem]);
    expect(h.rows('marketing_events').find((e) => e.subscriber_id === sub(1))).toMatchObject({ id: await eventIdFor(b1.idem), event_type: 'sent', resend_email_id: 'resend-2' });
    expect(h.queue.sent).toEqual([]);
    expect(await h.limiter('default').takeHandoff({ idem: b1.idem })).toBe(false);
    // the other two go out; the campaign closes with every recipient and the run succeeds
    h.clock.advance(60_000);
    await h.consume([message(b2, 1)]);
    h.clock.advance(60_000);
    await h.consume([message(b3, 1)]);
    expect(h.resend).toHaveLength(4);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 3 });
    expect(sendRun(h)).toMatchObject({ status: 'succeeded', output: { expected: 3, sent: 3, bounced: 0 } });
    expect((await h.limiter('default').stats()).sent_today).toBe(3);
  });

  it('a hold of a delivered-before message hands over as well; a first delivery that defers records nothing', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    const [body] = (await queued(h)) as [OutboundMailV1];
    h.resendScript.push('network');
    await h.consume([message(body, 1)]);
    h.env.OUTBOUND_MAIL_PAUSED = 'true';
    await h.consume([message(body, 2)]);
    expect(h.queue.sent).toEqual([{ body, delaySeconds: 3600 }]);
    h.queue.clear();
    // the hold copy arrives early (a shorter queue delay): it was handed over, so it sends
    h.env.OUTBOUND_MAIL_PAUSED = 'false';
    h.clock.advance(5 * 60_000);
    await h.consume([message(body, 1)]);
    expect(h.resend).toHaveLength(2);
    expect(h.rows('marketing_events')[0]).toMatchObject({ event_type: 'sent', resend_email_id: 'resend-2' });
    // a first delivery deferred before it wrote an event leaves no record behind
    const g = marketingHarness();
    seedCampaign(g, { subscribers: 1 });
    const [gb] = (await queued(g)) as [OutboundMailV1];
    g.env.OUTBOUND_MAIL_PAUSED = 'true';
    await g.consume([message(gb, 1)]);
    expect(await g.limiter('default').takeHandoff({ idem: gb.idem })).toBe(false);
  });
});

describe('the subscriber at send time', () => {
  it('a subscriber who unsubscribed after the click gets no mail: event bounced subscriber_inactive, row skipped, slot given back, campaign closes', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 2, csv: [{ n: 1, sub: 1 }, { n: 2, sub: 2 }] });
    const bodies = await queued(h);
    (h.rows('marketing_subscribers').find((r) => r.id === sub(2)) as Record<string, unknown>).status = 'unsubscribed';
    h.clock.advance(3 * 3_600_000);
    await h.consume(bodies.map((b) => message(b, 1)));
    expect(h.resend.map((r) => r.body.to[0])).toEqual([email(1)]);
    expect(h.rows('marketing_events').find((e) => e.subscriber_id === sub(2))).toMatchObject({ event_type: 'bounced', metadata: { error: 'subscriber_inactive' } });
    expect(h.rows('marketing_campaign_recipients').map((r) => [r.id, r.status])).toEqual([[rec(1), 'sent'], [rec(2), 'skipped']]);
    expect((await h.limiter('default').stats()).sent_today).toBe(1);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 1 });
    expect(sendRun(h)).toMatchObject({ status: 'succeeded', output: { expected: 2, sent: 1, bounced: 1 } });
  });

  it('a retried message whose subscriber became inactive is finished without a send (its event becomes bounced)', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    const [body] = (await queued(h)) as [OutboundMailV1];
    h.resendScript.push({ status: 500, body: {} });
    await h.consume([message(body, 1)]);
    (h.rows('marketing_subscribers')[0] as Record<string, unknown>).status = 'bounced';
    const again = message(body, 2);
    await h.consume([again]);
    expect([again.acked, again.retried, h.resend.length]).toEqual([true, false, 1]);
    expect(h.rows('marketing_events')).toEqual([expect.objectContaining({ event_type: 'bounced', metadata: { error: 'subscriber_inactive' } })]);
  });

  it('a follow-up to a subscriber who replied after it was queued is skipped (subscriber_replied); a campaign mail is not', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    h.db.seed('marketing_campaign_recipients', [{ id: rec(21), campaign_id: CAMPAIGN, subscriber_id: sub(1), sequence_number: 2, delay_days: 0, status: 'pending', custom_body: '<p>x</p>' }]);
    (h.rows('marketing_subscribers')[0] as Record<string, unknown>).replied_at = new Date(T0).toISOString();
    const follow: OutboundMailV1 = { v: 1, kind: 'followup', campaign_id: CAMPAIGN, subscriber_id: sub(1), recipient_record_id: rec(21), sequence: 2, subject: 'Following up', preferred_account_id: null, idem: `camp:${CAMPAIGN}:${sub(1)}:2`, run_id: 'run-f', deferrals: 0 };
    await h.consume([message(follow)]);
    expect(h.resend).toEqual([]);
    expect(h.rows('marketing_events')[0]).toMatchObject({ event_type: 'bounced', metadata: { sequence_number: 2, follow_up: true, error: 'subscriber_replied' } });
    expect(h.rows('marketing_campaign_recipients')[0]).toMatchObject({ status: 'skipped' });
    // the campaign mail itself still goes to a subscriber who replied
    await h.consume((await queued(h)).map((b) => message(b)));
    expect(h.resend.map((r) => r.body.to[0])).toEqual([email(1)]);
  });
});

describe('one payload per message', () => {
  it('every delivery of a message draws the same spintax: a retry repeats subject and body under the same key', async () => {
    const h = marketingHarness({ random: () => 0.9 });
    seedCampaign(h, { subscribers: 1, campaign: { subject_a: '{Quick|Short|Brief} question, {{name}}', body: '<html><body><p>{Hi|Hello|Hey|Dear} {{name}}, {a|b|c|d|e}</p></body></html>' } });
    const [body] = (await queued(h)) as [OutboundMailV1];
    h.resendScript.push('network');
    await h.consume([message(body, 1)]);
    h.clock.advance(60_000);
    await h.consume([message(body, 2)]);
    const [a, b] = h.resend as [(typeof h.resend)[0], (typeof h.resend)[0]];
    expect(b.headers['idempotency-key']).toBe(a.headers['idempotency-key']);
    expect([b.body.subject, b.body.html]).toEqual([a.body.subject, a.body.html]);
    // the draw is the message's own seeded source, not the consumer's random source
    const expected = personalise('{Quick|Short|Brief} question, {{name}}', '<html><body><p>{Hi|Hello|Hey|Dear} {{name}}, {a|b|c|d|e}</p></body></html>', { name: 'Person 1', email: email(1) }, await messageRandom(body.idem));
    expect(a.body.subject).toBe(expected.subject);
    expect(a.body.html.startsWith(expected.body.replace('</body></html>', ''))).toBe(true);
  });

  it('the source is stable per key and differs between keys', async () => {
    const draws = async (idem: string) => {
      const r = await messageRandom(idem);
      return [r(), r(), r()];
    };
    expect(await draws(`camp:${CAMPAIGN}:${sub(1)}:1`)).toEqual(await draws(`camp:${CAMPAIGN}:${sub(1)}:1`));
    expect(await draws(`camp:${CAMPAIGN}:${sub(1)}:1`)).not.toEqual(await draws(`camp:${CAMPAIGN}:${sub(2)}:1`));
    for (const v of await draws('x')) expect(v >= 0 && v < 1).toBe(true);
    // uniform enough to pick every option of a group
    const picks = new Set<number>();
    for (let i = 0; i < 60; i++) picks.add(Math.floor((await messageRandom(`k${i}`))() * 4));
    expect([...picks].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('outcome rules at their boundaries', () => {
  it('attempt 3 with a provider 5xx still retries; attempt 4 is final', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1 });
    const [body] = (await queued(h)) as [OutboundMailV1];
    h.resendScript.push({ status: 502, body: {} }, { status: 502, body: {} });
    const third = message(body, 3);
    await h.consume([third]);
    expect([third.acked, third.retried]).toEqual([false, true]);
    expect(h.rows('marketing_events')[0]).toMatchObject({ event_type: 'sent' });
    expect(h.rows('marketing_events')[0]?.resend_email_id ?? null).toBeNull();
    const fourth = message(body, 4);
    await h.consume([fourth]);
    expect([fourth.acked, fourth.retried]).toEqual([true, false]);
    expect(h.rows('marketing_events')[0]).toMatchObject({ event_type: 'bounced', metadata: { error: 'resend_502_error' } });
  });

  it(`a slot exactly ${WAIT_IN_PROCESS_MS / 1000} s ahead is waited for in-process; 1 ms more defers`, async () => {
    for (const [lag, waits] of [[0, true], [1, false]] as const) {
      const h = marketingHarness();
      seedCampaign(h, { subscribers: 2, settings: { delay_between_emails_seconds: 60 } });
      const [, b2] = (await queued(h)) as [OutboundMailV1, OutboundMailV1];
      await h.limiter('default').reserve({ idem: `camp:${CAMPAIGN}:${sub(1)}:1`, now: T0 });
      h.clock.set(T0 - lag);
      const m = message(b2, 1);
      await h.consume([m]);
      if (waits) {
        expect([h.sleeps, h.resend.length, h.queue.sent]).toEqual([[60_000], 1, []]);
      } else {
        expect([h.sleeps, h.resend.length]).toEqual([[], 0]);
        expect(h.queue.sent).toEqual([{ body: { ...b2, deferrals: 1 }, delaySeconds: 61 }]);
      }
    }
  });

  it('Resend 409: concurrent_idempotent_requests is retried, any other 409 is final', async () => {
    for (const [name, retried] of [['concurrent_idempotent_requests', true], ['invalid_idempotent_request', false], ['conflict', false]] as const) {
      const h = marketingHarness();
      seedCampaign(h, { subscribers: 1 });
      const [body] = (await queued(h)) as [OutboundMailV1];
      h.resendScript.push({ status: 409, body: { name } });
      const m = message(body, 1);
      await h.consume([m]);
      expect([name, m.retried, m.acked]).toEqual([name, retried, !retried]);
      if (!retried) expect(h.rows('marketing_events')[0]).toMatchObject({ event_type: 'bounced', metadata: { error: `resend_409_${name}` } });
    }
  });

  it('a final failure of a message whose mail went out (provider id recorded) leaves the event and the recipient row sent', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 1, senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 0 }], csv: [{ n: 1, sub: 1 }] });
    const [body] = (await queued(h)) as [OutboundMailV1];
    const id = await eventIdFor(body.idem);
    await h.db.insert('marketing_events', { id, campaign_id: CAMPAIGN, subscriber_id: sub(1), event_type: 'sent', metadata: { gmail_id: 'g-1', from: 'x' }, resend_email_id: 'g-1' });
    await h.db.update('marketing_campaign_recipients', { status: 'sent', sent_at: new Date(T0).toISOString() }, { filters: [['id', 'eq', rec(1)]] });
    // a stray copy at its deferral limit with every sender at its cap: final failure 'deferral_limit'
    const m = message({ ...body, deferrals: 30 }, 1);
    await h.consume([m]);
    expect(m.acked).toBe(true);
    expect(h.rows('marketing_events')).toEqual([expect.objectContaining({ id, event_type: 'sent', resend_email_id: 'g-1', metadata: { gmail_id: 'g-1', from: 'x' } })]);
    expect(h.rows('marketing_campaign_recipients')[0]).toMatchObject({ status: 'sent' });
  });

  it('the campaign close never touches a newest run that is no longer running', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 2 });
    const bodies = await queued(h);
    const run = sendRun(h) as { id: string; output: Record<string, unknown> };
    await closeRun(h.db, run.id, { status: 'failed', error: 'enqueue_partial', output: run.output }, { ...EMPTY_USAGE, by_step: {} });
    await h.consume(bodies.map((b) => message(b)));
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 2 });
    expect(sendRun(h)).toMatchObject({ status: 'failed', error: 'enqueue_partial', output: { expected: 2, queued: 2, mode: 'tags' } });
  });
});

describe('campaign close cost', () => {
  it('one close pass per batch with the counted columns only (500 recipients in batches of 10)', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 500, settings: { delay_between_emails_seconds: 0 } });
    const bodies = await queued(h);
    const select = h.db.select.bind(h.db);
    let requests = 0;
    let rows = 0;
    const columns = new Set<string>();
    vi.spyOn(h.db, 'select').mockImplementation(async (table: string, o?: Parameters<typeof select>[1]) => {
      const out = await select(table, o);
      if (table === 'marketing_events' && (o?.filters ?? []).some((f) => f[0] === 'event_type')) {
        requests += 1;
        rows += out.length;
        columns.add(String(o?.columns));
      }
      return out;
    });
    const restore = quiet();
    for (let i = 0; i < bodies.length; i += 10) await h.consume(bodies.slice(i, i + 10).map((b) => message(b, 1)));
    restore();
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 500 });
    // per message this was 500 passes and 125,250 rows; per batch it is 50 passes
    expect(requests).toBe(50);
    expect(rows).toBe(Array.from({ length: 50 }, (_, i) => (i + 1) * 10).reduce((a, b) => a + b, 0));
    expect([...columns]).toEqual(['id,subscriber_id,event_type,resend_email_id,metadata']);
  }, 120_000);
});

describe('pacing across UTC days', () => {
  /** Event-time run of the queue: every delivery at its due time, deferral copies re-queued with their delay. */
  async function simulate(n: number, spacingS: number): Promise<{ hours: number; sent: number; perDay: Record<string, number>; maxDeferrals: number }> {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: n, settings: { delay_between_emails_seconds: spacingS } });
    const pending: Array<[number, OutboundMailV1]> = (await queued(h)).map((b) => [T0, b]);
    const perDay: Record<string, number> = {};
    let maxDeferrals = 0;
    const restore = quiet();
    let guard = 0;
    while (pending.length > 0 && guard++ < 20_000) {
      pending.sort((a, b) => a[0] - b[0]);
      const [at, body] = pending.shift() as [number, OutboundMailV1];
      if (at > h.clock.now().getTime()) h.clock.set(at);
      const before = h.resend.length;
      await h.consume([message(body, 1)]);
      if (h.resend.length > before) {
        const day = h.clock.now().toISOString().slice(0, 10);
        perDay[day] = (perDay[day] ?? 0) + 1;
      }
      for (const s of h.queue.sent) {
        pending.push([h.clock.now().getTime() + (s.delaySeconds ?? 0) * 1000, s.body]);
        maxDeferrals = Math.max(maxDeferrals, s.body.deferrals);
      }
      h.queue.clear();
    }
    restore();
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: n });
    return { hours: (h.clock.now().getTime() - T0) / 3_600_000, sent: h.resend.length, perDay, maxDeferrals };
  }

  it('slots never run past the next 00:00 UTC: 200 recipients at 600 s take the 33 h of their slots, not 73 h', async () => {
    const out = await simulate(200, 600);
    expect(out.sent).toBe(200);
    // 10:00 -> 23:50 is 84 slots on day 1; the other 116 run from 00:00 (+ jitter <= 600 s) on day 2
    expect(out.perDay).toEqual({ '2026-10-08': 84, '2026-10-09': 116 });
    expect(out.hours).toBeLessThan(34);
    expect(out.maxDeferrals).toBeLessThanOrEqual(3);
  }, 120_000);
});
