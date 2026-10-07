// The directory-scan consumer (queue "scrapes", envelope DirectoryScanMessage): validation and redelivery, the flag,
// the robots gate before any page fetch, the writes of a permitted scan (company_leads upsert on source,source_url,
// scan_logs, saved_searches) and the retry policy. Runs, flags and scan rows live in MemoryDb / FakeKV; the scraper
// fetch is a routing stub, so nothing reaches a network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRun } from '../../src/agents/runs';
import type { Db, InsertOptions, Row } from '../../src/db/postgrest';
import type { OpsEnv } from '../../src/env';
import { directoryScanConsumer, invalidDirectoryScanReason, sendDirectoryScan, type DirectoryScanConsumerDeps } from '../../src/queues/directory-scan';
import type { DirectoryScanMessage } from '../../src/queues/messages';
import { RETRY_DELAY_SECONDS } from '../../src/queues/scrapes';
import { agentBindings, agentPorts, type AgentTestPorts, type FakeKV } from '../helpers/agent-env';
import { opsEnv, recordingQueue, testContext } from '../helpers/ops';
import { UA, page, routedFetch, savedRobots, testDeps, type TestDeps } from './helpers';

const SEARCH = 'https://www.wlw.de/de/suche/cnc';
const SAVED = '4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d';

interface FakeMessage {
  id: string;
  body: unknown;
  attempts: number;
  acked: boolean;
  retried: { delaySeconds?: number } | null;
  ack(): void;
  retry(o?: { delaySeconds?: number }): void;
}

function message(body: unknown, attempts = 1): FakeMessage {
  const m: FakeMessage = {
    id: 'm1',
    body,
    attempts,
    acked: false,
    retried: null,
    ack() {
      m.acked = true;
    },
    retry(o) {
      m.retried = o ?? {};
    },
  };
  return m;
}

function batchOf(...messages: FakeMessage[]): MessageBatch<DirectoryScanMessage> {
  return { queue: 'scrapes', messages, metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, ackAll() {}, retryAll() {} } as unknown as MessageBatch<DirectoryScanMessage>;
}

/** MemoryDb with the company_leads upsert recorded (MemoryDb has no (source, source_url) key for that table). */
function leadsRecordingDb(db: Db): { db: Db; leads: Array<{ rows: Row[]; o?: InsertOptions }> } {
  const leads: Array<{ rows: Row[]; o?: InsertOptions }> = [];
  const wrapped: Db = {
    select: (t, o) => db.select(t, o),
    update: (t, p, o) => db.update(t, p, o),
    rpc: (n, a) => db.rpc(n, a),
    insert: async (table, rows, o) => {
      if (table !== 'company_leads') return db.insert(table, rows, o);
      const list = (Array.isArray(rows) ? rows : [rows]) as Row[];
      leads.push({ rows: list, o });
      return list.map((_, i) => ({ id: `lead-${leads.length}-${i}` })) as never;
    },
  };
  return { db: wrapped, leads };
}

let ports: AgentTestPorts;
let env: OpsEnv;
let kv: FakeKV;

