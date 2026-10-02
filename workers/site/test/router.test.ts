import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dependency stubs: the router is tested independently of the SEO handler and the /api forward.
vi.mock('../src/seo/handler', () => ({
  handleSeo: vi.fn(),
}));
vi.mock('../src/api/forward', () => ({
  handleApi: vi.fn(),
}));
// Real implementations, wrapped so calls can be counted or a throw injected.
vi.mock('../src/sitemap', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/sitemap')>();
  return { ...mod, handleSitemap: vi.fn(mod.handleSitemap) };
});
vi.mock('../src/preview', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/preview')>();
  return { ...mod, finalise: vi.fn(mod.finalise) };
});

import worker from '../src/index';
import { handleApi } from '../src/api/forward';
import type { Env } from '../src/env';
import { finalise } from '../src/preview';
import { handleSeo } from '../src/seo/handler';
import { handleSitemap } from '../src/sitemap';

const PREVIEW = 'https://microns-site.example.workers.dev';
const PROD = 'https://www.micronshub.eu';
const LANG_PATH = /^\/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)(\/.*)?$/;
const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';
const SITEMAP_LANG_BLOB = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>https://www.micronshub.eu/en</loc></url></urlset>';

// dist/ stand-in for env.ASSETS with not_found_handling "single-page-application" and html_handling "none".
const FILES: Record<string, { body: string; type: string }> = {
  '/index.html': { body: SHELL, type: 'text/html' },
  '/robots.txt': { body: 'User-agent: *\n', type: 'text/plain' },
  '/zohoverify/index.html': { body: 'zoho', type: 'text/html' },
  '/en/index.html': { body: 'prerendered en', type: 'text/html' },
};

function makeAssets() {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const { pathname } = new URL(request.url);
      const file = FILES[pathname === '/' ? '/index.html' : pathname] ?? FILES['/index.html'];
      const etag = `"${file === FILES['/index.html'] ? 'shell' : pathname}"`;
      return new Response(request.method === 'HEAD' ? null : file.body, {
        status: 200,
        headers: { 'Content-Type': file.type, ETag: etag },
      });
    }),
  };
}

let assets: ReturnType<typeof makeAssets>;
let env: Env;
let pending: Promise<unknown>[];
let errorSpy: ReturnType<typeof vi.spyOn>;

const ctx = () =>
  ({
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {},
    props: {},
  }) as unknown as ExecutionContext;

function call(path: string, init: RequestInit = {}, origin = PREVIEW): Promise<Response> {
  return worker.fetch(new Request(new URL(path, origin), init), env, ctx());
}

beforeEach(() => {
  assets = makeAssets();
  env = {
    ASSETS: assets,
    SEO_CACHE: {},
    FLAGS: {},
    SUPABASE_URL: 'https://cfjrtmtaitwzggzpkhxi.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key-not-a-secret',
    SITE_ORIGIN: PROD,
    PREVIEW_HOSTNAMES: '',
    SEO_STRICT_404: 'false',
    API_FORWARD_ORIGIN: PROD,
    DIRECTORY_INDEX_EMULATION: 'true',
  } as unknown as Env;
  pending = [];
  vi.mocked(handleSeo).mockReset();
  vi.mocked(handleSeo).mockImplementation(async (request: Request) => {
    const { pathname } = new URL(request.url);
    if (!LANG_PATH.test(pathname) || pathname.endsWith('/index.html')) return null;
    return new Response(request.method === 'HEAD' ? null : `<html>seo ${pathname}</html>`, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'X-Seo-Source': 'i18n',
      },
    });
  });
  vi.mocked(handleApi).mockReset();
  vi.mocked(handleApi).mockImplementation(async () => Response.json({ forwarded: true }));
  vi.mocked(handleSitemap).mockClear();
  vi.mocked(finalise).mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/sitemaps/sitemap-en.xml')) return new Response(SITEMAP_LANG_BLOB);
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  vi.stubGlobal('caches', undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
});

