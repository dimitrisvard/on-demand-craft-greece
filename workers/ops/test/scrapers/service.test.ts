// Directory scan jobs (scrapers/service.ts): profile enrichment (only found fields, at most 20 profiles, one at a
// time with the directory's page delay and Crawl-delay, stop at a robots refusal or a host pause), the pause of a
// profile host kept in scan_logs so every isolate sees it, and the run outcome of a job.

import { describe, expect, it } from 'vitest';
import type { Db, Filter, Row } from '../../src/db/postgrest';
import type { BrowserPort } from '../../src/ports/index';
import { HostPauses, HOST_PAUSE_MS } from '../../src/scrapers/context';
import { scanDirectoryPage, type DirectoryScanResult } from '../../src/scrapers/directory';
import { scrapeProfile } from '../../src/scrapers/profile';
import { directoryJobOutcome, ENRICH_MAX, runDirectoryJob } from '../../src/scrapers/service';
import { MemoryDb } from '../helpers/memory-db';
import { page, routedFetch, testDeps, type Route, type TestDeps } from './helpers';

const SEARCH = 'https://www.wlw.de/de/suche/cnc';
const PROFILE_HOST = 'https://www.wlw.com';
const BOTH = new Map([['www.wlw.de', 'owner-permission-2026-10'], ['www.wlw.com', 'owner-permission-2026-10']]);
const PROFILE_FIELDS = ['website_url', 'phone', 'email', 'description', 'employee_count', 'country', 'city', 'full_address', 'industry_tags', 'certifications', 'contact_persons', 'company_name'];

interface Recorded {
  db: Db;
  base: MemoryDb;
  updates: Array<{ patch: Row; filters: readonly Filter[] }>;
}

/** MemoryDb for scan_logs and saved searches; company_leads writes recorded (no (source, source_url) key there). */
function recordingDb(base = new MemoryDb()): Recorded {
  const updates: Recorded['updates'] = [];
  const db: Db = {
    select: (t, o) => base.select(t, o),
    rpc: (n, a) => base.rpc(n, a),
    insert: async (table, rows, o) => {
      if (table !== 'company_leads') return base.insert(table, rows, o);
      return (Array.isArray(rows) ? rows : [rows]).map((_, i) => ({ id: `lead-${i}` })) as never;
    },
    update: async (table, patch, o) => {
      if (table !== 'company_leads') return base.update(table, patch, o);
      updates.push({ patch: patch as Row, filters: o.filters ?? [] });
      return [] as never;
    },
  };
  return { db, base, updates };
}

/** Every www.wlw.com profile answers `route`; robots.txt files as given; the search page as given. */
function net(o: { search?: string; profile?: Route; robots?: Record<string, string> }) {
  const robots = Object.fromEntries(Object.entries(o.robots ?? {}).map(([host, body]) => [`https://${host}/robots.txt`, { body, headers: { 'content-type': 'text/plain' } }]));
  const profile = o.profile ?? { body: page('wlw-profile-fallback.html') };
  return routedFetch(new Proxy({ ...robots, [SEARCH]: { body: o.search ?? page('wlw-search-links.html') } } as Record<string, Route>, {
    get: (routes, key: string) => (key in routes ? routes[key] : key.startsWith(`${PROFILE_HOST}/`) ? profile : undefined),
    has: (routes, key: string) => key in routes || key.startsWith(`${PROFILE_HOST}/`),
  }) as never);
}

const profileRequests = (requests: Array<{ url: string }>) => requests.map((r) => r.url).filter((u) => u.startsWith(`${PROFILE_HOST}/`) && !u.endsWith('/robots.txt'));

async function job(deps: TestDeps, db: Db, enrich = true) {
  return runDirectoryJob(deps, db, { url: SEARCH, source: 'wlw', maxPages: 1, enrichProfiles: enrich }, () => new Date(deps.now()));
}

