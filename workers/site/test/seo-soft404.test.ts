// seo.strict_404 (SEO_PARITY.md §7; PLAN.md P1-4 "wired but off"): shadow logging while off, 404 + shell while on,
// real client routes and real files exempt, classes S-06/S-07/S-10/S-11 unchanged.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import routeMatcherSource from '../../../src/components/TranslatedRouteMatcher.tsx?raw';
import slugTranslatorSource from '../../../src/utils/urlSlugTranslator.ts?raw';
import appSource from '../../../src/App.tsx?raw';
import { LANGUAGES } from '../../../middleware/types';
import { t } from '../../../middleware/i18n';
import { APP_ONLY_PATHS, ROUTE_MAP_PATHS, SLUG_TRANSLATION_KEYS, englishPath, isClientRoute } from '../src/seo/clientRoutes';
import { parseRoute, soft404Class } from '../src/seo/handler';
import { MemoryKV } from './helpers/kv';
import { AssetsStub, SHELL, SHELL_HEADERS, runWorker } from './helpers/seo-harness';

const ARTICLE = 'spot-welding-vs-riveting-strength-comparisons-for-assembly';

// SEO_PARITY.md §7.1 probes (en · fi) of the classes that are null today.
const PROBES: Array<[string, string]> = [
  ['S-01', '/en/zz-parity-404'], ['S-01', '/fi/zz-parity-404'],
  ['S-02', '/en/zz-parity-404/zz'], ['S-02', '/fi/zz-parity-404/zz'],
  ['S-03', '/en/services/zz-parity-404'], ['S-03', '/fi/palvelut/zz-parity-404'],
  ['S-04', '/en/blog/zz-parity-404'], ['S-04', '/fi/blogi/zz-parity-404'],
  ['S-05', `/en/blog/${ARTICLE}/zz`], ['S-05', '/fi/blogi/pistehitsaus-vs-niittaus-lujuusvertailut-kokoonpanoissa/zz'],
  ['S-08', '/en/zz/zz/zz'], ['S-08', '/fi/zz/zz/zz'],
  ['S-09', '/en/about.html'], ['S-09', '/fi/meista.html'],
];

function flagsWith(enabled: boolean | null): MemoryKV {
  const kv = new MemoryKV();
  if (enabled !== null) kv.store.set('seo.strict_404', JSON.stringify({ enabled }));
  return kv;
}

const SORTED_SHELL_HEADERS = Object.entries(SHELL_HEADERS).sort((a, b) => a[0].localeCompare(b[0]));

