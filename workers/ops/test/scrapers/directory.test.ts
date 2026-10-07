// Directory scans: the ported parsers give byte-equal JSON to the Vercel handler (api/scan-directory.js, run
// through the Phase 2 shim with a fetch stub on the same synthetic HTML), and the module path follows its rules:
// robots gate before any page fetch, crawler identity, host pause after a refusal, page delays, browser rendering
// only for permitted client-rendered pages.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNodeHandler, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import { BrowserBudget } from '../../src/scrapers/browser';
import { HOST_PAUSE_MS, pauseMarker } from '../../src/scrapers/context';
import { needsClientRendering, scanDirectory, scanDirectoryPage, UNKNOWN_SOURCE_MESSAGE } from '../../src/scrapers/directory';
import { buildPageUrl, directoryPageBody, extractSearchMeta } from '../../src/scrapers/parsers/directory';
import type { BrowserPort } from '../../src/ports/index';
import { MemoryDb } from '../helpers/memory-db';
import { UA, page, routedFetch, savedRobots, testDeps, type TestDeps } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The Vercel handler's answer for POST {url, source} when the page fetch answers `html` (status 200, text/html). */
async function handlerAnswer(url: string, source: string | undefined, html: string, init: { status?: number; contentType?: string } = {}): Promise<{ status: number; body: string }> {
  const fetched: string[] = [];
  vi.stubGlobal('fetch', (async (target: string) => {
    fetched.push(target);
    return new Response(html, { status: init.status ?? 200, headers: { 'content-type': init.contentType ?? 'text/html; charset=utf-8' } });
  }) as typeof fetch);
  const handler = (await import('../../../../api/scan-directory.js')).default as VercelHandler;
  const body = new TextEncoder().encode(JSON.stringify(source === undefined ? { url } : { url, source }));
  const request = new Request('https://ops.internal/api/scan-directory', { method: 'POST', headers: { 'content-type': 'application/json' } });
  const response = await runNodeHandler(handler, { request, functionUrl: '/api/scan-directory', body, logPrefix: '[microns-ops]' });
  vi.unstubAllGlobals();
  expect(fetched).toEqual([url]);
  return { status: response.status, body: await response.text() };
}

const CASES: Array<{ name: string; url: string; source?: string; fixture: string }> = [
  { name: 'Europages JSON-LD item list, next page', url: 'https://www.europages.co.uk/companies/germany/robotics.html', source: 'europages', fixture: 'europages-search-jsonld.html' },
  { name: 'Europages links and cards, auto source', url: 'https://www.europages.co.uk/companies/germany/steel%20works/p-1.html', source: 'auto', fixture: 'europages-search-links.html' },
  { name: 'Europages page 2 without a next page', url: 'https://www.europages.de/companies/cnc/p-2.html', fixture: 'europages-search-jsonld.html' },
  { name: 'wlw __NEXT_DATA__', url: 'https://www.wlw.com/en/search/cnc-turning/country/austria', source: 'wlw', fixture: 'wlw-search-nextdata.html' },
  { name: 'wlw JSON-LD', url: 'https://www.wlw.de/de/suche/schweissen', source: 'wlw', fixture: 'wlw-search-jsonld.html' },
  { name: 'wlw profile links, page 3', url: 'https://www.wlw.at/de/suche/cnc/page/3', fixture: 'wlw-search-links.html' },
  { name: 'empty page', url: 'https://www.wlw.de/de/suche/nothing', source: 'wlw', fixture: 'spa-shell.html' },
];

