// Supabase REST helpers of the SEO handler: a copy of middleware.ts:41-404 adapted to Workers.
//
// Unchanged from middleware.ts: REST URLs and select lists, request headers, the 2.5 s Promise.race timeouts,
// what is cached and for how long (1 h positive, 30 s negative, and which failures are not cached at all),
// the content_pages faq/cross_links/internal_links/sections normalisation, and the empty value each helper
// returns on a miss or failure.
//
// Adapted: SUPABASE_URL and the anon key come from env (middleware.ts:43, :103-109); the per-isolate Map caches
// sit in front of KV SEO_CACHE (./cache.ts); a failed lookup is reported to the request state so the strict-404
// path never answers 404 because Supabase was down.

import type { ContentPageRow } from '../../../../middleware/renderers/contentPage';
import { TieredCache, type CacheIo } from './cache';

export const CACHE_TTL = 60 * 60 * 1000; // 1 hour (middleware.ts:44)
export const NEGATIVE_CACHE_TTL = 30 * 1000; // middleware.ts:193
export const SERVICE_FETCH_TIMEOUT_MS = 2500; // middleware.ts:194

// ─── Types (middleware.ts:48-90) ──────────────────────────────────────────────

export interface ArticleMeta {
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

export interface ArticleListItem {
  title: string;
  slug: string;
  excerpt: string | null;
  created_at: string;
}

export type TranslationMap = Record<string, string>;

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

export type { ContentPageRow };

// ─── Caches (middleware.ts:94-99, :375) ───────────────────────────────────────

export interface SeoCaches {
  article: TieredCache<ArticleMeta | null>;
  translations: TieredCache<TranslationMap>;
  list: TieredCache<ArticleListItem[]>;
  sp: TieredCache<ServicePageRow | null>;
  splist: TieredCache<ServicePageRow[]>;
  cp: TieredCache<ContentPageRow | null>;
  cpalt: TieredCache<Record<string, string | null>>;
}

export function createCaches(): SeoCaches {
  return {
    article: new TieredCache('article'),
    translations: new TieredCache('translations'),
    list: new TieredCache('list'),
    sp: new TieredCache('sp'),
    splist: new TieredCache('splist'),
    cp: new TieredCache('cp'),
    cpalt: new TieredCache('cpalt'),
  };
}

// Everything one request needs to call Supabase. `degraded` is set when any lookup of this request failed or was
// served from a cached failure; the strict-404 path reads it.
export interface SupabaseIo extends CacheIo {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  supabaseUrl: string;
  anonKey: string; // '' when missing: every helper then returns its empty value, as middleware.ts does
  state: { degraded: boolean };
}

function authHeaders(anonKey: string): Record<string, string> {
  return { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
}

// Promise.race against a timer, as middleware.ts:227-230. The timer is cleared once the race settles (no
// observable difference; keeps the isolate free of a pending 2.5 s timer).
async function raceTimeout<T>(work: Promise<T>, onTimeout: T, timedOut: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      timedOut();
      resolve(onTimeout);
    }, SERVICE_FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// middleware.ts:111-135
export async function fetchArticleMeta(c: SeoCaches, io: SupabaseIo, lang: string, slug: string): Promise<ArticleMeta | null> {
  const parts = [lang, slug];
  const cached = await c.article.get(parts, io);
  if (cached) return cached.data;

  const anonKey = io.anonKey;
  if (!anonKey) {
    io.state.degraded = true;
    return null;
  }

  const selectFields = 'title,slug,meta_title,meta_description,excerpt,featured_image,featured_image_alt,language,created_at,updated_at,translation_id,content';

  try {
    const url = `${io.supabaseUrl}/rest/v1/articles?slug=eq.${encodeURIComponent(slug)}&language=eq.${lang}&status=eq.published&select=${selectFields}&limit=1`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) {
      io.state.degraded = true;
      return null;
    }
    const data = (await res.json()) as ArticleMeta[] | null;
    const article = data?.[0] ?? null;
    const expiresIn = article ? CACHE_TTL : NEGATIVE_CACHE_TTL;
    c.article.set(parts, article, expiresIn, io);
    return article;
  } catch {
    io.state.degraded = true;
    return null;
  }
}

// middleware.ts:137-158
export async function fetchTranslationSlugs(c: SeoCaches, io: SupabaseIo, translationId: string): Promise<TranslationMap> {
  const parts = [translationId];
  const cached = await c.translations.get(parts, io);
  if (cached) return cached.data;

  const anonKey = io.anonKey;
  if (!anonKey) return {};

  try {
    const url = `${io.supabaseUrl}/rest/v1/articles?translation_id=eq.${translationId}&status=eq.published&select=language,slug`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) return {};
    const rows = (await res.json()) as { language: string; slug: string }[];
    const map: TranslationMap = {};
    for (const row of rows) map[row.language] = row.slug;
    c.translations.set(parts, map, CACHE_TTL, io);
    return map;
  } catch {
    return {};
  }
}

