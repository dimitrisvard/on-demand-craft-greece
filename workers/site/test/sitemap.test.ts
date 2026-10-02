import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sitemapHandler from '../../../api/sitemap.js';
import type { Env } from '../src/env';
import { handleSitemap, rewriteSitemapPath } from '../src/sitemap';

const ORIGIN = 'https://microns-site.example.workers.dev';
const SUPABASE = 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
const STORAGE = `${SUPABASE}/storage/v1/object/public/sitemaps/`;
const ANON = 'test-anon-key-not-a-secret';
const LANGS = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'nb', 'hu', 'cs'];

const COMPLETE_BLOB =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  '  <url><loc>https://www.micronshub.eu/en</loc><lastmod>2026-09-30</lastmod></url>\n' +
  '  <url><loc>https://www.micronshub.eu/fi/palvelut/cnc-ty%C3%B6st%C3%B6</loc></url>\n</urlset>';
const INDEX_BLOB =
  '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  '  <sitemap><loc>https://www.micronshub.eu/sitemap-en.xml</loc></sitemap>\n</sitemapindex>';
const langBlob = (lang: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.micronshub.eu/${lang}</loc></url></urlset>`;

const ARTICLES = [
  { slug: 'cnc-tips', language: 'en', updated_at: '2026-09-01T10:00:00Z', created_at: '2026-08-01T10:00:00Z', translation_id: 't1' },
  { slug: 'cnc-tipps', language: 'de ', updated_at: null, created_at: '2026-08-02T10:00:00Z', translation_id: 't1' },
  { slug: 'orphan', language: 'fi', updated_at: '2026-07-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z', translation_id: null },
];
const CONTENT_PAGES = [
  { language: 'en', slug: 'about', localized_slug: null, updated_at: '2026-05-05T00:00:00Z' },
  { language: 'cs', slug: 'education', localized_slug: 'vzdelavani', updated_at: null },
];

interface Upstream {
  completeOk: boolean;
  langOk: boolean;
}

let upstream: Upstream;
let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${STORAGE}sitemap-complete.xml`) {
      return upstream.completeOk ? new Response(COMPLETE_BLOB) : new Response('err', { status: 503 });
    }
    if (url === `${STORAGE}sitemap-index.xml`) return new Response(INDEX_BLOB);
    const lang = /sitemaps\/sitemap-([a-z]{2})\.xml$/.exec(url);
    if (lang) return upstream.langOk ? new Response(langBlob(lang[1])) : new Response('missing', { status: 400 });
    if (url.startsWith(`${SUPABASE}/rest/v1/articles?`)) return Response.json(ARTICLES);
    if (url.startsWith(`${SUPABASE}/rest/v1/content_pages?`)) return Response.json(CONTENT_PAGES);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

// In-memory stand-in for caches.default; a hit carries CF-Cache-Status like the real Cache API.
class FakeCache {
  store = new Map<string, Response>();
  puts: string[] = [];
  async match(request: Request): Promise<Response | undefined> {
    const stored = this.store.get(request.url);
    if (!stored) return undefined;
    const copy = new Response(stored.clone().body, stored);
    copy.headers.set('CF-Cache-Status', 'HIT');
    return copy;
  }
  async put(request: Request, response: Response): Promise<void> {
    expect(request.method).toBe('GET');
    this.puts.push(request.url);
    const body = await response.arrayBuffer();
    this.store.set(request.url, new Response(body, response));
  }
}

let cache: FakeCache;
let pending: Promise<unknown>[];
let savedAnonKey: string | undefined;

function ctx(): ExecutionContext {
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
}

const env = { SUPABASE_ANON_KEY: ANON, SUPABASE_URL: 'https://unused.example' } as unknown as Env;

async function viaWorker(path: string, method = 'GET'): Promise<Response | null> {
  return handleSitemap(new Request(new URL(path, ORIGIN), { method }), env, ctx());
}

interface Direct {
  status: number;
  headers: Array<[string, string]>;
  body: string;
}

// api/sitemap.js called directly with a hand-built Vercel req/res.
async function direct(url: string): Promise<Direct> {
  const headers = new Map<string, string>();
  let status = 200;
  let body = '';
  const res = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), String(value));
      return res;
    },
    status(code: number) {
      status = code;
      return res;
    },
    send(payload: string) {
      body = payload;
      return res;
    },
  };
  const query = Object.fromEntries(new URL(url, 'http://localhost').searchParams);
  await sitemapHandler({ method: 'GET', url, query, headers: {} }, res);
  return { status, headers: [...headers.entries()].sort(), body };
}

