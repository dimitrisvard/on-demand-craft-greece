// growth.scrapers runs opened by the remote MCP tools scan_directory and run_saved_search are always closed: by the
// tool when the queue send fails, by the in-call scan itself when it ends or throws (also after the tool answered,
// under waitUntil), and with the job outcome of scrapers/service.ts otherwise.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '../../src/db/postgrest';
import { HostPauses, type ScraperDeps } from '../../src/scrapers/context';
import { RobotsCache } from '../../src/scrapers/robots';
import { NOW, connectV1, mcpHarness, settle, textOf, type McpHarness } from './helpers';
import { UA, page } from '../scrapers/helpers';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const SEARCH = 'https://www.wlw.de/de/suche/cnc';
const SAVED = '4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d';
const SCRAPERS_ON = { enabled: true, value: {}, updated_at: '2026-10-05T08:00:00Z', rev: 1 };
const WRITES = { enabled: true, value: { writes: true, write_tools: ['scan_directory'] } };

function scraper(h: McpHarness, o: Partial<ScraperDeps>): () => ScraperDeps {
  return () => ({
    fetch: (async () => new Response('', { status: 404 })) as typeof fetch,
    userAgent: UA,
    permitted: new Map([['www.wlw.de', 'owner-permission-2026-10']]),
    browser: null,
    now: () => h.ports.clock.now().getTime(),
    sleep: async () => {},
    robotsCache: new RobotsCache(),
    pauses: new HostPauses(),
    db: h.ports.db,
    log: () => {},
    ...o,
  });
}

/** company_leads writes answered as stored (MemoryDb keeps no (source, source_url) key for that table). */
function acceptLeads(h: McpHarness): void {
  const insert = h.ports.db.insert.bind(h.ports.db);
  h.ports.db.insert = (async (table: string, rows: unknown, o: unknown) => {
    if (table !== 'company_leads') return insert(table, rows as never, o as never);
    return (Array.isArray(rows) ? rows : [rows]).map((_, i) => ({ id: `lead-${i}` }));
  }) as typeof h.ports.db.insert;
}

const scanRuns = (h: McpHarness): Row[] => h.ports.db.rows('agent_runs').filter((r) => r.agent === 'growth.scrapers');

async function setUp(o: { env?: Record<string, unknown> } = {}): Promise<McpHarness> {
  const h = await mcpHarness({ flag: WRITES, env: o.env as never });
  h.kv.setJson('agent.growth.scrapers', SCRAPERS_ON);
  return h;
}

