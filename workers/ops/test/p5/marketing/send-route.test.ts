// /api/marketing?action=send-campaign in microns-ops (unit M5, PHASE5_SPEC §5.9): the binding order of checks and
// answers (caller, body, campaign, sent, stop 423, existing run, pause 503 / 409, run, enqueue), the recipient
// selection (CSV vs tags, A/B with a seeded source, pages of 1,000), the messages (one per recipient, round-robin
// sender, idem, run id, ≤ 100 per sendBatch), a failed enqueue closing the run 'failed' and a second click
// re-queuing only the recipients without a final event under ':r2' (a message in flight is left alone, one whose
// unfinished event is older than 15 min is queued again), `expected` of a re-queue (the recipients with a final event
// or a message in flight plus those queued now, so a list that shrank or grew in between still closes; a run that
// failed before its selection was read records null), concurrent clicks, an empty campaign closing at once, and the
// dispatch from routes/marketing.ts.

import { describe, expect, it, vi } from 'vitest';
import { closeRun, EMPTY_USAGE } from '../../../src/agents/runs';
import { DbError } from '../../../src/db/postgrest';
import { eventIdFor } from '../../../src/marketing/events';
import { OpsApi } from '../../../src/index';
import type { OutboundMailV1 } from '../../../src/queues/messages';
import { campaignIdOf, MAX_BODY_BYTES } from '../../../src/routes/marketing-send';
import { invoke, jsonPost, opsCall, opsEnv } from '../../helpers/ops';
import { ACC_G, ACC_OFF, ACC_R, CAMPAIGN, marketingHarness, message, rec, seedCampaign, sub, type MarketingHarness } from './harness';

async function answer(res: Response): Promise<[number, unknown]> {
  return [res.status, await res.json()];
}

function runsOf(h: MarketingHarness) {
  return h.rows('agent_runs').filter((r) => r.agent === 'marketing.send');
}

describe('order of checks and answers', () => {
  it('0: only STAFF and ADMIN; only POST', async () => {
    const h = marketingHarness();
    seedCampaign(h);
    for (const principal of [{ class: 'ANON' as const }, { class: 'CUSTOMER' as const, uid: 'u' }, { class: 'MACHINE' as const, machine: 'mcp' as const }]) {
      expect(await answer(await h.route({ campaign_id: CAMPAIGN }, { principal }))).toEqual([403, { error: 'forbidden' }]);
    }
    const get = await h.route(null, { method: 'GET' });
    expect([get.status, get.headers.get('allow'), await get.json()]).toEqual([405, 'POST', { error: 'method_not_allowed' }]);
    expect((await h.route({ campaign_id: CAMPAIGN }, { principal: { class: 'ADMIN', uid: 'a' } })).status).toBe(202);
  });

  it('1: a body that is not JSON {campaign_id: <uuid>} of at most 4 KB -> 400 invalid_campaign; nothing read', async () => {
    const h = marketingHarness();
    seedCampaign(h);
    const select = vi.spyOn(h.db, 'select');
    for (const raw of ['', 'x', '[]', 'null', '{}', '{"campaign_id":1}', '{"campaign_id":"not-a-uuid"}', JSON.stringify({ campaign_id: CAMPAIGN, pad: 'x'.repeat(MAX_BODY_BYTES) })]) {
      expect([raw.slice(0, 20), ...(await answer(await h.route(null, { raw })))]).toEqual([raw.slice(0, 20), 400, { error: 'invalid_campaign' }]);
    }
    expect(select).not.toHaveBeenCalled();
    expect(campaignIdOf(new TextEncoder().encode(JSON.stringify({ campaign_id: CAMPAIGN.toUpperCase() })))).toBe(CAMPAIGN);
  });

  it('2: unknown campaign -> 404; 3: status sent -> 409 campaign_already_sent', async () => {
    const h = marketingHarness();
    seedCampaign(h, { campaign: { status: 'sent' } });
    expect(await answer(await h.route({ campaign_id: '11111111-2222-4333-8444-555555555555' }))).toEqual([404, { error: 'campaign_not_found' }]);
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([409, { error: 'campaign_already_sent' }]);
    expect(runsOf(h)).toEqual([]);
  });

  it('4: OUTBOUND_MAIL_STOPPED -> 423 sending_stopped, before the runs are looked at (also with a running run)', async () => {
    const h = marketingHarness({ env: { OUTBOUND_MAIL_STOPPED: 'true' } });
    seedCampaign(h);
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([423, { error: 'sending_stopped' }]);
    h.env.OUTBOUND_MAIL_STOPPED = 'false';
    expect((await h.route({ campaign_id: CAMPAIGN })).status).toBe(202);
    h.env.OUTBOUND_MAIL_STOPPED = 'true';
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([423, { error: 'sending_stopped' }]);
  });

  it('5: a running or succeeded newest run -> 202 with that run and queued 0, nothing queued again', async () => {
    const h = marketingHarness();
    seedCampaign(h);
    const [status, first] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(status).toBe(202);
    expect(first).toEqual({ queued: 3, run_id: expect.any(String) });
    h.queue.clear();
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([202, { queued: 0, run_id: (first as { run_id: string }).run_id }]);
    await closeRun(h.db, (first as { run_id: string }).run_id, { status: 'succeeded' }, { ...EMPTY_USAGE, by_step: {} });
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([202, { queued: 0, run_id: (first as { run_id: string }).run_id }]);
    expect(h.queue.sent).toEqual([]);
    expect(runsOf(h)).toHaveLength(1);
  });

  it('6: OUTBOUND_MAIL_PAUSED -> 503 sending_paused without a run, 409 campaign_partially_queued after a failed run', async () => {
    const h = marketingHarness({ env: { OUTBOUND_MAIL_PAUSED: 'true' } });
    seedCampaign(h);
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([503, { error: 'sending_paused' }]);
    expect(runsOf(h)).toEqual([]);
    h.env.OUTBOUND_MAIL_PAUSED = 'false';
    h.queue.failOnBatch = 1;
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([500, { error: 'enqueue_failed', queued: 0 }]);
    h.env.OUTBOUND_MAIL_PAUSED = 'true';
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([409, { error: 'campaign_partially_queued' }]);
    expect(runsOf(h)).toHaveLength(1);
  });

  it('missing OUTBOUND_MAIL: 500 before a run is opened, the log names the binding only', async () => {
    const h = marketingHarness({ env: { OUTBOUND_MAIL: undefined } });
    seedCampaign(h);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await h.route({ campaign_id: CAMPAIGN });
    expect([res.status, await res.text()]).toEqual([500, 'Internal Server Error']);
    expect(runsOf(h)).toEqual([]);
    expect(errors.mock.calls.flat().join(' ')).toContain('config missing: OUTBOUND_MAIL');
    errors.mockRestore();
  });
});

