// Unit tests of the SEO handler: route decisions equal to middleware.ts, shell handling (env.ASSETS, loud failure),
// Supabase configuration from env.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { transform } from 'esbuild';
import middlewareSource from '../../../middleware.ts?raw';
import { resolvePageType } from '../../../middleware/slugs';
import { LANGUAGES } from '../../../middleware/types';
import type { ParsedRoute } from '../../../middleware/types';
import { SLUGS } from '../../../middleware/slugs';
import { LOG_PREFIX } from '../src/env';
import { parseRoute } from '../src/seo/handler';
import { AssetsStub, CASES, FixtureFetch, ORIGIN, makeEnv, outcomeOf, runWorker } from './helpers/seo-harness';
import { MemoryKV, TestContext } from './helpers/kv';

type ParseRoute = (pathname: string) => ParsedRoute | null;

// middleware.ts:334-346, extracted from the file and compiled, with the real resolvePageType injected. middleware.ts
// does not export parseRoute, and importing the module would also run its fetch-based helpers' module state.
async function middlewareParseRoute(): Promise<ParseRoute> {
  const start = middlewareSource.indexOf('function parseRoute(pathname: string)');
  expect(start).toBeGreaterThan(0);
  const end = middlewareSource.indexOf('\n}\n', start);
  const tsSource = middlewareSource.slice(start, end + 2);
  const { code } = await transform(tsSource, { loader: 'ts' });
  return new Function('resolvePageType', `${code}\nreturn parseRoute;`)(resolvePageType) as ParseRoute;
}

function probePaths(): string[] {
  const paths = new Set<string>();
  for (const c of CASES) paths.add(new URL(c.path, ORIGIN).pathname);
  const extras = [
    '/', '/en', '/en/', '/en//', '/en///services', '/en/services//cnc-machining', '/en/services/cnc-machining/',
    '/EN', '/En/about', '/enx', '/en-us', '/xx', '/xx/about', '/el/login', '/en%2Fservices', '/en/%E0%A4%A',
    '/en/services/%E0%A4%A', '/fi/palvelut/cnc-työstö', '/fi/palvelut/cnc-ty%C3%B6st%C3%B6/', '/de/blog/a/b/c',
    '/en/blog/', '/en/blog//x', '/cs/vzdelavani/', '/en/zz-parity-404/zz', '/fi/zz/zz/zz', '/fi/blogi/zz-parity-404',
    '/en/quote-request', '/de/quote-request', '/en/quote/success', '/de/angebot/success', '/en/home', '/en/blog-x',
    '/en/index.html', '/fi/palvelut/index.html', '/en/about.html', '/pt/', '/nb/blogg/x', '/sv/blog/x',
    '/en/services/cnc-machining/zz/zz', '/hu/szolgaltatasok/frccsnyomas', '/en/a%20b', '/en/%41bout',
  ];
  for (const p of extras) paths.add(p);
  for (const lang of LANGUAGES) {
    const s = SLUGS[lang];
    paths.add(`/${lang}`);
    for (const seg of [s.services, s.about, s.contact, s.quote, s.industries, s.ourWork, s.blog, 'education', 'legal-notice', 'privacy-policy', 'login', 'zz']) {
      paths.add(`/${lang}/${seg}`);
      paths.add(`/${lang}/${encodeURIComponent(seg)}/zz`);
    }
    for (const id of Object.keys(s.serviceDetail) as Array<keyof typeof s.serviceDetail>) {
      paths.add(`/${lang}/${s.services}/${encodeURIComponent(s.serviceDetail[id])}`);
      paths.add(`/${lang}/services/${id}`);
    }
  }
  return [...paths];
}

describe('parseRoute', () => {
  it('makes the same decision as middleware.ts:334-346 for every probe path', async () => {
    const reference = await middlewareParseRoute();
    const paths = probePaths();
    expect(paths.length).toBeGreaterThan(300);
    for (const p of paths) {
      expect(parseRoute(p), p).toEqual(reference(p));
    }
  });

  it('normalises trailing and double slashes and decodes segments', () => {
    expect(parseRoute('/en/')).toEqual({ lang: 'en', type: 'homepage', pathAfterLang: '' });
    expect(parseRoute('/en//services')).toEqual(parseRoute('/en/services'));
    expect(parseRoute('/en/services/')).toEqual(parseRoute('/en/services'));
    expect(parseRoute('/fi/palvelut/cnc-ty%C3%B6st%C3%B6')).toMatchObject({ type: 'service-detail', serviceId: 'cnc-machining' });
    expect(parseRoute('/en/%E0%A4%A')).toMatchObject({ type: 'content-page', contentSlug: '%E0%A4%A' });
    expect(parseRoute('/EN')).toBeNull();
    expect(parseRoute('/en/zz/zz')).toBeNull();
  });
});

