// robots.txt gate (RFC 9309 matching, fail closed) with the five robots.txt files saved from the directory sites on
// 2026-10-03, and the owner-recorded permission override.

import { describe, expect, it, vi } from 'vitest';
import { scanDirectoryPage } from '../../src/scrapers/directory';
import {
  PRODUCT_TOKEN,
  RobotsCache,
  decide,
  parsePermittedHosts,
  parseRobots,
  patternMatches,
  robotsAllows,
  ROBOTS_MAX_BYTES,
} from '../../src/scrapers/robots';
import { UA, routedFetch, savedRobots, testDeps } from './helpers';

const HOSTS = ['www.europages.co.uk', 'www.europages.de', 'www.wlw.de', 'www.wlw.com', 'www.wlw.at'];

const SEARCH_AND_COMPANY_URLS: Record<string, string[]> = {
  'www.europages.co.uk': [
    'https://www.europages.co.uk/companies/germany/robotics.html',
    'https://www.europages.co.uk/companies/germany/robotics/p-2.html',
    'https://www.europages.co.uk/EXAMPLE-METALLBAU/00000001-1.html',
    'https://www.europages.co.uk/en/search/?q=cnc',
    'https://www.europages.co.uk/',
  ],
  'www.europages.de': [
    'https://www.europages.de/unternehmen/deutschland/cnc.html',
    'https://www.europages.de/BEISPIEL/00000011.html',
    'https://www.europages.de/de/firma/beispiel',
  ],
  'www.wlw.de': ['https://www.wlw.de/de/suche?q=cnc', 'https://www.wlw.de/de/suche/cnc/page/2', 'https://www.wlw.de/de/firma/beispiel-gmbh'],
  'www.wlw.com': ['https://www.wlw.com/en/search/robotics/country/germany', 'https://www.wlw.com/en/company/example-cnc-4711'],
  'www.wlw.at': ['https://www.wlw.at/de/suche?q=x', 'https://www.wlw.at/de/firma/beispiel'],
};

function robotsRoutes(): Record<string, { body: string; headers: Record<string, string> }> {
  return Object.fromEntries(HOSTS.map((h) => [`https://${h}/robots.txt`, { body: savedRobots(h), headers: { 'content-type': 'text/plain' } }]));
}

describe('saved robots.txt files', () => {
  it.each(HOSTS)('%s: MicronsHubBot is disallowed on every search and company URL; Googlebot may fetch the root', async (host) => {
    const { fetch, requests } = routedFetch(robotsRoutes());
    const cache = new RobotsCache();
    for (const url of SEARCH_AND_COMPANY_URLS[host]) {
      const d = await robotsAllows(url, { fetchImpl: fetch, userAgent: UA, cache });
      expect(d, url).toEqual({ allowed: false, reason: 'robots_disallow' });
    }
    // One robots.txt request per origin (cached), sent with our crawler identity.
    expect(requests.map((r) => r.url)).toEqual([`https://${host}/robots.txt`]);
    expect(requests[0].headers['user-agent']).toBe(UA);
    const robots = parseRobots(savedRobots(host));
    expect(decide(robots, 'Googlebot', '/').allowed).toBe(true);
    expect(decide(robots, PRODUCT_TOKEN, '/').allowed).toBe(false);
  });

  it('even the named crawlers may not fetch the search and company paths', () => {
    const ep = parseRobots(savedRobots('www.europages.co.uk'));
    expect(decide(ep, 'Googlebot', '/de/companies/x.html').allowed).toBe(false);
    expect(decide(ep, 'Googlebot', '/x/p-12').allowed).toBe(false);
    expect(decide(ep, 'Googlebot', '/x/p-2').allowed).toBe(true);
    const wlw = parseRobots(savedRobots('www.wlw.de'));
    expect(decide(wlw, 'Googlebot', '/en/company/x').allowed).toBe(false);
    expect(decide(wlw, 'Googlebot', '/de/suche?q=x').allowed).toBe(false);
    expect(decide(wlw, 'Googlebot', '/de/suche/x/page/2').allowed).toBe(true);
  });

  it('a permitted host passes without a robots.txt fetch, with its permission reference, and the scan logs it', async () => {
    const permitted = parsePermittedHosts(JSON.stringify({ 'www.wlw.de': 'written permission 2026-10-01 ref 0007' }));
    const { fetch, requests } = routedFetch({ 'https://www.wlw.de/de/suche/cnc': { body: '<html></html>' } });
    const d = await robotsAllows('https://www.wlw.de/de/suche/cnc', { fetchImpl: fetch, userAgent: UA, permitted, cache: new RobotsCache() });
    expect(d).toEqual({ allowed: true, reason: 'permitted', permission: 'written permission 2026-10-01 ref 0007' });
    expect(requests).toEqual([]);

    const deps = testDeps(fetch, { permitted });
    const scan = await scanDirectoryPage(deps, { url: 'https://www.wlw.de/de/suche/cnc', source: 'wlw' });
    expect(scan.ok).toBe(true);
    expect(deps.logs).toContainEqual({ event: 'robots', fields: { host: 'www.wlw.de', allowed: true, reason: 'permitted', permission: 'written permission 2026-10-01 ref 0007' } });
  });
});