describe('first send', () => {
  it('tag mode: one message per active tagged subscriber, round-robin over the active senders, run and campaign updated', async () => {
    const h = marketingHarness();
    seedCampaign(h, {
      subscribers: 5,
      inactive: [4],
      tags: { 1: ['cnc'], 2: ['laser'], 3: ['cnc', 'laser'], 4: ['cnc'], 5: ['other'] },
      campaign: { target_tags: ['cnc', 'laser'] },
      senders: [
        { id: ACC_G, provider: 'google_workspace' },
        { id: ACC_OFF, provider: 'resend', is_active: false },
        { id: ACC_R, provider: 'resend' },
      ],
    });
    const [status, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(status).toBe(202);
    const runId = (out as { run_id: string }).run_id;
    expect(out).toEqual({ queued: 3, run_id: runId });
    const bodies = h.queue.bodies();
    expect(bodies).toEqual([1, 2, 3].map((n, i): OutboundMailV1 => ({
      v: 1,
      kind: 'campaign',
      campaign_id: CAMPAIGN,
      subscriber_id: sub(n),
      recipient_record_id: null,
      sequence: 1,
      subject: 'Hello {{name}}',
      preferred_account_id: i % 2 === 0 ? ACC_G : ACC_R,
      idem: `camp:${CAMPAIGN}:${sub(n)}:1`,
      run_id: runId,
      deferrals: 0,
    })));
    const [run] = runsOf(h);
    expect(run).toMatchObject({ id: runId, agent: 'marketing.send', trigger: 'dashboard', idempotency_key: `marketing.send:${CAMPAIGN}`, subject_type: 'marketing_campaign', subject_id: CAMPAIGN, status: 'running', output: { expected: 3, queued: 3, mode: 'tags' } });
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sending' });
    // nothing personal in the run output
    expect(JSON.stringify(run?.output)).not.toMatch(/@|Person|Hello/);
  });

  it('no target tags: every active subscriber; no sender accounts: preferred_account_id null (default identity)', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 4, inactive: [2] });
    await h.route({ campaign_id: CAMPAIGN });
    expect(h.queue.bodies().map((b) => [b.subscriber_id, b.preferred_account_id])).toEqual([[sub(1), null], [sub(3), null], [sub(4), null]]);
  });

  it('A/B: subject_b for a draw above 0.5 when enabled and subject_b is set (seeded draws, in recipient order)', async () => {
    const draws = [0.7, 0.2, 0.51, 0.5];
    const h = marketingHarness({ random: () => draws.shift() ?? 0 });
    seedCampaign(h, { subscribers: 4, campaign: { ab_test_config: { enabled: true } } });
    await h.route({ campaign_id: CAMPAIGN });
    expect(h.queue.bodies().map((b) => b.subject)).toEqual(['Hi {there|again} {{name}}', 'Hello {{name}}', 'Hi {there|again} {{name}}', 'Hello {{name}}']);
    const off = marketingHarness({ random: () => 0.9 });
    seedCampaign(off, { subscribers: 2, campaign: { ab_test_config: { enabled: true }, subject_b: null } });
    await off.route({ campaign_id: CAMPAIGN });
    expect(off.queue.bodies().map((b) => b.subject)).toEqual(['Hello {{name}}', 'Hello {{name}}']);
  });

  it('CSV mode: pending sequence-1 rows of the campaign with an active subscriber; custom subject or subject_a; record id carried', async () => {
    const h = marketingHarness();
    seedCampaign(h, {
      subscribers: 5,
      inactive: [3],
      csv: [
        { n: 1, sub: 2, custom_subject: 'Custom for {{name}}' },
        { n: 2, sub: 1 },
        { n: 3, sub: 3 },
        { n: 4, sub: 4, status: 'sent' },
        { n: 5, sub: 2 },
      ],
    });
    h.db.seed('marketing_campaign_recipients', [{ id: rec(9), campaign_id: CAMPAIGN, subscriber_id: sub(5), sequence_number: 2, status: 'pending' }]);
    h.db.seed('marketing_campaign_recipients', [{ id: rec(8), campaign_id: '99999999-0000-4000-8000-000000000000', subscriber_id: sub(5), sequence_number: 1, status: 'pending' }]);
    const [, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(out).toMatchObject({ queued: 2 });
    expect(h.queue.bodies().map((b) => [b.subscriber_id, b.recipient_record_id, b.subject])).toEqual([
      [sub(2), rec(1), 'Custom for {{name}}'],
      [sub(1), rec(2), 'Hello {{name}}'],
    ]);
    expect(runsOf(h)[0]?.output).toMatchObject({ expected: 2, mode: 'csv' });
  });

  it('reads in pages of 1,000 ordered by id and sends at most 100 messages per sendBatch', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 2_345 });
    const select = vi.spyOn(h.db, 'select');
    const [, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(out).toMatchObject({ queued: 2_345 });
    const pages = select.mock.calls.filter((c) => c[0] === 'marketing_subscribers');
    expect(pages).toHaveLength(3);
    for (const [, o] of pages) expect(o).toMatchObject({ limit: 1000, order: [{ column: 'id', ascending: true }] });
    expect(pages[1]?.[1]?.filters).toContainEqual(['id', 'gte', sub(1000)]);
    expect(h.queue.batches).toEqual([...Array(23).fill(100), 45]);
    expect(new Set(h.queue.bodies().map((b) => b.subscriber_id)).size).toBe(2_345);
    expect(runsOf(h)[0]?.output).toMatchObject({ expected: 2_345, queued: 2_345 });
  });

  it('a campaign without recipients closes at once: status sent, sent_count 0, run succeeded', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 2, inactive: [1, 2] });
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([202, { queued: 0, run_id: expect.any(String) }]);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 0 });
    expect(runsOf(h)[0]).toMatchObject({ status: 'succeeded', output: { expected: 0, queued: 0, sent: 0, bounced: 0, waiting: 0, mode: 'tags' } });
  });

  it('two concurrent clicks open one run; the other answers 202 with it and queued 0', async () => {
    const h = marketingHarness();
    seedCampaign(h);
    const [a, b] = await Promise.all([h.route({ campaign_id: CAMPAIGN }), h.route({ campaign_id: CAMPAIGN })]);
    const outs = [await a.json(), await b.json()] as Array<{ queued: number; run_id: string }>;
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(outs.map((o) => o.queued).sort()).toEqual([0, 3]);
    expect(outs[0]?.run_id).toBe(outs[1]?.run_id);
    expect(runsOf(h)).toHaveLength(1);
    expect(h.queue.sent).toHaveLength(3);
  });
});

