// SenderLimiter (unit M5): daily cap per sender (warm-up limit or daily limit; 500 for 'default'; 0 for an unknown
// account), spacing from marketing_settings (or 30 s when unset), UTC day roll-over, already_sent for committed keys,
// stale reservations re-used without counting twice, release, stats, the prune alarm, concurrent reserves and a
// nameless object refusing to allot. Real class on the fake Durable Object state (node:sqlite).

import { describe, expect, it } from 'vitest';
import { DEFAULT_SENDER_DAILY_CAP, nextUtcMidnight, SenderLimiter, STALE_SLOT_MS, utcDay } from '../../../src/do/sender-limiter';
import type { OpsEnv } from '../../../src/env';
import { P5MemoryDb } from '../../../src/ports/p5-stub/index';
import { FakeDurableObjectState } from '../../helpers/fake-do';
import { ACC_G, marketingHarness, seedCampaign, T0 } from './harness';

const K = (n: number) => `camp:c:s${n}:1`;

describe('cap and spacing', () => {
  it('the default sender: cap 500 per UTC day, spacing from the settings value, slots one spacing apart', async () => {
    const h = marketingHarness();
    seedCampaign(h, { settings: { delay_between_emails_seconds: 45 } });
    const l = h.limiter('default');
    const a = await l.reserve({ idem: K(1), now: T0 });
    const b = await l.reserve({ idem: K(2), now: T0 + 1000 });
    const c = await l.reserve({ idem: K(3), now: T0 + 200_000 });
    expect([a, b, c]).toEqual([
      { status: 'ok', not_before: T0 },
      { status: 'ok', not_before: T0 + 45_000 },
      { status: 'ok', not_before: T0 + 200_000 },
    ]);
    expect(await l.stats()).toEqual({ day: '2026-10-08', sent_today: 3, cap: DEFAULT_SENDER_DAILY_CAP, last_sent_at: null });
  });

  it('spacing is 30 s when the settings row has no value, and when there is no or more than one settings row', async () => {
    for (const settings of [{ delay_between_emails_seconds: null }, null]) {
      const h = marketingHarness();
      seedCampaign(h, { settings });
      const l = h.limiter('default');
      await l.reserve({ idem: K(1), now: T0 });
      expect(await l.reserve({ idem: K(2), now: T0 })).toEqual({ status: 'ok', not_before: T0 + 30_000 });
    }
    const h = marketingHarness();
    seedCampaign(h, { settings: { delay_between_emails_seconds: 5 } });
    h.db.seed('marketing_settings', [{ id: 'settings-2', delay_between_emails_seconds: 5 }]);
    const l = h.limiter('default');
    await l.reserve({ idem: K(1), now: T0 });
    expect(await l.reserve({ idem: K(2), now: T0 })).toEqual({ status: 'ok', not_before: T0 + 30_000 });
  });

  it('spacing is clamped to 0-3,600 s', async () => {
    const h = marketingHarness();
    seedCampaign(h, { settings: { delay_between_emails_seconds: 99_999 } });
    const l = h.limiter('default');
    await l.reserve({ idem: K(1), now: T0 });
    expect(await l.reserve({ idem: K(2), now: T0 })).toEqual({ status: 'ok', not_before: T0 + 3_600_000 });
  });

  it('an account: cap = daily_limit, or warmup_current_limit while warming up; exhausted with the next 00:00 UTC', async () => {
    for (const [sender, cap] of [[{ daily_limit: 2 }, 2], [{ daily_limit: 500, warmup_enabled: true, warmup_current_limit: 3 }, 3]] as const) {
      const h = marketingHarness();
      seedCampaign(h, { senders: [{ id: ACC_G, provider: 'google_workspace', ...sender }] });
      const l = h.limiter(ACC_G);
      for (let i = 1; i <= cap; i++) expect((await l.reserve({ idem: K(i), now: T0 })).status).toBe('ok');
      expect(await l.reserve({ idem: K(99), now: T0 })).toEqual({ status: 'exhausted', resets_at: '2026-10-09T00:00:00.000Z' });
      expect((await l.stats()).cap).toBe(cap);
    }
  });

  it('an account without a row has cap 0 (no fallback)', async () => {
    const h = marketingHarness();
    seedCampaign(h);
    expect(await h.limiter(ACC_G).reserve({ idem: K(1), now: T0 })).toEqual({ status: 'exhausted', resets_at: '2026-10-09T00:00:00.000Z' });
  });

  it('the sender row and settings are cached for 60 s', async () => {
    const h = marketingHarness();
    seedCampaign(h, { senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 1 }] });
    const l = h.limiter(ACC_G);
    expect((await l.reserve({ idem: K(1), now: T0 })).status).toBe('ok');
    await h.db.update('marketing_sender_accounts', { daily_limit: 5 }, { filters: [['id', 'eq', ACC_G]] });
    expect((await l.reserve({ idem: K(2), now: T0 + 59_000 })).status).toBe('exhausted');
    expect((await l.reserve({ idem: K(2), now: T0 + 61_000 })).status).toBe('ok');
  });
});

