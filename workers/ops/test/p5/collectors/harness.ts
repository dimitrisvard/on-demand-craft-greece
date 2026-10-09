// T1 harness of the scheduled collectors (unit G5): OpsEnv with the Phase 4 fakes, P5MemoryDb (leads unique keys),
// the Phase 4 test ports with a fixed clock, scripted sources on the production bases (so the port and the live
// oracle request the same URLs), and the production telegramText adapter over a recording fetch, so the
// sendMessage request bodies can be compared byte for byte. Synthetic data only (test/fixtures/collectors/).

import { openRun, type AgentKey } from '../../../src/agents/runs';
import type { OpsEnv } from '../../../src/env';
import type { Row } from '../../../src/db/postgrest';
import { makeP5Ports } from '../../../src/ports/p5';
import { makeTestP5Ports, P5MemoryDb, ScriptedSources, type TestP5Ports } from '../../../src/ports/p5-stub/index';
import type { P5ScrapeKind, P5ScrapeMessage } from '../../../src/queues/messages';
import { agentBindings, agentPorts, FakeClock, FakeKV, type AgentTestPorts } from '../../helpers/agent-env';
import { opsEnv } from '../../helpers/ops';
import { fixture, type AlgoliaFixture, type FixtureKeyword, type PullpushFixture } from './fixtures';

export { fixture, type AlgoliaFixture, type FixtureKeyword, type PullpushFixture } from './fixtures';

/** 2026-10-08 10:00 UTC: every collector's slot (reddit t1-t3 and hn are due at minute 0). */
export const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
export const SLOT = '2026-10-08T10:00Z';
export const DATE = '2026-10-08';
export const PULLPUSH_BASE = 'https://api.pullpush.io';
export const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

export interface TelegramWire {
  url: string;
  body: string;
}

export interface CollectorHarness {
  env: OpsEnv;
  ports: AgentTestPorts & { db: P5MemoryDb };
  p5: TestP5Ports;
  db: P5MemoryDb;
  clock: FakeClock;
  flags: FakeKV;
  sources: ScriptedSources;
  /** sendMessage requests of the production telegramText adapter, in order. */
  telegram: TelegramWire[];
  /** The texts of those requests. */
  alerts(): string[];
  /** Every pause a handler asked for (ms). */
  sleeps: number[];
  sleep(ms: number): Promise<void>;
  deps: { ports: AgentTestPorts & { db: P5MemoryDb }; p5: TestP5Ports };
  setFlag(key: 'agent.growth.reddit' | 'agent.growth.hn' | 'agent.growth.tenders', f: { enabled?: boolean; mode?: 'shadow' | 'assist' | 'auto'; value?: Record<string, unknown> } | null): void;
}