describe('parser parity with api/scan-directory.js (byte-equal JSON)', () => {
  it.each(CASES)('$name', async ({ url, source, fixture }) => {
    const html = page(fixture);
    const theirs = await handlerAnswer(url, source, html);
    expect(theirs.status).toBe(200);
    const detected = source && source !== 'auto' ? source : url.includes('europages.') ? 'europages' : 'wlw';
    const ours = JSON.stringify(directoryPageBody(html, url, detected, extractSearchMeta(url, detected)));
    expect(ours).toBe(theirs.body);

    // The module path (host permitted, so no robots.txt fetch) answers the same bytes.
    const host = new URL(url).hostname;
    const { fetch } = routedFetch({ [url]: { body: html } });
    const deps = testDeps(fetch, { permitted: new Map([[host, 'test permission']]) });
    const scan = await scanDirectoryPage(deps, { url, source });
    expect(scan.ok).toBe(true);
    expect(JSON.stringify(scan.body)).toBe(theirs.body);
  });

  it('the parsed fixtures are not trivial (companies, metadata, next page)', () => {
    const body = directoryPageBody(page('europages-search-jsonld.html'), CASES[0].url, 'europages', extractSearchMeta(CASES[0].url, 'europages'));
    expect(body.companiesFound).toBe(3);
    expect(body.hasNextPage).toBe(true);
    expect(body.keyword).toBe('robotics');
    expect(body.country).toBe('germany');
    expect(body.companies[0].company_name).toBe('Example Metallbau & Co. GmbH');
    const wlw = directoryPageBody(page('wlw-search-nextdata.html'), CASES[3].url, 'wlw', extractSearchMeta(CASES[3].url, 'wlw'));
    expect(wlw.companies.map((c) => c.source_url)).toEqual([
      'https://www.wlw.com/en/company/beispiel-drehteile-ag-123',
      'https://www.wlw.com/en/company/m-77',
      'https://www.wlw.de/de/firma/sample-blechtechnik',
    ]);
    expect(wlw.hasNextPage).toBe(true);
    const links = directoryPageBody(page('europages-search-links.html'), CASES[1].url, 'europages', { keyword: '', country: '' });
    expect(links.companies.map((c) => c.source_url)).toEqual([
      'https://www.europages.co.uk/EXAMPLE-STAHLBAU-GMBH/00000010-1.html',
      'https://www.europages.de/BEISPIEL-FRAESTECHNIK/00000011.html',
      'https://www.europages.co.uk/SAMPLE-LASER-WORKS-LTD/00000012-7.html',
      'https://www.europages.co.uk/CARD-ONLY-COMPANY/00000013.html',
    ]);
  });

  it('error answers keep the handler shapes', async () => {
    const theirs = await handlerAnswer('https://www.europages.de/x.html', 'europages', '<html></html>', { status: 500 });
    expect(theirs).toEqual({ status: 502, body: JSON.stringify({ error: 'Directory returned HTTP 500' }) });
    const { fetch } = routedFetch({ 'https://www.europages.de/x.html': { status: 500 } });
    const scan = await scanDirectoryPage(testDeps(fetch, { permitted: new Map([['www.europages.de', 'p']]) }), { url: 'https://www.europages.de/x.html', source: 'europages' });
    expect({ status: scan.status, body: JSON.stringify(scan.body) }).toEqual(theirs);

    const nonHtml = await handlerAnswer('https://www.europages.de/y.html', 'europages', '{}', { contentType: 'application/json' });
    const json = routedFetch({ 'https://www.europages.de/y.html': { body: '{}', headers: { 'content-type': 'application/json' } } });
    const scan2 = await scanDirectoryPage(testDeps(json.fetch, { permitted: new Map([['www.europages.de', 'p']]) }), { url: 'https://www.europages.de/y.html', source: 'europages' });
    expect({ status: scan2.status, body: JSON.stringify(scan2.body) }).toEqual(nonHtml);

    const deps = testDeps(routedFetch({}).fetch);
    expect(await scanDirectoryPage(deps, { url: '' })).toMatchObject({ status: 400, body: { error: 'url is required' } });
    expect(await scanDirectoryPage(deps, { url: 'https://example.com/x' })).toMatchObject({ status: 400, body: { error: UNKNOWN_SOURCE_MESSAGE } });
  });
});