describe('RFC 9309 matching', () => {
  const robots = parseRobots([
    '# comment line',
    'User-agent: *',
    'Disallow: /private',
    'Allow: /private/open',
    '',
    'User-agent: MicronsHubBot/2.0',
    'User-agent: other',
    'Disallow: /shop/',
    'Allow: /shop/public$',
    'Disallow: /*.pdf$',
    'Crawl-delay: 7',
    '',
    'user-agent: micronshubbot',
    'Allow: /shop/special',
    'Disallow:',
    'Crawl-delay: 3',
  ].join('\n'));

  it('combines every group naming the product token (case-insensitive, version ignored) and ignores *', () => {
    expect(decide(robots, PRODUCT_TOKEN, '/private').allowed).toBe(true);
    expect(decide(robots, PRODUCT_TOKEN, '/shop/x').allowed).toBe(false);
    expect(decide(robots, PRODUCT_TOKEN, '/shop/special/1').allowed).toBe(true);
    expect(decide(robots, PRODUCT_TOKEN, '/shop/public').allowed).toBe(true);
    expect(decide(robots, PRODUCT_TOKEN, '/shop/public/x').allowed).toBe(false);
    expect(decide(robots, PRODUCT_TOKEN, '/docs/a.pdf').allowed).toBe(false);
    expect(decide(robots, PRODUCT_TOKEN, '/docs/a.pdf?x=1').allowed).toBe(true);
    expect(decide(robots, PRODUCT_TOKEN, '/x').crawlDelayS).toBe(7);
  });

  it('falls back to the * groups, longest match wins, Allow wins a tie, /robots.txt is always allowed', () => {
    expect(decide(robots, 'SomeBot', '/private/x').allowed).toBe(false);
    expect(decide(robots, 'SomeBot', '/private/open/x').allowed).toBe(true);
    const tie = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a\n');
    expect(decide(tie, PRODUCT_TOKEN, '/a/b').allowed).toBe(true);
    expect(decide(parseRobots('User-agent: *\nDisallow: /\n'), PRODUCT_TOKEN, '/robots.txt').allowed).toBe(true);
    expect(decide(parseRobots(''), PRODUCT_TOKEN, '/anything').allowed).toBe(true);
    expect(decide(parseRobots('User-agent: Googlebot\nDisallow: /\n'), PRODUCT_TOKEN, '/x').allowed).toBe(true);
  });

  it('patterns: * matches any run, $ anchors the end, non-ASCII is compared percent-encoded', () => {
    expect(patternMatches('/a*/c', '/abbb/c/d')).toBe(true);
    expect(patternMatches('/a$', '/a')).toBe(true);
    expect(patternMatches('/a$', '/ab')).toBe(false);
    expect(patternMatches('*?*', '/x?y=1')).toBe(true);
    expect(patternMatches('/unternehmen/', '/unternehmen/x')).toBe(true);
    expect(patternMatches('/företag/', '/f%C3%B6retag/x')).toBe(true);
  });

  it('patterns: the segment matcher answers as a whole-pattern match on every short pattern and path', () => {
    // Reference: the pattern as an anchored regular expression (fine for these short inputs).
    const reference = (pattern: string, path: string) => {
      const anchored = pattern.endsWith('$');
      const body = anchored ? pattern.slice(0, -1) : pattern;
      const source = body.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
    };
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pick = (alphabet: string, max: number) => Array.from({ length: next(max + 1) }, () => alphabet[next(alphabet.length)]).join('');
    for (let i = 0; i < 4000; i++) {
      const pattern = `/${pick('ab*', 6)}${next(3) === 0 ? '$' : ''}`;
      const path = `/${pick('ab', 8)}`;
      expect(patternMatches(pattern, path), `${pattern} on ${path}`).toBe(reference(pattern, path));
    }
  });

  it('patterns: matching time grows linearly with the path for rules with many wildcards', () => {
    const rule = `/${'*a'.repeat(10)}*b`;
    const path = `/de/suche/${'a'.repeat(4000)}`;
    const started = performance.now();
    for (let i = 0; i < 200; i++) expect(patternMatches(rule, path)).toBe(false);
    expect(patternMatches(`/${'*a'.repeat(4)}*b`, `/de/suche/${'a'.repeat(110)}`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('a rule with more than 10 wildcards counts as a Disallow that matches every path', () => {
    const wide = `/${'*x'.repeat(11)}`;
    const robots = parseRobots(`User-agent: *\nAllow: ${wide}\nAllow: /de/\n`);
    expect(decide(robots, PRODUCT_TOKEN, '/de/suche/cnc')).toMatchObject({ allowed: false, rule: { allow: false, pattern: wide } });
    expect(decide(robots, PRODUCT_TOKEN, '/robots.txt').allowed).toBe(true);
    // Ten wildcards are matched as written.
    const ten = parseRobots(`User-agent: *\nDisallow: /${'*x'.repeat(10)}\n`);
    expect(decide(ten, PRODUCT_TOKEN, '/de/suche/cnc').allowed).toBe(true);
    expect(decide(ten, PRODUCT_TOKEN, `/${'x'.repeat(10)}`).allowed).toBe(false);
  });
});

describe('fetching robots.txt', () => {
  const url = 'https://www.example.de/de/suche?q=1';
  const robotsUrl = 'https://www.example.de/robots.txt';

  it('4xx other than 429 = no robots.txt: allowed', async () => {
    for (const status of [404, 410, 403]) {
      const { fetch } = routedFetch({ [robotsUrl]: { status, body: '' } });
      expect(await robotsAllows(url, { fetchImpl: fetch, userAgent: UA, cache: new RobotsCache() })).toEqual({ allowed: true, reason: 'robots_unavailable' });
    }
  });

  it('429, 5xx, network errors, timeouts and too many redirects fail closed', async () => {
    for (const status of [429, 500, 503]) {
      const { fetch } = routedFetch({ [robotsUrl]: { status } });
      expect(await robotsAllows(url, { fetchImpl: fetch, userAgent: UA, cache: new RobotsCache() })).toEqual({ allowed: false, reason: `robots_unreachable:status_${status}` });
    }
    const { fetch: broken } = routedFetch({ [robotsUrl]: { error: new TypeError('connection refused') } });
    expect((await robotsAllows(url, { fetchImpl: broken, userAgent: UA, cache: new RobotsCache() })).reason).toBe('robots_unreachable:network');

    const loop = routedFetch({ [robotsUrl]: { status: 301, headers: { location: robotsUrl } } });
    expect((await robotsAllows(url, { fetchImpl: loop.fetch, userAgent: UA, cache: new RobotsCache() })).reason).toBe('robots_unreachable:too_many_redirects');
    expect(loop.requests).toHaveLength(6);
    expect(loop.requests.every((r) => r.redirect === 'manual')).toBe(true);

    vi.useFakeTimers();
    try {
      const hanging = (async (_u: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
      const pending = robotsAllows(url, { fetchImpl: hanging, userAgent: UA, cache: new RobotsCache() });
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await pending).reason).toBe('robots_unreachable:timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a redirect to an IP literal or our own zone is refused (fail closed); one to a public host is followed', async () => {
    const internal = routedFetch({ [robotsUrl]: { status: 302, headers: { location: 'http://169.254.169.254/robots.txt' } } });
    expect((await robotsAllows(url, { fetchImpl: internal.fetch, userAgent: UA, cache: new RobotsCache() })).reason).toBe('robots_unreachable:redirect_refused');
    expect(internal.requests).toHaveLength(1);
    const moved = routedFetch({
      [robotsUrl]: { status: 301, headers: { location: 'https://cdn.example.net/robots.txt' } },
      'https://cdn.example.net/robots.txt': { body: 'User-agent: *\nDisallow: /de/\n' },
    });
    expect(await robotsAllows(url, { fetchImpl: moved.fetch, userAgent: UA, cache: new RobotsCache() })).toEqual({ allowed: false, reason: 'robots_disallow' });
  });

  it('reads at most 512 KiB; rules past the limit are ignored', async () => {
    const filler = `# ${'x'.repeat(ROBOTS_MAX_BYTES)}\n`;
    const { fetch } = routedFetch({ [robotsUrl]: { body: `User-agent: *\nAllow: /\n${filler}User-agent: *\nDisallow: /\n` } });
    expect((await robotsAllows(url, { fetchImpl: fetch, userAgent: UA, cache: new RobotsCache() })).allowed).toBe(true);
  });

  it('caches rules for 1 h and failures for 5 min per origin', async () => {
    let now = 0;
    const cache = new RobotsCache();
    const ok = routedFetch({ [robotsUrl]: { body: 'User-agent: *\nAllow: /\n' } });
    for (const t of [0, 3_599_000]) {
      now = t;
      await robotsAllows(url, { fetchImpl: ok.fetch, userAgent: UA, cache, now: () => now });
    }
    expect(ok.requests).toHaveLength(1);
    now = 3_600_001;
    await robotsAllows(url, { fetchImpl: ok.fetch, userAgent: UA, cache, now: () => now });
    expect(ok.requests).toHaveLength(2);

    const failing = routedFetch({ [robotsUrl]: { status: 500 } });
    const cache2 = new RobotsCache();
    now = 0;
    await robotsAllows(url, { fetchImpl: failing.fetch, userAgent: UA, cache: cache2, now: () => now });
    now = 299_000;
    await robotsAllows(url, { fetchImpl: failing.fetch, userAgent: UA, cache: cache2, now: () => now });
    expect(failing.requests).toHaveLength(1);
    now = 300_001;
    await robotsAllows(url, { fetchImpl: failing.fetch, userAgent: UA, cache: cache2, now: () => now });
    expect(failing.requests).toHaveLength(2);
  });

  it('SCRAPER_PERMITTED_HOSTS: only a JSON object of host -> non-empty reference counts', () => {
    expect([...parsePermittedHosts(JSON.stringify({ 'WWW.Example.DE.': ' ref 1 ', 'bad host': 'x', 'www.example.com': '', 'x.example.org': 5 }))]).toEqual([['www.example.de', 'ref 1']]);
    for (const bad of [undefined, '', '{}', '[]', 'not json', '"x"', 'null']) expect(parsePermittedHosts(bad).size).toBe(0);
  });
});
