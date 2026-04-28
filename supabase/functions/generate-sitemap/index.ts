import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

/**
 * Sitemap generator (canonical writer).
 *
 * Writes sitemap-complete.xml to Supabase Storage. api/sitemap.js (the Vercel
 * handler behind /sitemap.xml) reads this blob on every request and serves it
 * verbatim; its own dynamic generator is a fallback.
 *
 * Content-page URLs (industries, our-work, about, contact, education,
 * legal-notice, privacy-policy, …) are pulled LIVE from content_pages instead
 * of a hardcoded array. Previously the array missed education / legal-notice
 * / privacy-policy × 14 languages (42 URLs) and no alarm fired — the
 * regression guard at the bottom of this file throws if a future drift
 * silently drops rows again.
 *
 * /sitemap-complete.xml is being collapsed into /sitemap.xml via a Vercel
 * 301 redirect; both served identical content already. GSC submissions
 * should point at /sitemap.xml going forward.
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LANGUAGES = ["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "fi", "nb", "hu", "cs"];

// Only non-content_pages slugs live here now. Anything in content_pages
// (industries, our-work, about, contact, education, legal-notice,
// privacy-policy) is emitted from fetchContentPages() so the sitemap can
// never fall out of sync with the database again.
const SLUGS: Record<string, Record<string, string>> = {
  en: { services: 'services', quote: 'quote', blog: 'blog', cnc: 'cnc-machining', sheetMetal: 'sheet-metal', printing: '3d-printing', injection: 'injection-molding', surface: 'surface-finishes', rapid: 'rapid-prototyping' },
  de: { services: 'dienstleistungen', quote: 'angebot', blog: 'blog', cnc: 'cnc-bearbeitung', sheetMetal: 'blechbearbeitung', printing: '3d-druck', injection: 'spritzguss', surface: 'oberflaechenveredelung', rapid: 'rapid-prototyping' },
  fr: { services: 'services', quote: 'devis', blog: 'blog', cnc: 'usinage-cnc', sheetMetal: 'tolerie', printing: 'impression-3d', injection: 'injection-plastique', surface: 'finition-surface', rapid: 'prototypage-rapide' },
  es: { services: 'servicios', quote: 'cotizacion', blog: 'blog', cnc: 'mecanizado-cnc', sheetMetal: 'chapa-metalica', printing: 'impresion-3d', injection: 'moldeo-por-inyeccion', surface: 'acabados-superficie', rapid: 'prototipado-rapido' },
  it: { services: 'servizi', quote: 'preventivo', blog: 'blog', cnc: 'lavorazione-cnc', sheetMetal: 'lavorazione-lamiera', printing: 'stampa-3d', injection: 'stampaggio-iniezione', surface: 'finitura-superficie', rapid: 'prototipazione-rapida' },
  nl: { services: 'diensten', quote: 'offerte', blog: 'blog', cnc: 'cnc-bewerking', sheetMetal: 'plaatbewerking', printing: '3d-printen', injection: 'spuitgieten', surface: 'oppervlakteafwerking', rapid: 'rapid-prototyping' },
  pl: { services: 'uslugi', quote: 'wycena', blog: 'blog', cnc: 'obrobka-cnc', sheetMetal: 'obrobka-bluzy', printing: 'druk-3d', injection: 'wtrysk-tworzywa', surface: 'wykonczenie-powierzchni', rapid: 'szybkie-prototypowanie' },
  pt: { services: 'servicos', quote: 'orcamento', blog: 'blog', cnc: 'usinagem-cnc', sheetMetal: 'chapa-metalica', printing: 'impressao-3d', injection: 'moldagem-injecao', surface: 'acabamento-superficie', rapid: 'prototipagem-rapida' },
  sv: { services: 'tjanster', quote: 'offert', blog: 'blogg', cnc: 'cnc-bearbetning', sheetMetal: 'platbearbetning', printing: '3d-skrivning', injection: 'formsprutning', surface: 'ytbehandling', rapid: 'snabb-prototypering' },
  da: { services: 'tjenester', quote: 'tilbud', blog: 'blog', cnc: 'cnc-bearbejdning', sheetMetal: 'pladearbejde', printing: '3d-printing', injection: 'sprojtestobning', surface: 'overfladebehandling', rapid: 'hurtig-prototypering' },
  fi: { services: 'palvelut', quote: 'tarjous', blog: 'blogi', cnc: 'cnc-työstö', sheetMetal: 'levytyöstö', printing: '3d-tulostus', injection: 'ruiskupuristus', surface: 'pinnan-viimeistely', rapid: 'nopea-prototyyppaus' },
  nb: { services: 'tjenester', quote: 'tilbud', blog: 'blogg', cnc: 'cnc-bearbeiding', sheetMetal: 'platarbeid', printing: '3d-printing', injection: 'sproytestoping', surface: 'overflatebehandling', rapid: 'rask-prototyping' },
  hu: { services: 'szolgaltatasok', quote: 'ajanlat', blog: 'blog', cnc: 'cnc-megmunkalas', sheetMetal: 'lemezfeldolgozas', printing: '3d-nyomtas', injection: 'frccsnyomas', surface: 'feluletkezeles', rapid: 'gyors-prototipus' },
  cs: { services: 'sluzby', quote: 'nabidka', blog: 'blog', cnc: 'cnc-obrabeni', sheetMetal: 'obrabeni-plechu', printing: '3d-tisk', injection: 'vstrekovani', surface: 'uprava-povrchu', rapid: 'rychle-prototypovani' },
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function encodeSitemapUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.pathname = urlObj.pathname
      .split('/')
      .map(segment => encodeURIComponent(decodeURIComponent(segment)))
      .join('/');
    return urlObj.toString();
  } catch {
    return encodeURI(url);
  }
}

interface PageDef {
  key: string;
  path: (s: Record<string, string>) => string;
  priority: string;
  changefreq: string;
}

const STATIC_PAGES: PageDef[] = [
  { key: 'home', path: () => '', priority: '1.0', changefreq: 'weekly' },
  { key: 'services', path: (s) => `/${s.services}`, priority: '0.9', changefreq: 'weekly' },
  { key: 'cnc', path: (s) => `/${s.services}/${s.cnc}`, priority: '0.9', changefreq: 'weekly' },
  { key: 'sheetMetal', path: (s) => `/${s.services}/${s.sheetMetal}`, priority: '0.9', changefreq: 'weekly' },
  { key: 'printing', path: (s) => `/${s.services}/${s.printing}`, priority: '0.9', changefreq: 'weekly' },
  { key: 'injection', path: (s) => `/${s.services}/${s.injection}`, priority: '0.9', changefreq: 'weekly' },
  { key: 'surface', path: (s) => `/${s.services}/${s.surface}`, priority: '0.8', changefreq: 'weekly' },
  { key: 'rapid', path: (s) => `/${s.services}/${s.rapid}`, priority: '0.8', changefreq: 'weekly' },
  { key: 'quote', path: (s) => `/${s.quote}`, priority: '0.8', changefreq: 'weekly' },
  { key: 'quoteRequest', path: () => '/quote-request', priority: '0.7', changefreq: 'weekly' },
  { key: 'blog', path: (s) => `/${s.blog}`, priority: '0.8', changefreq: 'daily' },
];

const CONTENT_PAGE_META: Record<string, { priority: string; changefreq: string }> = {
  'industries':     { priority: '0.8', changefreq: 'weekly' },
  'our-work':       { priority: '0.7', changefreq: 'monthly' },
  'about':          { priority: '0.7', changefreq: 'monthly' },
  'contact':        { priority: '0.7', changefreq: 'monthly' },
  'education':      { priority: '0.7', changefreq: 'monthly' },
  'legal-notice':   { priority: '0.4', changefreq: 'yearly' },
  'privacy-policy': { priority: '0.4', changefreq: 'yearly' },
};

interface Article {
  slug: string;
  language: string;
  updated_at: string;
  created_at?: string;
  translation_id?: string;
}

interface ContentPage {
  slug: string;
  language: string;
  localized_slug: string | null;
  updated_at: string | null;
}

function buildPageUrl(lang: string, page: PageDef): string {
  const s = SLUGS[lang];
  const pagePath = page.path(s);
  return encodeSitemapUrl(`${siteUrl}/${lang}${pagePath}`);
}

function buildStaticPageHreflang(page: PageDef): string {
  const links = LANGUAGES.map(lang => {
    const url = escapeXml(buildPageUrl(lang, page));
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  const englishUrl = escapeXml(buildPageUrl('en', page));
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${englishUrl}"/>`);
  return links.join('\n');
}

function buildStaticUrlEntry(lang: string, page: PageDef, today: string): string {
  const loc = escapeXml(buildPageUrl(lang, page));
  // sitemaps.org XSD requires <loc>/<lastmod>/<changefreq>/<priority> first,
  // then extension elements like xhtml:link. GSC's strict parser rejects the
  // file with "Sitemap could not be read" if hreflang appears before lastmod.
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
${buildStaticPageHreflang(page)}
  </url>`;
}

function buildContentPageUrl(lang: string, row: ContentPage): string {
  const segment = row.localized_slug || row.slug;
  return encodeSitemapUrl(`${siteUrl}/${lang}/${segment}`);
}

function buildContentPageHreflang(slugGroup: Map<string, ContentPage>): string {
  const links: string[] = [];
  for (const lang of LANGUAGES) {
    const row = slugGroup.get(lang);
    if (!row) continue;
    const url = escapeXml(buildContentPageUrl(lang, row));
    links.push(`    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`);
  }
  const defaultLang = slugGroup.has('en') ? 'en' : [...slugGroup.keys()][0];
  const defaultRow = defaultLang ? slugGroup.get(defaultLang) : undefined;
  if (defaultRow && defaultLang) {
    const url = escapeXml(buildContentPageUrl(defaultLang, defaultRow));
    links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${url}"/>`);
  }
  return links.join('\n');
}

function buildContentPageUrlEntry(
  lang: string,
  row: ContentPage,
  slugGroup: Map<string, ContentPage>,
  today: string,
): string {
  const loc = escapeXml(buildContentPageUrl(lang, row));
  const meta = CONTENT_PAGE_META[row.slug] || { priority: '0.6', changefreq: 'monthly' };
  const lastmod = row.updated_at ? String(row.updated_at).split('T')[0] : today;
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${meta.changefreq}</changefreq>
    <priority>${meta.priority}</priority>
${buildContentPageHreflang(slugGroup)}
  </url>`;
}

function buildBlogHreflang(siblings: Article[]): string {
  const links = siblings.map(sibling => {
    const lang = (sibling.language || 'en').trim().toLowerCase();
    const blogSlug = SLUGS[lang]?.blog || 'blog';
    const url = escapeXml(encodeSitemapUrl(`${siteUrl}/${lang}/${blogSlug}/${sibling.slug}`));
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  const englishSibling = siblings.find(s => (s.language || '').trim().toLowerCase() === 'en');
  if (englishSibling) {
    const url = escapeXml(encodeSitemapUrl(`${siteUrl}/en/${SLUGS.en.blog}/${englishSibling.slug}`));
    links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${url}"/>`);
  }
  return links.join('\n');
}

function buildBlogUrlEntry(article: Article, siblings: Article[], today: string): string {
  const lang = (article.language || 'en').trim().toLowerCase();
  const blogSlug = SLUGS[lang]?.blog || 'blog';
  const loc = escapeXml(encodeSitemapUrl(`${siteUrl}/${lang}/${blogSlug}/${article.slug}`));
  const lastmod = (article.updated_at || article.created_at || today).split('T')[0];
  const hreflang = siblings.length > 1 ? `\n${buildBlogHreflang(siblings)}` : '';

  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>${hreflang}
  </url>`;
}

async function fetchAllPublishedArticles(): Promise<Article[]> {
  const all: Article[] = [];
  const PAGE_SIZE = 1000;
  let page = 0;
  while (true) {
    const { data: batch, error } = await supabase
      .from("articles")
      .select("slug, language, updated_at, created_at, translation_id")
      .eq("status", "published")
      .order("language", { ascending: true })
      .order("updated_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error("Error fetching articles:", error);
      throw new Error(`Failed to fetch articles: ${error.message}`);
    }

    if (!batch || batch.length === 0) break;
    all.push(...batch as Article[]);
    if (batch.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

async function fetchAllPublishedContentPages(): Promise<ContentPage[]> {
  const { data, error } = await supabase
    .from("content_pages")
    .select("language, slug, localized_slug, updated_at")
    .eq("status", "published")
    .not("slug", "in", "(home,blog)")
    .order("slug", { ascending: true })
    .order("language", { ascending: true });

  if (error) {
    console.error("Error fetching content_pages:", error);
    throw new Error(`Failed to fetch content_pages: ${error.message}`);
  }
  return (data || []) as ContentPage[];
}

function groupContentPagesByCanonicalSlug(rows: ContentPage[]): Map<string, Map<string, ContentPage>> {
  const groups = new Map<string, Map<string, ContentPage>>();
  for (const row of rows) {
    const lang = (row.language || '').trim().toLowerCase();
    if (!LANGUAGES.includes(lang)) continue;
    if (!groups.has(row.slug)) groups.set(row.slug, new Map());
    groups.get(row.slug)!.set(lang, row);
  }
  return groups;
}

async function syncArticlesToMonitoredUrls(articles: Article[]): Promise<{ upserted: number; skipped: number }> {
  const rows = articles
    .map((article) => {
      const lang = (article.language || '').trim().toLowerCase();
      if (!LANGUAGES.includes(lang)) return null;
      const blogSlug = SLUGS[lang]?.blog || 'blog';
      const url = encodeSitemapUrl(`${siteUrl}/${lang}/${blogSlug}/${article.slug}`);
      return {
        url,
        label: `${lang.toUpperCase()} — ${article.slug}`.slice(0, 200),
        language: lang,
        service_type: 'blog_article',
        priority: 5,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const skipped = articles.length - rows.length;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('gsc_monitored_urls')
      .upsert(chunk, { onConflict: 'url', ignoreDuplicates: false });
    if (error) {
      console.error(`Monitored URL upsert chunk ${i / 500} failed:`, error.message);
      throw new Error(`Failed to sync monitored URLs: ${error.message}`);
    }
    upserted += chunk.length;
  }

  console.log(`Synced ${upserted} article URLs to gsc_monitored_urls (${skipped} skipped for invalid language)`);
  return { upserted, skipped };
}

async function generateSitemap(
  articles: Article[],
  contentPages: ContentPage[],
): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  // 1. Static pages: 14 languages × 11 entries = 154 URLs.
  const staticEntries: string[] = [];
  for (const page of STATIC_PAGES) {
    for (const lang of LANGUAGES) {
      staticEntries.push(buildStaticUrlEntry(lang, page, today));
    }
  }

  // 2. Content-page entries: one <url> per (slug, language) row in the DB.
  // Each entry carries the full hreflang cluster for that canonical slug
  // using each row's localized_slug (fallback: canonical slug).
  const contentGroups = groupContentPagesByCanonicalSlug(contentPages);
  const contentEntries: string[] = [];
  let contentUrlCount = 0;
  for (const [, slugGroup] of contentGroups) {
    for (const [lang, row] of slugGroup) {
      contentEntries.push(buildContentPageUrlEntry(lang, row, slugGroup, today));
      contentUrlCount++;
    }
  }

  // Regression guard — hard fail on drift. This exact silent gap (42 missing
  // URLs for education/legal-notice/privacy-policy × 14 langs) is why we're
  // here; refusing to write a partial sitemap beats shipping another one.
  const expectedContentUrls = contentPages.filter(r => {
    const lang = (r.language || '').trim().toLowerCase();
    return LANGUAGES.includes(lang);
  }).length;
  if (contentUrlCount < expectedContentUrls) {
    throw new Error(
      `Sitemap regression guard: emitted ${contentUrlCount} content-page URLs ` +
      `but content_pages has ${expectedContentUrls} published rows across supported ` +
      `languages. Refusing to upload a partial sitemap.`
    );
  }

  console.log(
    `content_pages: ${contentUrlCount} URLs across ${contentGroups.size} canonical slugs ` +
    `(${[...contentGroups.keys()].sort().join(', ')})`
  );

  // 3. Blog articles: group by translation_id, emit hreflang between siblings.
  const translationGroups = new Map<string, Article[]>();
  const orphanArticles: Article[] = [];

  for (const article of articles || []) {
    const normalizedLang = (article.language || '').trim().toLowerCase();
    if (!LANGUAGES.includes(normalizedLang)) continue;

    if (article.translation_id) {
      if (!translationGroups.has(article.translation_id)) {
        translationGroups.set(article.translation_id, []);
      }
      translationGroups.get(article.translation_id)!.push(article);
    } else {
      orphanArticles.push(article);
    }
  }

  const blogEntries: string[] = [];
  let totalArticlesAdded = 0;

  for (const [, siblings] of translationGroups) {
    for (const article of siblings) {
      blogEntries.push(buildBlogUrlEntry(article, siblings, today));
      totalArticlesAdded++;
    }
  }

  for (const article of orphanArticles) {
    blogEntries.push(buildBlogUrlEntry(article, [article], today));
    totalArticlesAdded++;
  }

  console.log(`Total articles added to sitemap: ${totalArticlesAdded}`);
  console.log(`Translation groups: ${translationGroups.size}, orphan articles: ${orphanArticles.length}`);

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${staticEntries.join('\n')}
${contentEntries.join('\n')}
${blogEntries.join('\n')}
</urlset>`;

  return sitemap;
}

async function uploadSitemapToStorage(
  filename: string,
  content: string
): Promise<{ success: boolean; publicUrl: string | null; error?: string }> {
  try {
    const blob = new Blob([content], { type: "application/xml" });

    const { error } = await supabase.storage
      .from("sitemaps")
      .upload(filename, blob, {
        contentType: "application/xml",
        upsert: true,
        cacheControl: "3600",
      });

    if (error) {
      console.error(`Storage upload error for ${filename}:`, error);
      return { success: false, publicUrl: null, error: error.message };
    }

    const { data: urlData } = supabase.storage
      .from("sitemaps")
      .getPublicUrl(filename);

    console.log(`Sitemap uploaded: ${filename} -> ${urlData.publicUrl}`);
    return { success: true, publicUrl: urlData.publicUrl };
  } catch (error: any) {
    console.error(`Upload exception for ${filename}:`, error);
    return { success: false, publicUrl: null, error: error.message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const uploadResults: Array<{ filename: string; publicUrl: string | null; success: boolean }> = [];

    // Fetch articles + content pages once and reuse.
    const [articles, contentPages] = await Promise.all([
      fetchAllPublishedArticles(),
      fetchAllPublishedContentPages(),
    ]);

    const sitemap = await generateSitemap(articles, contentPages);
    const urlCount = (sitemap.match(/<url>/g) || []).length;

    // Sync every article URL into gsc_monitored_urls for the Index Status tab.
    const syncResult = await syncArticlesToMonitoredUrls(articles);

    const stats = {
      type: "complete",
      urls: urlCount,
      languages: LANGUAGES.length,
      articles: articles.length,
      contentPages: contentPages.length,
      monitoredUrlsSynced: syncResult.upserted,
    };

    const result = await uploadSitemapToStorage("sitemap-complete.xml", sitemap);
    uploadResults.push({ filename: "sitemap-complete.xml", ...result });

    console.log(
      `Generated sitemap with ${stats.urls} URLs (${stats.articles} articles, ` +
      `${stats.contentPages} content pages across ${stats.languages} languages); ` +
      `synced ${stats.monitoredUrlsSynced} monitored URLs`
    );

    const storageBaseUrl = `${supabaseUrl}/storage/v1/object/public/sitemaps`;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sitemap generated and saved successfully`,
        stats,
        storage: {
          uploaded: uploadResults,
          publicUrls: {
            sitemap: `${storageBaseUrl}/sitemap-complete.xml`,
          }
        },
        sitemap: sitemap,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error generating sitemap:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
