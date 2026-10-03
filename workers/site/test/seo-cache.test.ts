// KV SEO_CACHE layer behind the per-isolate Map caches (ARCHITECTURE.md §17; PLAN.md P1-4).

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { KV_GET_TIMEOUT_MS, MAP_MAX_ENTRIES, TieredCache, kvKey, kvTtlSeconds, type CacheIo, type CacheKind } from '../src/seo/cache';
import { CACHE_TTL, NEGATIVE_CACHE_TTL, SERVICE_FETCH_TIMEOUT_MS, cacheShape, createCaches } from '../src/seo/supabase';
import { createSeoHandler, type SeoHandler } from '../src/seo/handler';
import { MemoryKV, TestContext } from './helpers/kv';
import {
  AssetsStub, DUMMY_KEY, FixtureFetch, ORIGIN, REST_PREFIX, loadMiddleware, makeEnv, outcomeOf, runMiddleware, runWorker,
  type Failure, type Outcome,
} from './helpers/seo-harness';

function kindOf(key: string): CacheKind {
  return key.split(':')[2] as CacheKind;
}

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

// ─── Supabase answering a content-page lookup with a row that is not keyed by the requested segment ──────────
// The recorded fixture, except that the en content_pages lookup of each of `segments` is answered with the recorded
// en "about" row, although none of the segments is that row's slug or localized_slug. Unrecorded URLs answer [].

const ABOUT_EN_LOOKUP = 'content_pages?or=(slug.eq.about,localized_slug.eq.about)&language=eq.en&';

interface AliasRun {
  outcome: Outcome | null;
  calls: string[]; // REST URLs requested, sorted
}

function aliasFetch(segments: readonly string[], allowShellFetch: boolean) {
  const fixture = new FixtureFetch({ emptyForUnknown: true, allowShellFetch });
  const calls: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(REST_PREFIX)) calls.push(url);
    for (const segment of segments) {
      const e = encodeURIComponent(segment);
      url = url.replace(`content_pages?or=(slug.eq.${e},localized_slug.eq.${e})&language=eq.en&`, ABOUT_EN_LOOKUP);
    }
    return fixture.fetch(url, init);
  };
  return { fetch, calls };
}

async function workerAliased(path: string, segments: readonly string[], handler: SeoHandler, seoCache: MemoryKV): Promise<AliasRun> {
  const f = aliasFetch(segments, false);
  const ctx = new TestContext();
  const env = makeEnv({ seoCache, flags: new MemoryKV(), assets: new AssetsStub() });
  vi.stubGlobal('fetch', f.fetch);
  try {
    const res = await handler.handleSeo(new Request(ORIGIN + path), env, ctx.asContext());
    const outcome = res ? await outcomeOf(res) : null;
    await ctx.settle();
    return { outcome, calls: [...f.calls].sort() };
  } finally {
    vi.unstubAllGlobals();
  }
}

// middleware.ts on `paths` in order, in ONE module instance (one isolate, one set of Map caches).
async function middlewareAliased(paths: readonly string[], segments: readonly string[]): Promise<AliasRun[]> {
  const processEnv = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
  const middleware = await loadMiddleware();
  const saved = { key: processEnv.SUPABASE_ANON_KEY, vite: processEnv.VITE_SUPABASE_ANON_KEY };
  processEnv.SUPABASE_ANON_KEY = DUMMY_KEY;
  delete processEnv.VITE_SUPABASE_ANON_KEY;
  try {
    const runs: AliasRun[] = [];
    for (const path of paths) {
      const f = aliasFetch(segments, true);
      vi.stubGlobal('fetch', f.fetch);
      try {
        const res = await middleware(new Request(ORIGIN + path));
        runs.push({ outcome: res ? await outcomeOf(res) : null, calls: [...f.calls].sort() });
      } finally {
        vi.unstubAllGlobals();
      }
    }
    return runs;
  } finally {
    if (saved.key === undefined) delete processEnv.SUPABASE_ANON_KEY;
    else processEnv.SUPABASE_ANON_KEY = saved.key;
    if (saved.vite !== undefined) processEnv.VITE_SUPABASE_ANON_KEY = saved.vite;
  }
}

function io(kv: MemoryKV | undefined, ctx = new TestContext()): CacheIo {
  return { kv: kv?.asBinding(), waitUntil: (p) => ctx.waitUntil(p) };
}