describe('scan_directory in the call', () => {
  it('a company_leads write that throws: error answer, the run closes failed (scan_failed)', async () => {
    const h = await setUp();
    h.deps.scraper = scraper(h, { fetch: (async () => new Response(page('wlw-search-links.html'), { headers: { 'content-type': 'text/html' } })) as typeof fetch });
    const insert = h.ports.db.insert.bind(h.ports.db);
    h.ports.db.insert = (async (table: string, rows: unknown, o: unknown) => {
      if (table === 'company_leads') throw Object.assign(new Error('PostgREST 503'), { code: 'PGRST000' });
      return insert(table, rows as never, o as never);
    }) as typeof h.ports.db.insert;
    const client = await connectV1(h, await h.token());
    const result = await client.callTool({ name: 'scan_directory', arguments: { url: SEARCH, maxPages: 1 } });
    expect(result.isError).toBe(true);
    const [run] = scanRuns(h);
    expect(textOf(result)).toContain(`the directory scan failed (run_id ${run.id}): PostgREST 503`);
    expect(run).toMatchObject({ status: 'failed', error: 'scan_failed', output: { source: 'wlw' } });
    expect(run.finished_at).toBeTruthy();
    await client.close();
  });

  it('Browser Run that throws on a permitted client-rendered page: the run closes failed (scan_failed)', async () => {
    const h = await setUp();
    h.deps.scraper = scraper(h, {
      fetch: (async () => new Response(page('spa-shell.html'), { headers: { 'content-type': 'text/html' } })) as typeof fetch,
      browser: { render: async () => { throw new Error('Navigation timeout of 20000 ms exceeded'); } },
    });
    const client = await connectV1(h, await h.token());
    const result = await client.callTool({ name: 'scan_directory', arguments: { url: SEARCH, maxPages: 1 } });
    expect(result.isError).toBe(true);
    expect(scanRuns(h)).toEqual([expect.objectContaining({ status: 'failed', error: 'scan_failed' })]);
    await client.close();
  });

  it('every page fails: the run closes failed (pages_failed) and the answer is an error', async () => {
    const h = await setUp();
    h.deps.scraper = scraper(h, { fetch: (async () => new Response('error', { status: 500, headers: { 'content-type': 'text/html' } })) as typeof fetch });
    const client = await connectV1(h, await h.token());
    const result = await client.callTool({ name: 'scan_directory', arguments: { url: SEARCH, maxPages: 2 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Directory scan failed: no page could be read/);
    expect(scanRuns(h)).toEqual([expect.objectContaining({ status: 'failed', error: 'pages_failed', output: expect.objectContaining({ pages: 0, errors: 2 }) })]);
    expect(h.ports.db.rows('scan_logs')).toEqual([expect.objectContaining({ status: 'failed', error_message: 'Page 1: Directory returned HTTP 500' })]);
    await client.close();
  });

  it('a scan longer than the wait: the tool answers that it continues, the scan runs under waitUntil and closes its run', async () => {
    const h = await setUp();
    acceptLeads(h);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    h.deps.scraper = scraper(h, {
      fetch: (async () => {
        await held;
        return new Response(page('wlw-search-links.html'), { headers: { 'content-type': 'text/html' } });
      }) as typeof fetch,
    });
    // The tool's wait for the in-call scan ends at once; the page answers later.
    h.deps.sleep = async () => {};
    const client = await connectV1(h, await h.token());
    const result = await client.callTool({ name: 'scan_directory', arguments: { url: SEARCH, maxPages: 1 } });
    expect(result.isError).toBeFalsy();
    const [running] = scanRuns(h);
    expect(textOf(result)).toBe(`Directory scan still running in the background (run_id ${running.id}): WLW, up to 1 pages. The companies appear in get_companies when the run ends.`);
    expect(running.status).toBe('running');
    expect(h.ctx.pending.length).toBeGreaterThan(0);
    release();
    await settle(h);
    expect(scanRuns(h)).toEqual([expect.objectContaining({ id: running.id, status: 'succeeded', output: expect.objectContaining({ pages: 1, stored: 4 }) })]);
    expect(h.ports.db.rows('scan_logs')).toEqual([expect.objectContaining({ status: 'completed', url: SEARCH })]);
    await client.close();
  });

  it('the in-call scan gets a deadline 35 s after its start (no page starts past it)', async () => {
    const h = await setUp();
    acceptLeads(h);
    const pageTimes: number[] = [];
    let now = NOW.getTime();
    const next = page('wlw-search-links.html').replace('</body>', '<a href="/de/suche/cnc/page/2">next</a><a href="/de/suche/cnc/page/3">3</a></body>');
    h.deps.scraper = scraper(h, {
      now: () => now,
      sleep: async (ms) => { now += ms; },
      fetch: (async () => {
        pageTimes.push(now);
        now += 10_000;
        return new Response(next, { headers: { 'content-type': 'text/html' } });
      }) as typeof fetch,
    });
    const client = await connectV1(h, await h.token());
    const result = await client.callTool({ name: 'scan_directory', arguments: { url: SEARCH, maxPages: 3 } });
    expect(textOf(result)).toContain('Pages scanned: 2 of up to 3');
    expect(textOf(result)).toContain('Stopped at the time budget of the call');
    expect(pageTimes.map((t) => t - NOW.getTime())).toEqual([0, 14_000]);
    expect(scanRuns(h)).toEqual([expect.objectContaining({ status: 'succeeded', output: expect.objectContaining({ pages: 2, stopped: 'deadline' }) })]);
    await client.close();
  });
});

describe('queued scans', () => {
  const failingQueue = () => ({ send: async () => { throw new Error('Queue send failed: 503'); }, sendBatch: async () => {} }) as unknown as Queue;

  it('scan_directory above 3 pages: a failed queue send closes the run failed (send_failed)', async () => {
    const h = await setUp({ env: { SCRAPES: failingQueue() } });
    const client = await connectV1(h, await h.token());
    const result = await client.callTool({ name: 'scan_directory', arguments: { url: 'https://www.europages.de/companies/germany/cnc.html', maxPages: 8 } });
    expect(result.isError).toBe(true);
    const [run] = scanRuns(h);
    expect(textOf(result)).toBe(`Error: the scan could not be queued (run_id ${run.id}); try again later`);
    expect(run).toMatchObject({ status: 'failed', error: 'send_failed', output: { source: 'europages' } });
    expect(run.finished_at).toBeTruthy();
    await client.close();
  });

  it('run_saved_search: a failed queue send closes the run failed (send_failed)', async () => {
    const h = await mcpHarness({
      flag: { enabled: true, value: { writes: true } },
      env: { SCRAPES: failingQueue() } as never,
      sbRoute: ({ table, headers }) => (table === 'saved_searches' && (headers.get('accept') ?? '').includes('vnd.pgrst.object') ? { body: { id: SAVED, name: 'Austrian CNC', source: 'wlw', search_url: 'https://www.wlw.at/de/suche/cnc' } } : undefined),
    });
    h.kv.setJson('agent.growth.scrapers', SCRAPERS_ON);
    const client = await connectV1(h, await h.token());
    const result = await client.callTool({ name: 'run_saved_search', arguments: { saved_search_id: SAVED } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('the saved search could not be queued');
    expect(scanRuns(h)).toEqual([expect.objectContaining({ status: 'failed', error: 'send_failed', subject_id: SAVED })]);
    await client.close();
  });
});