describe('failed enqueue and re-queue', () => {
  it('an enqueue error closes the run failed (enqueue_partial, {expected, queued}) and answers 500 with the count', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 150 });
    h.queue.failOnBatch = 2;
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([500, { error: 'enqueue_failed', queued: 100 }]);
    expect(runsOf(h)[0]).toMatchObject({ status: 'failed', error: 'enqueue_partial', output: { expected: 150, queued: 100, mode: 'tags' } });
    expect(h.queue.sent).toHaveLength(100);
  });

  it('a second click re-queues under :r2 only the recipients without a sent or bounced event; expected is kept; the campaign closes once', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 150, settings: { delay_between_emails_seconds: 0 } });
    h.queue.failOnBatch = 2;
    await h.route({ campaign_id: CAMPAIGN });
    const firstRun = runsOf(h)[0]?.id as string;
    // the 100 queued messages are delivered
    const delivered = await h.drain();
    expect(delivered.every((m) => m.acked)).toBe(true);
    expect(h.resend).toHaveLength(100);
    h.queue.failOnBatch = null;
    const [status, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(status).toBe(202);
    expect(out).toEqual({ queued: 50, run_id: expect.any(String) });
    const r2 = runsOf(h).find((r) => r.idempotency_key === `marketing.send:${CAMPAIGN}:r2`);
    expect(r2).toMatchObject({ status: 'running', output: { expected: 150, queued: 50, mode: 'tags' } });
    expect(new Set(h.queue.bodies().map((b) => b.subscriber_id))).toEqual(new Set(Array.from({ length: 50 }, (_, i) => sub(101 + i))));
    expect(h.queue.bodies().every((b) => b.run_id === r2?.id)).toBe(true);
    await h.drain();
    expect(h.resend).toHaveLength(150);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 150 });
    expect(runsOf(h).find((r) => r.id === r2?.id)).toMatchObject({ status: 'succeeded', output: { expected: 150, queued: 50, sent: 150, bounced: 0, waiting: 0 } });
    expect(runsOf(h).find((r) => r.id === firstRun)).toMatchObject({ status: 'failed' });
    // a third click: campaign sent
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([409, { error: 'campaign_already_sent' }]);
  });

  it('a re-queue before the first messages ran queues them again; their limiter keys and events make the copies no-ops', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 3, settings: { delay_between_emails_seconds: 0 } });
    h.queue.failOnBatch = 1;
    await h.route({ campaign_id: CAMPAIGN });
    h.queue.failOnBatch = null;
    // the first run queued nothing; a second click queues all three; a stray earlier copy of one is also delivered
    const [, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(out).toMatchObject({ queued: 3 });
    const copy = structuredClone(h.queue.bodies()[0]) as OutboundMailV1;
    h.queue.sent.push({ body: copy });
    await h.drain();
    expect(h.resend.map((r) => r.body.to[0])).toEqual(['person1@example.test', 'person2@example.test', 'person3@example.test']);
    expect(h.rows('marketing_events').filter((e) => e.event_type === 'sent')).toHaveLength(3);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 3 });
  });

  it('a re-queue keeps the CSV mode of the first run (never widens to every tagged subscriber)', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 4, csv: [{ n: 1, sub: 1 }, { n: 2, sub: 2 }] });
    h.queue.failOnBatch = 1;
    await h.route({ campaign_id: CAMPAIGN });
    h.queue.failOnBatch = null;
    await h.db.update('marketing_campaign_recipients', { status: 'failed' }, { filters: [['campaign_id', 'eq', CAMPAIGN]] });
    const [, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(out).toMatchObject({ queued: 0 });
    expect(h.queue.sent).toEqual([]);
    // nothing has a final event and nothing is queued: expected 0, and the campaign closes at once
    expect(runsOf(h).find((r) => String(r.idempotency_key).endsWith(':r2'))).toMatchObject({ status: 'succeeded', output: { expected: 0, mode: 'csv' } });
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 0 });
  });

  it('normal path unchanged: a first run expects its selection, and a re-queue of an unchanged list expects the same number', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 150, settings: { delay_between_emails_seconds: 0 } });
    h.queue.failOnBatch = 2;
    await h.route({ campaign_id: CAMPAIGN });
    expect(runsOf(h)[0]?.output).toMatchObject({ expected: 150, queued: 100 });
    await h.drain();
    h.queue.failOnBatch = null;
    await h.route({ campaign_id: CAMPAIGN });
    const r2 = runsOf(h).find((r) => r.idempotency_key === `marketing.send:${CAMPAIGN}:r2`);
    expect(r2?.output).toMatchObject({ expected: 150, queued: 50 });
    const once = marketingHarness();
    seedCampaign(once, { subscribers: 7, inactive: [3] });
    await once.route({ campaign_id: CAMPAIGN });
    expect(runsOf(once)[0]?.output).toMatchObject({ expected: 6, queued: 6 });
  });

  it('subscribers who left between the failed run and the re-queue: expected = recipients with a final event + recipients queued now, and the campaign closes', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 150, settings: { delay_between_emails_seconds: 0 } });
    h.queue.failOnBatch = 2;
    await h.route({ campaign_id: CAMPAIGN });
    await h.drain();
    expect(h.resend).toHaveLength(100);
    h.queue.failOnBatch = null;
    // ten of the 50 recipients that were never queued unsubscribe before the second click
    const left = Array.from({ length: 10 }, (_, i) => sub(101 + i));
    await h.db.update('marketing_subscribers', { status: 'unsubscribed' }, { filters: [['id', 'in', left]] });
    const [status, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect([status, out]).toEqual([202, { queued: 40, run_id: expect.any(String) }]);
    const r2 = runsOf(h).find((r) => r.idempotency_key === `marketing.send:${CAMPAIGN}:r2`);
    expect(r2).toMatchObject({ status: 'running', output: { expected: 140, queued: 40, mode: 'tags' } });
    expect(h.queue.bodies().some((b) => left.includes(b.subscriber_id))).toBe(false);
    await h.drain();
    expect(h.resend).toHaveLength(140);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 140 });
    expect(runsOf(h).find((r) => r.id === r2?.id)).toMatchObject({ status: 'succeeded', output: { expected: 140, queued: 40, sent: 140, bounced: 0, waiting: 0 } });
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([409, { error: 'campaign_already_sent' }]);
  });
});

