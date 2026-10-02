// Router step 2: sitemap routes (PLAN.md P1-6; ARCHITECTURE.md §6.2 step 2; SEO_PARITY.md §9, G5).
//
// api/sitemap.js runs UNCHANGED through the Vercel (req, res) shim (src/compat/vercel-shim.ts), so bodies, status
// codes and headers (api/sitemap.js:392-396: Content-Type application/xml; charset=utf-8, Cache-Control
// public, max-age=3600, s-maxage=3600, Vary: Accept-Encoding) are the handler's own on every branch.
//
// Path mapping = the vercel.json rewrites (vercel.json:130-145), evaluated in file order, so the exact names win
// over the /sitemap-:lang.xml pattern ("complete" and "index" match it too). /api/sitemap is the function path.
// api/sitemap.js:333-334 reads the language with /lang=([a-z]{2})/i over req.url, so /sitemap-enx.xml serves
// the "en" blob and /sitemap-xx.xml answers 404 "Sitemap not found": preserved.
//
// Query merge = Vercel's reference router (vercel CLI 62.0.0, `vercel dev`: devRouter and the Lambda branch of
// the dev server; production to confirm in the P0-3 baseline with G5 probes that carry a query):
//   1. the rewrite destination's query (with the raw ':lang' capture) is parsed, and the request's own query
//      overrides it key by key (Object.assign(destQuery, reqQuery));
//   2. the function's req.url keeps the request's keys first, then the rewrite-only keys;
//   3. keys and values are percent-decoded and re-encoded with encodeURIComponent, so /sitemap-d%65.xml
//      reaches the function as lang=de.
// So /sitemap.xml?type=index serves the index and /sitemap-de.xml?lang=fr the fr blob, as in the reference.
// Two deliberate differences from the reference parser, for robustness: a malformed escape is kept raw instead
// of throwing, and a value is split at the first '=' only (the reference drops anything after a second '=').
//
// Configuration: api/sitemap.js hard-codes SUPABASE_URL and BASE_URL (api/sitemap.js:24-26) and reads
// process.env.SUPABASE_ANON_KEY inside its fetch helpers. With nodejs_compat and compatibility_date >= 2025-04-01
// the runtime fills process.env from vars and secrets; the key is also copied from env before each call.
// env.SUPABASE_URL is not used here (parity with the hard-coded URL).
//
// Edge cache: Cache API (caches.default), 1 h like Vercel's s-maxage=3600; only status 200 is stored, never 404
// or 500. Key = the public URL (path + query) on the request's origin, method GET. HEAD and GET share it; the
// body of a HEAD answer is stripped by finalise(). Note: the Cache API is a no-op on *.workers.dev hosts, so
// the preview always runs the handler.

import sitemapHandler from '../../../api/sitemap.js';
import { runVercelHandler, type VercelHandler } from './compat/vercel-shim';
import type { Env } from './env';
import { LOG_PREFIX } from './env';

const handler: VercelHandler = sitemapHandler;

const FUNCTION_PATH = '/api/sitemap';

// Headers the Cache API adds on a hit that Vercel would not send.
const CACHE_ADDED_HEADERS = ['cf-cache-status'];

