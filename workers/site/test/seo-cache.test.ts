// KV SEO_CACHE layer behind the per-isolate Map caches (ARCHITECTURE.md §17; PLAN.md P1-4).

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { TieredCache, kvKey, kvTtlSeconds, type CacheIo } from '../src/seo/cache';
import { CACHE_TTL, NEGATIVE_CACHE_TTL } from '../src/seo/supabase';
import { createSeoHandler } from '../src/seo/handler';
import { MemoryKV, TestContext } from './helpers/kv';
import { runWorker } from './helpers/seo-harness';

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

  it('keys over 512 bytes skip KV (Map only)', async () => {
    const kv = new MemoryKV();
    const cache = new TieredCache<string>('article');
    const parts = ['en', 'a'.repeat(600)];
    cache.set(parts, 'v', CACHE_TTL, io(kv));
    expect(kv.puts).toEqual([]);
    expect(await new TieredCache<string>('article').get(parts, io(kv))).toBeUndefined();
    expect(kv.gets).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
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
      expect((JSON.parse(p.value) as { expires: number }).expires).toBe(NOW + CACHE_TTL);
    }
  });

  it('writes negative rows for 30 s (expires) with a 60 s KV TTL', async () => {
    const run = await runWorker('/en/zz-parity-404');
    expect(run.result).toBeNull();
    const keys = run.seoCache.puts.map((p) => p.key).sort();
    expect(keys).toEqual(['seo:v1:cp:en:zz-parity-404', 'seo:v1:cpalt:zz-parity-404']);
    for (const p of run.seoCache.puts) {
      expect(p.expirationTtl).toBe(60);
      expect(JSON.parse(p.value)).toEqual({ data: p.key.includes('cpalt') ? {} : null, expires: NOW + NEGATIVE_CACHE_TTL });
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

  it('a failed lookup is cached as a 30 s negative tagged "failed"', async () => {
    const run = await runWorker('/en/services/sheet-metal', {
      failures: [{ match: 'service_pages?slug=eq.sheet-metal&language=eq.en&', mode: 'status500' }],
    });
    expect(run.seoCache.puts).toHaveLength(1);
    expect(run.seoCache.puts[0]).toMatchObject({ key: 'seo:v1:sp:en:sheet-metal', expirationTtl: 60 });
    expect(JSON.parse(run.seoCache.puts[0].value)).toEqual({ data: null, expires: NOW + NEGATIVE_CACHE_TTL, failed: true });
  });

  it('article failures are not cached (as middleware.ts:126, :132)', async () => {
    const run = await runWorker('/en/blog/zz-parity-404', {
      failures: [{ match: 'articles?slug=eq.zz-parity-404', mode: 'throw' }],
    });
    expect(run.result).toBeNull();
    expect(run.seoCache.puts).toEqual([]);
  });
});