beforeEach(() => {
  ports = agentPorts();
  ports.clock.set(new Date(Date.UTC(2026, 9, 5, 9, 0, 0)));
  const bindings = agentBindings();
  env = opsEnv({ ...bindings });
  kv = env.FLAGS as unknown as FakeKV;
  kv.setJson('agent.growth.scrapers', { enabled: true, value: {}, updated_at: '2026-10-05T08:00:00Z', rev: 1 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

async function openScan(): Promise<string> {
  const opened = await openRun(ports.db, { agent: 'growth.scrapers', trigger: 'mcp', idempotency_key: `directory-scan:${crypto.randomUUID()}`, tenant_id: env.AGENT_TENANT_ID });
  return opened.run_id;
}

function envelope(runId: string, params: Partial<DirectoryScanMessage['params']> = {}): DirectoryScanMessage {
  return {
    v: 1,
    kind: 'directory-scan',
    params: { url: SEARCH, source: 'wlw', max_pages: 2, enrich_profiles: false, ...params },
    run_id: runId,
    enqueued_at: '2026-10-05T08:59:00.000Z',
    requested_by: 'ADMIN:mcp',
  };
}

function deps(scraper: TestDeps, db: Db = ports.db): DirectoryScanConsumerDeps {
  return { ports: () => ({ ...ports, db }) as never, scraper: () => ({ ...scraper, db }), now: () => ports.clock.now() };
}

const runOf = (id: string) => ports.db.rows('agent_runs').find((r) => r.id === id);

describe('validation and redelivery', () => {
  it('a body that is not a valid envelope is retried without any read', async () => {
    const bad = [
      { ...envelope('x'), run_id: 'not-a-uuid' },
      envelope(crypto.randomUUID(), { max_pages: 11 }),
      envelope(crypto.randomUUID(), { source: 'kompass' as never }),
      envelope(crypto.randomUUID(), { saved_search_id: '12' }),
      envelope(crypto.randomUUID(), { enrich_profiles: 'yes' as never }),
    ];
    for (const body of bad) {
      expect(invalidDirectoryScanReason(body)).not.toBeNull();
      const m = message(body);
      const net = routedFetch({});
      await directoryScanConsumer(batchOf(m), env, testContext(), deps(testDeps(net.fetch)));
      expect(m.retried).toEqual({ delaySeconds: RETRY_DELAY_SECONDS });
      expect(net.requests).toEqual([]);
    }
    expect(ports.db.rows('agent_runs')).toEqual([]);
  });

  it('a missing run is retried; a final run is acknowledged without work', async () => {
    const net = routedFetch({});
    const missing = message(envelope(crypto.randomUUID()));
    await directoryScanConsumer(batchOf(missing), env, testContext(), deps(testDeps(net.fetch)));
    expect(missing.retried).toEqual({ delaySeconds: RETRY_DELAY_SECONDS });

    const runId = await openScan();
    await ports.db.update('agent_runs', { status: 'succeeded', finished_at: '2026-10-05T09:00:00.000Z' }, { filters: [['id', 'eq', runId]] });
    const done = message(envelope(runId));
    await directoryScanConsumer(batchOf(done), env, testContext(), deps(testDeps(net.fetch)));
    expect(done.acked).toBe(true);
    expect(net.requests).toEqual([]);
  });
});

describe('flag, target and robots', () => {
  it('flag agent.growth.scrapers off: the run closes skipped (flag_off) and nothing is fetched', async () => {
    kv.store.delete('agent.growth.scrapers');
    const runId = await openScan();
    const net = routedFetch({});
    const m = message(envelope(runId));
    await directoryScanConsumer(batchOf(m), env, testContext(), deps(testDeps(net.fetch)));
    expect(m.acked).toBe(true);
    expect(runOf(runId)).toMatchObject({ status: 'skipped', error: 'flag_off' });
    expect(net.requests).toEqual([]);
  });

  it('a URL outside the directory hosts closes the run failed (url_not_allowed)', async () => {
    const runId = await openScan();
    const net = routedFetch({});
    const m = message(envelope(runId, { url: 'https://directory.example.com/search?q=laser' }));
    await directoryScanConsumer(batchOf(m), env, testContext(), deps(testDeps(net.fetch)));
    expect(m.acked).toBe(true);
    expect(runOf(runId)).toMatchObject({ status: 'failed', error: 'url_not_allowed' });
    expect(net.requests).toEqual([]);
  });

  it('robots.txt disallows the crawler (saved wlw.de file, no permission): skipped robots_disallowed, only robots.txt fetched', async () => {
    const runId = await openScan();
    const net = routedFetch({ 'https://www.wlw.de/robots.txt': { body: savedRobots('www.wlw.de'), headers: { 'content-type': 'text/plain' } }, [SEARCH]: { body: page('wlw-search-links.html') } });
    const m = message(envelope(runId, { saved_search_id: SAVED }));
    ports.db.seed('saved_searches', [{ id: SAVED, name: 'Austrian CNC', source: 'wlw', search_url: SEARCH }]);
    await directoryScanConsumer(batchOf(m), env, testContext(), deps(testDeps(net.fetch)));
    expect(m.acked).toBe(true);
    expect(net.requests.map((r) => r.url)).toEqual(['https://www.wlw.de/robots.txt']);
    expect(net.requests[0].headers['user-agent']).toBe(UA);
    expect(runOf(runId)).toMatchObject({ status: 'skipped', error: 'robots_disallowed' });
    expect(ports.db.rows('scan_logs')).toEqual([expect.objectContaining({ scan_type: 'directory', status: 'failed', error_message: 'Page 1: robots_disallowed', companies_found: 0 })]);
  });
});

describe('a permitted scan', () => {
  it('pages with the crawler identity and page delay, upserts on source,source_url, logs, marks the saved search, succeeds', async () => {
    const runId = await openScan();
    ports.db.seed('saved_searches', [{ id: SAVED, name: 'Austrian CNC', source: 'wlw', search_url: SEARCH, result_count: 0 }]);
    const net = routedFetch({
      [SEARCH]: { body: page('wlw-search-links.html').replace('</body>', '<a href="/de/suche/cnc/page/2">next</a></body>') },
      [`${SEARCH}/page/2`]: { body: page('wlw-search-links.html') },
    });
    const scraper = testDeps(net.fetch, { permitted: new Map([['www.wlw.de', 'owner-permission-2026-10']]) });
    const { db, leads } = leadsRecordingDb(ports.db);
    const m = message(envelope(runId, { saved_search_id: SAVED }));
    await directoryScanConsumer(batchOf(m), env, testContext(), deps(scraper, db));

    expect(m.acked).toBe(true);
    expect(net.requests.map((r) => r.url)).toEqual([SEARCH, `${SEARCH}/page/2`]);
    expect(net.requests.every((r) => r.headers['user-agent'] === UA)).toBe(true);
    expect(scraper.sleeps).toEqual([4000]);
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.o?.onConflict?.join(',') === 'source,source_url' && l.o?.ignoreDuplicates === false)).toBe(true);
    const stored = leads.reduce((n, l) => n + l.rows.length, 0);
    expect(runOf(runId)).toMatchObject({ status: 'succeeded', output: { source: 'wlw', pages: 2, stored, robots: 'permitted', permission: 'owner-permission-2026-10' } });
    expect(ports.db.rows('scan_logs')).toEqual([expect.objectContaining({ status: 'completed', companies_found: stored, error_message: null, url: SEARCH })]);
    expect(ports.db.rows('saved_searches')[0]).toMatchObject({ result_count: stored, last_run_at: '2026-10-05T09:00:00.000Z' });
  });

  it('a 429 pauses the host: failed host_blocked, scan_logs blocked:<host>', async () => {
    const runId = await openScan();
    const net = routedFetch({ [SEARCH]: { status: 429 } });
    const scraper = testDeps(net.fetch, { permitted: new Map([['www.wlw.de', 'owner-permission-2026-10']]) });
    const m = message(envelope(runId));
    await directoryScanConsumer(batchOf(m), env, testContext(), deps(scraper));
    expect(m.acked).toBe(true);
    expect(runOf(runId)).toMatchObject({ status: 'failed', error: 'host_blocked' });
    expect(ports.db.rows('scan_logs')[0]).toMatchObject({ error_message: 'blocked:www.wlw.de', status: 'failed' });
  });
});

describe('outcomes', () => {
  it('no page read (every page answers 500): failed pages_failed, scan_logs failed', async () => {
    const runId = await openScan();
    const net = routedFetch({ [SEARCH]: { status: 500, body: 'error' }, [`${SEARCH}/page/2`]: { status: 500, body: 'error' } });
    const scraper = testDeps(net.fetch, { permitted: new Map([['www.wlw.de', 'owner-permission-2026-10']]) });
    const m = message(envelope(runId));
    await directoryScanConsumer(batchOf(m), env, testContext(), deps(scraper));
    expect(m.acked).toBe(true);
    expect(runOf(runId)).toMatchObject({ status: 'failed', error: 'pages_failed', output: { pages: 0, errors: 2 } });
    expect(ports.db.rows('scan_logs')).toEqual([expect.objectContaining({ status: 'failed', error_message: 'Page 1: Directory returned HTTP 500' })]);
  });

  it('a profile host that refuses during enrichment: failed host_blocked, the pause recorded in its own scan_logs row', async () => {
    const runId = await openScan();
    const net = routedFetch({ [SEARCH]: { body: page('wlw-search-links.html') }, 'https://www.wlw.com/en/company/example-cnc-service-4711': { status: 403, body: 'Forbidden' } });
    const scraper = testDeps(net.fetch, { permitted: new Map([['www.wlw.de', 'owner-permission-2026-10'], ['www.wlw.com', 'owner-permission-2026-10']]) });
    const { db } = leadsRecordingDb(ports.db);
    const m = message(envelope(runId, { max_pages: 1, enrich_profiles: true }));
    await directoryScanConsumer(batchOf(m), env, testContext(), deps(scraper, db));
    expect(m.acked).toBe(true);
    expect(runOf(runId)).toMatchObject({ status: 'failed', error: 'host_blocked', output: { pages: 1, paused_host: 'www.wlw.com' } });
    expect(ports.db.rows('scan_logs')).toEqual([
      expect.objectContaining({ scan_type: 'directory', status: 'completed', error_message: null }),
      expect.objectContaining({ scan_type: 'profile', status: 'failed', error_message: 'blocked:www.wlw.com', url: 'https://www.wlw.com/en/company/example-cnc-service-4711' }),
    ]);
  });
});

describe('retries', () => {
  it('a thrown error retries after 300 s; on the last attempt the run closes failed (consumer_failed)', async () => {
    const runId = await openScan();
    const throwing: DirectoryScanConsumerDeps = { ...deps(testDeps(routedFetch({}).fetch)), scraper: () => { throw new Error('boom'); } };
    const first = message(envelope(runId), 1);
    await directoryScanConsumer(batchOf(first), env, testContext(), throwing);
    expect(first.retried).toEqual({ delaySeconds: RETRY_DELAY_SECONDS });
    expect(runOf(runId)?.status).toBe('running');
    const last = message(envelope(runId), 4);
    await directoryScanConsumer(batchOf(last), env, testContext(), throwing);
    expect(last.retried).toEqual({ delaySeconds: RETRY_DELAY_SECONDS });
    expect(runOf(runId)).toMatchObject({ status: 'failed', error: 'consumer_failed' });
  });
});

describe('sendDirectoryScan', () => {
  it('sends the v1 envelope with enqueued_at; an oversized message is refused before the send', async () => {
    const q = recordingQueue();
    const e = opsEnv({ SCRAPES: q.binding });
    const runId = crypto.randomUUID();
    await sendDirectoryScan(e, { params: { url: SEARCH, source: 'wlw', max_pages: 5, enrich_profiles: true }, run_id: runId, requested_by: 'ADMIN:mcp' });
    expect(q.sent).toHaveLength(1);
    const body = q.sent[0].body as unknown as DirectoryScanMessage;
    expect(body).toMatchObject({ v: 1, kind: 'directory-scan', run_id: runId, params: { max_pages: 5 } });
    expect(invalidDirectoryScanReason(body)).toBeNull();
    expect(q.sent[0].options).toEqual({ contentType: 'json' });
    await expect(sendDirectoryScan(e, { params: { url: `${SEARCH}?q=${'x'.repeat(130_000)}`, source: 'wlw', max_pages: 1, enrich_profiles: false }, run_id: runId, requested_by: 'ADMIN:mcp' })).rejects.toThrow(/too large/);
    expect(q.sent).toHaveLength(1);
  });
});