// vercel.json:131-145 in order. ':lang' compiles (path-to-regexp, strict, delimiter '/') to one or more
// characters other than '/', '?' and '#'; the pathname never holds '?' or '#'. Matched on the raw pathname.
const LANG_SITEMAP = /^\/sitemap-([^/?#]+?)\.xml$/;

type Query = Record<string, Array<string | undefined>>;

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// parseQueryString of the Vercel dev router: '?a=1&a=2&b' -> { a: ['1', '2'], b: [undefined] } (no '+' decoding).
function parseQueryString(search: string): Query {
  const query: Query = Object.create(null) as Query;
  if (!search || !search.startsWith('?') || search === '?') return query;
  for (const param of search.slice(1).split('&')) {
    const eq = param.indexOf('=');
    const key = decodeComponent(eq === -1 ? param : param.slice(0, eq));
    const value = eq === -1 ? undefined : decodeComponent(param.slice(eq + 1));
    (query[key] ??= []).push(value);
  }
  return query;
}

// formatQueryString of the Vercel dev router: '' when empty, else '?k=v&k2' with encodeURIComponent.
function formatQueryString(query: Query): string {
  let out = '';
  let prefix = '?';
  for (const [key, values] of Object.entries(query)) {
    for (const value of values) {
      out += prefix + encodeURIComponent(key) + (value === undefined ? '' : `=${encodeURIComponent(value)}`);
      prefix = '&';
    }
  }
  return out;
}

// The '/api/sitemap?...' path + query that Vercel hands the function for a public path, or null.
export function rewriteSitemapPath(url: URL): string | null {
  const { pathname } = url;
  let destinationSearch: string | null = null;
  if (pathname === '/sitemap.xml') destinationSearch = '?type=main-index';
  else if (pathname === '/sitemap-complete.xml') destinationSearch = '';
  else if (pathname === '/sitemap-index.xml') destinationSearch = '?type=index';
  else {
    const match = LANG_SITEMAP.exec(pathname);
    if (match) destinationSearch = `?type=lang&lang=${match[1]}`;
    else if (pathname === FUNCTION_PATH) destinationSearch = '';
  }
  if (destinationSearch === null) return null;
  // 1. Request keys override the rewrite's keys.
  const routed = Object.assign(parseQueryString(destinationSearch), parseQueryString(url.search));
  // 2. The function URL: the request's keys first (in their order), then the rewrite-only keys.
  const functionQuery = Object.assign(parseQueryString(url.search), routed);
  return FUNCTION_PATH + formatQueryString(functionQuery);
}

/** True for the public sitemap URLs (vercel.json rewrites), false for /api/sitemap and everything else. */
export function isPublicSitemapPath(url: URL): boolean {
  return url.pathname !== FUNCTION_PATH && rewriteSitemapPath(url) !== null;
}

function defaultCache(): Cache | null {
  try {
    return typeof caches !== 'undefined' && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

function setAnonKey(env: Env): void {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!env.SUPABASE_ANON_KEY) {
    console.error(`${LOG_PREFIX} sitemap: SUPABASE_ANON_KEY is not set; the dynamic fallback of api/sitemap.js will emit no articles or content pages`);
    return;
  }
  if (proc?.env && proc.env.SUPABASE_ANON_KEY !== env.SUPABASE_ANON_KEY) proc.env.SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
}

function withoutCacheHeaders(response: Response): Response {
  if (!CACHE_ADDED_HEADERS.some((name) => response.headers.has(name))) return response;
  const out = new Response(response.body, response);
  for (const name of CACHE_ADDED_HEADERS) out.headers.delete(name);
  return out;
}

export async function handleSitemap(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const rewritten = rewriteSitemapPath(url);
  if (rewritten === null) return null;

  // Vercel's CDN caches GET and HEAD only; other methods always reach the function.
  const cacheable = request.method === 'GET' || request.method === 'HEAD';
  const cache = cacheable ? defaultCache() : null;
  const cacheKey = new Request(new URL(url.pathname + url.search, url.origin).toString(), { method: 'GET' });

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return withoutCacheHeaders(hit);
    } catch (err) {
      console.error(`${LOG_PREFIX} sitemap: cache match failed for ${url.pathname}`, err);
    }
  }

  setAnonKey(env);
  const response = await runVercelHandler(handler, {
    // HEAD runs the GET logic so a cached copy always has the full body.
    method: request.method === 'HEAD' ? 'GET' : request.method,
    url: rewritten,
    headers: request.headers,
  });

  if (cache && response.status === 200) {
    const put = cache.put(cacheKey, response.clone()).catch((err: unknown) => {
      console.error(`${LOG_PREFIX} sitemap: cache put failed for ${url.pathname}`, err);
    });
    ctx.waitUntil(put);
  }
  return response;
}