// middleware.ts:160-180
export async function fetchRecentArticles(c: SeoCaches, io: SupabaseIo, lang: string): Promise<ArticleListItem[]> {
  const parts = [lang];
  const cached = await c.list.get(parts, io);
  if (cached) return cached.data;

  const anonKey = io.anonKey;
  if (!anonKey) return [];

  try {
    const url = `${io.supabaseUrl}/rest/v1/articles?language=eq.${lang}&status=eq.published&select=title,slug,excerpt,created_at&order=created_at.desc&limit=10`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) return [];
    const rows = (await res.json()) as ArticleListItem[];
    c.list.set(parts, rows, CACHE_TTL, io);
    return rows;
  } catch {
    return [];
  }
}

// middleware.ts:182-187
const SERVICE_PAGE_SELECT = [
  'slug', 'language', 'localized_slug',
  'title', 'meta_description', 'h1', 'tagline', 'lead_paragraph',
  'capabilities', 'applications', 'materials', 'tolerances',
  'process_steps', 'lead_times', 'faq', 'differentiators', 'cross_links',
].join(',');

// middleware.ts:196-214. Returns { row, failed } so the caller can tag a negative entry that came from a failure.
async function fetchServicePageRaw(io: SupabaseIo, lang: string, slug: string): Promise<{ row: ServicePageRow | null; failed: boolean }> {
  const anonKey = io.anonKey;
  if (!anonKey) return { row: null, failed: true };
  try {
    const url = `${io.supabaseUrl}/rest/v1/service_pages`
      + `?slug=eq.${encodeURIComponent(slug)}`
      + `&language=eq.${lang}`
      + `&status=eq.published`
      + `&select=${SERVICE_PAGE_SELECT}&limit=1`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) return { row: null, failed: true };
    const data = (await res.json()) as ServicePageRow[] | null;
    return { row: data?.[0] ?? null, failed: false };
  } catch {
    return { row: null, failed: true };
  }
}

// middleware.ts:222-236
export async function fetchServicePage(c: SeoCaches, io: SupabaseIo, lang: string, slug: string): Promise<ServicePageRow | null> {
  const parts = [lang, slug];
  const cached = await c.sp.get(parts, io);
  if (cached) {
    if (cached.failed) io.state.degraded = true;
    return cached.data;
  }

  let failed = false;
  const { row, failed: rawFailed } = await raceTimeout(
    fetchServicePageRaw(io, lang, slug),
    { row: null, failed: true },
    () => { failed = true; },
  );
  failed = failed || rawFailed;
  if (failed) io.state.degraded = true;
  const expiresIn = row ? CACHE_TTL : NEGATIVE_CACHE_TTL;
  c.sp.set(parts, row, expiresIn, io, failed && !row);
  return row;
}

// middleware.ts:238-270
export async function fetchServicePageList(c: SeoCaches, io: SupabaseIo, lang: string): Promise<ServicePageRow[]> {
  const parts = [lang];
  const cached = await c.splist.get(parts, io);
  if (cached) {
    if (cached.failed) io.state.degraded = true;
    return cached.data;
  }

  const anonKey = io.anonKey;
  if (!anonKey) {
    io.state.degraded = true;
    return [];
  }

  let failed = false;
  const fetchForLang = async (): Promise<ServicePageRow[]> => {
    try {
      const url = `${io.supabaseUrl}/rest/v1/service_pages`
        + `?language=eq.${lang}`
        + `&status=eq.published`
        + `&slug=neq.index`
        + `&select=${SERVICE_PAGE_SELECT}&order=slug`;
      const res = await io.fetch(url, { headers: authHeaders(anonKey) });
      if (!res.ok) {
        failed = true;
        return [];
      }
      return (await res.json()) as ServicePageRow[];
    } catch {
      failed = true;
      return [];
    }
  };

  const rows = await raceTimeout(fetchForLang(), [] as ServicePageRow[], () => { failed = true; });
  if (failed) io.state.degraded = true;
  const expiresIn = rows.length ? CACHE_TTL : NEGATIVE_CACHE_TTL;
  c.splist.set(parts, rows, expiresIn, io, failed && !rows.length);
  return rows;
}

