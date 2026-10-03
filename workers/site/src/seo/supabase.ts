// Supabase REST helpers of the SEO handler: a copy of middleware.ts:41-404 adapted to Workers.
//
// Unchanged from middleware.ts: REST URLs and select lists, request headers, the 2.5 s Promise.race timeouts,
// what is cached and for how long (1 h positive, 30 s negative, and which failures are not cached at all),
// the content_pages faq/cross_links/internal_links/sections normalisation, and the empty value each helper
// returns on a miss or failure.
//
// Adapted: SUPABASE_URL and the anon key come from env (middleware.ts:43, :103-109); the per-isolate Map caches
// sit in front of KV SEO_CACHE (./cache.ts), which holds positives only (cacheLookup), and for content pages only
// under the row's own slug or localized_slug (fetchContentPage); a failed lookup is
// reported to the request state so the strict-404 path never answers 404 because Supabase was down. For the three
// lookups middleware.ts bounds with its 2.5 s Promise.race (service page, service page list, content page) the KV
// read runs INSIDE the same 2.5 s budget, so the answer time of middleware.ts holds whatever KV does.

import type { ContentPageRow } from '../../../../middleware/renderers/contentPage';
import { TieredCache, fingerprint, type CacheHit, type CacheIo, type CacheKind } from './cache';

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

// ─── Queries ──────────────────────────────────────────────────────────────────
// Kept as constants so the KV shape fingerprint (cacheShape) follows any change to them.

// middleware.ts:118
const ARTICLE_SELECT = 'title,slug,meta_title,meta_description,excerpt,featured_image,featured_image_alt,language,created_at,updated_at,translation_id,content';
// middleware.ts:145
const TRANSLATIONS_SELECT = 'language,slug';
// middleware.ts:168
const LIST_QUERY = 'status=eq.published&select=title,slug,excerpt,created_at&order=created_at.desc&limit=10';
// middleware.ts:182-187
const SERVICE_PAGE_SELECT = [
  'slug', 'language', 'localized_slug',
  'title', 'meta_description', 'h1', 'tagline', 'lead_paragraph',
  'capabilities', 'applications', 'materials', 'tolerances',
  'process_steps', 'lead_times', 'faq', 'differentiators', 'cross_links',
].join(',');
// middleware.ts:272-277
const CONTENT_PAGE_SELECT = [
  'slug', 'language', 'localized_slug',
  'title', 'meta_description', 'h1', 'tagline', 'lead_paragraph',
  'sections', 'faq', 'cross_links', 'internal_links',
  'schema_type', 'structured_data',
].join(',');
// middleware.ts:386-388
const CONTENT_ALTERNATES_SELECT = 'language,localized_slug';

// Bump when the code that shapes cached data changes without a query change (e.g. the content_pages
// normalisation in fetchContentPageRaw): every KV value written before becomes a miss.
const CACHE_SHAPE_VERSION = 1;

const SHAPE_SOURCES: Record<CacheKind, string> = {
  article: `articles|${ARTICLE_SELECT}|limit=1`,
  translations: `articles|${TRANSLATIONS_SELECT}`,
  list: `articles|${LIST_QUERY}`,
  sp: `service_pages|${SERVICE_PAGE_SELECT}|limit=1`,
  splist: `service_pages|slug=neq.index|${SERVICE_PAGE_SELECT}|order=slug`,
  cp: `content_pages|${CONTENT_PAGE_SELECT}|limit=1|normalised:faq{question,answer},cross_links[],internal_links[],sections[]`,
  cpalt: `content_pages|${CONTENT_ALTERNATES_SELECT}`,
};

// The "v" field of KV values of `kind` (see cache.ts).
export function cacheShape(kind: CacheKind): string {
  return fingerprint(`${CACHE_SHAPE_VERSION}|${kind}|${SHAPE_SOURCES[kind]}`);
}

