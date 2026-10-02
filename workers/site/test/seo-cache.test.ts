// KV SEO_CACHE layer behind the per-isolate Map caches (ARCHITECTURE.md §17; PLAN.md P1-4).

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { KV_GET_TIMEOUT_MS, MAP_MAX_ENTRIES, TieredCache, kvKey, kvTtlSeconds, type CacheIo, type CacheKind } from '../src/seo/cache';
import { CACHE_TTL, NEGATIVE_CACHE_TTL, SERVICE_FETCH_TIMEOUT_MS, cacheShape, createCaches } from '../src/seo/supabase';
import { createSeoHandler } from '../src/seo/handler';
import { MemoryKV, TestContext } from './helpers/kv';
import { runMiddleware, runWorker, type Failure } from './helpers/seo-harness';

function kindOf(key: string): CacheKind {
  return key.split(':')[2] as CacheKind;
}

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

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
    expect(kvTtlSeconds(NEGATIVE_CACHE_TTL)).toBe(60);
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
    const cache = new TieredCache<null>('cp');
    cache.set(['en', 'zz'], null, NEGATIVE_CACHE_TTL, io(kv));
    expect(kv.puts[0].expirationTtl).toBe(60);
    const fresh = new TieredCache<null>('cp');
    vi.setSystemTime(NOW + NEGATIVE_CACHE_TTL - 1);
    expect(await fresh.get(['en', 'zz'], io(kv))).toEqual({ data: null, failed: false });
    const fresh2 = new TieredCache<null>('cp');
    vi.setSystemTime(NOW + NEGATIVE_CACHE_TTL);
    expect(kv.store.has('seo:v1:cp:en:zz')).toBe(true);
    expect(await fresh2.get(['en', 'zz'], io(kv))).toBeUndefined();
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
    expect(kv.puts).toEqual([]);
    expect(cache.isolateSize).toBe(0);
    expect(await cache.get(parts, io(kv))).toBeUndefined();
    expect(kv.gets).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('a failed lookup is cached in the isolate Map only (tagged failed), never written to KV', async () => {
    const kv = new MemoryKV();
    const ctx = new TestContext();
    const cache = new TieredCache<null>('sp', { shape: 'abc' });
    cache.set(['en', 'x'], null, NEGATIVE_CACHE_TTL, io(kv, ctx), true);
    await ctx.settle();
    expect(ctx.pending).toEqual([]);
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
    cache.set(['a'], 1, NEGATIVE_CACHE_TTL, none);
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
    cache.set(['a'], 1, NEGATIVE_CACHE_TTL, io(undefined));
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

  it('writes negative rows for 30 s (expires) with a 60 s KV TTL', async () => {
    const run = await runWorker('/en/zz-parity-404');
    expect(run.result).toBeNull();
    const keys = run.seoCache.puts.map((p) => p.key).sort();
    expect(keys).toEqual(['seo:v1:cp:en:zz-parity-404', 'seo:v1:cpalt:zz-parity-404']);
    for (const p of run.seoCache.puts) {
      expect(p.expirationTtl).toBe(60);
      expect(JSON.parse(p.value)).toEqual({
        data: p.key.includes('cpalt') ? {} : null, expires: NOW + NEGATIVE_CACHE_TTL, v: cacheShape(kindOf(p.key)),
      });
    }
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

  it('negative entries expire after 30 s: Supabase is asked again', async () => {
    const seoCache = new MemoryKV();
    await runWorker('/en/zz-parity-404', { seoCache });
    const within = await runWorker('/en/zz-parity-404', { seoCache, handler: createSeoHandler() });
    expect(within.fixture.calls).toEqual([]);
    vi.setSystemTime(NOW + NEGATIVE_CACHE_TTL);
    const after = await runWorker('/en/zz-parity-404', { seoCache, handler: createSeoHandler() });
    expect(after.fixture.calls).toHaveLength(2);
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
      handler.caches.cp.set(['en', `probe-${i}`], null, NEGATIVE_CACHE_TTL, { kv: undefined, waitUntil: () => {} });
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
