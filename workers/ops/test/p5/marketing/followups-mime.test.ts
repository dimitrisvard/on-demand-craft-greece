// Follow-ups and warm-up under the schedule table (unit M5): enqueueDueFollowups rules beyond the repo parity
// (replied subscribers skipped, no double queueing of a message in flight, nothing queued while stopped or paused,
// configuration), the dispatcher running both jobs only with their vars "true" and closing the runs with the counts;
// and the Gmail message builder (RFC 2047 words, display-name quoting, no header injection, base64 lines).

import { describe, expect, it, vi } from 'vitest';
import { runSchedule } from '../../../src/cron/run-schedule';
import { eventIdFor } from '../../../src/marketing/events';
import { enqueueDueFollowups, slotTime } from '../../../src/marketing/followups';
import { buildMime, encodeHeaderText, encodeWords, mailbox } from '../../../src/marketing/send-gmail';
import { runWarmup } from '../../../src/marketing/warmup';
import { CAMPAIGN, marketingHarness, rec, seedCampaign, sub, T0, type MarketingHarness } from './harness';

function dueRow(h: MarketingHarness, n: number, subscriber: number, extra: Record<string, unknown> = {}): void {
  h.db.seed('marketing_campaign_recipients', [
    { id: rec(100 + n), campaign_id: CAMPAIGN, subscriber_id: sub(subscriber), sequence_number: 1, status: 'sent', sent_at: new Date(T0 - 2 * 86_400_000).toISOString() },
    { id: rec(n), campaign_id: CAMPAIGN, subscriber_id: sub(subscriber), sequence_number: 2, delay_days: 1, status: 'pending', ...extra },
  ]);
}

describe('enqueueDueFollowups', () => {
  it('a subscriber who replied is skipped; a message whose event exists is not queued again', async () => {
    const h = marketingHarness();
    seedCampaign(h, { subscribers: 3 });
    await h.db.update('marketing_subscribers', { replied_at: new Date(T0 - 3600_000).toISOString() }, { filters: [['id', 'eq', sub(1)]] });
    dueRow(h, 1, 1);
    dueRow(h, 2, 2);
    dueRow(h, 3, 3);
    await h.db.insert('marketing_events', { id: await eventIdFor(`camp:${CAMPAIGN}:${sub(3)}:2`), campaign_id: CAMPAIGN, subscriber_id: sub(3), event_type: 'sent', metadata: { follow_up: true, sequence_number: 2 } });
    const counts = await enqueueDueFollowups(h.env, '2026-10-08T10:05Z', { run_id: 'r', ports: h.ports });
    expect(counts).toEqual({ candidates: 3, enqueued: 1, skipped: 1, not_due: 0, in_flight: 1, held: 0 });
    expect(h.queue.bodies().map((b) => b.subscriber_id)).toEqual([sub(2)]);
    expect(h.rows('marketing_campaign_recipients').find((r) => r.id === rec(1))).toMatchObject({ status: 'skipped' });
  });

  it('nothing is queued while OUTBOUND_MAIL_STOPPED or OUTBOUND_MAIL_PAUSED is "true"', async () => {
    for (const flag of ['OUTBOUND_MAIL_STOPPED', 'OUTBOUND_MAIL_PAUSED'] as const) {
      const h = marketingHarness({ env: { [flag]: 'true' } });
      seedCampaign(h, { subscribers: 1 });
      dueRow(h, 1, 1);
      expect(await enqueueDueFollowups(h.env, '2026-10-08T10:05Z', { ports: h.ports })).toMatchObject({ enqueued: 0, held: 1 });
      expect(h.queue.sent).toEqual([]);
    }
  });

  it('needs OUTBOUND_MAIL (config_missing) and a valid slot', async () => {
    const h = marketingHarness({ env: { OUTBOUND_MAIL: undefined } });
    await expect(enqueueDueFollowups(h.env, '2026-10-08T10:05Z', { ports: h.ports })).rejects.toMatchObject({ code: 'config_missing', names: ['OUTBOUND_MAIL'] });
    expect(() => slotTime('nope')).toThrow(/invalid slot/);
    await expect(runWarmup(h.env, '2026-10-8', { ports: h.ports })).rejects.toThrow(/invalid date/);
  });
});