describe('expected while it is not known', () => {
  /** Makes the next n reads of a table throw a PostgREST 503. */
  function failReads(h: MarketingHarness, table: string, n = 1): void {
    const select = h.db.select.bind(h.db);
    let left = n;
    vi.spyOn(h.db, 'select').mockImplementation(async (t: string, o?: Parameters<typeof select>[1]) => {
      if (t === table && left > 0) {
        left -= 1;
        throw new DbError(503, 'PGRST000', 'upstream unavailable (test)');
      }
      return select(t, o);
    });
  }

  it('a first run that fails while reading its recipients records expected null; the re-queue counts the selection; the campaign closes only after every mail', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 4 });
    failReads(h, 'marketing_subscribers');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await answer(await h.route({ campaign_id: CAMPAIGN }))).toEqual([500, { error: 'enqueue_failed', queued: 0 }]);
    errors.mockRestore();
    expect(runsOf(h)[0]).toMatchObject({ status: 'failed', error: 'enqueue_partial', output: { expected: null, queued: 0 } });
    const [status, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect([status, out]).toEqual([202, { queued: 4, run_id: expect.any(String) }]);
    expect(runsOf(h).find((r) => String(r.idempotency_key).endsWith(':r2'))?.output).toMatchObject({ expected: 4, queued: 4 });
    const bodies = h.queue.bodies();
    h.queue.clear();
    await h.consume([message(bodies[0]!)]);
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sending' });
    await h.consume(bodies.slice(1).map((b) => message(b)));
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 4 });
    expect(runsOf(h).find((r) => String(r.idempotency_key).endsWith(':r2'))).toMatchObject({ status: 'succeeded', output: { expected: 4, sent: 4 } });
  });

  it('a re-queue after such a run counts again: a subscriber who joined in between is expected too, and the campaign closes after every mail', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 150, settings: { delay_between_emails_seconds: 0 } });
    h.queue.failOnBatch = 2;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.route({ campaign_id: CAMPAIGN });
    h.queue.failOnBatch = null;
    await h.drain();
    // the next click fails in its selection; then a subscriber joins (the selection grows to 151)
    failReads(h, 'marketing_subscribers');
    expect((await h.route({ campaign_id: CAMPAIGN })).status).toBe(500);
    errors.mockRestore();
    expect(runsOf(h).find((r) => String(r.idempotency_key).endsWith(':r2'))?.output).toMatchObject({ expected: null });
    h.db.seed('marketing_subscribers', [{ id: sub(151), email: 'person151@example.test', name: null, status: 'active', tags: ['cnc'], replied_at: null }]);
    const [, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(out).toMatchObject({ queued: 51 });
    // 100 recipients with a final event + 51 queued now
    expect(runsOf(h).find((r) => String(r.idempotency_key).endsWith(':r3'))?.output).toMatchObject({ expected: 151, queued: 51 });
    await h.drain();
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 151 });
  });

  it('a re-queue counts a subscriber who left after a final outcome together with the recipients queued now', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 3, settings: { delay_between_emails_seconds: 0 } });
    failReads(h, 'marketing_subscribers');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await h.route({ campaign_id: CAMPAIGN });
    errors.mockRestore();
    // subscriber 1 got the mail through an earlier path, then left the list
    await h.db.insert('marketing_events', { id: await eventIdFor(`camp:${CAMPAIGN}:${sub(1)}:1`), campaign_id: CAMPAIGN, subscriber_id: sub(1), event_type: 'sent', metadata: {}, resend_email_id: 'r-0' });
    (h.rows('marketing_subscribers')[0] as Record<string, unknown>).status = 'unsubscribed';
    const [, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(out).toMatchObject({ queued: 2 });
    expect(runsOf(h).find((r) => String(r.idempotency_key).endsWith(':r2'))?.output).toMatchObject({ expected: 3, queued: 2 });
    await h.drain();
    expect(h.rows('marketing_campaigns')[0]).toMatchObject({ status: 'sent', sent_count: 3 });
  });
});