let errors: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TieredCache', () => {
  it('key format and KV TTL (KV minimum 60 s)', () => {
    expect(kvKey('sp', ['en', 'cnc-machining'])).toBe('seo:v1:sp:en:cnc-machining');
    expect(kvKey('cpalt', ['education'])).toBe('seo:v1:cpalt:education');
    expect(kvTtlSeconds(CACHE_TTL)).toBe(3600);
    expect(kvTtlSeconds(1000)).toBe(60);
    expect(kvTtlSeconds(90_500)).toBe(91);
  });

  it('miss in both tiers, then set writes Map and KV (through waitUntil) with {data, expires}', async () => {
    const kv = new MemoryKV();
    const ctx = new TestContext();
    const cache = new TieredCache<{ a: number } | null>('sp');
    expect(await cache.get(['en', 'x'], io(kv, ctx))).toBeUndefined();
    cache.set(['en', 'x'], { a: 1 }, CACHE_TTL, io(kv, ctx));
    expect(ctx.pending).toHaveLength(1);
    await ctx.settle();
    expect(kv.puts).toEqual([{ key: 'seo:v1:sp:en:x', value: JSON.stringify({ data: { a: 1 }, expires: NOW + CACHE_TTL }), expirationTtl: 3600 }]);
  });

  it('Map hit does not read KV', async () => {
    const kv = new MemoryKV();
    const cache = new TieredCache<string>('list');
    cache.set(['en'], 'rows', CACHE_TTL, io(kv));
    kv.gets.length = 0;
    expect(await cache.get(['en'], io(kv))).toEqual({ data: 'rows', failed: false });
    expect(kv.gets).toEqual([]);
  });

  it('KV hit (fresh isolate) returns the data and fills the Map with the same expires', async () => {
    const kv = new MemoryKV();
    await kv.put('seo:v1:cp:en:about', JSON.stringify({ data: { slug: 'about' }, expires: NOW + 1000 }));
    const cache = new TieredCache<{ slug: string }>('cp');
    expect(await cache.get(['en', 'about'], io(kv))).toEqual({ data: { slug: 'about' }, failed: false });
    kv.gets.length = 0;
    expect(await cache.get(['en', 'about'], io(kv))).toEqual({ data: { slug: 'about' }, failed: false });
    expect(kv.gets).toEqual([]); // served by the Map now
    vi.setSystemTime(NOW + 1000); // Map entry expires with the KV expires
    expect(await cache.get(['en', 'about'], io(kv))).toBeUndefined();
  });

  it('a KV entry with expires in the past is a miss even though KV still returns it', async () => {
    const kv = new MemoryKV();
    new TieredCache<string>('cp').set(['en', 'about'], 'row', CACHE_TTL, io(kv));
    vi.setSystemTime(NOW + CACHE_TTL - 1);
    expect(await new TieredCache<string>('cp').get(['en', 'about'], io(kv))).toEqual({ data: 'row', failed: false });
    vi.setSystemTime(NOW + CACHE_TTL);
    expect(kv.store.has('seo:v1:cp:en:about')).toBe(true);
    expect(await new TieredCache<string>('cp').get(['en', 'about'], io(kv))).toBeUndefined();
  });

  it('malformed KV values are misses', async () => {
    const kv = new MemoryKV();
    const cache = new TieredCache<unknown>('sp');
    for (const value of ['"x"', '{"data":1}', '{"expires":"soon","data":1}', 'null']) {
      await kv.put('seo:v1:sp:en:x', value);
      expect(await cache.get(['en', 'x'], io(kv)), value).toBeUndefined();
    }
  });

  it('KV get error: logged, treated as a miss', async () => {
    const kv = new MemoryKV();
    kv.failGet = true;
    const cache = new TieredCache<string>('sp');
    expect(await cache.get(['en', 'x'], io(kv))).toBeUndefined();
    expect(errors.mock.calls.some((a) => String(a[0]).includes('"msg":"seo_kv_error","op":"get"'))).toBe(true);
  });

  it('KV put error: logged, never thrown', async () => {
    const kv = new MemoryKV();
    kv.failPut = true;
    const ctx = new TestContext();
    const cache = new TieredCache<string>('sp');
    expect(() => cache.set(['en', 'x'], 'v', CACHE_TTL, io(kv, ctx))).not.toThrow();
    await ctx.settle();
    expect(errors.mock.calls.some((a) => String(a[0]).includes('"op":"put"'))).toBe(true);
    expect(await cache.get(['en', 'x'], io(kv))).toEqual({ data: 'v', failed: false }); // Map still works
  });

  it('keys over 512 bytes are not cached in either tier (no KV call, no Map entry)', async () => {
    const kv = new MemoryKV();
    const cache = new TieredCache<string>('article');
    const parts = ['en', 'a'.repeat(600)];
    cache.set(parts, 'v', CACHE_TTL, io(kv));
    cache.setLocal(parts, 'v', NEGATIVE_CACHE_TTL);
    expect(kv.puts).toEqual([]);
    expect(cache.isolateSize).toBe(0);
    expect(await cache.get(parts, io(kv))).toBeUndefined();
    expect(kv.gets).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('a negative (no row) is cached in the isolate Map only, never written to KV; another isolate reads KV', async () => {
    const kv = new MemoryKV();
    const cache = new TieredCache<null>('cp', { shape: 'abc' });
    cache.setLocal(['en', 'zz'], null, NEGATIVE_CACHE_TTL);
    expect(kv.puts).toEqual([]);
    expect(await cache.get(['en', 'zz'], io(kv))).toEqual({ data: null, failed: false });
    expect(kv.gets).toEqual([]); // served by the Map
    expect(await new TieredCache<null>('cp', { shape: 'abc' }).get(['en', 'zz'], io(kv))).toBeUndefined();
    expect(kv.gets).toEqual(['seo:v1:cp:en:zz']); // a positive another isolate wrote would have been found
    vi.setSystemTime(NOW + NEGATIVE_CACHE_TTL);
    expect(cache.peek(['en', 'zz'])).toBeUndefined();
  });

  it('a failed lookup is cached in the isolate Map only (tagged failed), never written to KV', async () => {
    const kv = new MemoryKV();
    const cache = new TieredCache<null>('sp', { shape: 'abc' });
    cache.setLocal(['en', 'x'], null, NEGATIVE_CACHE_TTL, true);
    expect(kv.puts).toEqual([]);
    expect(cache.peek(['en', 'x'])).toEqual({ data: null, failed: true });
    expect(await new TieredCache<null>('sp', { shape: 'abc' }).get(['en', 'x'], io(kv))).toBeUndefined();
  });

  it('KV values carry the shape fingerprint "v"; another or a missing "v" is a miss (version skew)', async () => {
    const kv = new MemoryKV();
    const writer = new TieredCache<string>('cp', { shape: 'shape-a' });
    writer.set(['en', 'about'], 'row', CACHE_TTL, io(kv));
    expect(JSON.parse(kv.puts[0].value)).toEqual({ data: 'row', expires: NOW + CACHE_TTL, v: 'shape-a' });
    expect(await new TieredCache<string>('cp', { shape: 'shape-a' }).get(['en', 'about'], io(kv))).toEqual({ data: 'row', failed: false });
    expect(await new TieredCache<string>('cp', { shape: 'shape-b' }).get(['en', 'about'], io(kv))).toBeUndefined();
    await kv.put('seo:v1:cp:en:about', JSON.stringify({ data: 'row', expires: NOW + CACHE_TTL }));
    expect(await new TieredCache<string>('cp', { shape: 'shape-a' }).get(['en', 'about'], io(kv))).toBeUndefined();
  });

  it('every cache kind has its own stable shape, derived from its query', () => {
    const kinds: CacheKind[] = ['article', 'translations', 'list', 'sp', 'splist', 'cp', 'cpalt'];
    const shapes = kinds.map((k) => cacheShape(k));
    expect(new Set(shapes).size).toBe(kinds.length);
    for (const s of shapes) expect(s).toMatch(/^[0-9a-f]{8}$/);
    const caches = createCaches();
    for (const k of kinds) expect(caches[k].shape).toBe(cacheShape(k));
  });

  it('a stalled KV read is a miss after KV_GET_TIMEOUT_MS, logged as get_timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = new MemoryKV();
    kv.hangGet = true;
    const cache = new TieredCache<string>('sp');
    let settled = false;
    const pending = cache.get(['en', 'x'], io(kv)).then((v) => { settled = true; return v; });
    await vi.advanceTimersByTimeAsync(KV_GET_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeUndefined();
    expect(errors.mock.calls.some((a) => String(a[0]).includes('"msg":"seo_kv_error","op":"get_timeout"'))).toBe(true);
  });

  it('the isolate Map is bounded: expired entries go first, then the oldest written', async () => {
    const cache = new TieredCache<number>('cp', { maxEntries: 3 });
    const none = io(undefined);
    cache.setLocal(['a'], 1, NEGATIVE_CACHE_TTL);
    cache.set(['b'], 2, CACHE_TTL, none);
    cache.set(['c'], 3, CACHE_TTL, none);
    vi.setSystemTime(NOW + NEGATIVE_CACHE_TTL); // 'a' expired
    cache.set(['d'], 4, CACHE_TTL, none);
    expect(cache.isolateSize).toBe(3);
    expect(cache.peek(['a'])).toBeUndefined();
    expect(cache.peek(['b'])).toEqual({ data: 2, failed: false });
    cache.set(['e'], 5, CACHE_TTL, none); // nothing expired: 'b' (oldest) goes
    expect(cache.isolateSize).toBe(3);
    expect(cache.peek(['b'])).toBeUndefined();
    expect([cache.peek(['c'])?.data, cache.peek(['d'])?.data, cache.peek(['e'])?.data]).toEqual([3, 4, 5]);
    cache.set(['c'], 6, CACHE_TTL, none); // rewrite moves 'c' to the end: 'd' is now the oldest
    cache.set(['f'], 7, CACHE_TTL, none);
    expect(cache.peek(['d'])).toBeUndefined();
    expect(cache.peek(['c'])?.data).toBe(6);
  });

  it('expired Map entries are dropped on read', () => {
    const cache = new TieredCache<number>('cp');
    cache.setLocal(['a'], 1, NEGATIVE_CACHE_TTL);
    vi.setSystemTime(NOW + NEGATIVE_CACHE_TTL);
    expect(cache.peek(['a'])).toBeUndefined();
    expect(cache.isolateSize).toBe(0);
  });

  it('works without a KV binding', async () => {
    const cache = new TieredCache<string>('sp');
    cache.set(['en', 'x'], 'v', CACHE_TTL, io(undefined));
    expect(await cache.get(['en', 'x'], io(undefined))).toEqual({ data: 'v', failed: false });
  });
});

