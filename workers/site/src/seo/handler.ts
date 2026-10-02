// SEO handler of microns-site (PLAN.md P1-4; ARCHITECTURE.md §6.2 step 4, §6.3, §17).
//
// A copy of the request orchestrator of middleware.ts (default export, :406-678) and its helpers, importing
// middleware/{types,slugs,meta,inject,schema,renderers/*} unchanged, so the same request and the same Supabase
// rows give the same bytes, status and headers as Vercel today. Contract: handleSeo returns null exactly where
// middleware.ts returns undefined (every non-language path included); the router then falls through to the
// static step.
//
// Adapted to Workers (all documented in PLAN.md P1-4 / ARCHITECTURE.md §6.2):
//   - Shell: env.ASSETS.fetch(/index.html), never a self-fetch (H-4). A non-2xx or a thrown fetch is logged as an
//     error (LOG_PREFIX) before returning null, instead of middleware.ts:424-431's silent undefined.
//   - SUPABASE_URL and SUPABASE_ANON_KEY from env (middleware.ts:43, :103-109). A missing value is logged as an
//     error once per request; the helpers then behave as middleware.ts with an empty key (empty values).
//   - Caches: per-isolate Map plus KV SEO_CACHE (./cache.ts, ./supabase.ts). KV reads have a deadline and, for the
//     three lookups middleware.ts races against 2.5 s, run inside that same budget; failed lookups stay in the
//     isolate Map (never KV); KV values carry a shape fingerprint; the Maps are bounded. See cache.ts.
//   - seo.strict_404 (SEO_PARITY.md §7), wired but off by default: see softNotFound below. The FLAGS read has a
//     deadline (FLAG_READ_TIMEOUT_MS) after which the SEO_STRICT_404 fallback applies.

import type { Env } from '../env';
import { LOG_PREFIX } from '../env';
import { getFlag } from '../flags';
import { hasStaticFile } from '../static';
import { LANGUAGES, SITE_BASE, DEFAULT_IMAGE } from '../../../../middleware/types';
import type { Lang, PageMeta, ParsedRoute, ContentPageSlug } from '../../../../middleware/types';
import { resolvePageType, localizedPath, localizedContentSlug } from '../../../../middleware/slugs';
import { getMeta } from '../../../../middleware/meta';
import { buildHreflangTags, rewriteHtml } from '../../../../middleware/inject';
import { articleSchema, organizationSchema, websiteSchemaFromRow } from '../../../../middleware/schema';
import { renderHomepage } from '../../../../middleware/renderers/homepage';
import { renderServicesIndex } from '../../../../middleware/renderers/servicesIndex';
import { renderServiceDetail } from '../../../../middleware/renderers/serviceDetail';
import { renderIndustries } from '../../../../middleware/renderers/industries';
import { renderSimplePage } from '../../../../middleware/renderers/simplePage';
import { renderBlogIndex } from '../../../../middleware/renderers/blogIndex';
import { renderArticleFromRow } from '../../../../middleware/renderers/blogArticle';
import { renderContentFromRow } from '../../../../middleware/renderers/contentPage';
import {
  createCaches,
  fetchArticleMeta,
  fetchContentPage,
  fetchContentPageAlternates,
  fetchRecentArticles,
  fetchServicePage,
  fetchServicePageList,
  fetchTranslationSlugs,
  type SeoCaches,
  type SupabaseIo,
} from './supabase';
import { isClientRoute } from './clientRoutes';

// ─── URL Parsing (middleware.ts:334-346, verbatim) ────────────────────────────

const LANG_PATH_RE = /^\/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)(\/(.*))?$/;

export function parseRoute(pathname: string): ParsedRoute | null {
  const match = pathname.match(LANG_PATH_RE);
  if (!match) return null;
  const lang = match[1] as Lang;
  const rest = (match[3] || '').replace(/\/$/, '');
  if (!rest) return { lang, type: 'homepage', pathAfterLang: '' };
  // Decode each segment so that non-ASCII slugs (e.g. /fi/palvelut/cnc-työstö
  // arriving as /fi/palvelut/cnc-ty%C3%B6st%C3%B6) match the reverse slug map.
  const segs = rest.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  return resolvePageType(lang, segs);
}