describe('re-queue and messages in flight', () => {
  it('a recipient whose unfinished event is younger than 15 min is left out; one whose unfinished event is older is queued again and sent once', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 3, settings: { delay_between_emails_seconds: 0 } });
    h.queue.failOnBatch = 1;
    await h.route({ campaign_id: CAMPAIGN });
    h.queue.failOnBatch = null;
    // subscriber 1: event written 20 min ago and never finished (its message was lost); subscriber 2: 5 min ago
    h.db.seed('marketing_events', [
      { id: await eventIdFor(`camp:${CAMPAIGN}:${sub(1)}:1`), campaign_id: CAMPAIGN, subscriber_id: sub(1), event_type: 'sent', metadata: {}, created_at: new Date(h.clock.now().getTime() - 20 * 60_000).toISOString() },
      { id: await eventIdFor(`camp:${CAMPAIGN}:${sub(2)}:1`), campaign_id: CAMPAIGN, subscriber_id: sub(2), event_type: 'sent', metadata: {}, created_at: new Date(h.clock.now().getTime() - 5 * 60_000).toISOString() },
    ]);
    const [, out] = await answer(await h.route({ campaign_id: CAMPAIGN }));
    expect(out).toMatchObject({ queued: 2 });
    expect(h.queue.bodies().map((b) => b.subscriber_id)).toEqual([sub(1), sub(3)]);
    // the message in flight reaches its own final event, so it counts: 1 in flight + 2 queued
    expect(runsOf(h).find((r) => String(r.idempotency_key).endsWith(':r2'))?.output).toMatchObject({ expected: 3, queued: 2 });
    await h.drain();
    expect(h.resend.map((r) => r.body.to[0])).toEqual(['person1@example.test', 'person3@example.test']);
    expect(h.rows('marketing_events').filter((e) => e.subscriber_id === sub(1))).toEqual([expect.objectContaining({ event_type: 'sent', resend_email_id: 'resend-1' })]);
  });
});

describe('dispatch from routes/marketing.ts', () => {
  it('action send-campaign reaches the Phase 5 handler (here: 400 for a bad body, no Vercel handler involved)', async () => {
    const call = opsCall({ endpoint: 'marketing', action: 'send-campaign', functionUrl: '/api/marketing?action=send-campaign' });
    const res = await invoke(OpsApi as never, call, { ...jsonPost({ nope: true }), env: opsEnv() });
    expect(await answer(res)).toEqual([400, { error: 'invalid_campaign' }]);
    const forbidden = await invoke(OpsApi as never, { ...call, principal: { class: 'CUSTOMER', uid: 'u' } }, { ...jsonPost({ campaign_id: CAMPAIGN }), env: opsEnv() });
    expect(forbidden.status).toBe(403);
  });
});