async function snapshot(res: Response): Promise<Direct> {
  return { status: res.status, headers: [...res.headers.entries()].sort(), body: await res.text() };
}

// Public path -> the req.url Vercel hands api/sitemap.js (vercel.json:130-145).
const MAPPED: Array<[string, string]> = [
  ['/sitemap.xml', '/api/sitemap?type=main-index'],
  ['/sitemap-complete.xml', '/api/sitemap'],
  ['/sitemap-index.xml', '/api/sitemap?type=index'],
  ...LANGS.map((lang): [string, string] => [`/sitemap-${lang}.xml`, `/api/sitemap?type=lang&lang=${lang}`]),
  ['/api/sitemap', '/api/sitemap'],
  ['/api/sitemap?type=index', '/api/sitemap?type=index'],
  ['/api/sitemap?type=lang&lang=fr', '/api/sitemap?type=lang&lang=fr'],
  ['/sitemap-xx.xml', '/api/sitemap?type=lang&lang=xx'],
  ['/sitemap-enx.xml', '/api/sitemap?type=lang&lang=enx'],
  ['/sitemap-de.xml?utm_source=parity', '/api/sitemap?type=lang&lang=de&utm_source=parity'],
  ['/sitemap-complete.xml?x=1', '/api/sitemap?x=1'],
  ['/sitemap.xml?type=index', '/api/sitemap?type=main-index&type=index'],
];

