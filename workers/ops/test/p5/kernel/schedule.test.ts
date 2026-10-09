// The pure schedule module (src/cron/schedule.ts): the cron matcher (*, */n, a,b, a-b, day of week 0 = Sunday), slots,
// the catch-up window of entries with an interval of at least 120 minutes, and the due list of every tick over a
// simulated week (PHASE5_SPEC §5.2, §7.2 K5 row).

import { describe, expect, it } from 'vitest';
import {
  CATCH_UP_MIN,
  catchUpWindow,
  cronMatches,
  dueJobs,
  intervalMinutes,
  minuteOf,
  SCHEDULE,
  slotFor,
  slotKey,
  type JobId,
} from '../../../src/cron/schedule';

const at = (iso: string) => new Date(iso);
/** Monday 2026-10-05 00:00 UTC: the simulated week runs Monday to Sunday. */
const WEEK_START = Date.UTC(2026, 9, 5);
const MINUTE = 60_000;

describe('cronMatches', () => {
  it('reads *, */n, lists and ranges on every field', () => {
    expect(cronMatches('* * * * *', at('2026-10-05T13:37:00Z'))).toBe(true);
    expect(cronMatches('*/15 * * * *', at('2026-10-05T13:45:00Z'))).toBe(true);
    expect(cronMatches('*/15 * * * *', at('2026-10-05T13:46:00Z'))).toBe(false);
    expect(cronMatches('0 6,8,10 * * *', at('2026-10-05T08:00:00Z'))).toBe(true);
    expect(cronMatches('0 6,8,10 * * *', at('2026-10-05T07:00:00Z'))).toBe(false);
    expect(cronMatches('0 9-17 * * *', at('2026-10-05T17:00:00Z'))).toBe(true);
    expect(cronMatches('0 9-17 * * *', at('2026-10-05T18:00:00Z'))).toBe(false);
    expect(cronMatches('5 0 1 * *', at('2026-11-01T00:05:00Z'))).toBe(true);
    expect(cronMatches('5 0 1 * *', at('2026-11-02T00:05:00Z'))).toBe(false);
    expect(cronMatches('0 0 * 12 *', at('2026-12-24T00:00:00Z'))).toBe(true);
    expect(cronMatches('0 0 * 12 *', at('2026-11-24T00:00:00Z'))).toBe(false);
    expect(cronMatches('1-3,7 * * * *', at('2026-10-05T10:07:00Z'))).toBe(true);
    expect(cronMatches('1-3,7 * * * *', at('2026-10-05T10:05:00Z'))).toBe(false);
  });

  it('day of week 0 is Sunday and 1 is Monday, in UTC', () => {
    expect(cronMatches('30 6 * * 1', at('2026-10-05T06:30:00Z'))).toBe(true); // Monday
    expect(cronMatches('30 6 * * 1', at('2026-10-06T06:30:00Z'))).toBe(false); // Tuesday
    expect(cronMatches('0 12 * * 0', at('2026-10-11T12:00:00Z'))).toBe(true); // Sunday
    // 2026-10-05T23:30 in Athens is already Tuesday; the matcher reads UTC only.
    expect(cronMatches('30 23 * * 1', at('2026-10-05T23:30:00Z'))).toBe(true);
  });

  it('day of month and day of week both restricted: either matches (Vixie rule)', () => {
    expect(cronMatches('0 0 13 * 5', at('2026-11-13T00:00:00Z'))).toBe(true); // Friday the 13th
    expect(cronMatches('0 0 13 * 5', at('2026-10-13T00:00:00Z'))).toBe(true); // the 13th, a Tuesday
    expect(cronMatches('0 0 13 * 5', at('2026-10-09T00:00:00Z'))).toBe(true); // a Friday
    expect(cronMatches('0 0 13 * 5', at('2026-10-08T00:00:00Z'))).toBe(false);
  });

  it('refuses malformed expressions and out-of-range values', () => {
    for (const bad of ['* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 7', '*/0 * * * *', '5-1 * * * *', 'a * * * *', '1-2-3 * * * *', '-1 * * * *']) {
      expect(() => cronMatches(bad, at('2026-10-05T00:00:00Z')), bad).toThrow(/invalid cron/);
    }
  });

  it('every table expression parses', () => {
    for (const entry of SCHEDULE) expect(() => cronMatches(entry.cron, new Date(WEEK_START)), entry.job).not.toThrow();
  });
});

