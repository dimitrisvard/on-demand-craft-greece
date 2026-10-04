// The /api rewrites (/api/track, /api/connector-status) use the shared query merge
// (workers/shared/src/compat/vercel-rewrite.ts); the sitemap rewrites use their own copy in src/sitemap.ts. Both
// must be the same algorithm: for every sitemap test input (read from test/sitemap.test.ts, so new inputs are
// picked up) plus edge cases, '/api/sitemap' + mergeRewriteQuery(destination, request query) must equal
// rewriteSitemapPath().

import { describe, expect, it } from 'vitest';
import { functionUrlFor, mergeRewriteQuery } from '../../shared/src/compat/vercel-rewrite';
import { rewriteSitemapPath } from '../src/sitemap';
import sitemapTestSource from './sitemap.test.ts?raw';

const ORIGIN = 'https://www.micronshub.eu';
const FUNCTION_PATH = '/api/sitemap';

// Every single-quoted path literal of the sitemap suite that starts with /sitemap or /api/sitemap.
function sitemapTestInputs(): string[] {
  const found = new Set<string>();
  for (const match of sitemapTestSource.matchAll(/'(\/(?:api\/)?sitemap[^'\s]*)'/g)) found.add(match[1]);
  return [...found];
}

const EDGE_CASES = [
  '/sitemap-de.xml?type=index&type=main-index',
  '/sitemap-de.xml?lang',
  '/sitemap-de.xml?lang=',
  '/sitemap-de.xml?a=1&b=2&a=3',
  '/sitemap.xml?x=a+b',
  '/sitemap.xml?x=%2B&y=%20',
  '/sitemap.xml?x=%zz',
  '/sitemap.xml?%E9=1',
  '/sitemap-%E9.xml',
  '/sitemap-a%2Fb.xml',
  '/sitemap-index.xml?&&',
  '/sitemap-index.xml?=v',
  '/sitemap-complete.xml?a=1=2&b',
  '/api/sitemap?type=lang&lang=de&lang=fr',
];

// The destination query of a public path, as rewriteSitemapPath re-encodes it for a request without a query.
function destinationOf(url: URL): string {
  const bare = rewriteSitemapPath(new URL(url.pathname, ORIGIN));
  if (bare === null) throw new Error(`not a sitemap path: ${url.pathname}`);
  return bare.slice(FUNCTION_PATH.length);
}

describe('shared mergeRewriteQuery equals the sitemap rewrite (src/sitemap.ts)', () => {
  const inputs = sitemapTestInputs();

  it('the sitemap suite still provides its inputs', () => {
    expect(inputs.length).toBeGreaterThanOrEqual(30);
    expect(inputs).toContain('/sitemap-de.xml?utm_source=parity');
    expect(inputs).toContain('/sitemap-complete.xml?a=b=c');
  });

  it.each([...inputs, ...EDGE_CASES])('%s', (path) => {
    const url = new URL(path, ORIGIN);
    const expected = rewriteSitemapPath(url);
    if (expected === null) return; // not a sitemap rewrite (the suite's negative cases)
    expect(FUNCTION_PATH + mergeRewriteQuery(destinationOf(url), url.search)).toBe(expected);
  });

  it('the /api rewrites use that merge: request keys first and winning, destination-only keys appended', () => {
    const f = (path: string) => functionUrlFor(new URL(path, ORIGIN)).functionUrl;
    expect(f('/api/track?type=open&eid=1&cid=2')).toBe('/api/marketing?type=open&eid=1&cid=2&action=track');
    expect(f('/api/track?action=webhook&x=1')).toBe('/api/marketing?action=webhook&x=1');
    expect(f('/api/track?url=a+b')).toBe('/api/marketing?url=a%2Bb&action=track');
    expect(f('/api/connector-status?x=1')).toBe('/api/tenders?x=1&connectors=true');
    expect(f('/api/connector-status?connectors=false')).toBe('/api/tenders?connectors=false');
    expect(f('/api/tenders?a=%zz&b=a+b')).toBe('/api/tenders?a=%zz&b=a+b');
  });
});
