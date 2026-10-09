// handleHnScan (src/collectors/hn.ts). Parity: the live hn-collector v7 handler (run from its repository source,
// test/p5/collectors/live-source.ts) and the port derive the same window from the newest stored lead, request the
// same 16 Algolia URLs, write the same leads rows and send byte-equal alerts (high and medium only); the deliberate
// difference D-14 is pinned (no alert, no count for a row that already existed). Then: shadow, flag off, the run
// states, a non-2xx term, a network error failing the tick as live, an upsert error, the 200 ms pauses.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeRun, EMPTY_USAGE } from '../../../src/agents/runs';
import { HN_SEARCH_TERMS, hnSearchUrl, hnShowUrl, hnSince, makeHnScanHandler } from '../../../src/collectors/hn';
import { DbError, type InsertOptions, type Row } from '../../../src/db/postgrest';
import { P5MemoryDb, ScriptedSources } from '../../../src/ports/p5-stub/index';
import { testContext } from '../../helpers/ops';
import {
  ALGOLIA_BASE,
  collectorHarness,
  dispatcherRun,
  leadRows,
  runRow,
  scrapeBody,
  scriptAlgolia,
  seedKeywords,
  SLOT,
  T0,
  testMessage,
  type CollectorHarness,
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
const OLDER_LEAD = { source: 'hackernews', external_id: '40999999', title: 'older lead', posted_at: '2026-10-08T08:00:00.000Z', source_url: null };
const standardSeed: Seed = (db) => {
  seedKeywords(db);
  db.seed('leads', [OLDER_LEAD]);
};

interface LiveRun {
  db: P5MemoryDb;
  sources: ScriptedSources;
  telegram: TelegramWire[];
  supabase: FakeSupabase;
  status: number;
  body: Record<string, unknown>;
}

async function runLive(seed: Seed, script: (s: ScriptedSources) => void = (s) => scriptAlgolia(s), makeDb: () => P5MemoryDb = () => new P5MemoryDb({ clock: () => new Date(T0) })): Promise<LiveRun> {
  const db = makeDb();
  seed(db);
  const sources = new ScriptedSources({ bases: { hn: ALGOLIA_BASE } });
  script(sources);
  const telegram: TelegramWire[] = [];
  const supabase = fakeSupabase(db);
  const live = loadLive('hn-collector', {
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
  const res = await live.handler(new Request('https://fn.test/functions/v1/hn-collector', { method: 'POST' }));
  return { db, sources, telegram, supabase, status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function portHarness(seed: Seed = standardSeed, script: (s: ScriptedSources) => void = (s) => scriptAlgolia(s)): CollectorHarness {
  const h = collectorHarness();
  seed(h.db);
  script(h.sources);
  h.setFlag('agent.growth.hn', { mode: 'assist' });
  return h;
}

async function runPort(h: CollectorHarness, params: unknown = { slot: SLOT }) {
  const runId = await dispatcherRun(h.db, 'growth.hn', `growth.hn:${SLOT}`);
  const msg = testMessage(scrapeBody('hn-scan', params as { slot: string }, runId));
  await makeHnScanHandler({ sleep: h.sleep })(msg, h.env, testContext(), h.deps);
  return { msg, runId, run: runRow(h.db, runId) };
}

const urls = (s: ScriptedSources) => s.requests.map((r) => r.url);
const alertTexts = (t: TelegramWire[]) => t.map((x) => (JSON.parse(x.body) as { text: string }).text);

describe('parity with the live hn-collector', () => {
  it('same window, Algolia requests, leads rows and alert bytes', async () => {
    const live = await runLive(standardSeed);
    const h = portHarness();
    const { msg, run } = await runPort(h);
    expect(msg.acked).toBe(1);
    expect(live.status).toBe(200);
    expect(urls(h.sources)).toEqual(urls(live.sources));
    expect(urls(h.sources)).toHaveLength(16);
    expect(leadRows(h.db)).toEqual(leadRows(live.db));
    expect(h.telegram).toEqual(live.telegram);
    expect(run.status).toBe('succeeded');
    expect(run.output).toEqual({ scanned: live.body.postsScanned, matched: 6, leads_new: 6, high_or_medium: 4, errors: 0, algolia_status: { 200: 15, 500: 1 } });
    expect(live.body).toMatchObject({ newLeads: 6, highIntent: 4 });
  });

  it('the stored rows: Show HN label, HTML stripped from the body, url fallback, score_value, status new', async () => {
    const h = portHarness();
    await runPort(h);
    const byId = (id: string) => h.db.rows('leads', ['external_id', 'eq', id])[0];
    expect(byId('41000005')).toMatchObject({ subreddit: 'Show HN', url: 'https://example.org/show-5', lead_score: 'high', status: 'new' });
    expect(String(byId('41000005').body)).not.toMatch(/<[^>]+>/);
    expect(byId('41000003')).toMatchObject({ subreddit: 'Hacker News', url: 'https://news.ycombinator.com/item?id=41000003', body: 'Small batch, urgent.', lead_score: 'medium', score_value: 3 });
    // a hit seen under two terms is stored once, with the later copy (points 25)
    expect(h.db.rows('leads', ['external_id', 'eq', '41000001'])).toHaveLength(1);
    expect(byId('41000001').score).toBe(25);
    // hn scoring: industry_specific alone is low (no alert)
    expect(byId('41000008').lead_score).toBe('low');
    expect(alertTexts(h.telegram).map((t) => t.split('\n')[0])).toEqual([
      '\u{1F534} HIGH INTENT LEAD \u{2014} Hacker News',
      '\u{1F7E1} MEDIUM INTENT LEAD \u{2014} Hacker News',
      '\u{1F7E1} MEDIUM INTENT LEAD \u{2014} Hacker News',
      '\u{1F534} HIGH INTENT LEAD \u{2014} Hacker News',
    ]);
  });

  it('window: newest hackernews lead - 60 s; without one, now - 1 h; a null posted_at sorts first (as PostgREST desc)', async () => {
    expect(hnSince('2026-10-08T08:00:00.000Z', T0)).toBe(Math.floor(Date.parse('2026-10-08T08:00:00.000Z') / 1000) - 60);
    expect(hnSince(null, T0)).toBe(T0 / 1000 - 3600);
    for (const seed of [
      (db: P5MemoryDb) => seedKeywords(db),
      (db: P5MemoryDb) => {
        standardSeed(db);
        db.seed('leads', [{ source: 'hackernews', external_id: '40999998', title: 'no date', posted_at: null }]);
      },
      (db: P5MemoryDb) => {
        standardSeed(db);
        db.seed('leads', [{ source: 'reddit', external_id: 'r1', title: 'newer reddit lead', posted_at: '2026-10-08T09:59:00.000Z', source_url: 'https://reddit.com/x' }]);
      },
    ]) {
      const live = await runLive(seed);
      const h = portHarness(seed);
      await runPort(h);
      expect(urls(h.sources)).toEqual(urls(live.sources));
    }
    const h = portHarness((db) => seedKeywords(db));
    await runPort(h);
    expect(h.sources.requests[0].url).toBe(new Request(hnSearchUrl(ALGOLIA_BASE, 'CNC machining', T0 / 1000 - 3600)).url);
  });

  it('request order and shape: 15 terms in the live order, then Show HN', async () => {
    const h = portHarness();
    await runPort(h);
    const since = hnSince(OLDER_LEAD.posted_at, T0);
    expect(urls(h.sources)).toEqual([...HN_SEARCH_TERMS.map((t) => hnSearchUrl(ALGOLIA_BASE, t, since)), hnShowUrl(ALGOLIA_BASE, since)].map((u) => new Request(u).url));
    expect(h.sources.requests[3].url).toContain('query=3D%20printing%20service&tags=story&numericFilters=created_at_i%3E');
    expect(h.sleeps).toEqual(Array(15).fill(200));
  });
});

describe('D-14: a row that already exists never alerts and is not counted', () => {
  const existing: Seed = (db) => {
    standardSeed(db);
    db.seed('leads', [{ source: 'hackernews', external_id: '41000003', title: 'seen before', posted_at: '2026-10-08T07:00:00.000Z', source_url: null }]);
  };

  it('the live function alerts for it again; the port does not', async () => {
    const live = await runLive(existing);
    const h = portHarness(existing);
    const { run } = await runPort(h);
    const isH3 = (t: TelegramWire) => t.body.includes('item?id=41000003');
    expect(live.telegram.filter(isH3)).toHaveLength(1);
    expect(h.telegram.filter(isH3)).toHaveLength(0);
    expect(h.telegram).toEqual(live.telegram.filter((t) => !isH3(t)));
    expect(leadRows(h.db)).toEqual(leadRows(live.db));
    expect(run.output).toMatchObject({ matched: 6, leads_new: 5, high_or_medium: 3 });
  });
});

describe('modes, run states and errors', () => {
  it('shadow: requests and scoring only; nothing written, nothing sent', async () => {
    const h = portHarness();
    h.setFlag('agent.growth.hn', { mode: 'shadow' });
    const before = leadRows(h.db);
    const { run } = await runPort(h);
    expect(urls(h.sources)).toHaveLength(16);
    expect(leadRows(h.db)).toEqual(before);
    expect(h.telegram).toEqual([]);
    expect(h.db.calls.filter((c) => c.method === 'insert')).toEqual([]);
    expect(run.output).toEqual({ scanned: 8, matched: 6, leads_new: 0, high_or_medium: 0, errors: 0, algolia_status: { 200: 15, 500: 1 }, shadow: true });
  });

  it('flag off: skipped {reason: flag_off}, no request', async () => {
    const h = portHarness();
    h.setFlag('agent.growth.hn', { enabled: false });
    const { msg, run } = await runPort(h);
    expect(msg.acked).toBe(1);
    expect(run).toMatchObject({ status: 'skipped', output: { reason: 'flag_off' } });
    expect(h.sources.requests).toEqual([]);
  });

  it('a final run (redelivery) is acked without work; invalid params fail the run', async () => {
    const h = portHarness();
    const runId = await dispatcherRun(h.db, 'growth.hn', `growth.hn:${SLOT}`);
    await closeRun(h.db, runId, { status: 'failed', error: 'x' }, { ...EMPTY_USAGE, by_step: {} });
    const msg = testMessage(scrapeBody('hn-scan', { slot: SLOT }, runId), 2);
    await makeHnScanHandler({ sleep: h.sleep })(msg, h.env, testContext(), h.deps);
    expect(msg.acked).toBe(1);
    expect(h.sources.requests).toEqual([]);

    const h2 = portHarness();
    const bad = await runPort(h2, { slot: '2026-10-08 10:00' });
    expect(bad.run).toMatchObject({ status: 'failed', error: 'invalid_params' });
    expect(h2.sources.requests).toEqual([]);
  });

  it('a network error on a term fails the tick before any write, as live (500); the message is acked', async () => {
    const broken = (s: ScriptedSources) => {
      scriptAlgolia(s);
      s.route({ method: 'GET', match: /query=machine%20shop/, respond: () => Promise.reject(new TypeError('network')) });
    };
    const live = await runLive(standardSeed, broken);
    expect(live.status).toBe(500);
    const h = portHarness(standardSeed, broken);
    const { msg, run } = await runPort(h);
    expect(msg.acked).toBe(1);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('algolia_unreachable');
    expect(leadRows(h.db)).toEqual(leadRows(live.db));
    expect(h.telegram).toEqual([]);
    expect((run.output as { algolia_status: Record<string, number> }).algolia_status).toEqual({ 200: 10, error: 1 });
  });

  it('an unreadable answer fails the tick (algolia_unreadable)', async () => {
    const h = portHarness(standardSeed, (s) => {
      scriptAlgolia(s);
      s.route({ method: 'GET', match: /query=Xometry/, respond: () => new Response('not json', { status: 200 }) });
    });
    const { run } = await runPort(h);
    expect(run).toMatchObject({ status: 'failed', error: 'algolia_unreadable' });
  });

  it('an upsert error is counted and the next hit follows, as live', async () => {
    // the same database failure for one row, under the live function and under the port
    class FailingLeads extends P5MemoryDb {
      override async insert<T extends Row = Row>(table: string, rows: Row | readonly Row[], o?: InsertOptions): Promise<T[]> {
        if (table === 'leads' && (rows as Row).external_id === '41000003') throw new DbError(400, '22P02', 'postgrest POST leads: 400');
        return super.insert<T>(table, rows, o);
      }
    }
    const live = await runLive(standardSeed, (s) => scriptAlgolia(s), () => new FailingLeads({ clock: () => new Date(T0) }));
    expect(live.body).toMatchObject({ errors: 1, newLeads: 5 });

    const h = portHarness();
    const failing = new FailingLeads({ clock: () => new Date(T0) });
    standardSeed(failing);
    const runId = await dispatcherRun(failing, 'growth.hn', `growth.hn:${SLOT}`);
    const msg = testMessage(scrapeBody('hn-scan', { slot: SLOT }, runId));
    await makeHnScanHandler({ sleep: h.sleep })(msg, h.env, testContext(), { ports: { ...h.ports, db: failing }, p5: h.p5 });
    expect(leadRows(failing)).toEqual(leadRows(live.db));
    expect(h.telegram).toEqual(live.telegram);
    expect(runRow(failing, runId).output).toMatchObject({ errors: 1, leads_new: 5, high_or_medium: 3 });
  });
});
