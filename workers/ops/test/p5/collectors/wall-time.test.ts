// Time limits of the collectors, under fake timers (setTimeout, Date) with AbortSignal.timeout driven by the same
// fake timers and source routes that answer only when their request is aborted:
//   - each PullPush and Algolia request carries a 30 s timeout: a request that never answers ends as an error after
//     30 s (reddit: pullpush_status {error}, next subreddit; HN: the tick fails with algolia_unreachable, acked);
//   - one reddit tier message ends well inside the 15-minute queue consumer limit even when every PullPush request
//     hangs: no subreddit starts after 10 min, the run closes 'succeeded' with partial: true and the counts so far,
//     the message is acked, and the subreddits not reached keep their last_scanned_at.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOURCE_TIMEOUT_MS } from '../../../src/collectors/common';
import { makeHnScanHandler } from '../../../src/collectors/hn';
import { makeRedditTierHandler, REDDIT_WALL_STOP_MS } from '../../../src/collectors/reddit';
import type { ClockPort } from '../../../src/ports/index';
import type { P5ScrapeHandler } from '../../../src/queues/scrapes-p5';
import { testContext } from '../../helpers/ops';
import {
  ALGOLIA_BASE,
  collectorHarness,
  dispatcherRun,
  PULLPUSH_BASE,
  runRow,
  scrapeBody,
  scriptPullpush,
  seedKeywords,
  SLOT,
  subredditRow,
  T0,
  testMessage,
  type CollectorHarness,
} from './harness';

/** The queue consumer wall-time limit of the platform (15 min). */
const CONSUMER_LIMIT_MS = 15 * 60_000;