describe('module rules', () => {
  const url = 'https://www.wlw.de/de/suche/cnc';
  const robotsUrl = 'https://www.wlw.de/robots.txt';

  it('robots disallowed: 403 robots_disallowed and the page is never fetched', async () => {
    const { fetch, requests } = routedFetch({ [robotsUrl]: { body: savedRobots('www.wlw.de'), headers: { 'content-type': 'text/plain' } }, [url]: { body: page('wlw-search-links.html') } });
    const scan = await scanDirectoryPage(testDeps(fetch), { url, source: 'wlw' });
    expect(scan).toMatchObject({ ok: false, status: 403, body: { error: 'robots_disallowed' } });
    expect(requests.map((r) => r.url)).toEqual([robotsUrl]);
  });

  it('robots unreachable fails closed', async () => {
    const { fetch, requests } = routedFetch({ [robotsUrl]: { status: 503 }, [url]: { body: page('wlw-search-links.html') } });
    expect(await scanDirectoryPage(testDeps(fetch), { url, source: 'wlw' })).toMatchObject({ status: 403, body: { error: 'robots_disallowed' } });
    expect(requests.map((r) => r.url)).toEqual([robotsUrl]);
  });

  it('a non-directory host is refused before anything is fetched', async () => {
    const { fetch, requests } = routedFetch({});
    for (const bad of ['https://europages.evil.example/x', 'http://169.254.169.254/europages.de/x', 'https://www.wlw.de.evil.example/']) {
      const scan = await scanDirectoryPage(testDeps(fetch), { url: bad, source: 'europages' });
      expect(scan.status).toBe(400);
    }
    expect(requests).toEqual([]);
  });

  it('robots allowed: one page fetch with the crawler identity, no browser identity rotation', async () => {
    const { fetch, requests } = routedFetch({ [robotsUrl]: { body: 'User-agent: MicronsHubBot\nAllow: /\n' }, [url]: { body: page('wlw-search-links.html') } });
    const scan = await scanDirectoryPage(testDeps(fetch), { url, source: 'wlw' });
    expect(scan.ok).toBe(true);
    expect(requests.map((r) => r.url)).toEqual([robotsUrl, url]);
    expect(requests[1].headers['user-agent']).toBe(UA);
    expect(requests[1].redirect).toBe('manual');
  });

  it('403, 429 and challenge pages pause the host for 24 h (no further fetch), also across isolates through scan_logs', async () => {
    for (const [route, status] of [[{ status: 429 }, 429], [{ status: 403 }, 403], [{ body: page('challenge.html'), status: 200 }, 403], [{ body: page('challenge.html'), status: 503 }, 403]] as const) {
      const { fetch, requests } = routedFetch({ [url]: route });
      const deps = testDeps(fetch, { permitted: new Map([['www.wlw.de', 'p']]) });
      const first = await scanDirectoryPage(deps, { url, source: 'wlw' });
      expect(first).toMatchObject({ ok: false, status, body: { error: 'host_blocked', retryAfter: 86400 }, paused: 'www.wlw.de' });
      const second = await scanDirectoryPage(deps, { url, source: 'wlw' });
      expect(second).toMatchObject({ ok: false, status: 429, body: { error: 'host_blocked', retryAfter: 86400 } });
      expect(requests).toHaveLength(1);
    }
    // Another isolate: the pause is read from the scan_logs row written for the blocked scan.
    const db = new MemoryDb();
    const now = Date.UTC(2026, 9, 5, 9, 0, 0);
    db.seed('scan_logs', [{ id: 1, source: 'wlw', url, status: 'failed', error_message: pauseMarker('www.wlw.de'), started_at: new Date(now - 3_600_000).toISOString() }]);
    const { fetch, requests } = routedFetch({ [url]: { body: page('wlw-search-links.html') } });
    const fresh = testDeps(fetch, { permitted: new Map([['www.wlw.de', 'p']]), db, now: () => now });
    expect(await scanDirectoryPage(fresh, { url, source: 'wlw' })).toMatchObject({ status: 429, body: { error: 'host_blocked', retryAfter: (HOST_PAUSE_MS - 3_600_000) / 1000 } });
    expect(requests).toEqual([]);
    // A pause older than 24 h no longer counts.
    const later = testDeps(fetch, { permitted: new Map([['www.wlw.de', 'p']]), db, now: () => now + HOST_PAUSE_MS });
    expect((await scanDirectoryPage(later, { url, source: 'wlw' })).ok).toBe(true);
  });

  it('a redirect off the host is not followed', async () => {
    const { fetch, requests } = routedFetch({ [url]: { status: 302, headers: { location: 'https://other.example.com/x' } } });
    const scan = await scanDirectoryPage(testDeps(fetch, { permitted: new Map([['www.wlw.de', 'p']]) }), { url, source: 'wlw' });
    expect(scan).toMatchObject({ status: 502, body: { error: 'redirect_off_host' } });
    expect(requests.map((r) => r.url)).toEqual([url]);
  });

  it('browser: only for a permitted client-rendered page with no cards, once per invocation', async () => {
    const renders: string[] = [];
    const browser: BrowserPort = { render: async (u, o) => { renders.push(`${u} ${o.userAgent}`); return { status: 200, html: page('spa-rendered.html') }; } };
    expect(needsClientRendering(page('spa-shell.html'))).toBe(true);
    expect(needsClientRendering(page('wlw-search-links.html'))).toBe(false);

    const shell = routedFetch({ [url]: { body: page('spa-shell.html') }, [`${url}/page/2`]: { body: page('spa-shell.html') } });
    const budget = new BrowserBudget();
    const deps = testDeps(shell.fetch, { permitted: new Map([['www.wlw.de', 'p']]), browser });
    const scan = await scanDirectoryPage(deps, { url, source: 'wlw' }, budget);
    expect(scan.ok && scan.rendered).toBe(true);
    expect(scan.ok && scan.body.companies.map((c) => c.company_name)).toEqual(['Rendered Company One', 'Rendered Company Two']);
    expect(renders).toEqual([`${url} ${UA}`]);
    // Same invocation: the budget is spent, no second browser.
    const again = await scanDirectoryPage(deps, { url: `${url}/page/2`, source: 'wlw' }, budget);
    expect(again.ok && again.rendered).toBe(false);
    expect(renders).toHaveLength(1);

    // Not permitted (robots allow only): never rendered.
    const open = routedFetch({ 'https://www.wlw.de/robots.txt': { body: 'User-agent: *\nAllow: /\n' }, [url]: { body: page('spa-shell.html') } });
    const notPermitted = await scanDirectoryPage(testDeps(open.fetch, { browser }), { url, source: 'wlw' });
    expect(notPermitted.ok && notPermitted.rendered).toBe(false);
    expect(renders).toHaveLength(1);
  });

  it('a refusal while rendering pauses the host', async () => {
    const browser: BrowserPort = { render: async () => ({ status: 429, html: '' }) };
    const shell = routedFetch({ [url]: { body: page('spa-shell.html') } });
    const deps = testDeps(shell.fetch, { permitted: new Map([['www.wlw.de', 'p']]), browser });
    expect(await scanDirectoryPage(deps, { url, source: 'wlw' })).toMatchObject({ status: 429, body: { error: 'host_blocked' }, paused: 'www.wlw.de' });
    expect(deps.pauses.remaining('www.wlw.de', deps.now())).toBe(HOST_PAUSE_MS);
  });

  it('a rendered page that is a challenge (status 200) pauses the host: nothing parsed, no second fetch or render', async () => {
    const renders: string[] = [];
    const browser: BrowserPort = { render: async (u) => { renders.push(u); return { status: 200, html: page('challenge.html').replace('</body>', '<a href="/en/company/hidden-firm-1">x</a></body>') }; } };
    const shell = routedFetch({ [url]: { body: page('spa-shell.html') } });
    const deps = testDeps(shell.fetch, { permitted: new Map([['www.wlw.de', 'p']]), browser });
    const scan = await scanDirectoryPage(deps, { url, source: 'wlw' }, new BrowserBudget());
    expect(scan).toEqual(expect.objectContaining({ ok: false, status: 403, body: { error: 'host_blocked', retryAfter: 86400 }, paused: 'www.wlw.de' }));
    expect(deps.pauses.remaining('www.wlw.de', deps.now())).toBe(HOST_PAUSE_MS);
    const again = await scanDirectoryPage(deps, { url, source: 'wlw' }, new BrowserBudget());
    expect(again).toMatchObject({ ok: false, status: 429, body: { error: 'host_blocked' } });
    expect(shell.requests).toHaveLength(1);
    expect(renders).toEqual([url]);
  });

  it('every redirect target passes the robots gate before it is requested', async () => {
    const robots = { body: 'User-agent: MicronsHubBot\nAllow: /de/suche/\nDisallow: /de/firma/\n', headers: { 'content-type': 'text/plain' } };
    const refused = routedFetch({
      'https://www.wlw.de/robots.txt': robots,
      [url]: { status: 301, headers: { location: '/de/firma/example-gmbh' } },
      'https://www.wlw.de/de/firma/example-gmbh': { body: page('wlw-search-links.html') },
    });
    const deps = testDeps(refused.fetch);
    expect(await scanDirectoryPage(deps, { url, source: 'wlw' })).toMatchObject({ ok: false, status: 403, body: { error: 'robots_disallowed' }, robots: { allowed: false, reason: 'robots_disallow' } });
    expect(refused.requests.map((r) => r.url)).toEqual(['https://www.wlw.de/robots.txt', url]);
    expect(deps.logs).toContainEqual({ event: 'robots', fields: { host: 'www.wlw.de', allowed: false, reason: 'robots_disallow', redirect: true } });
    // In a multi-page scan the refusal stops the scan as a robots refusal.
    const multi = await scanDirectory(testDeps(refused.fetch), { url, source: 'wlw', maxPages: 3 });
    expect(multi).toMatchObject({ pages: 0, stopped: 'robots', errors: ['Page 1: robots_disallowed'] });

    // An allowed target is followed.
    const allowed = routedFetch({
      'https://www.wlw.de/robots.txt': robots,
      [url]: { status: 302, headers: { location: '/de/suche/cnc-fraesen' } },
      'https://www.wlw.de/de/suche/cnc-fraesen': { body: page('wlw-search-links.html') },
    });
    const followed = await scanDirectoryPage(testDeps(allowed.fetch), { url, source: 'wlw' });
    expect(followed.ok).toBe(true);
    expect(allowed.requests.map((r) => r.url)).toEqual(['https://www.wlw.de/robots.txt', url, 'https://www.wlw.de/de/suche/cnc-fraesen']);
  });

  it('with a deadline, the page is rendered only when the render timeout still fits before it', async () => {
    const renders: string[] = [];
    const browser: BrowserPort = { render: async (u) => { renders.push(u); return { status: 200, html: page('spa-rendered.html') }; } };
    let deps: TestDeps;
    const shell = routedFetch({ [url]: { body: page('spa-shell.html') } });
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await deps.sleep(16_000);
      return shell.fetch(input, init);
    }) as typeof fetch;
    deps = testDeps(slow, { permitted: new Map([['www.wlw.de', 'p']]), browser });
    const start = deps.now();
    const late = await scanDirectoryPage(deps, { url, source: 'wlw', deadline: start + 35_000 });
    expect(late).toMatchObject({ ok: true, rendered: false, body: { companies: [] } });
    expect(renders).toEqual([]);
    const fits = await scanDirectoryPage(deps, { url, source: 'wlw', deadline: deps.now() + 36_000 });
    expect(fits).toMatchObject({ ok: true, rendered: true });
    expect(renders).toEqual([url]);
  });
});