// The language and decoded segments of a /{lang} or /{lang}/* path, with the same normalisation as parseRoute;
// null for every other path (the paths outside the Vercel matcher, middleware.ts:682-687).
function languagePath(pathname: string): { lang: Lang; segs: string[] } | null {
  const match = pathname.match(LANG_PATH_RE);
  if (!match) return null;
  const rest = (match[3] || '').replace(/\/$/, '');
  const segs = rest ? rest.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  }) : [];
  return { lang: match[1] as Lang, segs };
}

// ─── Hreflang Builders (middleware.ts:350-372) ────────────────────────────────

function staticHreflangs(pathFor: (lang: Lang) => string): string {
  return buildHreflangTags(pathFor);
}

function contentPageHreflang(
  canonical: ContentPageSlug,
  slugByLang: Partial<Record<Lang, string | null>> = {},
): string {
  const pathFor = (l: Lang) => `/${l}/${localizedContentSlug(l, canonical, slugByLang[l] ?? null)}`;
  const tags: string[] = [];
  for (const l of LANGUAGES) {
    tags.push(`<link rel="alternate" hreflang="${l}" href="${SITE_BASE}${pathFor(l)}" />`);
  }
  tags.push(`<link rel="alternate" hreflang="x-default" href="${SITE_BASE}${pathFor('en')}" />`);
  return tags.join('\n    ');
}

// ─── Soft-404 classes (SEO_PARITY.md §7.1) ────────────────────────────────────

// The S-xx class of a language path the handler has no document for. S-06 and S-07 are answered with the
// parent document (not null), so they never reach this; S-10 and S-11 are non-language paths.
export type Soft404Class = 'S-01' | 'S-02' | 'S-03' | 'S-04' | 'S-05' | 'S-08' | 'S-09';

export function soft404Class(lang: Lang, segs: readonly string[], route: ParsedRoute | null): Soft404Class {
  if (route?.type === 'blog-article') return (route.blogSlug ?? '').includes('/') ? 'S-05' : 'S-04';
  if (segs.length === 1) return segs[0].endsWith('.html') ? 'S-09' : 'S-01';
  if (segs.length >= 3) {
    const first = resolvePageType(lang, segs.slice(0, 1));
    return first?.type === 'services-index' ? 'S-03' : 'S-08';
  }
  const first = resolvePageType(lang, segs.slice(0, 1));
  return first?.type === 'services-index' ? 'S-03' : 'S-02';
}

// ─── Handler ──────────────────────────────────────────────────────────────────

interface Shell {
  html: string;
  headers: Headers;
}

export interface SeoHandlerOptions {
  // Tests only. Production uses the global fetch, looked up at call time.
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface SeoHandler {
  handleSeo(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null>;
  // The isolate caches of this instance (tests clear the Map tier to exercise KV).
  readonly caches: SeoCaches;
}

function logError(msg: string, fields: Record<string, unknown>): void {
  console.error(`${LOG_PREFIX} ${JSON.stringify({ msg, ...fields })}`);
}

// middleware.ts answers every would-be 404 with an immediate `return undefined`; the flag read in front of that
// must not be able to stall the request. A FLAGS read slower than this uses the SEO_STRICT_404 fallback.
export const FLAG_READ_TIMEOUT_MS = 500;

async function strict404Enabled(env: Env, path: string): Promise<boolean> {
  const fallback = env.SEO_STRICT_404 === 'true';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), FLAG_READ_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([getFlag(env, 'seo.strict_404', fallback), deadline]);
    if (result === 'timeout') {
      logError('seo_flag_timeout', { flag: 'seo.strict_404', path, fallback });
      return fallback;
    }
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// middleware.ts:421-431, against the asset binding.
async function fetchShell(env: Env, url: URL): Promise<Shell | null> {
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/index.html', url)));
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      logError('seo_shell_failed', { path: url.pathname, status: res.status });
      return null;
    }
    return { html: await res.text(), headers: new Headers(res.headers) };
  } catch (err) {
    logError('seo_shell_failed', { path: url.pathname, error: String(err) });
    return null;
  }
}

