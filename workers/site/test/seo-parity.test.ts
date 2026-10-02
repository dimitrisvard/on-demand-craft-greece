// Offline document parity (SEO_PARITY.md §6 smoke item c; PLAN.md P1-4): middleware.ts and the Worker SEO handler
// run on the same shell and the same recorded Supabase REST responses must return byte-identical bodies, the same
// status and the same headers, request the same REST URLs with the same headers, and agree on where there is no
// document (middleware.ts undefined <=> handleSeo null). A second Worker run with a fresh isolate in front of the
// warm KV SEO_CACHE must serve identical bytes without a REST call for any lookup that found data; only lookups
// Supabase answered with no row are asked again, as negatives are cached per isolate only (src/seo/cache.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeoHandler } from '../src/seo/handler';
import { CASES, FixtureFetch, firstDiff, runMiddleware, runWorker, type Failure, type Override } from './helpers/seo-harness';

// The recorded REST calls (FixtureFetch.calls format) whose answer, overrides applied, is not "no row" ([]).
async function callsWithRows(calls: readonly string[], overrides?: Override[]): Promise<string[]> {
  const replay = new FixtureFetch({ overrides });
  const out: string[] = [];
  for (const call of calls) {
    const body: unknown = await (await replay.fetch(call.split(' | ')[0])).json();
    if (!(Array.isArray(body) && body.length === 0)) out.push(call);
  }
  return out;
}

beforeEach(() => {
  // would_404 shadow-mode lines (flag off) are expected for the null cases; keep the output readable.
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('offline document parity: middleware.ts vs handleSeo', () => {
  it('covers at least 30 fixture URLs', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
    expect(CASES.filter((c) => c.expect === 'document').length).toBeGreaterThanOrEqual(30);
  });

  for (const c of CASES) {
    it(`${c.name}: ${c.path}`, async () => {
      const mw = await runMiddleware(c.path, { overrides: c.overrides });
      const wk = await runWorker(c.path, { overrides: c.overrides });

      expect(mw.fixture.unknown, 'middleware.ts requested an unrecorded URL').toEqual([]);
      expect(wk.fixture.unknown, 'handleSeo requested an unrecorded URL').toEqual([]);
      expect(wk.fixture.shellFetches, 'handleSeo must not self-fetch the shell').toEqual([]);
      expect([...wk.fixture.calls].sort()).toEqual([...mw.fixture.calls].sort());

      if (c.expect === 'null') {
        expect(mw.outcome).toBeNull();
        expect(wk.result).toBeNull();
      } else {
        expect(mw.outcome).not.toBeNull();
        expect(wk.outcome).not.toBeNull();
        const a = mw.outcome!;
        const b = wk.outcome!;
        expect(b.status).toBe(a.status);
        expect(b.headers).toEqual(a.headers);
        expect(firstDiff(a.body, b.body)).toBeNull();
        // Shell came from env.ASSETS, exactly once.
        expect(wk.assets.requests).toEqual([{ method: 'GET', url: `${new URL(c.path, 'https://www.micronshub.eu').origin}/index.html` }]);
      }

      // Warm KV, cold isolate: same bytes; no REST call except the "no row" lookups (negatives are per isolate).
      const warm = await runWorker(c.path, {
        overrides: c.overrides,
        seoCache: wk.seoCache,
        handler: createSeoHandler(),
      });
      expect(await callsWithRows(warm.fixture.calls, c.overrides)).toEqual([]);
      expect(warm.fixture.calls.filter((call) => !wk.fixture.calls.includes(call))).toEqual([]);
      expect(warm.fixture.unknown).toEqual([]);
      if (c.expect === 'null') {
        expect(warm.result).toBeNull();
      } else {
        expect(warm.outcome!.status).toBe(wk.outcome!.status);
        expect(warm.outcome!.headers).toEqual(wk.outcome!.headers);
        expect(firstDiff(wk.outcome!.body, warm.outcome!.body)).toBeNull();
      }
    });
  }
});

describe('failure modes give the same i18n fallback on both implementations', () => {
  const path = '/en/services/sheet-metal';
  const match = 'service_pages?slug=eq.sheet-metal&language=eq.en&';

  for (const mode of ['status500', 'throw'] as const) {
    it(`REST ${mode}`, async () => {
      const failures: Failure[] = [{ match, mode }];
      const mw = await runMiddleware(path, { failures });
      const wk = await runWorker(path, { failures });
      expect(mw.outcome).not.toBeNull();
      expect(wk.outcome).toEqual(mw.outcome);
      expect(wk.outcome!.headers).toContainEqual(['x-seo-source', 'i18n']);
      expect([...wk.fixture.calls].sort()).toEqual([...mw.fixture.calls].sort());
    });
  }

  it('REST timeout (2.5 s race, fake timers)', async () => {
    vi.useFakeTimers();
    const failures: Failure[] = [{ match, mode: 'hang' }];
    const advance = async () => { await vi.advanceTimersByTimeAsync(2500); };
    const mw = await runMiddleware(path, { failures, advance });
    const wk = await runWorker(path, { failures, advance });
    expect(mw.outcome).not.toBeNull();
    expect(wk.outcome).toEqual(mw.outcome);
    expect(wk.outcome!.headers).toContainEqual(['x-seo-source', 'i18n']);
  });

  it('missing anon key: same output as middleware.ts with an empty key, no REST call', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const p of ['/en', '/en/services', '/en/services/cnc-machining', '/en/blog', '/en/about', '/en/blog/spot-welding-vs-riveting-strength-comparisons-for-assembly', '/en/zz-parity-404']) {
      errors.mockClear();
      const mw = await runMiddleware(p, { anonKey: null });
      const wk = await runWorker(p, { env: { SUPABASE_ANON_KEY: '' } });
      expect(wk.outcome, p).toEqual(mw.outcome);
      expect(mw.fixture.calls).toEqual([]);
      expect(wk.fixture.calls).toEqual([]);
      const logged = errors.mock.calls.filter((args) => String(args[0]).includes('seo_supabase_config_missing'));
      expect(logged.length, p).toBe(1);
    }
  });
});