describe('UTC day roll-over', () => {
  it('the count starts at 0 at 00:00 UTC; a caller whose clock is behind keeps the current day', async () => {
    const h = marketingHarness();
    seedCampaign(h, { senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 1 }], settings: { delay_between_emails_seconds: 0 } });
    const l = h.limiter(ACC_G);
    const late = Date.UTC(2026, 9, 8, 23, 59, 30);
    expect((await l.reserve({ idem: K(1), now: late })).status).toBe('ok');
    expect((await l.reserve({ idem: K(2), now: late + 10_000 })).status).toBe('exhausted');
    const next = Date.UTC(2026, 9, 9, 0, 0, 1);
    expect(await l.reserve({ idem: K(2), now: next })).toEqual({ status: 'ok', not_before: next });
    // behind: still 2026-10-09's count (1 of 1), not a fresh day
    expect((await l.reserve({ idem: K(3), now: late + 20_000 })).status).toBe('exhausted');
    h.clock.set(next);
    expect((await l.stats()).day).toBe('2026-10-09');
  });

  it('a reservation of an earlier day is dropped and the key reserves anew (counted on the new day)', async () => {
    const h = marketingHarness();
    seedCampaign(h, { senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 5 }], settings: { delay_between_emails_seconds: 0 } });
    const l = h.limiter(ACC_G);
    await l.reserve({ idem: K(1), now: T0 });
    const next = Date.UTC(2026, 9, 9, 8, 0, 0);
    expect(await l.reserve({ idem: K(1), now: next })).toEqual({ status: 'ok', not_before: next });
    h.clock.set(next);
    expect((await l.stats()).sent_today).toBe(1);
  });
});

describe('keys', () => {
  it('a committed key answers already_sent, also when the cap is reached', async () => {
    const h = marketingHarness();
    seedCampaign(h, { senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 1 }] });
    const l = h.limiter(ACC_G);
    await l.reserve({ idem: K(1), now: T0 });
    await l.commit({ idem: K(1), provider_id: 'gm-1' });
    expect(await l.reserve({ idem: K(1), now: T0 + 1000 })).toEqual({ status: 'already_sent' });
    expect((await l.stats()).sent_today).toBe(1);
    expect(await l.reserve({ idem: K(1), now: Date.UTC(2026, 9, 20) })).toEqual({ status: 'already_sent' });
  });

  it('a reserved key answers its slot again (deferred copy, retry) without counting twice, while the slot is at most 10 min old', async () => {
    const h = marketingHarness();
    seedCampaign(h, { settings: { delay_between_emails_seconds: 120 } });
    const l = h.limiter('default');
    await l.reserve({ idem: K(1), now: T0 });
    const second = await l.reserve({ idem: K(2), now: T0 });
    expect(second).toEqual({ status: 'ok', not_before: T0 + 120_000 });
    expect(await l.reserve({ idem: K(2), now: T0 + 120_000 })).toEqual(second);
    expect(await l.reserve({ idem: K(2), now: T0 + 120_000 + STALE_SLOT_MS })).toEqual(second);
    expect((await l.stats()).sent_today).toBe(2);
  });

  it('a reservation whose slot is more than 10 min old gets a new slot and is not counted twice', async () => {
    const h = marketingHarness();
    seedCampaign(h, { settings: { delay_between_emails_seconds: 60 } });
    const l = h.limiter('default');
    await l.reserve({ idem: K(1), now: T0 });
    await l.reserve({ idem: K(2), now: T0 });
    const later = T0 + 60_000 + STALE_SLOT_MS + 1;
    expect(await l.reserve({ idem: K(1), now: later })).toEqual({ status: 'ok', not_before: later });
    expect(await l.reserve({ idem: K(3), now: later })).toEqual({ status: 'ok', not_before: later + 60_000 });
    expect((await l.stats()).sent_today).toBe(3);
  });

  it('release gives a reserved count back and removes the key; a sent key is never released', async () => {
    const h = marketingHarness();
    seedCampaign(h, { senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 1 }] });
    const l = h.limiter(ACC_G);
    await l.reserve({ idem: K(1), now: T0 });
    await l.release({ idem: K(1) });
    expect((await l.stats()).sent_today).toBe(0);
    expect((await l.reserve({ idem: K(2), now: T0 })).status).toBe('ok');
    await l.commit({ idem: K(2), provider_id: 'gm-2' });
    await l.release({ idem: K(2) });
    expect(await l.reserve({ idem: K(2), now: T0 })).toEqual({ status: 'already_sent' });
    expect((await l.stats()).sent_today).toBe(1);
    await l.release({ idem: 'camp:unknown' });
  });

  it('stats reports the last commit time', async () => {
    const h = marketingHarness();
    seedCampaign(h);
    const l = h.limiter('default');
    await l.reserve({ idem: K(1), now: T0 });
    h.clock.set(T0 + 5000);
    await l.commit({ idem: K(1), provider_id: 'r-1' });
    expect(await l.stats()).toEqual({ day: '2026-10-08', sent_today: 1, cap: 500, last_sent_at: new Date(T0 + 5000).toISOString() });
  });
});