describe('router order', () => {
  it('1: a redirect source inside a language path redirects before the SEO handler', async () => {
    const res = await call('/en/dawycena?x=1');
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('/pl/wycena?x=1');
    expect(handleSitemap).not.toHaveBeenCalled();
    expect(handleSeo).not.toHaveBeenCalled();
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it('1: redirects every method', async () => {
    for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
      const res = await call('/deorcamento', { method });
      expect(res.status).toBe(308);
      expect(res.headers.get('Location')).toBe('/de/angebot');
    }
  });

  it('2: sitemap paths are answered before /api and the SEO handler', async () => {
    const res = await call('/sitemap-en.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    expect(await res.text()).toBe(SITEMAP_LANG_BLOB);
    expect(handleApi).not.toHaveBeenCalled();
    expect(handleSeo).not.toHaveBeenCalled();
  });

  it('2: /api/sitemap is handled locally (not forwarded) and still gets the /api CORS headers', async () => {
    const res = await call('/api/sitemap?type=lang&lang=en');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SITEMAP_LANG_BLOB);
    expect(handleApi).not.toHaveBeenCalled();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,OPTIONS,PATCH,DELETE,POST,PUT');
  });

  it('3: other /api/* paths are forwarded, with CORS from finalise', async () => {
    const res = await call('/api/emails?action=contact', { method: 'OPTIONS' });
    expect(handleApi).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleApi).mock.calls[0][0].method).toBe('OPTIONS');
    expect(await res.json()).toEqual({ forwarded: true });
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(handleSeo).not.toHaveBeenCalled();
  });

  it('3: /api without a slash and /apix are not /api/*', async () => {
    await call('/api');
    await call('/apix/y');
    expect(handleApi).not.toHaveBeenCalled();
    expect(assets.fetch).toHaveBeenCalled();
  });

  it('4: language paths go to the SEO handler', async () => {
    const res = await call('/en/services');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>seo /en/services</html>');
    expect(res.headers.get('X-Seo-Source')).toBe('i18n');
    expect(handleSeo).toHaveBeenCalledTimes(1);
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it('4 -> 6: null from the SEO handler falls through to static', async () => {
    const res = await call('/en/index.html');
    expect(handleSeo).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe('prerendered en');
  });

  it('6: non-language paths reach static (asset or SPA shell with 200)', async () => {
    const robots = await call('/robots.txt');
    expect(await robots.text()).toBe('User-agent: *\n');
    const unknown = await call('/zz-parity-404');
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toBe(SHELL);
    const root = await call('/');
    expect(await root.text()).toBe(SHELL);
    expect(handleSeo).toHaveBeenCalledTimes(3);
    expect(handleApi).not.toHaveBeenCalled();
  });

  it('5: directory index emulation when DIRECTORY_INDEX_EMULATION is "true"', async () => {
    expect(await (await call('/zohoverify/')).text()).toBe('zoho');
    expect(await (await call('/zohoverify')).text()).toBe('zoho');
  });

  it('5: no directory index emulation when DIRECTORY_INDEX_EMULATION is "false"', async () => {
    env.DIRECTORY_INDEX_EMULATION = 'false';
    expect(await (await call('/zohoverify/')).text()).toBe(SHELL);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    expect(new URL((assets.fetch.mock.calls[0][0] as Request).url).pathname).toBe('/zohoverify/');
  });
});

describe('finalise', () => {
  it('is applied exactly once per request on every step', async () => {
    const paths = ['/en/dawycena', '/sitemap-en.xml', '/api/emails', '/en/services', '/zz', '/zohoverify/'];
    for (const path of paths) {
      vi.mocked(finalise).mockClear();
      const res = await call(path);
      expect(finalise, path).toHaveBeenCalledTimes(1);
      expect(res.headers.get('X-Robots-Tag'), path).toBe('noindex');
    }
  });

  it('adds no X-Robots-Tag on the production host', async () => {
    const res = await call('/en/services', {}, PROD);
    expect(res.headers.has('X-Robots-Tag')).toBe(false);
  });
});

describe('HEAD', () => {
  it.each(['/en/services', '/sitemap-en.xml', '/zz', '/robots.txt', '/api/sitemap?type=lang&lang=en'])(
    'HEAD %s: same status and headers as GET, empty body',
    async (path) => {
      const get = await call(path);
      const head = await call(path, { method: 'HEAD' });
      expect(head.status).toBe(get.status);
      expect([...head.headers.entries()]).toEqual([...get.headers.entries()]);
      expect(head.body).toBeNull();
      expect(await head.text()).toBe('');
    },
  );
});

describe('errors', () => {
  it('a throw in the sitemap step is logged and falls through', async () => {
    vi.mocked(handleSitemap).mockRejectedValueOnce(new Error('boom'));
    const res = await call('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SHELL);
    expect(handleSeo).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[microns-site] router step sitemap failed: GET /sitemap.xml', expect.any(Error));
  });

  it('a throw in the SEO step is logged and falls through to static', async () => {
    vi.mocked(handleSeo).mockRejectedValueOnce(new Error('boom'));
    const res = await call('/en/services');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SHELL);
    expect(errorSpy).toHaveBeenCalledWith('[microns-site] router step seo failed: GET /en/services', expect.any(Error));
  });

  it('a throw in the static step answers 500 text/plain, still finalised once', async () => {
    assets.fetch.mockRejectedValue(new Error('assets down'));
    vi.mocked(finalise).mockClear();
    const res = await call('/zz');
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('Internal Server Error');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(finalise).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[microns-site] router step static failed: GET /zz', expect.any(Error));
  });

  it('a throw in the /api step answers 500', async () => {
    vi.mocked(handleApi).mockRejectedValueOnce(new Error('boom'));
    const res = await call('/api/emails');
    expect(res.status).toBe(500);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
