// handleRedditTier (src/collectors/reddit.ts). Parity: the live reddit-collector v15 handler (run from its
// repository source over a fake supabase-js client on the same seeded tables, test/p5/collectors/live-source.ts)
// and the port read the same subreddits, request the same PullPush URLs with the same User-Agent, write the same
// leads rows and last_scanned_at values and send byte-equal alerts; the deliberate differences are pinned: no alert
// and no count for a row that already existed (D-14), no increment_keyword_match_count call, the re-check of a
// subreddit another tick scanned meanwhile. Then the run rules: flag off, shadow, final or missing run, invalid
// params, non-2xx and network errors, upsert errors, a failing database read, the 40 cap and the 500 ms pause.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isDue, makeRedditTierHandler, pullpushUrl, PULLPUSH_USER_AGENT } from '../../../src/collectors/reddit';
import { closeRun, EMPTY_USAGE } from '../../../src/agents/runs';
import { DbError, type Db, type Row } from '../../../src/db/postgrest';
import { P5MemoryDb, ScriptedSources } from '../../../src/ports/p5-stub/index';
import type { RedditTierParams } from '../../../src/queues/messages';
import { testContext } from '../../helpers/ops';
import {
  collectorHarness,
  dispatcherRun,
  fixture,
  leadRows,
  PULLPUSH_BASE,
  runRow,
  scrapeBody,
  scriptPullpush,
  seedKeywords,
  seedSubreddits,
  SLOT,
  subredditRow,
  T0,
  testMessage,
  type CollectorHarness,
  type PullpushFixture,
  type TelegramWire,
} from './harness';
import { fakeSupabase, loadLive, type FakeSupabase } from './live-source';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Seed = (db: P5MemoryDb) => void;
const standardSeed: Seed = (db) => {
  seedKeywords(db);
  seedSubreddits(db);
};

interface LiveRun {
  db: P5MemoryDb;
  sources: ScriptedSources;
  telegram: TelegramWire[];
  supabase: FakeSupabase;
  body: Record<string, unknown>;
}