export function collectorHarness(o: { now?: number; env?: Partial<OpsEnv> } = {}): CollectorHarness {
  const clock = new FakeClock(o.now ?? T0);
  const db = new P5MemoryDb({ clock: () => clock.now() });
  const ports = agentPorts({ db, clock }) as AgentTestPorts & { db: P5MemoryDb };
  const flags = new FakeKV();
  const env = opsEnv({ ...agentBindings({ FLAGS: flags as unknown as KVNamespace }), ...o.env });
  const telegram: TelegramWire[] = [];
  const telegramFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    telegram.push({ url: String(input instanceof Request ? input.url : input), body: String(init?.body ?? '') });
    return new Response(JSON.stringify({ ok: true, result: { message_id: telegram.length } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const sources = new ScriptedSources({ bases: { pullpush: PULLPUSH_BASE, hn: ALGOLIA_BASE } });
  const p5 = makeTestP5Ports({ sources, telegramText: makeP5Ports(env, { fetch: telegramFetch }).telegramText as TestP5Ports['telegramText'] });
  const sleeps: number[] = [];
  const h: CollectorHarness = {
    env,
    ports,
    p5,
    db,
    clock,
    flags,
    sources,
    telegram,
    alerts: () => telegram.map((t) => (JSON.parse(t.body) as { text: string }).text),
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    deps: { ports, p5 },
    setFlag(key, f) {
      if (f === null) {
        flags.store.delete(key);
        return;
      }
      const mode = f.mode ?? 'assist';
      flags.setJson(key, { enabled: f.enabled ?? true, mode, value: { mode, ...f.value } });
    },
  };
  return h;
}

/** Seeds the active (and one inactive) keywords of the fixture. */
export function seedKeywords(db: P5MemoryDb): FixtureKeyword[] {
  const keywords = fixture<FixtureKeyword[]>('keywords.json');
  db.seed('lead_keywords', keywords.map((k, i) => ({ id: i + 1, ...k })));
  return keywords;
}

/** monitored_subreddits rows relative to T0 (minutes since the last scan; null = never). */
export function subredditRow(subreddit: string, tier: number, lastScanMinAgo: number | null, o: { interval?: number | null; active?: boolean; source?: string; now?: number } = {}): Row {
  const now = o.now ?? T0;
  return {
    subreddit,
    source: o.source ?? 'reddit',
    tier,
    scan_interval_minutes: o.interval === undefined ? 30 : o.interval,
    is_active: o.active ?? true,
    last_scanned_at: lastScanMinAgo === null ? null : new Date(now - lastScanMinAgo * 60_000).toISOString(),
    last_post_id: null,
  };
}

/** The standard subreddit seed: tier 1 machining (never), cnc (45 min, due), fresh1 (5 min, not due); tier 2
 *  engineering (never; PullPush answers 503), slow2 (45 min of 60, not due); tier 3 hardware (95 min, interval null
 *  -> 30, due); tier 4 tier4 (never); inactive1 (tier 1, inactive); forum1 (tier 1, source forum). */
export function seedSubreddits(db: P5MemoryDb): void {
  db.seed('monitored_subreddits', [
    subredditRow('machining', 1, null),
    subredditRow('cnc', 1, 45),
    subredditRow('fresh1', 1, 5),
    subredditRow('engineering', 2, null),
    subredditRow('slow2', 2, 45, { interval: 60 }),
    subredditRow('hardware', 3, 95, { interval: null }),
    subredditRow('tier4', 4, null),
    subredditRow('inactive1', 1, null, { active: false }),
    subredditRow('forum1', 1, null, { source: 'forum' }),
  ].map((r, i) => ({ id: i + 1, ...r })));
}

/** Scripts PullPush from the fixture (by the subreddit query parameter; others answer {data: []}). */
export function scriptPullpush(sources: ScriptedSources, data: PullpushFixture = fixture<PullpushFixture>('pullpush.json')): void {
  sources.route({
    method: 'GET',
    match: `${PULLPUSH_BASE}/reddit/search/submission?`,
    respond: (req) => {
      const sub = new URL(req.url).searchParams.get('subreddit') ?? '';
      const entry = data[sub] ?? {};
      if (entry.status && entry.status !== 200) return new Response(JSON.stringify({ error: 'scripted' }), { status: entry.status, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ data: entry.posts ?? [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
}

/** Scripts Algolia from the fixture (by query, or tags=show_hn; others answer {hits: []}). */
export function scriptAlgolia(sources: ScriptedSources, data: AlgoliaFixture = fixture<AlgoliaFixture>('algolia.json')): void {
  sources.route({
    method: 'GET',
    match: `${ALGOLIA_BASE}/search_by_date?`,
    respond: (req) => {
      const url = new URL(req.url);
      const query = url.searchParams.get('query');
      const entry = query === null && url.searchParams.get('tags') === 'show_hn' ? data.show_hn : (data.queries[query ?? ''] ?? {});
      if (entry.status && entry.status !== 200) return new Response(JSON.stringify({ message: 'scripted' }), { status: entry.status, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ hits: entry.hits ?? [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
}

/** Opens the run the dispatcher would open; returns its id. */
export async function dispatcherRun(db: P5MemoryDb, agent: AgentKey, key: string): Promise<string> {
  return (await openRun(db, { agent, trigger: 'cron', idempotency_key: key })).run_id;
}

export function scrapeBody(kind: P5ScrapeKind, params: P5ScrapeMessage['params'], runId: string): P5ScrapeMessage {
  return { v: 1, kind, params, run_id: runId, enqueued_at: new Date(T0).toISOString(), requested_by: 'schedule' };
}

export interface TestMessage<B = P5ScrapeMessage> {
  id: string;
  timestamp: Date;
  body: B;
  attempts: number;
  acked: number;
  retried: Array<{ delaySeconds?: number } | undefined>;
  ack(): void;
  retry(o?: { delaySeconds?: number }): void;
}

/** A queue message that records ack() and retry(). */
export function testMessage<B = P5ScrapeMessage>(body: B, attempts = 1): TestMessage<B> & Message<B> {
  const m: TestMessage<B> = {
    id: `msg-${attempts}`,
    timestamp: new Date(T0),
    body,
    attempts,
    acked: 0,
    retried: [],
    ack() {
      m.acked++;
    },
    retry(o) {
      m.retried.push(o);
    },
  };
  return m as TestMessage<B> & Message<B>;
}

/** The run row of an id. */
export function runRow(db: P5MemoryDb, id: string): Row {
  const row = db.rows('agent_runs', ['id', 'eq', id])[0];
  if (!row) throw new Error(`no run ${id}`);
  return row;
}

/** Lead rows without the generated columns (id, created_at), for comparisons. */
export function leadRows(db: P5MemoryDb): Row[] {
  return db.rows('leads').map(({ id: _id, created_at: _c, ...rest }) => rest);
}