describe('alarm, concurrency, naming', () => {
  it('the prune alarm drops sent keys older than 30 days and re-arms while keys remain', async () => {
    const h = marketingHarness();
    seedCampaign(h);
    const l = h.limiter('default');
    const state = h.limiterState('default');
    await l.reserve({ idem: K(1), now: T0 });
    await l.commit({ idem: K(1), provider_id: 'r-1' });
    expect(await state.storage.getAlarm()).toBe(T0 + 86_400_000);
    h.clock.set(T0 + 31 * 86_400_000);
    await l.reserve({ idem: K(2), now: h.clock.now().getTime() });
    await l.commit({ idem: K(2), provider_id: 'r-2' });
    await state.runAlarm();
    expect(await l.reserve({ idem: K(1), now: h.clock.now().getTime() })).toEqual({ status: 'ok', not_before: expect.any(Number) });
    expect(await l.reserve({ idem: K(2), now: h.clock.now().getTime() })).toEqual({ status: 'already_sent' });
    expect(await state.storage.getAlarm()).not.toBeNull();
  });

  it('concurrent reserves never allot one slot twice nor pass the cap', async () => {
    const h = marketingHarness();
    seedCampaign(h, { senders: [{ id: ACC_G, provider: 'google_workspace', daily_limit: 5 }], settings: { delay_between_emails_seconds: 10 } });
    const l = h.limiter(ACC_G);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => l.reserve({ idem: K(i), now: T0 })));
    const ok = results.filter((r) => r.status === 'ok') as Array<{ not_before: number }>;
    expect(ok).toHaveLength(5);
    expect(new Set(ok.map((r) => r.not_before)).size).toBe(5);
    expect(results.filter((r) => r.status === 'exhausted')).toHaveLength(3);
  });

  it('an object without a name refuses to allot; input is checked', async () => {
    const state = new FakeDurableObjectState('');
    const l = new SenderLimiter(state as unknown as DurableObjectState, {} as OpsEnv);
    (l as unknown as { dbInstance: P5MemoryDb }).dbInstance = new P5MemoryDb();
    await expect(l.reserve({ idem: K(1), now: T0 })).rejects.toThrow(/addressed by name/);
    const h = marketingHarness();
    await expect(h.limiter('default').reserve({ idem: '', now: T0 })).rejects.toThrow(/idem/);
  });

  it('day and midnight helpers', () => {
    expect(utcDay(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12-31');
    expect(nextUtcMidnight(Date.UTC(2026, 11, 31, 23, 59))).toBe('2027-01-01T00:00:00.000Z');
  });
});