describe('handleSeo: shell and configuration', () => {
  let errors: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for every non-language path without touching ASSETS or Supabase', async () => {
    for (const p of ['/', '/EN', '/xx/about', '/services', '/assets/index.js', '/api/sitemap', '/sitemap.xml', '/enx']) {
      const run = await runWorker(p);
      expect(run.result, p).toBeNull();
      expect(run.assets.requests, p).toEqual([]);
      expect(run.fixture.calls, p).toEqual([]);
    }
  });

  it('fetches the shell from env.ASSETS at /index.html of the request origin, never by self-fetch', async () => {
    const run = await runWorker('/en/quote?x=1');
    expect(run.outcome?.status).toBe(200);
    expect(run.assets.requests).toEqual([{ method: 'GET', url: `${ORIGIN}/index.html` }]);
    expect(run.fixture.shellFetches).toEqual([]);
  });

  for (const shell of [500, 404, 'throw'] as const) {
    it(`shell ${shell}: logs a structured error and returns null (router falls through), no Supabase call`, async () => {
      const run = await runWorker('/en/services/cnc-machining', { assets: new AssetsStub({ shell }) });
      expect(run.result).toBeNull();
      expect(run.fixture.calls).toEqual([]);
      const lines = errors.mock.calls.map((args) => String(args[0]));
      const line = lines.find((l) => l.includes('seo_shell_failed'));
      expect(line).toBeDefined();
      expect(line!.startsWith(`${LOG_PREFIX} {`)).toBe(true);
      const fields = JSON.parse(line!.slice(LOG_PREFIX.length + 1)) as Record<string, unknown>;
      expect(fields).toMatchObject({ msg: 'seo_shell_failed', path: '/en/services/cnc-machining' });
      if (shell !== 'throw') expect(fields.status).toBe(shell);
    });
  }

  it('missing SUPABASE_ANON_KEY: one structured error per request, i18n fallback, no REST call', async () => {
    const run = await runWorker('/en/services/cnc-machining', { env: { SUPABASE_ANON_KEY: '' } });
    expect(run.outcome?.status).toBe(200);
    expect(run.outcome?.headers).toContainEqual(['x-seo-source', 'i18n']);
    expect(run.fixture.calls).toEqual([]);
    const lines = errors.mock.calls.map((args) => String(args[0])).filter((l) => l.includes('seo_supabase_config_missing'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('SUPABASE_ANON_KEY');
    expect(lines[0]).not.toContain('test-anon-key');
  });

  it('missing SUPABASE_URL: logged, helpers return their empty value', async () => {
    const run = await runWorker('/en/services', { env: { SUPABASE_URL: '' } });
    expect(run.outcome?.headers).toContainEqual(['x-seo-source', 'i18n']);
    expect(run.fixture.calls).toEqual([]);
    expect(errors.mock.calls.some((args) => String(args[0]).includes('"SUPABASE_URL"'))).toBe(true);
  });

  it('uses env.SUPABASE_URL and the anon key from env for REST calls', async () => {
    const run = await runWorker('/en/services/cnc-machining');
    expect(run.fixture.calls).toEqual([
      'https://cfjrtmtaitwzggzpkhxi.supabase.co/rest/v1/service_pages?slug=eq.cnc-machining&language=eq.en&status=eq.published'
        + '&select=slug,language,localized_slug,title,meta_description,h1,tagline,lead_paragraph,capabilities,applications,'
        + 'materials,tolerances,process_steps,lead_times,faq,differentiators,cross_links&limit=1'
        + ' | apikey=test-anon-key | authorization=Bearer test-anon-key',
    ]);
  });

  it('answers HEAD like GET (the router strips the body in finalise)', async () => {
    const get = await runWorker('/en/about');
    const head = await runWorker('/en/about', { method: 'HEAD' });
    expect(head.outcome).toEqual(get.outcome);
  });

  it('the exported handleSeo uses the module-level instance and the global fetch', async () => {
    vi.resetModules(); // a fresh module-level instance (empty isolate Maps)
    const mod = await import('../src/seo/handler');
    const seoCache = new MemoryKV();
    const env = makeEnv({ seoCache, flags: new MemoryKV(), assets: new AssetsStub() });
    const path = '/en/services/cnc-machining';
    const reference = await runWorker(path);

    const first = new FixtureFetch({ allowShellFetch: false });
    vi.stubGlobal('fetch', first.fetch);
    try {
      const ctx = new TestContext();
      const res = await mod.handleSeo(new Request(ORIGIN + path), env, ctx.asContext());
      await ctx.settle();
      expect(res).not.toBeNull();
      expect(await outcomeOf(res!)).toEqual(reference.outcome);
      expect(first.calls).toHaveLength(1); // the global fetch reached the REST fixture
    } finally {
      vi.unstubAllGlobals();
    }

    const second = new FixtureFetch({ allowShellFetch: false });
    vi.stubGlobal('fetch', second.fetch);
    seoCache.gets.length = 0;
    try {
      const ctx = new TestContext();
      const res = await mod.handleSeo(new Request(ORIGIN + path), env, ctx.asContext());
      expect(await outcomeOf(res!)).toEqual(reference.outcome);
      // Served by the module-level isolate Map: no KV read, no REST call.
      expect(second.calls).toEqual([]);
      expect(seoCache.gets).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