export function createSeoHandler(options: SeoHandlerOptions = {}): SeoHandler {
  const caches = createCaches();
  const doFetch = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));

  // Called wherever middleware.ts returns undefined for a /{lang} path. Flag off (default): log would_404 and
  // return null (today's soft 404). Flag on: 404 with the shell and the SPA fallback's headers, except for real
  // client routes, real static files, and misses caused by a failed Supabase lookup.
  async function softNotFound(
    env: Env, url: URL, route: ParsedRoute | null, shell: Shell | null, degraded: boolean,
  ): Promise<Response | null> {
    const lp = languagePath(url.pathname);
    if (!lp) return null;
    if (isClientRoute(lp.lang, lp.segs)) return null;
    const cls = soft404Class(lp.lang, lp.segs, route);
    const strict = await strict404Enabled(env, url.pathname);
    if (!strict) {
      console.log(JSON.stringify({ msg: 'would_404', path: url.pathname, class: cls }));
      return null;
    }
    if (degraded) {
      logError('seo_strict_404_skipped', { path: url.pathname, class: cls, reason: 'supabase_lookup_failed' });
      return null;
    }
    if (await hasStaticFile(url, env)) return null;
    const doc = shell ?? (await fetchShell(env, url));
    if (!doc) return null;
    return new Response(doc.html, { status: 404, headers: new Headers(doc.headers) });
  }

  async function handleSeo(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
    const url = new URL(request.url);
    const route = parseRoute(url.pathname);

    if (!route || route.type === 'other') return softNotFound(env, url, route, null, false);

    const supabaseUrl = (env.SUPABASE_URL || '').replace(/\/+$/, '');
    const anonKey = env.SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !anonKey) {
      logError('seo_supabase_config_missing', {
        path: url.pathname,
        missing: [!supabaseUrl && 'SUPABASE_URL', !anonKey && 'SUPABASE_ANON_KEY'].filter(Boolean),
      });
    }
    const io: SupabaseIo = {
      fetch: doFetch,
      supabaseUrl,
      anonKey: supabaseUrl ? anonKey : '',
      kv: env.SEO_CACHE,
      waitUntil: (p) => ctx.waitUntil(p),
      state: { degraded: false },
    };

    // Every request gets the full SSR body injected into a <article id="seo-content"> sibling of <div id="root">
    // (middleware.ts:414-419). Fetch the base shell first, as middleware.ts:421-431 does.
    const shell = await fetchShell(env, url);
    if (!shell) return null;
    const originalHtml = shell.html;

    let meta: PageMeta;
    let canonicalPath: string;
    let hreflangTags: string;
    let jsonLdBlocks: string[] = [];
    let bodyHtml: string | undefined;
    // Diagnostic: 'db' when the body/meta came from Supabase, 'i18n' when the
    // renderer fell back, 'none' for routes that don't source from service_pages.
    let seoSource: 'db' | 'i18n' | 'none' = 'none';

    switch (route.type) {
      case 'homepage': {
        canonicalPath = localizedPath(route.lang, 'homepage');
        hreflangTags = staticHreflangs((l) => localizedPath(l, 'homepage'));
        // Prefer the DB-driven home row. Falls back to the i18n-based renderer
        // for non-EN languages until their rows are seeded.
        const homeRow = await fetchContentPage(caches, io, route.lang, 'home');
        if (homeRow) {
          meta = {
            title: homeRow.title.includes('Microns Hub') ? homeRow.title : `${homeRow.title} | Microns Hub`,
            description: homeRow.meta_description,
            ogType: 'website',
            image: DEFAULT_IMAGE,
          };
          seoSource = 'db';
          const rendered = renderContentFromRow(route.lang, homeRow, 'home');
          bodyHtml = rendered.bodyHtml;
          // Strip the self-referential breadcrumb that renderContentFromRow emits —
          // Google flags single-item BreadcrumbList schemas on the home URL. Also
          // swap in WebSite+SearchAction and Organization for the home route.
          jsonLdBlocks = [
            organizationSchema(),
            websiteSchemaFromRow(homeRow),
            ...rendered.jsonLd.filter((b) => !b.includes('"BreadcrumbList"')),
          ];
        } else {
          meta = getMeta(route);
          const rendered = renderHomepage(route.lang);
          bodyHtml = rendered.bodyHtml;
          jsonLdBlocks = [...rendered.jsonLd, websiteSchemaFromRow(null)];
        }
        break;
      }

      case 'services-index': {
        const [indexRow, list] = await Promise.all([
          fetchServicePage(caches, io, route.lang, 'index'),
          fetchServicePageList(caches, io, route.lang),
        ]);
        meta = getMeta(route, indexRow);
        canonicalPath = localizedPath(route.lang, 'services-index');
        hreflangTags = staticHreflangs((l) => localizedPath(l, 'services-index'));
        seoSource = indexRow ? 'db' : 'i18n';
        const rendered = renderServicesIndex(route.lang, indexRow, list);
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
        break;
      }

      case 'service-detail': {
        const row = await fetchServicePage(caches, io, route.lang, route.serviceId!);
        meta = getMeta(route, row);
        canonicalPath = localizedPath(route.lang, 'service-detail', route.serviceId);
        hreflangTags = staticHreflangs((l) => localizedPath(l, 'service-detail', route.serviceId));
        seoSource = row ? 'db' : 'i18n';
        const rendered = renderServiceDetail(route.lang, route.serviceId!, row);
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
        break;
      }

      case 'industries': {
        meta = getMeta(route);
        canonicalPath = localizedPath(route.lang, 'industries');
        hreflangTags = staticHreflangs((l) => localizedPath(l, 'industries'));
        const rendered = renderIndustries(route.lang);
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
        break;
      }

      case 'blog-index': {
        meta = getMeta(route);
        canonicalPath = localizedPath(route.lang, 'blog-index');
        hreflangTags = staticHreflangs((l) => localizedPath(l, 'blog-index'));
        const rendered = await renderBlogIndex(route.lang, () => fetchRecentArticles(caches, io, route.lang));
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
        break;
      }

      case 'about':
      case 'contact':
      case 'quote':
      case 'our-work': {
        meta = getMeta(route);
        canonicalPath = localizedPath(route.lang, route.type);
        hreflangTags = staticHreflangs((l) => localizedPath(l, route.type));
        const rendered = renderSimplePage(route.lang, route.type);
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
        break;
      }

      case 'content-page': {
        // The URL segment that resolvePageType handed us. It may be either
        // the canonical English slug ('education') or a per-language
        // localized_slug ('vzdelavani' for cs). fetchContentPageRaw queries
        // (slug OR localized_slug), so either form finds the row.
        const requestedSlug = route.contentSlug!;
        const [row, initialAlternates] = await Promise.all([
          fetchContentPage(caches, io, route.lang, requestedSlug),
          fetchContentPageAlternates(caches, io, requestedSlug),
        ]);
        // The DB row's .slug column is the source of truth for the canonical
        // English slug. Use it for every downstream lookup (alternates,
        // hreflang cluster, legacy-fallback dispatch) so localized URLs like
        // /cs/vzdelavani share the same hreflang group as /en/education etc.
        const canonicalSlug = ((row?.slug as ContentPageSlug | undefined) ?? requestedSlug) as ContentPageSlug;
        // Re-fetch alternates only when the URL segment was a localized form
        // (initialAlternates was looked up by 'vzdelavani' and returned empty;
        // the real cluster lives under the canonical 'education' key).
        const alternates = canonicalSlug !== requestedSlug
          ? await fetchContentPageAlternates(caches, io, canonicalSlug)
          : initialAlternates;
        const urlSegment = localizedContentSlug(route.lang, canonicalSlug, row?.localized_slug ?? alternates[route.lang] ?? null);
        canonicalPath = `/${route.lang}/${urlSegment}`;
        if (row) {
          meta = {
            title: row.title.includes('Microns Hub') ? row.title : `${row.title} | Microns Hub`,
            description: row.meta_description,
            ogType: 'website',
            image: DEFAULT_IMAGE,
          };
          hreflangTags = contentPageHreflang(canonicalSlug, alternates);
          seoSource = 'db';
          const rendered = renderContentFromRow(route.lang, row, canonicalSlug);
          bodyHtml = rendered.bodyHtml;
          jsonLdBlocks = rendered.jsonLd;
        } else {
          // Row missing — fall back so we never regress the 4 existing legacy
          // slugs. The 3 new slugs (education / legal-notice / privacy-policy)
          // have no legacy renderer; returning null lets React handle it.
          if (canonicalSlug === 'industries') {
            meta = getMeta({ ...route, type: 'industries' });
            hreflangTags = staticHreflangs((l) => localizedPath(l, 'industries'));
            const rendered = renderIndustries(route.lang);
            bodyHtml = rendered.bodyHtml;
            jsonLdBlocks = rendered.jsonLd;
          } else if (canonicalSlug === 'about' || canonicalSlug === 'contact' || canonicalSlug === 'our-work') {
            meta = getMeta({ ...route, type: canonicalSlug });
            hreflangTags = staticHreflangs((l) => localizedPath(l, canonicalSlug));
            const rendered = renderSimplePage(route.lang, canonicalSlug);
            bodyHtml = rendered.bodyHtml;
            jsonLdBlocks = rendered.jsonLd;
          } else {
            return softNotFound(env, url, route, shell, io.state.degraded);
          }
        }
        break;
      }

      case 'blog-article': {
        const article = await fetchArticleMeta(caches, io, route.lang, route.blogSlug!);
        if (!article) return softNotFound(env, url, route, shell, io.state.degraded);

        const title = article.meta_title || article.title;
        const description = article.meta_description || article.excerpt || '';
        const image = article.featured_image || DEFAULT_IMAGE;

        // Build a map of language → article URL, driven by the translation_id
        // chain. Articles without a translation record only emit self.
        // For languages WITHOUT a published translation the hreflang tag is
        // omitted entirely (never pointed at the blog index), see
        // middleware.ts:607-612.
        const hrefMap: Partial<Record<Lang, string>> = {};
        if (article.translation_id) {
          const translations = await fetchTranslationSlugs(caches, io, article.translation_id);
          for (const l of LANGUAGES) {
            if (translations[l]) {
              hrefMap[l] = localizedPath(l, 'blog-article', translations[l]);
            }
          }
        }
        // Always include self, even when translation_id is NULL or the
        // translation row for this language is absent from the chain.
        hrefMap[route.lang] = localizedPath(route.lang, 'blog-article', article.slug);

        // x-default points at the EN translation when available; falls back to
        // the current language for single-language (imported) articles.
        const xDefaultPath = hrefMap.en || hrefMap[route.lang]!;

        const hreflangParts: string[] = [];
        for (const l of LANGUAGES) {
          const p = hrefMap[l];
          if (p) {
            hreflangParts.push(`<link rel="alternate" hreflang="${l}" href="${SITE_BASE}${p}" />`);
          }
        }
        hreflangParts.push(`<link rel="alternate" hreflang="x-default" href="${SITE_BASE}${xDefaultPath}" />`);

        const canonicalUrl = `${SITE_BASE}${localizedPath(route.lang, 'blog-article', article.slug)}`;
        canonicalPath = localizedPath(route.lang, 'blog-article', article.slug);
        hreflangTags = hreflangParts.join('\n    ');
        jsonLdBlocks = [articleSchema({
          lang: route.lang, title, description,
          createdAt: article.created_at, updatedAt: article.updated_at,
          image, url: canonicalUrl,
        })];
        meta = { title, description, ogType: 'article', image };
        bodyHtml = renderArticleFromRow({
          lang: route.lang,
          title: article.title,
          content: article.content,
          featuredImage: article.featured_image,
          featuredImageAlt: article.featured_image_alt,
          createdAt: article.created_at,
          updatedAt: article.updated_at,
          blogIndexPath: localizedPath(route.lang, 'blog-index'),
        });
        seoSource = 'db';
        break;
      }

      default:
        return softNotFound(env, url, route, shell, io.state.degraded);
    }

    const modifiedHtml = rewriteHtml(originalHtml, {
      meta, lang: route.lang, canonicalPath, hreflangTags, jsonLdBlocks, bodyHtml,
    });

    return new Response(modifiedHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'X-Seo-Source': seoSource,
      },
    });
  }

  return { handleSeo, caches };
}

const defaultHandler = createSeoHandler();

export async function handleSeo(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  return defaultHandler.handleSeo(request, env, ctx);
}