async function runLive(seed: Seed, tier: number, data?: PullpushFixture, max = 40): Promise<LiveRun> {
  const db = new P5MemoryDb({ clock: () => new Date(T0) });
  seed(db);
  const sources = new ScriptedSources({ bases: { pullpush: PULLPUSH_BASE } });
  scriptPullpush(sources, data);
  const telegram: TelegramWire[] = [];
  const supabase = fakeSupabase(db);
  const live = loadLive('reddit-collector', {
    env: { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test-value', TELEGRAM_BOT_TOKEN: 'telegram-test-value', TELEGRAM_CHAT_ID: 'chat-test-value' },
    supabase,
    fetch: async (url, init) => {
      if (url.startsWith('https://api.telegram.org/')) {
        telegram.push({ url, body: String(init?.body ?? '') });
        return new Response('{"ok":true}', { status: 200 });
      }
      return sources.fetch(url, init);
    },
  });
  const res = await live.handler(new Request(`https://fn.test/functions/v1/reddit-collector?tier=${tier}&max=${max}`, { method: 'POST' }));
  return { db, sources, telegram, supabase, body: (await res.json()) as Record<string, unknown> };
}

async function runPort(h: CollectorHarness, tier: 1 | 2 | 3, o: { attempts?: number; params?: unknown } = {}) {
  const runId = await dispatcherRun(h.db, 'growth.reddit', `growth.reddit:t${tier}:${SLOT}`);
  const params = (o.params ?? { tier, max: 40, slot: SLOT }) as RedditTierParams;
  const msg = testMessage(scrapeBody('reddit-tier', params, runId), o.attempts ?? 1);
  await makeRedditTierHandler({ sleep: h.sleep })(msg, h.env, testContext(), h.deps);
  return { msg, runId, run: runRow(h.db, runId) };
}

function portHarness(seed: Seed = standardSeed, data?: PullpushFixture): CollectorHarness {
  const h = collectorHarness();
  seed(h.db);
  scriptPullpush(h.sources, data);
  h.setFlag('agent.growth.reddit', { mode: 'assist' });
  return h;
}

const requested = (s: ScriptedSources) => s.requests.map((r) => ({ url: r.url, ua: r.headers['user-agent'] }));
const subs = (db: P5MemoryDb) => db.rows('monitored_subreddits').map((r) => ({ subreddit: r.subreddit, last_scanned_at: r.last_scanned_at }));

describe('parity with the live reddit-collector', () => {
  for (const tier of [1, 2, 3] as const) {
    it(`tier ${tier}: same reads, PullPush requests, leads rows, last_scanned_at values and alert bytes`, async () => {
      const live = await runLive(standardSeed, tier);
      const h = portHarness();
      const { msg, run } = await runPort(h, tier);

      expect(msg.acked).toBe(1);
      expect(requested(h.sources)).toEqual(requested(live.sources));
      expect(requested(h.sources).length).toBeGreaterThan(0);
      for (const r of requested(h.sources)) expect(r.ua).toBe(PULLPUSH_USER_AGENT);
      expect(leadRows(h.db)).toEqual(leadRows(live.db));
      expect(subs(h.db)).toEqual(subs(live.db));
      expect(h.telegram).toEqual(live.telegram);

      // deliberate difference: the live call to the absent RPC is dropped
      expect(live.supabase.calls.some((c) => c.op === 'rpc' && c.table === 'increment_keyword_match_count')).toBe(true);
      expect(h.db.calls.filter((c) => c.method === 'rpc').map((c) => c.target)).toEqual(['agent_run_begin']);

      expect(run.status).toBe('succeeded');
      expect(run.output).toMatchObject({ tier, due: live.body.subredditsScanned, leads_new: leadRows(h.db).length, high: h.telegram.length });
    });
  }

  it('tier 3 in detail: due subreddits, counts and pullpush_status', async () => {
    const h = portHarness();
    const { run } = await runPort(h, 3);
    // due: machining (never), cnc (45 of 30 min), engineering (never), hardware (95 min, interval null -> 30);
    // not due: fresh1 (5 min), slow2 (45 of 60 min); excluded: tier4, inactive1, forum1 (source forum)
    expect(h.sources.requests.map((r) => new URL(r.url).searchParams.get('subreddit'))).toEqual(['machining', 'cnc', 'engineering', 'hardware']);
    expect(run.output).toEqual({ tier: 3, due: 4, scanned: 4, fetched: 9, matched: 8, leads_new: 8, high: 4, errors: 0, pullpush_status: { 200: 3, 503: 1 } });
    expect(run.error).toBeNull();
    expect(h.sleeps).toEqual([500, 500, 500, 500]);
    // the non-2xx subreddit still gets its last_scanned_at (as live)
    expect(h.db.rows('monitored_subreddits', ['subreddit', 'eq', 'engineering'])[0].last_scanned_at).toBe(new Date(T0).toISOString());
    expect(h.db.rows('monitored_subreddits', ['subreddit', 'eq', 'fresh1'])[0].last_scanned_at).toBe(new Date(T0 - 5 * 60_000).toISOString());
  });

  it('due rule: never scanned, or the interval (null or 0 -> 30 min) has passed', async () => {
    const at = (min: number) => new Date(T0 - min * 60_000).toISOString();
    expect(isDue({ last_scanned_at: null, scan_interval_minutes: 30 }, T0)).toBe(true);
    expect(isDue({ last_scanned_at: at(30), scan_interval_minutes: 30 }, T0)).toBe(true);
    expect(isDue({ last_scanned_at: at(29), scan_interval_minutes: 30 }, T0)).toBe(false);
    expect(isDue({ last_scanned_at: at(45), scan_interval_minutes: null }, T0)).toBe(true);
    expect(isDue({ last_scanned_at: at(29), scan_interval_minutes: 0 }, T0)).toBe(false);
    expect(isDue({ last_scanned_at: at(45), scan_interval_minutes: 60 }, T0)).toBe(false);
    expect(isDue({ last_scanned_at: 'not a date', scan_interval_minutes: 30 }, T0)).toBe(false);
    const nullIntervals: Seed = (db) => {
      seedKeywords(db);
      db.seed('monitored_subreddits', [
        subredditRow('null45', 1, 45, { interval: null }),
        subredditRow('null20', 1, 20, { interval: null }),
        subredditRow('zero45', 1, 45, { interval: 0 }),
      ].map((r, i) => ({ id: i + 1, ...r })));
    };
    const live = await runLive(nullIntervals, 1, {});
    const h = portHarness(nullIntervals, {});
    await runPort(h, 1);
    expect(requested(h.sources)).toEqual(requested(live.sources));
    expect(h.sources.requests.map((r) => new URL(r.url).searchParams.get('subreddit'))).toEqual(['null45', 'zero45']);
  });

  it('PullPush URL: incremental after= from last_scanned_at, none for a never-scanned subreddit', () => {
    expect(pullpushUrl(PULLPUSH_BASE, 'cnc', '2026-10-08T09:15:00.000Z')).toBe(
      'https://api.pullpush.io/reddit/search/submission?subreddit=cnc&sort=new&sort_type=created_utc&size=100&after=1791450900',
    );
    expect(pullpushUrl(PULLPUSH_BASE, 'machining', null)).toBe('https://api.pullpush.io/reddit/search/submission?subreddit=machining&sort=new&sort_type=created_utc&size=100');
  });
});

describe('D-14: a row that already exists never alerts and is not counted', () => {
  const existing: Seed = (db) => {
    standardSeed(db);
    db.seed('leads', [{ source: 'reddit', external_id: 't1a', source_url: 'https://reddit.com/r/machining/comments/t1a/looking_for_manufacturer_in_ge/', title: 'seen before', posted_at: '2026-10-08T08:59:00.000Z' }]);
  };

  it('the live function alerts for it again; the port does not', async () => {
    const live = await runLive(existing, 1);
    const h = portHarness(existing);
    const { run } = await runPort(h, 1);
    const isT1a = (t: TelegramWire) => (JSON.parse(t.body) as { text: string }).text.includes('/comments/t1a/');
    expect(live.telegram.filter(isT1a)).toHaveLength(1);
    expect(h.telegram.filter(isT1a)).toHaveLength(0);
    expect(h.telegram).toEqual(live.telegram.filter((t) => !isT1a(t)));
    expect(leadRows(h.db)).toEqual(leadRows(live.db));
    expect(run.output).toMatchObject({ leads_new: 5, high: 2, matched: 6 });
    expect(h.db.rows('leads', ['external_id', 'eq', 't1a'])[0].title).toBe('seen before');
  });

  it('a second tick over the same posts inserts nothing and sends nothing', async () => {
    const h = portHarness();
    await runPort(h, 1);
    const first = { leads: leadRows(h.db).length, alerts: h.telegram.length };
    for (const r of h.db.rows('monitored_subreddits')) {
      await h.db.update('monitored_subreddits', { last_scanned_at: null }, { filters: [['subreddit', 'eq', String(r.subreddit)]] });
    }
    h.clock.advance(15 * 60_000);
    const runId = await dispatcherRun(h.db, 'growth.reddit', 'growth.reddit:t1:2026-10-08T10:15Z');
    await makeRedditTierHandler({ sleep: h.sleep })(testMessage(scrapeBody('reddit-tier', { tier: 1, max: 40, slot: '2026-10-08T10:15Z' }, runId)), h.env, testContext(), h.deps);
    expect(leadRows(h.db)).toHaveLength(first.leads);
    expect(h.telegram).toHaveLength(first.alerts);
    expect(runRow(h.db, runId).output).toMatchObject({ leads_new: 0, high: 0, matched: first.leads });
  });
});

describe('due filter, tier filter and the 40 cap', () => {
  const many: Seed = (db) => {
    seedKeywords(db);
    const rows: Row[] = [];
    for (let i = 0; i < 45; i++) rows.push(subredditRow(`sub${String(i).padStart(2, '0')}`, i % 2 === 0 ? 1 : 2, i % 3 === 0 ? null : 31));
    rows.push(subredditRow('recent', 1, 10), subredditRow('t3only', 3, null));
    db.seed('monitored_subreddits', rows.map((r, i) => ({ id: i + 1, ...r })));
  };

  it('tier 2: the first 40 due subreddits of tiers <= 2 by tier, as live', async () => {
    const live = await runLive(many, 2);
    const h = portHarness(many, {});
    const { run } = await runPort(h, 2);
    const names = h.sources.requests.map((r) => new URL(r.url).searchParams.get('subreddit'));
    expect(names).toHaveLength(40);
    expect(names).toEqual(live.sources.requests.map((r) => new URL(r.url).searchParams.get('subreddit')));
    expect(names.slice(0, 23).every((n) => Number(n!.slice(3)) % 2 === 0)).toBe(true);
    expect(names).not.toContain('recent');
    expect(names).not.toContain('t3only');
    expect(run.output).toMatchObject({ due: 40, scanned: 40, fetched: 0 });
    expect(subs(h.db)).toEqual(subs(live.db));
  });

  it('tier 1 reads only tier-1 rows', async () => {
    const h = portHarness(many, {});
    const { run } = await runPort(h, 1);
    expect(h.sources.requests.map((r) => new URL(r.url).searchParams.get('subreddit'))).toEqual(
      Array.from({ length: 23 }, (_, i) => `sub${String(i * 2).padStart(2, '0')}`),
    );
    expect(run.output).toMatchObject({ due: 23, scanned: 23 });
  });
});

describe('re-check before each subreddit', () => {
  it('a subreddit another tick scanned meanwhile is skipped (no fetch, no write)', async () => {
    const h = portHarness();
    // while machining is fetched, a concurrent tick stamps cnc
    h.sources.route({
      method: 'GET',
      match: `${PULLPUSH_BASE}/reddit/search/submission?subreddit=machining`,
      respond: async () => {
        await h.db.update('monitored_subreddits', { last_scanned_at: new Date(T0).toISOString() }, { filters: [['subreddit', 'eq', 'cnc']] });
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });
    const { run } = await runPort(h, 1);
    expect(h.sources.requests.map((r) => new URL(r.url).searchParams.get('subreddit'))).toEqual(['machining']);
    expect(run.output).toMatchObject({ due: 2, scanned: 1, errors: 0 });
  });
});

describe('modes and run states', () => {
  it('flag off: run skipped {reason: flag_off, tier}, nothing fetched, acked', async () => {
    const h = portHarness();
    h.setFlag('agent.growth.reddit', { enabled: false });
    const { msg, run } = await runPort(h, 2);
    expect(msg.acked).toBe(1);
    expect(run.status).toBe('skipped');
    expect(run.output).toEqual({ reason: 'flag_off', tier: 2 });
    expect(h.sources.requests).toHaveLength(0);
  });

  it('missing flag reads as off (fail closed)', async () => {
    const h = portHarness();
    h.setFlag('agent.growth.reddit', null);
    const { run } = await runPort(h, 1);
    expect(run.status).toBe('skipped');
  });

  it('shadow: fetch and score only; no lead, no last_scanned_at, no alert', async () => {
    const h = portHarness();
    h.setFlag('agent.growth.reddit', { mode: 'shadow' });
    const before = subs(h.db);
    const { msg, run } = await runPort(h, 3);
    expect(msg.acked).toBe(1);
    expect(h.sources.requests).toHaveLength(4);
    expect(leadRows(h.db)).toEqual([]);
    expect(subs(h.db)).toEqual(before);
    expect(h.telegram).toEqual([]);
    expect(h.db.calls.filter((c) => c.method === 'insert' || (c.method === 'update' && c.target !== 'agent_runs'))).toEqual([]);
    expect(run.status).toBe('succeeded');
    expect(run.output).toEqual({ tier: 3, due: 4, scanned: 4, fetched: 9, matched: 8, leads_new: 0, high: 0, errors: 0, pullpush_status: { 200: 3, 503: 1 }, shadow: true });
  });

  it('a run that is already final (redelivery) is acked without work', async () => {
    const h = portHarness();
    const runId = await dispatcherRun(h.db, 'growth.reddit', `growth.reddit:t1:${SLOT}`);
    await closeRun(h.db, runId, { status: 'succeeded', output: { done: true } }, { ...EMPTY_USAGE, by_step: {} });
    const msg = testMessage(scrapeBody('reddit-tier', { tier: 1, max: 40, slot: SLOT }, runId), 2);
    await makeRedditTierHandler({ sleep: h.sleep })(msg, h.env, testContext(), h.deps);
    expect(msg.acked).toBe(1);
    expect(h.sources.requests).toHaveLength(0);
    expect(runRow(h.db, runId).output).toEqual({ done: true });
  });

  it('a message whose run does not exist is acked without work', async () => {
    const h = portHarness();
    const msg = testMessage(scrapeBody('reddit-tier', { tier: 1, max: 40, slot: SLOT }, '00000000-0000-4000-8000-0000000000aa'));
    await makeRedditTierHandler({ sleep: h.sleep })(msg, h.env, testContext(), h.deps);
    expect(msg.acked).toBe(1);
    expect(h.sources.requests).toHaveLength(0);
  });

  it('invalid params: run failed invalid_params, acked', async () => {
    const h = portHarness();
    const { msg, run } = await runPort(h, 1, { params: { tier: 4, max: 40, slot: SLOT } });
    expect(msg.acked).toBe(1);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('invalid_params');
    expect(h.sources.requests).toHaveLength(0);
  });
});

describe('errors', () => {
  it('a PullPush network error counts, keeps that last_scanned_at and continues with the next subreddit', async () => {
    const h = portHarness();
    h.sources.route({ method: 'GET', match: `${PULLPUSH_BASE}/reddit/search/submission?subreddit=machining`, respond: () => Promise.reject(new TypeError('network')) });
    const { run } = await runPort(h, 1);
    expect(run.status).toBe('succeeded');
    expect(run.output).toMatchObject({ due: 2, scanned: 1, errors: 1, pullpush_status: { error: 1, 200: 1 } });
    expect(h.db.rows('monitored_subreddits', ['subreddit', 'eq', 'machining'])[0].last_scanned_at).toBeNull();
    expect(h.db.rows('monitored_subreddits', ['subreddit', 'eq', 'cnc'])[0].last_scanned_at).toBe(new Date(T0).toISOString());
    expect(h.sleeps).toEqual([500]);
  });

  it('an upsert error (unique key other than source_url) is counted and skipped, as live', async () => {
    const conflicting: Seed = (db) => {
      standardSeed(db);
      db.seed('leads', [{ source: 'reddit', external_id: 't1b', source_url: 'https://reddit.com/elsewhere', title: 'other' }]);
    };
    const live = await runLive(conflicting, 1);
    const h = portHarness(conflicting);
    const { run } = await runPort(h, 1);
    expect(leadRows(h.db)).toEqual(leadRows(live.db));
    expect(h.telegram).toEqual(live.telegram);
    expect(run.output).toMatchObject({ errors: 1, leads_new: 5 });
  });

  it('a failing subreddit read closes the run failed with a fixed code and acks', async () => {
    const h = portHarness();
    const db = h.db;
    const failing: Db = {
      select: (table, o) => (table === 'monitored_subreddits' ? Promise.reject(new DbError(503, null, 'postgrest GET monitored_subreddits: 503')) : db.select(table, o)),
      insert: (t, r, o) => db.insert(t, r, o),
      update: (t, p, o) => db.update(t, p, o),
      rpc: (n, a) => db.rpc(n, a),
    };
    const runId = await dispatcherRun(db, 'growth.reddit', `growth.reddit:t1:${SLOT}`);
    const msg = testMessage(scrapeBody('reddit-tier', { tier: 1, max: 40, slot: SLOT }, runId));
    await makeRedditTierHandler({ sleep: h.sleep })(msg, h.env, testContext(), { ports: { ...h.ports, db: failing }, p5: h.p5 });
    expect(msg.acked).toBe(1);
    expect(runRow(db, runId)).toMatchObject({ status: 'failed', error: 'db_error 503' });
  });

  it('an unreadable PullPush answer counts as an error for that subreddit only', async () => {
    const h = portHarness();
    h.sources.route({ method: 'GET', match: `${PULLPUSH_BASE}/reddit/search/submission?subreddit=cnc`, respond: () => new Response('<html>', { status: 200 }) });
    const { run } = await runPort(h, 1);
    expect(run.output).toMatchObject({ scanned: 1, errors: 1 });
    expect(h.db.rows('monitored_subreddits', ['subreddit', 'eq', 'cnc'])[0].last_scanned_at).toBe(new Date(T0 - 45 * 60_000).toISOString());
  });
});

describe('fixture sanity', () => {
  it('the PullPush fixture covers high, medium, low, noise, no permalink and a non-2xx subreddit', () => {
    const data = fixture<PullpushFixture>('pullpush.json');
    expect(Object.keys(data)).toEqual(['machining', 'cnc', 'engineering', 'hardware']);
    expect(data.engineering.status).toBe(503);
    expect(data.machining.posts!.some((p) => p.permalink === undefined)).toBe(true);
  });
});