let logs: MockInstance<(...args: unknown[]) => void>;
let errors: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function would404Lines(): Array<Record<string, unknown>> {
  return logs.mock.calls
    .map((args) => String(args[0]))
    .filter((l) => l.includes('"would_404"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('client-route tables are faithful copies of the React sources', () => {
  it('ROUTE_MAP_PATHS equals the keys of ROUTE_MAP in TranslatedRouteMatcher.tsx', () => {
    const start = routeMatcherSource.indexOf('const ROUTE_MAP');
    const end = routeMatcherSource.indexOf('};', start);
    const block = routeMatcherSource.slice(start, end);
    const keys = [...block.matchAll(/^\s*'(\/[^']*)'\s*:/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    expect([...ROUTE_MAP_PATHS]).toEqual(keys);
  });

  it('SLUG_TRANSLATION_KEYS equals urlSlugTranslator.ts, in order', () => {
    const start = slugTranslatorSource.indexOf('export const SLUG_TRANSLATION_KEYS');
    const end = slugTranslatorSource.indexOf('};', start);
    const pairs = [...slugTranslatorSource.slice(start, end).matchAll(/^\s*'([^']+)'\s*:\s*'([^']+)'/gm)].map((m) => [m[1], m[2]]);
    expect(SLUG_TRANSLATION_KEYS.map((p) => [...p])).toEqual(pairs);
  });

  it('every static /:lang route of App.tsx is a client route or served by the SEO handler', () => {
    const paths = [...appSource.matchAll(/path="\/(?::lang|en)(\/[^"]*)"/g)].map((m) => m[1]);
    expect(paths).toContain('/login');
    for (const p of paths) {
      if (p.includes(':')) continue; // :slug catch-alls and blog article routes
      const segs = p.split('/').filter(Boolean);
      const handled = parseRoute(`/en${p}`) !== null;
      const client = isClientRoute('en', segs);
      expect(handled || client, p).toBe(true);
      if (!handled) expect(APP_ONLY_PATHS.includes(p) || ROUTE_MAP_PATHS.includes(p), p).toBe(true);
    }
  });
});

describe('isClientRoute', () => {
  it('accepts every ROUTE_MAP page in every language, English and localized form', () => {
    for (const lang of LANGUAGES) {
      for (const p of [...ROUTE_MAP_PATHS, ...APP_ONLY_PATHS]) {
        const segs = p.split('/').filter(Boolean);
        expect(isClientRoute(lang, segs), `${lang} ${p}`).toBe(true);
        // translateUrlPath: each segment through its url_slug_* key
        const localized = segs.map((s) => {
          const key = SLUG_TRANSLATION_KEYS.find(([en]) => en === s)?.[1];
          return key ? t(lang, key, s) : s;
        });
        expect(englishPath(lang, localized), `${lang} ${localized.join('/')}`).toBe(p);
        expect(isClientRoute(lang, localized), `${lang} ${localized.join('/')}`).toBe(true);
      }
    }
  });

  it('accepts the client-only localized slugs the SEO handler has no row for', () => {
    expect(isClientRoute('de', ['bildung'])).toBe(true);
    expect(isClientRoute('de', ['impressum'])).toBe(true);
    expect(isClientRoute('fr', ['mentions-legales'])).toBe(true);
    expect(isClientRoute('it', ['impressum'])).toBe(true); // 'impressum' in any language -> legal-notice
    expect(isClientRoute('de', ['angebot', 'success'])).toBe(true);
    expect(isClientRoute('fi', ['yhteys', 'success'])).toBe(true);
    expect(isClientRoute('fi', ['palvelut', 'cnc-työstö'])).toBe(true);
  });

  it('rejects unknown pages, blog articles and deeper paths', () => {
    for (const [lang, segs] of [
      ['en', ['zz-parity-404']], ['en', ['zz', 'zz']], ['en', ['services', 'zz']], ['en', ['blog', 'x']],
      ['fi', ['blogi', 'x']], ['en', ['about.html']], ['en', ['quote', 'success', 'x']], ['en', []],
      ['de', ['dienstleistungen', 'zz']], ['en', ['index.html']],
    ] as const) {
      expect(isClientRoute(lang, segs), `${lang} ${segs.join('/')}`).toBe(false);
    }
  });
});

describe('soft404Class', () => {
  it('classifies the SEO_PARITY.md §7.1 probes', () => {
    for (const [cls, path] of PROBES) {
      const route = parseRoute(path);
      const [, lang, ...segs] = path.split('/');
      expect(soft404Class(lang as 'en', segs.map((s) => decodeURIComponent(s)), route), path).toBe(cls);
    }
  });
});

describe('seo.strict_404 off (default): shadow mode', () => {
  it('logs exactly one would_404 JSON line per probe and returns null', async () => {
    for (const [cls, path] of PROBES) {
      logs.mockClear();
      const run = await runWorker(path, { emptyForUnknown: true });
      expect(run.result, path).toBeNull();
      expect(would404Lines(), path).toEqual([{ msg: 'would_404', path, class: cls }]);
    }
  });

  it('reads the flag from KV FLAGS with the SEO_STRICT_404 var as fallback', async () => {
    const off = await runWorker('/en/zz-parity-404', { emptyForUnknown: true, flags: flagsWith(null) });
    expect(off.result).toBeNull();
    expect(off.flags.gets).toEqual(['seo.strict_404']);
  });

  it('no would_404 for client routes, documents, and non-language paths', async () => {
    for (const path of ['/en/login', '/de/bildung', '/de/impressum', '/en/about/zz', '/EN', '/xx/about', '/el/login', '/']) {
      logs.mockClear();
      await runWorker(path, { emptyForUnknown: true });
      expect(would404Lines(), path).toEqual([]);
    }
  });
});

describe('seo.strict_404 on', () => {
  for (const source of ['kv', 'var'] as const) {
    it(`404 + shell + SPA fallback headers for every probe (flag from ${source})`, async () => {
      for (const [, path] of PROBES) {
        const run = await runWorker(path, {
          emptyForUnknown: true,
          flags: flagsWith(source === 'kv' ? true : null),
          env: source === 'var' ? { SEO_STRICT_404: 'true' } : {},
        });
        expect(run.outcome, path).not.toBeNull();
        expect(run.outcome!.status, path).toBe(404);
        expect(run.outcome!.body === SHELL, path).toBe(true);
        expect(run.outcome!.headers, path).toEqual(SORTED_SHELL_HEADERS);
        expect(run.fixture.shellFetches, path).toEqual([]);
        expect(would404Lines()).toEqual([]);
      }
    });
  }

  it('a KV value false wins over the var', async () => {
    const run = await runWorker('/en/zz-parity-404', { emptyForUnknown: true, flags: flagsWith(false), env: { SEO_STRICT_404: 'true' } });
    expect(run.result).toBeNull();
  });

  it('real client routes keep null (SPA shell 200)', async () => {
    for (const path of ['/en/login', '/de/login', '/fi/login', '/de/bildung', '/de/impressum', '/fr/mentions-legales', '/en/education', '/pl/legal-notice', '/en/privacy-policy']) {
      // No content_pages row for the path: the handler has no document, the client renders the page.
      const run = await runWorker(path, {
        emptyForUnknown: true,
        flags: flagsWith(true),
        overrides: [{ match: 'content_pages?or=', body: [] }],
      });
      expect(run.result, path).toBeNull();
    }
  });

  it('paths with a parent document (S-06, S-07) and documents are unchanged', async () => {
    for (const path of ['/en/about/zz-parity-404', '/fi/meista/zz-parity-404', '/en/services/cnc-machining/zz', '/en/contact/success', '/en/quote-request']) {
      const run = await runWorker(path, { emptyForUnknown: true, flags: flagsWith(true) });
      expect(run.outcome?.status, path).toBe(200);
      expect(run.outcome?.headers.some(([k]) => k === 'x-seo-source'), path).toBe(true);
    }
  });

  it('non-language paths (S-10, S-11) are outside the flag', async () => {
    for (const path of ['/EN/about', '/FI/meista', '/el/login', '/xx/about']) {
      const run = await runWorker(path, { emptyForUnknown: true, flags: flagsWith(true) });
      expect(run.result, path).toBeNull();
      expect(run.flags.gets, path).toEqual([]);
    }
  });

  it('real files (prerendered dist/<lang>/index.html) are never answered 404', async () => {
    const assets = new AssetsStub({ files: { '/en/index.html': '<!doctype html><title>prerendered</title>' } });
    const run = await runWorker('/en/index.html', { emptyForUnknown: true, flags: flagsWith(true), assets });
    expect(run.result).toBeNull();
    const missing = await runWorker('/en/about.html', { emptyForUnknown: true, flags: flagsWith(true), assets: new AssetsStub() });
    expect(missing.outcome?.status).toBe(404);
  });

  it('a miss caused by a failed Supabase lookup is never a 404', async () => {
    for (const mode of ['status500', 'throw'] as const) {
      const run = await runWorker('/en/zz-parity-404', {
        emptyForUnknown: true,
        flags: flagsWith(true),
        failures: [{ match: 'content_pages?or=', mode }],
      });
      expect(run.result, mode).toBeNull();
      expect(errors.mock.calls.some((a) => String(a[0]).includes('seo_strict_404_skipped'))).toBe(true);
    }
    const noKey = await runWorker(`/en/blog/${ARTICLE}x`, { emptyForUnknown: true, flags: flagsWith(true), env: { SUPABASE_ANON_KEY: '' } });
    expect(noKey.result).toBeNull();
  });

  it('a cached failure (30 s negative tagged failed) is not a 404 either', async () => {
    const seoCache = new MemoryKV();
    await runWorker('/en/zz-parity-404', { emptyForUnknown: true, seoCache, failures: [{ match: 'content_pages?or=', mode: 'status500' }] });
    const run = await runWorker('/en/zz-parity-404', { emptyForUnknown: true, seoCache, flags: flagsWith(true) });
    expect(run.fixture.calls.some((c) => c.includes('content_pages?or='))).toBe(false);
    expect(run.result).toBeNull();
  });

  it('shell failure on the 404 path: logged, null', async () => {
    // 'throw' rather than a status: with a broken /index.html the static existence check of src/static.ts cannot
    // tell files from the fallback and (safely) answers "file exists" for a non-2xx shell.
    const run = await runWorker('/en/zz/zz', { emptyForUnknown: true, flags: flagsWith(true), assets: new AssetsStub({ shell: 'throw' }) });
    expect(run.result).toBeNull();
    expect(errors.mock.calls.some((a) => String(a[0]).includes('seo_shell_failed'))).toBe(true);
  });
});