describe('slotFor and the catch-up window', () => {
  it('own minute: the tick minute itself (seconds dropped), catchUp false', () => {
    expect(slotFor('0 7 * * *', at('2026-10-05T07:00:42Z'), 60)).toEqual({ slot: at('2026-10-05T07:00:00Z'), catchUp: false });
  });

  it('a lost 07:00 tick fires at 07:01 with catchUp true; 60 min late still fires; 61 min late does not', () => {
    expect(slotFor('0 7 * * *', at('2026-10-05T07:01:00Z'), CATCH_UP_MIN)).toEqual({ slot: at('2026-10-05T07:00:00Z'), catchUp: true });
    expect(slotFor('0 7 * * *', at('2026-10-05T08:00:00Z'), CATCH_UP_MIN)).toEqual({ slot: at('2026-10-05T07:00:00Z'), catchUp: true });
    expect(slotFor('0 7 * * *', at('2026-10-05T08:01:00Z'), CATCH_UP_MIN)).toBeNull();
  });

  it('without a window only the own minute fires', () => {
    expect(slotFor('*/15 * * * *', at('2026-10-05T07:16:00Z'), 0)).toBeNull();
    expect(slotFor('*/15 * * * *', at('2026-10-05T07:15:00Z'), 0)).toEqual({ slot: at('2026-10-05T07:15:00Z'), catchUp: false });
  });

  it('the latest matching minute wins inside the window', () => {
    expect(slotFor('0 6,8 * * *', at('2026-10-05T08:30:00Z'), 60)).toEqual({ slot: at('2026-10-05T08:00:00Z'), catchUp: true });
  });

  it('intervals and windows: >= 120 min gets CATCH_UP_MIN, shorter entries none', () => {
    const intervals = Object.fromEntries(SCHEDULE.map((e) => [e.job, intervalMinutes(e.cron)]));
    expect(intervals).toMatchObject({
      'reddit-t1': 15, 'reddit-t2': 30, 'reddit-t3': 60, hn: 30, 'marketing-followups': 60,
      tenders: 1440, xometry: 120, 'content-daily': 1440, sitemap: 1440, 'ops-digest': 7 * 1440, 'marketing-warmup': 1440,
    });
    const windows = Object.fromEntries(SCHEDULE.map((e) => [e.job, catchUpWindow(e)]));
    expect(windows).toEqual({
      'reddit-t1': 0, 'reddit-t2': 0, 'reddit-t3': 0, hn: 0, 'marketing-followups': 0,
      tenders: 60, xometry: 60, 'content-daily': 60, sitemap: 60, 'ops-digest': 60, 'marketing-warmup': 60,
    });
  });

  it('intervalMinutes equals a minute-by-minute scan of the 8-day window (also for day-restricted forms)', () => {
    const brute = (expr: string) => {
      let previous: number | null = null;
      let shortest = 8 * 1440;
      for (let m = 0; m < 8 * 1440; m++) {
        if (!cronMatches(expr, new Date(Date.UTC(2026, 0, 5) + m * MINUTE))) continue;
        if (previous !== null) shortest = Math.min(shortest, m - previous);
        previous = m;
      }
      return shortest;
    };
    for (const expr of [...SCHEDULE.map((e) => e.cron), '0 0 * * 0', '30 23 * * 1-5', '0 0 13 * 5', '0 22,2 * * *', '*/7 * * * *', '45 23 * * 6', '0 12 1 * *']) {
      expect(intervalMinutes(expr), expr).toBe(brute(expr));
    }
  });

  it('slot keys are YYYY-MM-DDTHH:MMZ; minuteOf truncates to the UTC minute', () => {
    expect(slotKey(at('2026-10-05T07:00:00Z'))).toBe('2026-10-05T07:00Z');
    expect(minuteOf(Date.UTC(2026, 9, 5, 7, 0, 59, 999)).toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });
});

describe('dueJobs over a simulated week (10,080 minute ticks)', () => {
  /** Distinct slots per job and the ticks that listed each slot. */
  function simulate(skip: ReadonlySet<number> = new Set()) {
    const slots = new Map<JobId, Map<string, { first: number; catchUp: boolean }>>();
    for (let i = 0; i < 7 * 24 * 60; i++) {
      if (skip.has(i)) continue;
      for (const d of dueJobs(WEEK_START + i * MINUTE)) {
        let m = slots.get(d.job);
        if (!m) slots.set(d.job, (m = new Map()));
        if (!m.has(d.slot)) m.set(d.slot, { first: i, catchUp: d.catchUp });
      }
    }
    return slots;
  }

  it('one slot per expected firing: reddit-t1 672, reddit-t2 336, reddit-t3 168, hn 336, tenders 7, xometry 49, content-daily 7, sitemap 7, ops-digest 1, follow-ups 168, warm-up 7', () => {
    const slots = simulate();
    const counts = Object.fromEntries(SCHEDULE.map((e) => [e.job, slots.get(e.job)?.size ?? 0]));
    expect(counts).toEqual({
      'reddit-t1': 672, 'reddit-t2': 336, 'reddit-t3': 168, hn: 336, tenders: 7, xometry: 49,
      'content-daily': 7, sitemap: 7, 'ops-digest': 1, 'marketing-followups': 168, 'marketing-warmup': 7,
    });
    expect([...(slots.get('ops-digest')?.keys() ?? [])]).toEqual(['2026-10-05T06:30Z']);
    expect([...(slots.get('xometry')?.keys() ?? [])].slice(0, 7)).toEqual(['06', '08', '10', '12', '14', '16', '18'].map((h) => `2026-10-05T${h}:00Z`));
    // Every slot was first listed in its own minute (no catch-up needed when no tick is lost).
    for (const [job, m] of slots) for (const [slot, v] of m) expect(v.catchUp, `${job} ${slot}`).toBe(false);
  });

  it('a lost tick: the 07:00 content-daily slot is listed at 07:01 as a catch-up; a lost */15 tick is skipped', () => {
    const sevenOclock = 7 * 60;
    const slots = simulate(new Set([sevenOclock]));
    expect(slots.get('content-daily')?.get('2026-10-05T07:00Z')).toEqual({ first: sevenOclock + 1, catchUp: true });
    expect(slots.get('reddit-t1')?.has('2026-10-05T07:00Z')).toBe(false);
    expect(slots.get('reddit-t1')?.size).toBe(671);
  });

  it('a catch-up slot is listed on every tick of its window and on none after it', () => {
    const listed = (t: number) => dueJobs(t).filter((d) => d.job === 'content-daily').map((d) => `${d.slot}/${d.catchUp}`);
    expect(listed(Date.UTC(2026, 9, 5, 7, 30))).toEqual(['2026-10-05T07:00Z/true']);
    expect(listed(Date.UTC(2026, 9, 5, 8, 0))).toEqual(['2026-10-05T07:00Z/true']);
    expect(listed(Date.UTC(2026, 9, 5, 8, 1))).toEqual([]);
  });

  it('a tick lists each job at most once', () => {
    for (let i = 0; i < 24 * 60; i += 7) {
      const jobs = dueJobs(WEEK_START + i * MINUTE).map((d) => d.job);
      expect(new Set(jobs).size).toBe(jobs.length);
    }
  });

  it('the simulated week of all 11 entries stays cheap (well under the 50 ms per tick budget)', () => {
    const started = performance.now();
    for (let i = 0; i < 7 * 24 * 60; i++) dueJobs(WEEK_START + i * MINUTE);
    const perTick = (performance.now() - started) / (7 * 24 * 60);
    expect(perTick).toBeLessThan(5);
  });
});