// Article rows carry the full article body (median ~23 kB of text): fewer of them per isolate.
const ARTICLE_MAP_MAX_ENTRIES = 300;

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
    article: new TieredCache('article', { shape: cacheShape('article'), maxEntries: ARTICLE_MAP_MAX_ENTRIES }),
    translations: new TieredCache('translations', { shape: cacheShape('translations') }),
    list: new TieredCache('list', { shape: cacheShape('list') }),
    sp: new TieredCache('sp', { shape: cacheShape('sp') }),
    splist: new TieredCache('splist', { shape: cacheShape('splist') }),
    cp: new TieredCache('cp', { shape: cacheShape('cp') }),
    cpalt: new TieredCache('cpalt', { shape: cacheShape('cpalt') }),
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
async function raceTimeout<T>(work: Promise<T>, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), SERVICE_FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface RawResult<T> {
  data: T;
  failed: boolean;
  // true: do not cache the result at all (middleware.ts returns before its cache write).
  skipCache?: boolean;
}

interface BoundedResult<T> extends RawResult<T> {
  cached: boolean;
}

// The cache write middleware.ts makes after a lookup: data found for CACHE_TTL, "no row" for NEGATIVE_CACHE_TTL.
// Found data goes to the Map and KV; "no row" (and a failed lookup, tagged) only to this isolate's Map, as in
// middleware.ts, so unknown URLs cost no KV write. `failed` matters only when nothing was found.
function cacheLookup<T>(cache: TieredCache<T>, parts: readonly string[], data: T, found: boolean, io: CacheIo, failed = false): void {
  if (found) cache.set(parts, data, CACHE_TTL, io);
  else cache.setLocal(parts, data, NEGATIVE_CACHE_TTL, failed);
}

// Map check (synchronous, as middleware.ts), then KV and Supabase together under ONE 2.5 s budget: a timeout gives
// `empty` as a failure, exactly what middleware.ts's race gives when the fetch is slow.
async function boundedLookup<T>(
  cache: TieredCache<T>, parts: readonly string[], io: SupabaseIo, empty: T, fetchRaw: () => Promise<RawResult<T>>,
): Promise<BoundedResult<T>> {
  const local = cache.peek(parts);
  if (local) return { ...local, cached: true };
  return raceTimeout(
    (async (): Promise<BoundedResult<T>> => {
      const shared: CacheHit<T> | undefined = await cache.getShared(parts, io);
      if (shared) return { ...shared, cached: true };
      return { ...(await fetchRaw()), cached: false };
    })(),
    { data: empty, failed: true, cached: false },
  );
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

  try {
    const url = `${io.supabaseUrl}/rest/v1/articles?slug=eq.${encodeURIComponent(slug)}&language=eq.${lang}&status=eq.published&select=${ARTICLE_SELECT}&limit=1`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) {
      io.state.degraded = true;
      return null;
    }
    const data = (await res.json()) as ArticleMeta[] | null;
    const article = data?.[0] ?? null;
    cacheLookup(c.article, parts, article, !!article, io);
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
    const url = `${io.supabaseUrl}/rest/v1/articles?translation_id=eq.${translationId}&status=eq.published&select=${TRANSLATIONS_SELECT}`;
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
    const url = `${io.supabaseUrl}/rest/v1/articles?language=eq.${lang}&${LIST_QUERY}`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) return [];
    const rows = (await res.json()) as ArticleListItem[];
    c.list.set(parts, rows, CACHE_TTL, io);
    return rows;
  } catch {
    return [];
  }
}

// middleware.ts:196-214. Returns { data, failed } so the caller can tag a negative entry that came from a failure.
async function fetchServicePageRaw(io: SupabaseIo, lang: string, slug: string): Promise<RawResult<ServicePageRow | null>> {
  const anonKey = io.anonKey;
  if (!anonKey) return { data: null, failed: true };
  try {
    const url = `${io.supabaseUrl}/rest/v1/service_pages`
      + `?slug=eq.${encodeURIComponent(slug)}`
      + `&language=eq.${lang}`
      + `&status=eq.published`
      + `&select=${SERVICE_PAGE_SELECT}&limit=1`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) return { data: null, failed: true };
    const data = (await res.json()) as ServicePageRow[] | null;
    return { data: data?.[0] ?? null, failed: false };
  } catch {
    return { data: null, failed: true };
  }
}