describe('the schedule table runs both jobs only with their vars', () => {
  it('marketing-followups at :05 and marketing-warmup at 00:05 open, run and close their runs with the counts', async () => {
    const at = Date.UTC(2026, 9, 8, 0, 5);
    const h = marketingHarness({ now: at, env: { MARKETING_FOLLOWUPS_ENABLED: 'true', MARKETING_WARMUP_ENABLED: 'true' } });
    seedCampaign(h, { subscribers: 1, senders: [{ id: 'a1a1a1a1-0000-4000-8000-0000000000aa', provider: 'resend', warmup_enabled: true, warmup_current_limit: 10, daily_limit: 500 }] });
    dueRow(h, 1, 1);
    const result = await runSchedule(h.env, at, { ports: h.ports, memo: new Set() });
    expect(result.fired.filter((f) => f.job.startsWith('marketing'))).toEqual([
      { job: 'marketing-followups', slot: '2026-10-08T00:05Z', outcome: 'created' },
      { job: 'marketing-warmup', slot: '2026-10-08T00:05Z', outcome: 'created' },
    ]);
    const runs = h.rows('agent_runs');
    expect(runs.find((r) => r.idempotency_key === 'marketing.followups:2026-10-08T00:05Z')).toMatchObject({ agent: 'marketing.followups', trigger: 'cron', status: 'succeeded', output: { candidates: 1, enqueued: 1, skipped: 0, not_due: 0, in_flight: 0, held: 0 } });
    expect(runs.find((r) => r.idempotency_key === 'marketing.warmup:2026-10-08')).toMatchObject({ agent: 'marketing.warmup', status: 'succeeded', output: { accounts_processed: 1, warmed_up: 1, counters_reset: 1 } });
    expect(h.queue.bodies()[0]?.run_id).toBe(runs.find((r) => r.agent === 'marketing.followups')?.id);
    expect(h.rows('marketing_sender_accounts')[0]).toMatchObject({ warmup_current_limit: 15, emails_sent_today: 0, last_reset_date: '2026-10-08' });
  });

  it('with the vars "false" (the shipped values) neither job opens a run', async () => {
    const at = Date.UTC(2026, 9, 8, 0, 5);
    const h = marketingHarness({ now: at, env: { MARKETING_FOLLOWUPS_ENABLED: 'false', MARKETING_WARMUP_ENABLED: 'false' } });
    const result = await runSchedule(h.env, at, { ports: h.ports, memo: new Set() });
    expect(result.fired.filter((f) => f.job.startsWith('marketing')).map((f) => f.outcome)).toEqual(['flag_off', 'flag_off']);
    expect(h.rows('agent_runs').filter((r) => String(r.agent).startsWith('marketing'))).toEqual([]);
  });

  it('a missing OUTBOUND_MAIL closes the follow-up run failed with config_missing and the name', async () => {
    const at = Date.UTC(2026, 9, 8, 11, 5);
    const h = marketingHarness({ now: at, env: { MARKETING_FOLLOWUPS_ENABLED: 'true', OUTBOUND_MAIL: undefined } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runSchedule(h.env, at, { ports: h.ports, memo: new Set() });
    expect(h.rows('agent_runs').find((r) => r.agent === 'marketing.followups')).toMatchObject({ status: 'failed', error: 'config_missing: OUTBOUND_MAIL' });
    vi.restoreAllMocks();
  });
});

describe('Gmail message builder', () => {
  it('ASCII subjects stay as they are; others become UTF-8 base64 words of at most 75 characters, never splitting a character', () => {
    expect(encodeHeaderText('Hello there')).toBe('Hello there');
    const long = 'Grüße aus Thessaloniki – ευχαριστούμε πολύ για το ενδιαφέρον σας! '.repeat(2);
    const words = encodeWords(long).split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    const decoded = words.map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
    expect(decoded).toBe(long);
  });

  it('display names: plain, quoted when they hold specials, encoded when not ASCII; CR/LF never reach a header', () => {
    expect(mailbox('Sender One', 'a@example.test')).toBe('Sender One <a@example.test>');
    expect(mailbox('Microns Hub, Sales', 'a@example.test')).toBe('"Microns Hub, Sales" <a@example.test>');
    expect(mailbox('Δημήτρης', 'a@example.test')).toBe(`=?UTF-8?B?${Buffer.from('Δημήτρης').toString('base64')}?= <a@example.test>`);
    expect(mailbox(null, 'a@example.test')).toBe('<a@example.test>');
    const mime = new TextDecoder().decode(buildMime({ fromName: 'X\r\nBcc: evil@example.test', fromEmail: 'a@example.test', to: 'b@example.test\r\nBcc: c@example.test', subject: 'Hi\r\nBcc: d@example.test', html: '<p>x</p>' }));
    const head = mime.split('\r\n\r\n')[0] as string;
    expect(head.split('\r\n').map((l) => l.split(':')[0])).toEqual(['From', 'To', 'Subject', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding']);
  });

  it('the body is base64 in lines of 76 characters with CRLF', () => {
    const html = `<p>${'x'.repeat(500)} ü</p>`;
    const mime = new TextDecoder().decode(buildMime({ fromName: 'S', fromEmail: 'a@example.test', to: 'b@example.test', subject: 's', html }));
    const body = mime.split('\r\n\r\n')[1] as string;
    const lines = body.split('\r\n').filter(Boolean);
    expect(lines.slice(0, -1).every((l) => l.length === 76)).toBe(true);
    expect(Buffer.from(lines.join(''), 'base64').toString('utf8')).toBe(html);
  });
});
