import { describe, expect, it } from 'vitest';
import vercelJson from '../../../../vercel.json';
import { API_REWRITES, functionUrlFor, mergeRewriteQuery } from '../../src/compat/vercel-rewrite';

const ORIGIN = 'https://site.test';
const fn = (path: string) => functionUrlFor(new URL(path, ORIGIN));

describe('API_REWRITES', () => {
  it('lists exactly the vercel.json rewrites whose destination is an /api function other than the sitemap', () => {
    const fromVercelJson = vercelJson.rewrites
      .filter((r) => r.destination.startsWith('/api/') && !r.destination.startsWith('/api/sitemap'))
      .map((r) => {
        const q = r.destination.indexOf('?');
        return {
          source: r.source,
          destinationPath: q === -1 ? r.destination : r.destination.slice(0, q),
          destinationSearch: q === -1 ? '' : r.destination.slice(q),
        };
      });
    expect(API_REWRITES).toStrictEqual(fromVercelJson);
  });

  it('maps /api/track to marketing with action=track and /api/connector-status to tenders with connectors=true', () => {
    expect(API_REWRITES).toStrictEqual([
      { source: '/api/track', destinationPath: '/api/marketing', destinationSearch: '?action=track' },
      { source: '/api/connector-status', destinationPath: '/api/tenders', destinationSearch: '?connectors=true' },
    ]);
  });
});

describe('functionUrlFor', () => {
  it('/api/track: the request keys first, then action=track', () => {
    expect(fn('/api/track?type=open&eid=1&cid=2')).toStrictEqual({
      functionUrl: '/api/marketing?type=open&eid=1&cid=2&action=track',
      functionPath: '/api/marketing',
      rewritten: true,
    });
  });

  it('/api/track without a query reaches marketing with action=track only', () => {
    expect(fn('/api/track').functionUrl).toBe('/api/marketing?action=track');
    expect(fn('/api/track?').functionUrl).toBe('/api/marketing?action=track');
  });

  it('a request action overrides the rewrite action (/api/track?action=webhook reaches webhook)', () => {
    expect(fn('/api/track?action=webhook').functionUrl).toBe('/api/marketing?action=webhook');
    expect(fn('/api/track?x=1&action=webhook&action=track').functionUrl).toBe('/api/marketing?x=1&action=webhook&action=track');
  });

  it('/api/connector-status: the request keys first, then connectors=true', () => {
    expect(fn('/api/connector-status?x=1')).toStrictEqual({
      functionUrl: '/api/tenders?x=1&connectors=true',
      functionPath: '/api/tenders',
      rewritten: true,
    });
    expect(fn('/api/connector-status?connectors=false').functionUrl).toBe('/api/tenders?connectors=false');
  });

  it('re-encodes keys and values: + stays a literal plus (%2B), / and spaces are escaped, valid escapes decoded', () => {
    expect(fn('/api/track?url=a+b').functionUrl).toBe('/api/marketing?url=a%2Bb&action=track');
    expect(fn('/api/track?url=https%3A%2F%2Fx.test%2Fp%3Fq%3D1&t=a%20b').functionUrl)
      .toBe('/api/marketing?url=https%3A%2F%2Fx.test%2Fp%3Fq%3D1&t=a%20b&action=track');
    expect(fn('/api/track?p=/x&s=it\'s').functionUrl).toBe('/api/marketing?p=%2Fx&s=it\'s&action=track');
  });

  it('keeps bare keys bare, a malformed escape raw (then encoded), and splits a value at the first = only', () => {
    expect(fn('/api/track?debug').functionUrl).toBe('/api/marketing?debug&action=track');
    expect(fn('/api/track?x=%E9').functionUrl).toBe('/api/marketing?x=%25E9&action=track');
    expect(fn('/api/track?a=b=c').functionUrl).toBe('/api/marketing?a=b%3Dc&action=track');
  });

  it('returns any other path raw (path + query exactly as requested)', () => {
    expect(fn('/api/s3?action=list&prefix=a%2Fb+c')).toStrictEqual({
      functionUrl: '/api/s3?action=list&prefix=a%2Fb+c',
      functionPath: '/api/s3',
      rewritten: false,
    });
    expect(fn('/api/marketing?action=track&type=open').functionUrl).toBe('/api/marketing?action=track&type=open');
    expect(fn('/api/emails').functionUrl).toBe('/api/emails');
  });

  it('matches the source path exactly (no trailing slash, case-sensitive)', () => {
    expect(fn('/api/track/').rewritten).toBe(false);
    expect(fn('/api/Track').rewritten).toBe(false);
    expect(fn('/api/track/x').rewritten).toBe(false);
  });
});

describe('mergeRewriteQuery', () => {
  it('a repeated request key replaces the destination value as a whole and keeps its order', () => {
    expect(mergeRewriteQuery('?type=main-index', '?type=index&type=lang')).toBe('?type=index&type=lang');
  });

  it('empty in, empty out; destination-only keys follow the request keys', () => {
    expect(mergeRewriteQuery('', '')).toBe('');
    expect(mergeRewriteQuery('', '?')).toBe('');
    expect(mergeRewriteQuery('?a=1&b=2', '?c=3&a=9')).toBe('?c=3&a=9&b=2');
  });

  it('applies the same rules as the sitemap rewrites of microns-site', () => {
    expect(mergeRewriteQuery('', "?q=a+b&p=/x&s=it's")).toBe("?q=a%2Bb&p=%2Fx&s=it's");
    expect(mergeRewriteQuery('', '?x=%E9')).toBe('?x=%25E9');
    expect(mergeRewriteQuery('', '?a=b=c')).toBe('?a=b%3Dc');
    expect(mergeRewriteQuery('?type=lang&lang=d%65', '')).toBe('?type=lang&lang=de');
  });

  it('treats __proto__ as an ordinary key', () => {
    expect(mergeRewriteQuery('?action=track', '?__proto__=x')).toBe('?__proto__=x&action=track');
  });
});