let timeouts: number[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(T0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  timeouts = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    timeouts.push(ms);
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return c.signal;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A source route answer that never comes: it rejects only when the request is aborted. */
const never = (req: Request): Promise<Response> =>
  new Promise((_, reject) => {
    if (req.signal.aborted) reject(req.signal.reason);
    req.signal.addEventListener('abort', () => reject(req.signal.reason));
  });

/** The handler's clock follows the faked Date, so the budget sees the time the timers advance. */
const dateClock: ClockPort = { now: () => new Date() };

/** Runs one message on fake time (1 s steps, at most `capMs`); returns the elapsed fake time and whether it ended. */
async function runOnFakeTime(h: CollectorHarness, handler: P5ScrapeHandler, msg: Parameters<P5ScrapeHandler>[0], capMs = 2 * CONSUMER_LIMIT_MS) {
  const t0 = Date.now();
  let done = false;
  const p = handler(msg, h.env, testContext(), { ports: { ...h.ports, clock: dateClock }, p5: h.p5 }).then(() => {
    done = true;
  });
  while (!done && Date.now() - t0 < capMs) await vi.advanceTimersByTimeAsync(1_000);
  if (done) await p;
  return { elapsed: Date.now() - t0, done };
}

describe('source request timeouts', () => {
  it('a PullPush request that never answers ends after 30 s as pullpush_status {error}; the next subreddit follows', async () => {
    const h = collectorHarness();
    seedKeywords(h.db);
    h.db.seed('monitored_subreddits', [subredditRow('machining', 1, null), subredditRow('cnc', 1, 45)].map((r, i) => ({ id: i + 1, ...r })));
    scriptPullpush(h.sources, {}); // cnc answers {data: []}: no lead, so no Telegram request (it has its own timeout)
    h.sources.route({ method: 'GET', match: `${PULLPUSH_BASE}/reddit/search/submission?subreddit=machining`, respond: never });
    h.setFlag('agent.growth.reddit', { mode: 'assist' });
    const runId = await dispatcherRun(h.db, 'growth.reddit', `growth.reddit:t1:${SLOT}`);
    const msg = testMessage(scrapeBody('reddit-tier', { tier: 1, max: 40, slot: SLOT }, runId));

    const { elapsed, done } = await runOnFakeTime(h, makeRedditTierHandler(), msg);
    expect(done).toBe(true);
    expect(timeouts).toEqual([SOURCE_TIMEOUT_MS, SOURCE_TIMEOUT_MS]);
    expect(SOURCE_TIMEOUT_MS).toBe(30_000);
    // 30 s timeout on machining, then cnc answers and is followed by the 500 ms pause
    expect(elapsed).toBeGreaterThanOrEqual(30_000);
    expect(elapsed).toBeLessThanOrEqual(32_000);
    expect(msg.acked).toBe(1);
    const run = runRow(h.db, runId);
    expect(run.status).toBe('succeeded');
    expect(run.output).toMatchObject({ due: 2, scanned: 1, errors: 1, pullpush_status: { error: 1, 200: 1 } });
    expect(run.output).not.toHaveProperty('partial');
    expect(h.db.rows('monitored_subreddits', ['subreddit', 'eq', 'machining'])[0].last_scanned_at).toBeNull();
  });

  it('an Algolia request that never answers fails the tick after 30 s (algolia_unreachable); the message is acked', async () => {
    const h = collectorHarness();
    seedKeywords(h.db);
    h.sources.route({ method: 'GET', match: `${ALGOLIA_BASE}/search_by_date?`, respond: never });
    h.setFlag('agent.growth.hn', { mode: 'assist' });
    const runId = await dispatcherRun(h.db, 'growth.hn', `growth.hn:${SLOT}`);
    const msg = testMessage(scrapeBody('hn-scan', { slot: SLOT }, runId));

    const { elapsed, done } = await runOnFakeTime(h, makeHnScanHandler(), msg);
    expect(done).toBe(true);
    expect(timeouts).toEqual([SOURCE_TIMEOUT_MS]);
    expect(elapsed).toBeGreaterThanOrEqual(30_000);
    expect(elapsed).toBeLessThanOrEqual(31_000);
    expect(msg.acked).toBe(1);
    expect(msg.retried).toEqual([]);
    expect(runRow(h.db, runId)).toMatchObject({ status: 'failed', error: 'algolia_unreachable', output: { scanned: 0, algolia_status: { error: 1 } } });
    expect(h.db.rows('leads')).toEqual([]);
  });
});

describe('one reddit tier message within the consumer limit', () => {
  it('every PullPush request hangs: the run closes before 15 min (succeeded, partial: true) and the message is acked', async () => {
    const h = collectorHarness();
    seedKeywords(h.db);
    h.db.seed('monitored_subreddits', Array.from({ length: 40 }, (_, i) => ({ id: i + 1, ...subredditRow(`s${String(i).padStart(2, '0')}`, 1, null) })));
    h.sources.route({ method: 'GET', match: `${PULLPUSH_BASE}/reddit/search/submission?`, respond: never });
    h.setFlag('agent.growth.reddit', { mode: 'assist' });
    const runId = await dispatcherRun(h.db, 'growth.reddit', `growth.reddit:t1:${SLOT}`);
    const msg = testMessage(scrapeBody('reddit-tier', { tier: 1, max: 40, slot: SLOT }, runId));

    const { elapsed, done } = await runOnFakeTime(h, makeRedditTierHandler(), msg);
    expect(done).toBe(true);
    expect(elapsed).toBeLessThan(CONSUMER_LIMIT_MS);
    // the budget: 20 timeouts of 30 s fill the 10 min; no subreddit starts after that
    expect(REDDIT_WALL_STOP_MS).toBe(10 * 60_000);
    expect(elapsed).toBeGreaterThanOrEqual(REDDIT_WALL_STOP_MS);
    expect(elapsed).toBeLessThanOrEqual(REDDIT_WALL_STOP_MS + 2_000);
    expect(h.sources.requests).toHaveLength(20);
    expect(msg.acked).toBe(1);
    expect(msg.retried).toEqual([]);
    const run = runRow(h.db, runId);
    expect(run.status).toBe('succeeded');
    expect(run.error).toBeNull();
    expect(run.output).toEqual({ tier: 1, due: 40, scanned: 0, fetched: 0, matched: 0, leads_new: 0, high: 0, errors: 20, pullpush_status: { error: 20 }, partial: true });
    expect(h.db.rows('monitored_subreddits').every((r) => r.last_scanned_at === null)).toBe(true);
  });
});