describe('profile enrichment', () => {
  it('writes only the fields a profile found, one profile at a time with the directory page delay', async () => {
    const { fetch, requests } = net({});
    const deps = testDeps(fetch, { permitted: BOTH });
    const rec = recordingDb();
    const result = await job(deps, rec.db);
    expect(result.result.companies).toHaveLength(4);
    expect(result.enriched).toBe(4);
    expect(profileRequests(requests)).toEqual(result.result.companies.map((c) => c.source_url));
    expect(deps.sleeps).toEqual([4000, 4000, 4000]);
    expect(rec.updates).toHaveLength(4);
    for (const [i, u] of rec.updates.entries()) {
      expect(u.filters).toEqual([['source', 'eq', 'wlw'], ['source_url', 'eq', result.result.companies[i].source_url]]);
      expect(Object.keys(u.patch).every((k) => PROFILE_FIELDS.includes(k))).toBe(true);
      expect(Object.values(u.patch).every((v) => v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))).toBe(true);
      expect(u.patch).toMatchObject({ website_url: 'https://www.muster-kunststoff.example', phone: '+49 30 0000000' });
    }
    expect(result.paused).toBeNull();
    expect(directoryJobOutcome(result)).toEqual({ status: 'succeeded' });
  });

  it('without enrichProfiles no profile is fetched', async () => {
    const { fetch, requests } = net({});
    const result = await job(testDeps(fetch, { permitted: BOTH }), recordingDb().db, false);
    expect(result.enriched).toBe(0);
    expect(profileRequests(requests)).toEqual([]);
  });

  it('waits the robots.txt Crawl-delay of the directory between profiles when it is longer', async () => {
    const { fetch } = net({ robots: { 'www.wlw.de': 'User-agent: MicronsHubBot\nAllow: /\nCrawl-delay: 6\n', 'www.wlw.com': 'User-agent: *\nAllow: /\n' } });
    const deps = testDeps(fetch);
    const result = await job(deps, recordingDb().db);
    expect(result.enriched).toBe(4);
    expect(deps.sleeps).toEqual([6000, 6000, 6000]);
  });

  it(`at most ${ENRICH_MAX} profiles per job`, async () => {
    const links = Array.from({ length: 25 }, (_, i) => `<a href="/en/company/example-firm-${i + 1}">Firm ${i + 1}</a>`).join('\n');
    const { fetch, requests } = net({ search: `<!doctype html><html><body>${links}</body></html>` });
    const deps = testDeps(fetch, { permitted: BOTH });
    const result = await job(deps, recordingDb().db);
    expect(result.result.companies).toHaveLength(25);
    expect(profileRequests(requests)).toHaveLength(ENRICH_MAX);
    expect(result.enriched).toBe(ENRICH_MAX);
  });

  it('a robots refusal of the profile host ends enrichment: no profile fetched, no further wait', async () => {
    const { fetch, requests } = net({ robots: { 'www.wlw.com': 'User-agent: *\nDisallow: /\n' } });
    const deps = testDeps(fetch, { permitted: new Map([['www.wlw.de', 'owner-permission-2026-10']]) });
    const result = await job(deps, recordingDb().db);
    expect(result.enriched).toBe(0);
    expect(profileRequests(requests)).toEqual([]);
    expect(requests.filter((r) => r.url === `${PROFILE_HOST}/robots.txt`)).toHaveLength(1);
    expect(deps.sleeps).toEqual([]);
    expect(result.paused).toBeNull();
    expect(directoryJobOutcome(result)).toEqual({ status: 'succeeded' });
  });

  it('a refusal (403) ends enrichment and pauses the host for every isolate: no fetch and no Browser Run there', async () => {
    const shared = new MemoryDb();
    const a = net({ profile: { status: 403, body: 'Forbidden' } });
    const isolateA = testDeps(a.fetch, { permitted: BOTH, db: shared });
    const rec = recordingDb(shared);
    const result = await job(isolateA, rec.db);
    expect(profileRequests(a.requests)).toHaveLength(1);
    expect(isolateA.sleeps).toEqual([]);
    expect(result).toMatchObject({ enriched: 0, paused: 'www.wlw.com' });
    expect(directoryJobOutcome(result)).toEqual({ status: 'failed', error: 'host_blocked' });
    expect(shared.rows('scan_logs')).toEqual([
      expect.objectContaining({ scan_type: 'directory', status: 'completed', error_message: null }),
      expect.objectContaining({ scan_type: 'profile', status: 'failed', error_message: 'blocked:www.wlw.com', url: profileRequests(a.requests)[0] }),
    ]);

    // Another isolate one hour later: its own pauses are empty, the database is the same.
    const target = `${PROFILE_HOST}/de/suche/cnc`;
    const b = routedFetch({ [target]: { body: page('spa-shell.html') }, [`${PROFILE_HOST}/en/company/x-1`]: { body: page('wlw-profile-fallback.html') } });
    const renders: string[] = [];
    const browser: BrowserPort = { render: async (u) => { renders.push(u); return { status: 200, html: page('spa-rendered.html') }; } };
    const later = isolateA.now() + 3_600_000;
    const isolateB = testDeps(b.fetch, { permitted: BOTH, db: shared, pauses: new HostPauses(), browser, now: () => later });
    expect(await scanDirectoryPage(isolateB, { url: target, source: 'wlw' })).toMatchObject({ ok: false, status: 429, body: { error: 'host_blocked', retryAfter: (HOST_PAUSE_MS - 3_600_000) / 1000 } });
    expect(await scrapeProfile(isolateB, { url: `${PROFILE_HOST}/en/company/x-1`, source: 'wlw' })).toMatchObject({ ok: false, status: 429, body: { error: 'host_blocked' } });
    expect(b.requests).toEqual([]);
    expect(renders).toEqual([]);
  });
});

describe('job outcome', () => {
  const result = (o: Partial<DirectoryScanResult>): DirectoryScanResult => ({ source: 'wlw', keyword: 'cnc', country: '', pages: 0, companies: [], errors: [], paused: null, robots: null, stopped: 'limit', ...o });

  it('paused host -> failed host_blocked; robots before any page -> skipped; no page and errors -> failed pages_failed; else succeeded', () => {
    expect(directoryJobOutcome({ result: result({ pages: 1, stopped: 'paused', paused: 'www.wlw.de' }), paused: 'www.wlw.de' })).toEqual({ status: 'failed', error: 'host_blocked' });
    expect(directoryJobOutcome({ result: result({ pages: 2 }), paused: 'www.wlw.com' })).toEqual({ status: 'failed', error: 'host_blocked' });
    expect(directoryJobOutcome({ result: result({ stopped: 'robots', errors: ['Page 1: robots_disallowed'] }), paused: null })).toEqual({ status: 'skipped', error: 'robots_disallowed' });
    expect(directoryJobOutcome({ result: result({ errors: ['Page 1: Directory returned HTTP 500'] }), paused: null })).toEqual({ status: 'failed', error: 'pages_failed' });
    expect(directoryJobOutcome({ result: result({ pages: 1, stopped: 'robots', errors: ['Page 2: robots_disallowed'] }), paused: null })).toEqual({ status: 'succeeded' });
    expect(directoryJobOutcome({ result: result({ pages: 1, stopped: 'empty' }), paused: null })).toEqual({ status: 'succeeded' });
    expect(directoryJobOutcome({ result: result({ stopped: 'deadline' }), paused: null })).toEqual({ status: 'succeeded' });
  });
});