// middleware.ts:272-277
const CONTENT_PAGE_SELECT = [
  'slug', 'language', 'localized_slug',
  'title', 'meta_description', 'h1', 'tagline', 'lead_paragraph',
  'sections', 'faq', 'cross_links', 'internal_links',
  'schema_type', 'structured_data',
].join(',');

// middleware.ts:279-316
async function fetchContentPageRaw(io: SupabaseIo, lang: string, slug: string): Promise<{ row: ContentPageRow | null; failed: boolean }> {
  const anonKey = io.anonKey;
  if (!anonKey) return { row: null, failed: true };
  try {
    // Match either the canonical slug OR the language-specific localized_slug
    // so non-EN URLs (e.g. /fr/a-propos) resolve even when the route parser
    // handed us the raw URL segment instead of the canonical slug.
    const encoded = encodeURIComponent(slug);
    const url = `${io.supabaseUrl}/rest/v1/content_pages`
      + `?or=(slug.eq.${encoded},localized_slug.eq.${encoded})`
      + `&language=eq.${lang}`
      + `&status=eq.published`
      + `&select=${CONTENT_PAGE_SELECT}&limit=1`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) return { row: null, failed: true };
    const data = (await res.json()) as Record<string, unknown>[] | null;
    const row = data?.[0] ?? null;
    if (!row) return { row: null, failed: false };
    // Normalize content_pages.faq ({q, a}) to the {question, answer} shape used
    // by the existing faqPageSchemaFromRow helper and the renderer.
    if (Array.isArray(row.faq)) {
      row.faq = row.faq.map((f: { q?: string; a?: string; question?: string; answer?: string }) => ({
        question: f.question ?? f.q ?? '',
        answer: f.answer ?? f.a ?? '',
      }));
    } else {
      row.faq = [];
    }
    row.cross_links = Array.isArray(row.cross_links) ? row.cross_links : [];
    row.internal_links = Array.isArray(row.internal_links) ? row.internal_links : [];
    row.sections = Array.isArray(row.sections) ? row.sections : [];
    return { row: row as unknown as ContentPageRow, failed: false };
  } catch {
    return { row: null, failed: true };
  }
}

// middleware.ts:318-330
export async function fetchContentPage(c: SeoCaches, io: SupabaseIo, lang: string, slug: string): Promise<ContentPageRow | null> {
  const parts = [lang, slug];
  const cached = await c.cp.get(parts, io);
  if (cached) {
    if (cached.failed) io.state.degraded = true;
    return cached.data;
  }

  let failed = false;
  const { row, failed: rawFailed } = await raceTimeout(
    fetchContentPageRaw(io, lang, slug),
    { row: null, failed: true },
    () => { failed = true; },
  );
  failed = failed || rawFailed;
  if (failed) io.state.degraded = true;
  const expiresIn = row ? CACHE_TTL : NEGATIVE_CACHE_TTL;
  c.cp.set(parts, row, expiresIn, io, failed && !row);
  return row;
}

// middleware.ts:377-404
export async function fetchContentPageAlternates(c: SeoCaches, io: SupabaseIo, canonical: string): Promise<Record<string, string | null>> {
  const parts = [canonical];
  const cached = await c.cpalt.get(parts, io);
  if (cached) return cached.data;

  const anonKey = io.anonKey;
  if (!anonKey) return {};

  try {
    const url = `${io.supabaseUrl}/rest/v1/content_pages`
      + `?slug=eq.${encodeURIComponent(canonical)}`
      + `&status=eq.published`
      + `&select=language,localized_slug`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) return {};
    const rows = (await res.json()) as { language: string; localized_slug: string | null }[];
    const map: Record<string, string | null> = {};
    for (const r of rows) map[r.language] = r.localized_slug;
    c.cpalt.set(parts, map, Object.keys(map).length ? CACHE_TTL : NEGATIVE_CACHE_TTL, io);
    return map;
  } catch {
    return {};
  }
}