beforeEach(() => {
  upstream = { completeOk: true, langOk: true };
  stubFetch();
  cache = new FakeCache();
  vi.stubGlobal('caches', { default: cache });
  pending = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  savedAnonKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_ANON_KEY = ANON;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (savedAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = savedAnonKey;
});

describe('rewriteSitemapPath', () => {
  it.each(MAPPED)('%s -> %s', (path, expected) => {
    expect(rewriteSitemapPath(new URL(path, ORIGIN))).toBe(expected);
  });

  it('keeps the :lang value raw (path-to-regexp segment, non-greedy before .xml)', () => {
    expect(rewriteSitemapPath(new URL('/sitemap-a.b.xml', ORIGIN))).toBe('/api/sitemap?type=lang&lang=a.b');
    expect(rewriteSitemapPath(new URL('/sitemap-%65n.xml', ORIGIN))).toBe('/api/sitemap?type=lang&lang=%65n');
  });

  it.each([
    '/sitemap',
    '/sitemap-.xml',
    '/sitemap-en.xml/',
    '/sitemaps.xml',
    '/sitemap.xml/',
    '/SITEMAP.xml',
    '/sitemap-en.XML',
    '/sitemap-a/b.xml',
    '/en/sitemap.xml',
    '/api/sitemap/',
    '/api/sitemapx',
    '/api/sitemap.js',
    '/robots.txt',
  ])('%s is not a sitemap path', (path) => {
    expect(rewriteSitemapPath(new URL(path, ORIGIN))).toBeNull();
  });
});

describe('handleSitemap', () => {
  it('returns null for a non-sitemap path without fetching', async () => {
    expect(await viaWorker('/en/services')).toBeNull();
    expect(await viaWorker('/api/emails')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const scenario of ['storage blobs', 'storage down (dynamic fallback, lang 404)'] as const) {
    describe(scenario, () => {
      beforeEach(() => {
        if (scenario !== 'storage blobs') upstream = { completeOk: false, langOk: false };
      });

      it.each(MAPPED)('%s equals api/sitemap.js called with req.url %s', async (path, rewritten) => {
        const expected = await direct(rewritten);
        const actual = await viaWorker(path);
        expect(actual).not.toBeNull();
        expect(await snapshot(actual!)).toEqual(expected);
        expect(expected.headers).toEqual([
          ['cache-control', 'public, max-age=3600, s-maxage=3600'],
          ['content-type', 'application/xml; charset=utf-8'],
          ['vary', 'Accept-Encoding'],
        ]);
      });
    });
  }

  it('/sitemap-xx.xml answers 404 "Sitemap not found" as api/sitemap.js does', async () => {
    const res = (await viaWorker('/sitemap-xx.xml'))!;
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Sitemap not found');
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
  });

  it('/sitemap-enx.xml serves the en blob', async () => {
    const res = (await viaWorker('/sitemap-enx.xml'))!;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(langBlob('en'));
    expect(fetchMock).toHaveBeenCalledWith(`${STORAGE}sitemap-en.xml`, expect.anything());
  });

  it('/sitemap.xml is the generated index pointing at /sitemap-complete.xml with today as lastmod', async () => {
    const body = await (await viaWorker('/sitemap.xml'))!.text();
    expect(body).toContain('<loc>https://www.micronshub.eu/sitemap-complete.xml</loc>');
    expect(body).toContain('<lastmod>2026-10-02</lastmod>');
  });

  it('the dynamic fallback reads Supabase REST with the anon key from env', async () => {
    upstream.completeOk = false;
    delete process.env.SUPABASE_ANON_KEY;
    const res = (await viaWorker('/sitemap-complete.xml'))!;
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('https://www.micronshub.eu/en/blog/cnc-tips');
    expect(body).toContain('https://www.micronshub.eu/cs/vzdelavani');
    expect(process.env.SUPABASE_ANON_KEY).toBe(ANON);
    const rest = fetchMock.mock.calls.find(([u]) => String(u).includes('/rest/v1/articles'));
    expect((rest![1] as RequestInit).headers).toMatchObject({ apikey: ANON });
  });

  it('caches a 200 for the public URL and serves the hit without calling the handler again', async () => {
    const first = (await viaWorker('/sitemap-complete.xml'))!;
    const firstBody = await first.text();
    await Promise.all(pending);
    expect(cache.puts).toEqual([`${ORIGIN}/sitemap-complete.xml`]);
    const calls = fetchMock.mock.calls.length;

    const second = (await viaWorker('/sitemap-complete.xml'))!;
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(await second.text()).toBe(firstBody);
    expect(second.status).toBe(200);
    expect(second.headers.has('cf-cache-status')).toBe(false);
    expect([...second.headers.entries()].sort()).toEqual([...first.headers.entries()].sort());
  });

  it('keys the cache on the query too', async () => {
    await viaWorker('/sitemap-de.xml');
    await viaWorker('/sitemap-de.xml?a=1');
    await Promise.all(pending);
    expect(cache.puts).toEqual([`${ORIGIN}/sitemap-de.xml`, `${ORIGIN}/sitemap-de.xml?a=1`]);
  });

  it('never caches a non-200', async () => {
    expect((await viaWorker('/sitemap-xx.xml'))!.status).toBe(404);
    upstream.langOk = false;
    expect((await viaWorker('/sitemap-de.xml'))!.status).toBe(404);
    await Promise.all(pending);
    expect(cache.puts).toEqual([]);
    expect(pending).toEqual([]);
  });

  it('HEAD runs the GET logic (full body for the cache; finalise strips it) and shares the cache entry', async () => {
    const head = (await viaWorker('/sitemap-index.xml', 'HEAD'))!;
    expect(head.status).toBe(200);
    expect(await head.text()).toBe(INDEX_BLOB);
    await Promise.all(pending);
    expect(cache.puts).toEqual([`${ORIGIN}/sitemap-index.xml`]);
    const calls = fetchMock.mock.calls.length;
    const get = (await viaWorker('/sitemap-index.xml'))!;
    expect(await get.text()).toBe(INDEX_BLOB);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('other methods reach the handler and bypass the cache', async () => {
    const post = (await viaWorker('/api/sitemap?type=index', 'POST'))!;
    expect(post.status).toBe(200);
    expect(await post.text()).toBe(INDEX_BLOB);
    await Promise.all(pending);
    expect(cache.puts).toEqual([]);
  });

  it('works without a Cache API (caches undefined)', async () => {
    vi.stubGlobal('caches', undefined);
    const res = (await viaWorker('/sitemap-fr.xml'))!;
    expect(await res.text()).toBe(langBlob('fr'));
    expect(pending).toEqual([]);
  });

  it('a failing cache does not fail the request', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: async () => {
          throw new Error('match down');
        },
        put: async () => {
          throw new Error('put down');
        },
      },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = (await viaWorker('/sitemap-it.xml'))!;
    expect(await res.text()).toBe(langBlob('it'));
    await Promise.all(pending);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
