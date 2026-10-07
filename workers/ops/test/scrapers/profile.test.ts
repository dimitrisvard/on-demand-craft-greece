// Profile scans: the ported parsers give byte-equal JSON to the Vercel handler (api/scrape-company-profile.js, run
// through the Phase 2 shim with a fetch stub on the same synthetic HTML); the module path keeps the robots gate,
// the crawler identity and the host pause.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNodeHandler, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import { profileBody } from '../../src/scrapers/parsers/profile';
import { scrapeProfile } from '../../src/scrapers/profile';
import { UA, page, routedFetch, savedRobots, testDeps } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function handlerAnswer(url: string, source: string, html: string, status = 200): Promise<{ status: number; body: string }> {
  vi.stubGlobal('fetch', (async () => new Response(html, { status, headers: { 'content-type': 'text/html' } })) as typeof fetch);
  const handler = (await import('../../../../api/scrape-company-profile.js')).default as VercelHandler;
  const request = new Request('https://ops.internal/api/scrape-company-profile', { method: 'POST', headers: { 'content-type': 'application/json' } });
  const response = await runNodeHandler(handler, { request, functionUrl: '/api/scrape-company-profile', body: new TextEncoder().encode(JSON.stringify({ url, source })), logPrefix: '[microns-ops]' });
  vi.unstubAllGlobals();
  return { status: response.status, body: await response.text() };
}

const CASES: Array<{ name: string; url: string; source: 'europages' | 'wlw'; fixture: string }> = [
  { name: 'Europages JSON-LD profile', url: 'https://www.europages.co.uk/EXAMPLE-METALLBAU/00000001-1.html', source: 'europages', fixture: 'europages-profile-jsonld.html' },
  { name: 'Europages regex fallbacks', url: 'https://www.europages.co.uk/SAMPLE-LASER/00000012-7.html', source: 'europages', fixture: 'europages-profile-regex.html' },
  { name: 'wlw __NEXT_DATA__ profile with contacts', url: 'https://www.wlw.com/en/company/beispiel-drehteile-ag-123', source: 'wlw', fixture: 'wlw-profile-nextdata.html' },
  { name: 'wlw fallbacks and JSON-LD', url: 'https://www.wlw.de/de/firma/muster-kunststoff', source: 'wlw', fixture: 'wlw-profile-fallback.html' },
  { name: 'wlw parser on a Europages page', url: 'https://www.wlw.de/de/firma/x', source: 'wlw', fixture: 'europages-profile-regex.html' },
];

describe('parser parity with api/scrape-company-profile.js (byte-equal JSON)', () => {
  it.each(CASES)('$name', async ({ url, source, fixture }) => {
    const html = page(fixture);
    const theirs = await handlerAnswer(url, source, html);
    expect(theirs.status).toBe(200);
    expect(JSON.stringify(profileBody(html, url, source))).toBe(theirs.body);

    const host = new URL(url).hostname;
    const { fetch, requests } = routedFetch({ [url]: { body: html } });
    const scan = await scrapeProfile(testDeps(fetch, { permitted: new Map([[host, 'permission ref']]) }), { url, source });
    expect(scan.ok).toBe(true);
    expect(JSON.stringify(scan.body)).toBe(theirs.body);
    expect(requests[0].headers['user-agent']).toBe(UA);
    expect(requests[0].headers.referer).toBe(source === 'europages' ? 'https://www.europages.co.uk/' : 'https://www.wlw.com/en/search');
  });

  it('the fixtures exercise the fields', () => {
    const ep = profileBody(page('europages-profile-jsonld.html'), CASES[0].url, 'europages');
    expect(ep).toMatchObject({ company_name: 'Example Metallbau & Co. GmbH', website_url: 'https://www.example-metallbau.de', employee_count: '42', year_established: '1998', full_address: 'Musterstrasse 1, 70173, Stuttgart, Germany' });
    expect(ep.industry_tags).toEqual(['sheet metal', 'laser cutting', 'bending']);
    const wlw = profileBody(page('wlw-profile-nextdata.html'), CASES[2].url, 'wlw');
    expect(wlw.contact_persons).toEqual([{ name: 'Erika Beispiel', title: 'Vertrieb', email: 'e.beispiel@example.at', phone: '+43 1 0000002' }]);
    expect(wlw.certifications).toEqual(['ISO 9001', 'ISO 14001']);
  });

  it('error answers keep the handler shapes', async () => {
    const theirs = await handlerAnswer('https://www.wlw.de/de/firma/x', 'wlw', '', 500);
    const { fetch } = routedFetch({ 'https://www.wlw.de/de/firma/x': { status: 500 } });
    const scan = await scrapeProfile(testDeps(fetch, { permitted: new Map([['www.wlw.de', 'p']]) }), { url: 'https://www.wlw.de/de/firma/x', source: 'wlw' });
    expect({ status: scan.status, body: JSON.stringify(scan.body) }).toEqual(theirs);
    const deps = testDeps(routedFetch({}).fetch);
    expect(await scrapeProfile(deps, { url: '', source: 'wlw' })).toMatchObject({ status: 400, body: { error: 'url is required' } });
    expect(await scrapeProfile(deps, { url: 'https://www.wlw.de/x', source: 'other' })).toMatchObject({ status: 400, body: { error: 'source must be "europages" or "wlw"' } });
    expect(await scrapeProfile(deps, { url: 'https://example.com/x', source: 'wlw' })).toMatchObject({ status: 400, body: { error: 'url_not_allowed' } });
  });
});

describe('profile module rules', () => {
  const url = 'https://www.europages.de/BEISPIEL/00000011.html';

  it('robots.txt of the directory refuses our crawler: nothing but robots.txt is fetched', async () => {
    const { fetch, requests } = routedFetch({ 'https://www.europages.de/robots.txt': { body: savedRobots('www.europages.de') }, [url]: { body: page('europages-profile-regex.html') } });
    expect(await scrapeProfile(testDeps(fetch), { url, source: 'europages' })).toMatchObject({ status: 403, body: { error: 'robots_disallowed' } });
    expect(requests.map((r) => r.url)).toEqual(['https://www.europages.de/robots.txt']);
  });

  it('a 403 pauses the host for 24 h', async () => {
    const { fetch, requests } = routedFetch({ [url]: { status: 403 } });
    const deps = testDeps(fetch, { permitted: new Map([['www.europages.de', 'p']]) });
    expect(await scrapeProfile(deps, { url, source: 'europages' })).toMatchObject({ status: 403, body: { error: 'host_blocked', retryAfter: 86400 } });
    expect(await scrapeProfile(deps, { url, source: 'europages' })).toMatchObject({ status: 429, body: { error: 'host_blocked' } });
    expect(requests).toHaveLength(1);
  });

  it('every redirect target passes the robots gate before it is requested', async () => {
    const robots = { body: 'User-agent: MicronsHubBot\nAllow: /BEISPIEL/\nDisallow: /intern/\n', headers: { 'content-type': 'text/plain' } };
    const { fetch, requests } = routedFetch({
      'https://www.europages.de/robots.txt': robots,
      [url]: { status: 302, headers: { location: '/intern/profile-11.html' } },
      'https://www.europages.de/intern/profile-11.html': { body: page('europages-profile-regex.html') },
    });
    expect(await scrapeProfile(testDeps(fetch), { url, source: 'europages' })).toMatchObject({ ok: false, status: 403, body: { error: 'robots_disallowed' } });
    expect(requests.map((r) => r.url)).toEqual(['https://www.europages.de/robots.txt', url]);
  });
});