describe('handleSeo with KV SEO_CACHE', () => {
  it('writes positive rows for 1 h with the documented keys', async () => {
    const run = await runWorker('/en/services');
    const byKey = Object.fromEntries(run.seoCache.puts.map((p) => [p.key, p]));
    expect(Object.keys(byKey).sort()).toEqual(['seo:v1:sp:en:index', 'seo:v1:splist:en']);
    for (const p of Object.values(byKey)) {
      expect(p.expirationTtl).toBe(3600);
      const value = JSON.parse(p.value) as { expires: number; v: string };
      expect(Object.keys(value).sort()).toEqual(['data', 'expires', 'v']);
      expect(value.expires).toBe(NOW + CACHE_TTL);
      expect(value.v).toBe(cacheShape(kindOf(p.key)));
    }
  });

  it('a lookup answered with no row is a 30 s negative in the isolate Map, read from but never written to KV', async () => {
    const page = await runWorker('/en/zz-parity-404');
    expect(page.result).toBeNull();
    expect(page.seoCache.puts).toEqual([]);
    expect([...page.seoCache.gets].sort()).toEqual(['seo:v1:cp:en:zz-parity-404', 'seo:v1:cpalt:zz-parity-404']);
    expect(page.handler.caches.cp.peek(['en', 'zz-parity-404'])).toEqual({ data: null, failed: false });
    expect(page.handler.caches.cpalt.peek(['zz-parity-404'])).toEqual({ data: {}, failed: false });
    const article = await runWorker('/en/blog/zz-parity-404');
    expect(article.result).toBeNull();
    expect(article.seoCache.puts).toEqual([]);
    expect(article.seoCache.gets).toEqual(['seo:v1:article:en:zz-parity-404']);
    expect(article.handler.caches.article.peek(['en', 'zz-parity-404'])).toEqual({ data: null, failed: false });
    vi.setSystemTime(NOW + NEGATIVE_CACHE_TTL);
    expect(page.handler.caches.cp.peek(['en', 'zz-parity-404'])).toBeUndefined();
    expect(article.handler.caches.article.peek(['en', 'zz-parity-404'])).toBeUndefined();
  });

  it('N distinct unknown URLs cost no KV write; a real page in the same isolate still writes its rows', async () => {
    const N = 40;
    const handler = createSeoHandler();
    const seoCache = new MemoryKV();
    for (let i = 0; i < N; i += 1) {
      const lang = ['en', 'de', 'fr', 'cs'][i % 4];
      for (const path of [`/${lang}/zz-probe-${i}`, `/${lang}/blog/zz-probe-${i}`]) {
        const run = await runWorker(path, { handler, seoCache, emptyForUnknown: true });
        expect(run.result, path).toBeNull();
        expect(run.fixture.calls.length, path).toBeGreaterThan(0); // Supabase answered "no row"
      }
    }
    expect(seoCache.puts).toEqual([]);
    // KV is still read for each key (a row another isolate wrote would be found) ...
    const reads = (kind: CacheKind) => seoCache.gets.filter((k) => kindOf(k) === kind).length;
    expect([reads('cp'), reads('cpalt'), reads('article')]).toEqual([N, N, N]);
    // ... and each "no row" is held for 30 s in this isolate's Map, as in middleware.ts.
    expect([handler.caches.cp.isolateSize, handler.caches.cpalt.isolateSize, handler.caches.article.isolateSize]).toEqual([N, N, N]);
    expect(handler.caches.cp.peek(['de', 'zz-probe-1'])).toEqual({ data: null, failed: false });
    expect(handler.caches.article.peek(['fr', 'zz-probe-2'])).toEqual({ data: null, failed: false });

    const real = await runWorker('/en/about', { handler, seoCache });
    expect(real.result).not.toBeNull();
    expect(seoCache.puts.map((p) => p.key).sort()).toEqual(['seo:v1:cp:en:about', 'seo:v1:cpalt:about']);
    for (const p of seoCache.puts) {
      expect(p.expirationTtl).toBe(3600);
      expect(JSON.parse(p.value)).toMatchObject({ expires: NOW + CACHE_TTL, v: cacheShape(kindOf(p.key)) });
    }
  });

  it('service page and service list lookups answered with no row stay in the isolate Map; KV is read, never written', async () => {
    const handler = createSeoHandler();
    const seoCache = new MemoryKV();
    const options = { handler, seoCache, emptyForUnknown: true, overrides: [{ match: 'service_pages?', body: [] }] };
    // Service index (sp <lang>:index + splist <lang>) and service detail (sp <lang>:<service id>) URLs.
    const paths = ['/en/services', '/de/dienstleistungen', '/en/services/cnc-machining', '/fr/services/usinage-cnc', '/fi/palvelut/cnc-ty%C3%B6st%C3%B6'];
    for (const path of paths) {
      const run = await runWorker(path, options);
      expect(run.fixture.calls.some((c) => c.includes('service_pages?')), path).toBe(true); // Supabase answered "no row"
    }
    expect(seoCache.puts).toEqual([]);
    const spGets = seoCache.gets.filter((k) => kindOf(k) === 'sp' || kindOf(k) === 'splist').sort();
    expect(spGets).toEqual([
      'seo:v1:sp:de:index', 'seo:v1:sp:en:cnc-machining', 'seo:v1:sp:en:index', 'seo:v1:sp:fi:cnc-machining', 'seo:v1:sp:fr:cnc-machining',
      'seo:v1:splist:de', 'seo:v1:splist:en',
    ]);
    for (const parts of [['en', 'index'], ['de', 'index'], ['en', 'cnc-machining'], ['fr', 'cnc-machining'], ['fi', 'cnc-machining']]) {
      expect(handler.caches.sp.peek(parts), parts.join(':')).toEqual({ data: null, failed: false });
    }
    expect(handler.caches.splist.peek(['en'])).toEqual({ data: [], failed: false });
    expect(handler.caches.splist.peek(['de'])).toEqual({ data: [], failed: false });
    vi.setSystemTime(NOW + NEGATIVE_CACHE_TTL);
    expect(handler.caches.sp.peek(['en', 'index'])).toBeUndefined();
    expect(handler.caches.splist.peek(['en'])).toBeUndefined();
  });

  it('a content row found under a URL segment that is neither its slug nor its localized_slug stays in the isolate Map (1 h), as in middleware.ts; no KV write per segment', async () => {
    const N = 20;
    const segments = Array.from({ length: N }, (_, i) => `zz-alias-${i}`);
    const handler = createSeoHandler();
    const seoCache = new MemoryKV();
    const runs: AliasRun[] = [];
    for (const segment of segments) runs.push(await workerAliased(`/en/${segment}`, segments, handler, seoCache));
    for (const run of runs) {
      expect(run.outcome!.status).toBe(200);
      expect(run.outcome!.headers).toContainEqual(['x-seo-source', 'db']); // Supabase found the row every time
    }
    // No cp key per segment in KV; the one write is the row's own alternates cluster, keyed by its slug.
    expect(seoCache.puts.map((p) => p.key)).toEqual(['seo:v1:cpalt:about']);
    expect(seoCache.gets.filter((k) => kindOf(k) === 'cp')).toHaveLength(N); // KV is still read
    expect(handler.caches.cp.isolateSize).toBe(N);
    expect(handler.caches.cp.peek(['en', 'zz-alias-3'])).toMatchObject({ data: { slug: 'about' }, failed: false });

    // Same isolate: answered from the Map, no REST call, same document.
    const again = await workerAliased('/en/zz-alias-0', segments, handler, seoCache);
    expect(again.calls).toEqual([]);
    expect(again.outcome).toEqual(runs[0].outcome);
    // middleware.ts on the same sequence: same bytes and the same REST calls, request by request.
    const mw = await middlewareAliased(['/en/zz-alias-0', '/en/zz-alias-1', '/en/zz-alias-0'], segments);
    expect(mw).toEqual([runs[0], runs[1], again]);

    // Lookups under a row's own slug or localized_slug still write KV (1 h).
    await runWorker('/en/about', { handler, seoCache });
    await runWorker('/cs/vzdelavani', { handler, seoCache });
    expect(seoCache.puts.map((p) => p.key).sort()).toEqual([
      'seo:v1:cp:cs:vzdelavani', 'seo:v1:cp:en:about', 'seo:v1:cpalt:about', 'seo:v1:cpalt:education',
    ]);
    for (const p of seoCache.puts) {
      expect(p.expirationTtl).toBe(3600);
      expect(JSON.parse(p.value)).toMatchObject({ expires: NOW + CACHE_TTL, v: cacheShape(kindOf(p.key)) });
    }

    // The Map entry lives as long as a positive (CACHE_TTL), not NEGATIVE_CACHE_TTL.
    vi.setSystemTime(NOW + CACHE_TTL - 1);
    expect(handler.caches.cp.peek(['en', 'zz-alias-0'])).toMatchObject({ data: { slug: 'about' }, failed: false });
    vi.setSystemTime(NOW + CACHE_TTL);
    expect(handler.caches.cp.peek(['en', 'zz-alias-0'])).toBeUndefined();
  });

  it('article lookups use kinds article and translations', async () => {
    const run = await runWorker('/en/blog/spot-welding-vs-riveting-strength-comparisons-for-assembly');
    expect(run.seoCache.puts.map((p) => p.key).sort()).toEqual([
      'seo:v1:article:en:spot-welding-vs-riveting-strength-comparisons-for-assembly',
      'seo:v1:translations:f81bf596-49c9-4f8b-bf0a-6c73dd0e267c',
    ]);
    const list = await runWorker('/sv/blogg');
    expect(list.seoCache.puts.map((p) => p.key)).toEqual(['seo:v1:list:sv']);
  });

  it('a KV row is used before Supabase (Map -> KV -> Supabase)', async () => {
    const seoCache = new MemoryKV();
    const first = await runWorker('/en/services/cnc-machining', { seoCache });
    const entry = JSON.parse(seoCache.store.get('seo:v1:sp:en:cnc-machining')!) as { data: { title: string }; expires: number };
    entry.data.title = 'Edited in KV';
    await seoCache.put('seo:v1:sp:en:cnc-machining', JSON.stringify(entry));
    const second = await runWorker('/en/services/cnc-machining', { seoCache, handler: createSeoHandler() });
    expect(second.fixture.calls).toEqual([]);
    expect(second.outcome!.body).toContain('<title>Edited in KV | Microns Hub</title>');
    expect(first.outcome!.body).not.toContain('Edited in KV');
  });

  it('the isolate Map answers repeated requests without KV or Supabase', async () => {
    const handler = createSeoHandler();
    const seoCache = new MemoryKV();
    await runWorker('/en/services/cnc-machining', { seoCache, handler });
    seoCache.gets.length = 0;
    const again = await runWorker('/en/services/cnc-machining', { seoCache, handler });
    expect(again.fixture.calls).toEqual([]);
    expect(seoCache.gets).toEqual([]);
  });

  it('negatives are per isolate (as middleware.ts): no new REST call within 30 s, another isolate asks Supabase', async () => {
    const handler = createSeoHandler();
    const seoCache = new MemoryKV();
    await runWorker('/en/zz-parity-404', { handler, seoCache });
    const within = await runWorker('/en/zz-parity-404', { handler, seoCache });
    expect(within.fixture.calls).toEqual([]);
    const otherIsolate = await runWorker('/en/zz-parity-404', { seoCache, handler: createSeoHandler() });
    expect(otherIsolate.fixture.calls).toHaveLength(2);
    vi.setSystemTime(NOW + NEGATIVE_CACHE_TTL);
    const after = await runWorker('/en/zz-parity-404', { handler, seoCache });
    expect(after.fixture.calls).toHaveLength(2);
    expect(seoCache.puts).toEqual([]);
  });

  it('KV errors never fail a request and give the same document', async () => {
    const reference = await runWorker('/en/about');
    const broken = new MemoryKV();
    broken.failGet = true;
    broken.failPut = true;
    const run = await runWorker('/en/about', { seoCache: broken });
    expect(run.outcome).toEqual(reference.outcome);
    expect(errors.mock.calls.filter((a) => String(a[0]).includes('seo_kv_error')).length).toBeGreaterThanOrEqual(4);
  });

  it('a failed lookup is a 30 s negative in this isolate only (as middleware.ts), never written to KV', async () => {
    const handler = createSeoHandler();
    const seoCache = new MemoryKV();
    const failures: Failure[] = [{ match: 'service_pages?slug=eq.cnc-machining&language=eq.en&', mode: 'status500' }];
    const run = await runWorker('/en/services/cnc-machining', { handler, seoCache, failures });
    expect(run.outcome!.headers).toContainEqual(['x-seo-source', 'i18n']);
    expect(run.seoCache.puts).toEqual([]);
    expect(handler.caches.sp.peek(['en', 'cnc-machining'])).toEqual({ data: null, failed: true });
    // Same isolate within 30 s: the cached failure, no REST call (middleware.ts:224-235).
    const again = await runWorker('/en/services/cnc-machining', { handler, seoCache });
    expect(again.fixture.calls).toEqual([]);
    expect(again.outcome).toEqual(run.outcome);
    // Another isolate asks Supabase and serves the DB document.
    const other = await runWorker('/en/services/cnc-machining', { seoCache, handler: createSeoHandler() });
    expect(other.fixture.calls).toHaveLength(1);
    expect(other.outcome!.headers).toContainEqual(['x-seo-source', 'db']);
  });

  it("one isolate's Supabase failure does not change the document other isolates serve", async () => {
    const seoCache = new MemoryKV();
    const a = await runWorker('/en', { seoCache, failures: [{ match: 'content_pages?or=(slug.eq.home', mode: 'status500' }] });
    expect(a.outcome!.headers).toContainEqual(['x-seo-source', 'none']);
    const b = await runWorker('/en', { seoCache, handler: createSeoHandler() });
    const vercel = await runMiddleware('/en');
    expect(b.outcome!.headers).toContainEqual(['x-seo-source', 'db']);
    expect(b.outcome).toEqual(vercel.outcome);
  });

  it('a KV value written with another shape (other deployed version) is ignored: same bytes as middleware.ts', async () => {
    const reference = await runMiddleware('/en/about');
    const seoCache = new MemoryKV();
    const first = await runWorker('/en/about', { seoCache });
    const key = 'seo:v1:cp:en:about';
    const stored = JSON.parse(seoCache.store.get(key)!) as { data: Record<string, unknown>; expires: number; v: string };
    const { faq: _faq, cross_links: _cl, internal_links: _il, ...stripped } = stored.data;
    await seoCache.put(key, JSON.stringify({ data: stripped, expires: stored.expires, v: 'deadbeef' }));
    const run = await runWorker('/en/about', { seoCache, handler: createSeoHandler() });
    expect(run.fixture.calls.some((c) => c.includes('content_pages?or=(slug.eq.about'))).toBe(true);
    expect(run.outcome).toEqual(reference.outcome);
    expect(first.outcome).toEqual(reference.outcome);
  });

  it('the isolate Maps of a handler stay bounded under many distinct miss URLs', async () => {
    const handler = createSeoHandler();
    const seoCache = new MemoryKV();
    for (let i = 0; i < MAP_MAX_ENTRIES + 50; i += 1) {
      handler.caches.cp.setLocal(['en', `probe-${i}`], null, NEGATIVE_CACHE_TTL);
    }
    expect(handler.caches.cp.isolateSize).toBe(MAP_MAX_ENTRIES);
    // And through the request path (unknown REST URLs answer [] here).
    for (let i = 0; i < 5; i += 1) await runWorker(`/en/zz-probe-${i}`, { handler, seoCache, emptyForUnknown: true });
    expect(handler.caches.cp.isolateSize).toBe(MAP_MAX_ENTRIES);
    expect(handler.caches.cpalt.isolateSize).toBe(5);
  });

  it('article failures are not cached (as middleware.ts:126, :132)', async () => {
    const run = await runWorker('/en/blog/zz-parity-404', {
      failures: [{ match: 'articles?slug=eq.zz-parity-404', mode: 'throw' }],
    });
    expect(run.result).toBeNull();
    expect(run.seoCache.puts).toEqual([]);
  });
});

