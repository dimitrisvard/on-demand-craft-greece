/**
 * Vercel Routing Middleware — SEO Body + Meta Injection for Microns Hub
 *
 * Problem: Every non-blog page returned the same static index.html shell with
 * only per-page <head> tags injected — Googlebot received 0 chars of body
 * content on ~180 URLs (homepage, services index, 82 service details,
 * industries, blog index, about/contact/quote/our-work).
 *
 * Solution: On every language-prefixed route this middleware:
 *   1. Parses the URL via the localized slug map (middleware/slugs.ts).
 *   2. Rewrites <head> tags (title/description/OG/Twitter/canonical/hreflang)
 *      using clean-UTF-8 strings pulled from src/locales/<lang>/translation.json
 *      (no more hardcoded mojibake).
 *   3. For crawler requests, also injects a <article id="seo-content"> block
 *      adjacent to <div id="root"> with fully rendered body HTML. Regular
 *      users get the byte-identical shell they had before, so React
 *      hydration is unaffected.
 *
 * Route types handled: homepage, services-index, service-detail (82 URLs),
 * industries, blog-index, blog-article (existing Supabase-backed path),
 * about, contact, quote, our-work.
 *
 * Safety: <article id="seo-content" hidden> is a sibling of <div id="root">,
 * not inside it, so React's hydrateRoot is unaffected.
 */

import { LANGUAGES, Lang, PageMeta, ParsedRoute, SITE_BASE, DEFAULT_IMAGE } from './middleware/types';
import { resolvePageType, localizedPath } from './middleware/slugs';
import { getMeta } from './middleware/meta';
import { buildHreflangTags, rewriteHtml } from './middleware/inject';
import { articleSchema } from './middleware/schema';
import { renderHomepage } from './middleware/renderers/homepage';
import { renderServicesIndex } from './middleware/renderers/servicesIndex';
import { renderServiceDetail } from './middleware/renderers/serviceDetail';
import { renderIndustries } from './middleware/renderers/industries';
import { renderSimplePage } from './middleware/renderers/simplePage';
import { renderBlogIndex } from './middleware/renderers/blogIndex';

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArticleMeta {
  title: string;
  slug: string;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  featured_image: string | null;
  featured_image_alt: string | null;
  language: string;
  created_at: string;
  updated_at: string;
  translation_id: string | null;
  content: string | null;
}

interface ArticleListItem {
  title: string;
  slug: string;
  excerpt: string | null;
  created_at: string;
}

type TranslationMap = Record<string, string>;

export interface ServicePageRow {
  slug: string;
  language: string;
  localized_slug: string | null;
  title: string;
  meta_description: string;
  h1: string;
  tagline: string;
  lead_paragraph: string;
  capabilities: Array<{ label: string; detail: string }>;
  applications: Array<{ name: string; description: string }>;
  materials: Array<{ material: string; grade: string; properties: string; uses: string }>;
  tolerances: Array<{ spec: string; value: string; notes?: string }>;
  process_steps: Array<{ step: number; title: string; description: string }>;
  lead_times: Array<{ tier: string; quantity_range: string; working_days: string }>;
  faq: Array<{ question: string; answer: string }>;
  differentiators: Array<{ title: string; description: string }>;
  cross_links: Array<{ slug: string; label: string; description: string }>;
}

// ─── Caches ───────────────────────────────────────────────────────────────────

const articleCache = new Map<string, { data: ArticleMeta | null; expires: number }>();
const translationCache = new Map<string, { data: TranslationMap; expires: number }>();
const listCache = new Map<string, { data: ArticleListItem[]; expires: number }>();
const servicePageCache = new Map<string, { data: ServicePageRow | null; expires: number }>();
const servicePageListCache = new Map<string, { data: ServicePageRow[]; expires: number }>();

// ─── Bot / Crawler Detection ──────────────────────────────────────────────────

const BOT_UA_PATTERN = /googlebot|bingbot|yandexbot|duckduckbot|baiduspider|slurp|facebot|ia_archiver|semrushbot|ahrefsbot|dotbot|petalbot|mj12bot|sogou|applebot/i;

function isCrawler(request: Request): boolean {
  const ua = request.headers.get('user-agent') || '';
  return BOT_UA_PATTERN.test(ua);
}

// ─── Supabase Helpers ─────────────────────────────────────────────────────────

function getAnonKey(): string {
  try {
    return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  } catch {
    return '';
  }
}