describe('multi-page scans', () => {
  const base = 'https://www.europages.de/companies/germany/cnc.html';

  it('walks pages with the page scheme, waits at least 2.5 s (Europages) and the Crawl-delay, stops without a next page', async () => {
    const p1 = page('europages-search-jsonld.html');
    const p2 = page('europages-search-links.html').replace('?page=2', '').replace('/companies/p-3.html', '/companies/x.html');
    const { fetch, requests } = routedFetch({
      'https://www.europages.de/robots.txt': { body: 'User-agent: MicronsHubBot\nAllow: /\nCrawl-delay: 1\n' },
      [base]: { body: p1 },
      [buildPageUrl(base, 2, 'europages')]: { body: p2 },
    });
    const deps = testDeps(fetch);
    const result = await scanDirectory(deps, { url: base, source: 'europages', maxPages: 5 });
    expect(requests.map((r) => r.url)).toEqual(['https://www.europages.de/robots.txt', base, 'https://www.europages.de/companies/germany/cnc/p-2.html']);
    expect(result).toMatchObject({ pages: 2, stopped: 'end', errors: [], keyword: 'cnc', country: 'germany' });
    expect(result.companies.length).toBe(3 + 4);
    expect(deps.sleeps).toEqual([2500]);

    const slow = routedFetch({
      'https://www.wlw.de/robots.txt': { body: 'User-agent: *\nAllow: /\nCrawl-delay: 9\n' },
      'https://www.wlw.de/de/suche/cnc': { body: page('wlw-search-nextdata.html') },
      'https://www.wlw.de/de/suche/cnc/page/2': { body: page('wlw-search-nextdata.html') },
    });
    const slowDeps = testDeps(slow.fetch);
    const r2 = await scanDirectory(slowDeps, { url: 'https://www.wlw.de/de/suche/cnc', source: 'wlw', maxPages: 2 });
    expect(r2).toMatchObject({ pages: 2, stopped: 'end' });
    expect(slowDeps.sleeps).toEqual([9000]);
  });

  it('caps at 10 pages and stops at robots, pauses and empty pages', async () => {
    const all = routedFetch(Object.fromEntries([
      ['https://www.wlw.de/robots.txt', { body: 'User-agent: *\nAllow: /\n' }],
      ...Array.from({ length: 12 }, (_, i) => [
        buildPageUrl('https://www.wlw.de/de/suche/cnc', i + 1, 'wlw'),
        { body: page('wlw-search-links.html').replace('</body>', `<a href="/de/suche/cnc/page/${i + 2}">next</a></body>`) },
      ]),
    ]));
    const capped = await scanDirectory(testDeps(all.fetch), { url: 'https://www.wlw.de/de/suche/cnc', source: 'wlw', maxPages: 50 });
    expect(capped.pages).toBe(10);
    expect(all.requests).toHaveLength(11);

    const robots = routedFetch({ 'https://www.wlw.de/robots.txt': { body: savedRobots('www.wlw.de') } });
    expect(await scanDirectory(testDeps(robots.fetch), { url: 'https://www.wlw.de/de/suche/cnc', source: 'wlw', maxPages: 3 })).toMatchObject({ pages: 0, stopped: 'robots', errors: ['Page 1: robots_disallowed'] });

    const blocked = routedFetch({ 'https://www.wlw.de/robots.txt': { body: '' }, 'https://www.wlw.de/de/suche/cnc': { status: 429 } });
    expect(await scanDirectory(testDeps(blocked.fetch), { url: 'https://www.wlw.de/de/suche/cnc', source: 'wlw', maxPages: 3 })).toMatchObject({ stopped: 'paused', paused: 'www.wlw.de' });

    const empty = routedFetch({ 'https://www.wlw.de/robots.txt': { body: '' }, 'https://www.wlw.de/de/suche/cnc': { body: '<html></html>' } });
    expect(await scanDirectory(testDeps(empty.fetch), { url: 'https://www.wlw.de/de/suche/cnc', source: 'wlw', maxPages: 3 })).toMatchObject({ pages: 1, stopped: 'empty', companies: [] });
  });

  it('with a deadline, a page starts only while its robots and page timeouts (20 s) still fit before it', async () => {
    const search = 'https://www.wlw.de/de/suche/cnc';
    const pages = routedFetch(Object.fromEntries(Array.from({ length: 3 }, (_, i) => [
      buildPageUrl(search, i + 1, 'wlw'),
      { body: page('wlw-search-links.html').replace('</body>', `<a href="/de/suche/cnc/page/${i + 2}">next</a></body>`) },
    ])));
    let deps: TestDeps;
    const tenSeconds = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await deps.sleep(10_000);
      return pages.fetch(input, init);
    }) as typeof fetch;
    deps = testDeps(tenSeconds, { permitted: new Map([['www.wlw.de', 'p']]) });
    const start = deps.now();
    // Page 1 at 0 s, page 2 at 14 s (10 s fetch + 4 s wlw delay); page 3 would start at 28 s, past 35 - 20 s.
    const result = await scanDirectory(deps, { url: search, source: 'wlw', maxPages: 3, deadline: start + 35_000 });
    expect(result).toMatchObject({ pages: 2, stopped: 'deadline', errors: [] });
    expect(pages.requests.map((r) => r.url)).toEqual([search, buildPageUrl(search, 2, 'wlw')]);
    // Without a deadline the same scan reads all three pages.
    pages.requests.length = 0;
    expect(await scanDirectory(deps, { url: search, source: 'wlw', maxPages: 3 })).toMatchObject({ pages: 3, stopped: 'limit' });
  });
});