describe('KV reads cannot stretch the 2.5 s bound of middleware.ts', () => {
  const path = '/en/services/sheet-metal';
  const match = 'service_pages?slug=eq.sheet-metal&language=eq.en&';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('stalled KV and stalled Supabase: the i18n fallback at 2.5 s, same document as middleware.ts', async () => {
    const failures: Failure[] = [{ match, mode: 'hang' }];
    const advance = async () => { await vi.advanceTimersByTimeAsync(SERVICE_FETCH_TIMEOUT_MS); };
    const mw = await runMiddleware(path, { failures, advance });
    const seoCache = new MemoryKV();
    seoCache.hangGet = true;
    const wk = await runWorker(path, { failures, seoCache, advance });
    expect(wk.outcome!.headers).toContainEqual(['x-seo-source', 'i18n']);
    expect(wk.outcome).toEqual(mw.outcome);
    expect(seoCache.puts).toEqual([]); // the timeout negative is per isolate
  });

  it('stalled KV, healthy Supabase: KV is skipped after KV_GET_TIMEOUT_MS and the DB document is served', async () => {
    const mw = await runMiddleware('/en/services/cnc-machining');
    const seoCache = new MemoryKV();
    seoCache.hangGet = true;
    const wk = await runWorker('/en/services/cnc-machining', { seoCache, advance: async () => { await vi.advanceTimersByTimeAsync(KV_GET_TIMEOUT_MS); } });
    expect(wk.outcome!.headers).toContainEqual(['x-seo-source', 'db']);
    expect(wk.outcome).toEqual(mw.outcome);
    expect(errors.mock.calls.some((a) => String(a[0]).includes('"op":"get_timeout"'))).toBe(true);
  });

  it('stalled KV on the unbounded lookups (article, list): the request still settles', async () => {
    for (const p of ['/en/blog/spot-welding-vs-riveting-strength-comparisons-for-assembly', '/sv/blogg']) {
      const mw = await runMiddleware(p);
      const seoCache = new MemoryKV();
      seoCache.hangGet = true;
      const wk = await runWorker(p, { seoCache, advance: async () => { await vi.advanceTimersByTimeAsync(2 * KV_GET_TIMEOUT_MS); } });
      expect(wk.outcome, p).toEqual(mw.outcome);
    }
  });
});