// middleware.ts:222-236
export async function fetchServicePage(c: SeoCaches, io: SupabaseIo, lang: string, slug: string): Promise<ServicePageRow | null> {
  const parts = [lang, slug];
  const { data: row, failed, cached } = await boundedLookup(c.sp, parts, io, null, () => fetchServicePageRaw(io, lang, slug));
  if (failed) io.state.degraded = true;
  if (cached) return row;
  cacheLookup(c.sp, parts, row, !!row, io, failed);
  return row;
}

// middleware.ts:238-270
export async function fetchServicePageList(c: SeoCaches, io: SupabaseIo, lang: string): Promise<ServicePageRow[]> {
  const parts = [lang];
  const fetchForLang = async (): Promise<RawResult<ServicePageRow[]>> => {
    const anonKey = io.anonKey;
    // middleware.ts:243-244: no key returns [] before the race and before any cache write.
    if (!anonKey) return { data: [], failed: true, skipCache: true };
    try {
      const url = `${io.supabaseUrl}/rest/v1/service_pages`
        + `?language=eq.${lang}`
        + `&status=eq.published`
        + `&slug=neq.index`
        + `&select=${SERVICE_PAGE_SELECT}&order=slug`;
      const res = await io.fetch(url, { headers: authHeaders(anonKey) });
      if (!res.ok) return { data: [], failed: true };
      return { data: (await res.json()) as ServicePageRow[], failed: false };
    } catch {
      return { data: [], failed: true };
    }
  };

  const { data: rows, failed, cached, skipCache } = await boundedLookup(c.splist, parts, io, [] as ServicePageRow[], fetchForLang);
  if (failed) io.state.degraded = true;
  if (cached || skipCache) return rows;
  cacheLookup(c.splist, parts, rows, rows.length > 0, io, failed);
  return rows;
}

// middleware.ts:279-316
async function fetchContentPageRaw(io: SupabaseIo, lang: string, slug: string): Promise<RawResult<ContentPageRow | null>> {
  const anonKey = io.anonKey;
  if (!anonKey) return { data: null, failed: true };
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
    if (!res.ok) return { data: null, failed: true };
    const data = (await res.json()) as Record<string, unknown>[] | null;
    const row = data?.[0] ?? null;
    if (!row) return { data: null, failed: false };
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
    return { data: row as unknown as ContentPageRow, failed: false };
  } catch {
    return { data: null, failed: true };
  }
}

// middleware.ts:318-330. KV keys stay bounded by the rows, not by the URLs requested: a row is shared through KV
// only under its own slug or localized_slug. A row Supabase returns for any other segment is cached as
// middleware.ts caches it (this isolate's Map, CACHE_TTL) and never written to KV, so the bytes served are the same.
export async function fetchContentPage(c: SeoCaches, io: SupabaseIo, lang: string, slug: string): Promise<ContentPageRow | null> {
  const parts = [lang, slug];
  const { data: row, failed, cached } = await boundedLookup(c.cp, parts, io, null, () => fetchContentPageRaw(io, lang, slug));
  if (failed) io.state.degraded = true;
  if (cached) return row;
  if (row && slug !== row.slug && slug !== row.localized_slug) c.cp.setLocal(parts, row, CACHE_TTL);
  else cacheLookup(c.cp, parts, row, !!row, io, failed);
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
      + `&select=${CONTENT_ALTERNATES_SELECT}`;
    const res = await io.fetch(url, { headers: authHeaders(anonKey) });
    if (!res.ok) return {};
    const rows = (await res.json()) as { language: string; localized_slug: string | null }[];
    const map: Record<string, string | null> = {};
    for (const r of rows) map[r.language] = r.localized_slug;
    cacheLookup(c.cpalt, parts, map, Object.keys(map).length > 0, io);
    return map;
  } catch {
    return {};
  }
}