async function fetchArticleMeta(lang: string, slug: string, includeContent = false): Promise<ArticleMeta | null> {
  const cacheKey = `${lang}:${slug}:${includeContent ? 'full' : 'meta'}`;
  const cached = articleCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const anonKey = getAnonKey();
  if (!anonKey) return null;

  const selectFields = 'title,slug,meta_title,meta_description,excerpt,featured_image,featured_image_alt,language,created_at,updated_at,translation_id'
    + (includeContent ? ',content' : '');

  try {
    const url = `${SUPABASE_URL}/rest/v1/articles?slug=eq.${encodeURIComponent(slug)}&language=eq.${lang}&status=eq.published&select=${selectFields}&limit=1`;
    const res = await fetch(url, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const article = data?.[0] ?? null;
    articleCache.set(cacheKey, { data: article, expires: Date.now() + CACHE_TTL });
    return article;
  } catch {
    return null;
  }
}

async function fetchTranslationSlugs(translationId: string): Promise<TranslationMap> {
  const cached = translationCache.get(translationId);
  if (cached && cached.expires > Date.now()) return cached.data;

  const anonKey = getAnonKey();
  if (!anonKey) return {};

  try {
    const url = `${SUPABASE_URL}/rest/v1/articles?translation_id=eq.${translationId}&status=eq.published&select=language,slug`;
    const res = await fetch(url, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!res.ok) return {};
    const rows: { language: string; slug: string }[] = await res.json();
    const map: TranslationMap = {};
    for (const row of rows) map[row.language] = row.slug;
    translationCache.set(translationId, { data: map, expires: Date.now() + CACHE_TTL });
    return map;
  } catch {
    return {};
  }
}

async function fetchRecentArticles(lang: string): Promise<ArticleListItem[]> {
  const cacheKey = `list:${lang}`;
  const cached = listCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const anonKey = getAnonKey();
  if (!anonKey) return [];

  try {
    const url = `${SUPABASE_URL}/rest/v1/articles?language=eq.${lang}&status=eq.published&select=title,slug,excerpt,created_at&order=created_at.desc&limit=10`;
    const res = await fetch(url, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!res.ok) return [];
    const rows: ArticleListItem[] = await res.json();
    listCache.set(cacheKey, { data: rows, expires: Date.now() + CACHE_TTL });
    return rows;
  } catch {
    return [];
  }
}

const SERVICE_PAGE_SELECT = [
  'slug', 'language', 'localized_slug',
  'title', 'meta_description', 'h1', 'tagline', 'lead_paragraph',
  'capabilities', 'applications', 'materials', 'tolerances',
  'process_steps', 'lead_times', 'faq', 'differentiators', 'cross_links',
].join(',');

async function fetchServicePageRaw(lang: string, slug: string): Promise<ServicePageRow | null> {
  const anonKey = getAnonKey();
  if (!anonKey) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/service_pages`
      + `?slug=eq.${encodeURIComponent(slug)}`
      + `&language=eq.${lang}`
      + `&status=eq.published`
      + `&select=${SERVICE_PAGE_SELECT}&limit=1`;
    const res = await fetch(url, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch one service_pages row for the requested language only. Returns null
 * on miss — callers fall back to the existing i18n-based renderer so non-EN
 * languages without a DB row keep their translated SSR body instead of being
 * switched to raw EN content.
 */
export async function fetchServicePage(lang: string, slug: string): Promise<ServicePageRow | null> {
  const cacheKey = `sp:${lang}:${slug}`;
  const cached = servicePageCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const timeout = new Promise<ServicePageRow | null>((resolve) => setTimeout(() => resolve(null), 500));
  const row = await Promise.race([fetchServicePageRaw(lang, slug), timeout]);
  servicePageCache.set(cacheKey, { data: row, expires: Date.now() + CACHE_TTL });
  return row;
}

export async function fetchServicePageList(lang: string): Promise<ServicePageRow[]> {
  const cacheKey = `splist:${lang}`;
  const cached = servicePageListCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const anonKey = getAnonKey();
  if (!anonKey) return [];

  const fetchForLang = async (): Promise<ServicePageRow[]> => {
    try {
      const url = `${SUPABASE_URL}/rest/v1/service_pages`
        + `?language=eq.${lang}`
        + `&status=eq.published`
        + `&slug=neq.index`
        + `&select=${SERVICE_PAGE_SELECT}&order=slug`;
      const res = await fetch(url, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      if (!res.ok) return [];
      return (await res.json()) as ServicePageRow[];
    } catch {
      return [];
    }
  };

  const timeout = new Promise<ServicePageRow[]>((resolve) => setTimeout(() => resolve([]), 500));
  const rows = await Promise.race([fetchForLang(), timeout]);
  servicePageListCache.set(cacheKey, { data: rows, expires: Date.now() + CACHE_TTL });
  return rows;
}

// ─── URL Parsing ──────────────────────────────────────────────────────────────

function parseRoute(pathname: string): ParsedRoute | null {
  const match = pathname.match(/^\/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)(\/(.*))?$/);
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

// ─── Hreflang Builders ───────────────────────────────────────────────────────

function staticHreflangs(pathFor: (lang: Lang) => string): string {
  return buildHreflangTags(pathFor);
}

// ─── Middleware Entry Point ──────────────────────────────────────────────────

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  const route = parseRoute(url.pathname);

  if (!route || route.type === 'other') return undefined;

  const crawlerRequest = isCrawler(request);

  // Fetch the base shell (without language prefix so the matcher doesn't loop).
  let originalHtml: string;
  try {
    const indexRes = await fetch(new URL('/index.html', url.origin), {
      headers: { Accept: 'text/html' },
    });
    if (!indexRes.ok) return undefined;
    originalHtml = await indexRes.text();
  } catch {
    return undefined;
  }

  let meta: PageMeta;
  let canonicalPath: string;
  let hreflangTags: string;
  let jsonLdBlocks: string[] = [];
  let bodyHtml: string | undefined;

  switch (route.type) {
    case 'homepage': {
      meta = getMeta(route);
      canonicalPath = localizedPath(route.lang, 'homepage');
      hreflangTags = staticHreflangs((l) => localizedPath(l, 'homepage'));
      if (crawlerRequest) {
        const rendered = renderHomepage(route.lang);
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
      }
      break;
    }

    case 'services-index': {
      const [indexRow, list] = await Promise.all([
        fetchServicePage(route.lang, 'index'),
        fetchServicePageList(route.lang),
      ]);
      meta = getMeta(route, indexRow);
      canonicalPath = localizedPath(route.lang, 'services-index');
      hreflangTags = staticHreflangs((l) => localizedPath(l, 'services-index'));
      if (crawlerRequest) {
        const rendered = renderServicesIndex(route.lang, indexRow, list);
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
      }
      break;
    }

    case 'service-detail': {
      const row = await fetchServicePage(route.lang, route.serviceId!);
      meta = getMeta(route, row);
      canonicalPath = localizedPath(route.lang, 'service-detail', route.serviceId);
      hreflangTags = staticHreflangs((l) => localizedPath(l, 'service-detail', route.serviceId));
      if (crawlerRequest) {
        const rendered = renderServiceDetail(route.lang, route.serviceId!, row);
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
      }
      break;
    }

    case 'industries': {
      meta = getMeta(route);
      canonicalPath = localizedPath(route.lang, 'industries');
      hreflangTags = staticHreflangs((l) => localizedPath(l, 'industries'));
      if (crawlerRequest) {
        const rendered = renderIndustries(route.lang);
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
      }
      break;
    }

    case 'blog-index': {
      meta = getMeta(route);
      canonicalPath = localizedPath(route.lang, 'blog-index');
      hreflangTags = staticHreflangs((l) => localizedPath(l, 'blog-index'));
      if (crawlerRequest) {
        const rendered = await renderBlogIndex(route.lang, () => fetchRecentArticles(route.lang));
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
      }
      break;
    }

    case 'about':
    case 'contact':
    case 'quote':
    case 'our-work': {
      meta = getMeta(route);
      canonicalPath = localizedPath(route.lang, route.type);
      hreflangTags = staticHreflangs((l) => localizedPath(l, route.type));
      if (crawlerRequest) {
        const rendered = renderSimplePage(route.lang, route.type);
        bodyHtml = rendered.bodyHtml;
        jsonLdBlocks = rendered.jsonLd;
      }
      break;
    }

    case 'blog-article': {
      const article = await fetchArticleMeta(route.lang, route.blogSlug!, crawlerRequest);
      if (!article) return undefined;

      const title = article.meta_title || article.title;
      const description = article.meta_description || article.excerpt || '';
      const image = article.featured_image || DEFAULT_IMAGE;

      const hrefMap: Record<Lang, string | undefined> = {} as Record<Lang, string | undefined>;
      if (article.translation_id) {
        const translations = await fetchTranslationSlugs(article.translation_id);
        for (const l of LANGUAGES) {
          if (translations[l]) hrefMap[l] = localizedPath(l, 'blog-article', translations[l]);
        }
      }
      if (Object.values(hrefMap).filter(Boolean).length === 0) {
        hrefMap[route.lang] = localizedPath(route.lang, 'blog-article', article.slug);
      }

      const canonicalUrl = `${SITE_BASE}${localizedPath(route.lang, 'blog-article', article.slug)}`;
      canonicalPath = localizedPath(route.lang, 'blog-article', article.slug);
      hreflangTags = staticHreflangs((l) => hrefMap[l] || localizedPath(l, 'blog-index'));
      jsonLdBlocks = [articleSchema({
        lang: route.lang, title, description,
        createdAt: article.created_at, updatedAt: article.updated_at,
        image, url: canonicalUrl,
      })];
      meta = { title, description, ogType: 'article', image };
      // Blog article body is raw article.content (existing behavior).
      if (crawlerRequest && article.content) bodyHtml = article.content;
      break;
    }

    default:
      return undefined;
  }

  const modifiedHtml = rewriteHtml(originalHtml, {
    meta, lang: route.lang, canonicalPath, hreflangTags, jsonLdBlocks, bodyHtml,
  });

  return new Response(modifiedHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Vary': 'User-Agent',
    },
  });
}

// ─── Matcher Configuration ────────────────────────────────────────────────────

export const config = {
  matcher: [
    '/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)',
    '/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)/(.*)',
  ],
};
