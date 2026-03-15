import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// All supported languages
const LANGUAGES = ["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "fi", "nb", "hu", "cs"];

// URL slugs per language — must match api/sitemap.xml.js and src/locales translations
const SLUGS: Record<string, Record<string, string>> = {
  en: { services: 'services', about: 'about', contact: 'contact', quote: 'quote', industries: 'industries', ourWork: 'our-work', blog: 'blog', cnc: 'cnc-machining', sheetMetal: 'sheet-metal', printing: '3d-printing', injection: 'injection-molding', surface: 'surface-finishes', rapid: 'rapid-prototyping' },
  de: { services: 'dienstleistungen', about: 'ueber-uns', contact: 'kontakt', quote: 'angebot', industries: 'branchen', ourWork: 'unsere-arbeit', blog: 'blog', cnc: 'cnc-bearbeitung', sheetMetal: 'blechbearbeitung', printing: '3d-druck', injection: 'spritzguss', surface: 'oberflaechenveredelung', rapid: 'rapid-prototyping' },
  fr: { services: 'services', about: 'a-propos', contact: 'contact', quote: 'devis', industries: 'secteurs', ourWork: 'notre-travail', blog: 'blog', cnc: 'usinage-cnc', sheetMetal: 'tolerie', printing: 'impression-3d', injection: 'injection-plastique', surface: 'finition-surface', rapid: 'prototypage-rapide' },
  es: { services: 'servicios', about: 'sobre-nosotros', contact: 'contacto', quote: 'cotizacion', industries: 'industrias', ourWork: 'nuestro-trabajo', blog: 'blog', cnc: 'mecanizado-cnc', sheetMetal: 'chapa-metalica', printing: 'impresion-3d', injection: 'moldeo-por-inyeccion', surface: 'acabados-superficie', rapid: 'prototipado-rapido' },
  it: { services: 'servizi', about: 'chi-siamo', contact: 'contatto', quote: 'preventivo', industries: 'settori', ourWork: 'i-nostri-lavori', blog: 'blog', cnc: 'lavorazione-cnc', sheetMetal: 'lavorazione-lamiera', printing: 'stampa-3d', injection: 'stampaggio-iniezione', surface: 'finitura-superficie', rapid: 'prototipazione-rapida' },
  nl: { services: 'diensten', about: 'over-ons', contact: 'contact', quote: 'offerte', industries: 'branches', ourWork: 'ons-werk', blog: 'blog', cnc: 'cnc-bewerking', sheetMetal: 'plaatbewerking', printing: '3d-printen', injection: 'spuitgieten', surface: 'oppervlakteafwerking', rapid: 'rapid-prototyping' },
  pl: { services: 'uslugi', about: 'o-nas', contact: 'kontakt', quote: 'wycena', industries: 'branze', ourWork: 'nasza-praca', blog: 'blog', cnc: 'obrobka-cnc', sheetMetal: 'obrobka-bluzy', printing: 'druk-3d', injection: 'wtrysk-tworzywa', surface: 'wykonczenie-powierzchni', rapid: 'szybkie-prototypowanie' },
  pt: { services: 'servicos', about: 'sobre-nos', contact: 'contato', quote: 'orcamento', industries: 'industrias', ourWork: 'nosso-trabalho', blog: 'blog', cnc: 'usinagem-cnc', sheetMetal: 'chapa-metalica', printing: 'impressao-3d', injection: 'moldagem-injecao', surface: 'acabamento-superficie', rapid: 'prototipagem-rapida' },
  sv: { services: 'tjanster', about: 'om-oss', contact: 'kontakt', quote: 'offert', industries: 'branscher', ourWork: 'vart-arbete', blog: 'blogg', cnc: 'cnc-bearbetning', sheetMetal: 'platbearbetning', printing: '3d-skrivning', injection: 'formsprutning', surface: 'ytbehandling', rapid: 'snabb-prototypering' },
  da: { services: 'tjenester', about: 'om-os', contact: 'kontakt', quote: 'tilbud', industries: 'brancher', ourWork: 'vores-arbejde', blog: 'blog', cnc: 'cnc-bearbejdning', sheetMetal: 'pladearbejde', printing: '3d-printing', injection: 'sprojtestobning', surface: 'overfladebehandling', rapid: 'hurtig-prototypering' },
  fi: { services: 'palvelut', about: 'meista', contact: 'yhteys', quote: 'tarjous', industries: 'toimialat', ourWork: 'tyomme', blog: 'blogi', cnc: 'cnc-työstö', sheetMetal: 'levytyöstö', printing: '3d-tulostus', injection: 'ruiskupuristus', surface: 'pinnan-viimeistely', rapid: 'nopea-prototyyppaus' },
  nb: { services: 'tjenester', about: 'om-oss', contact: 'kontakt', quote: 'tilbud', industries: 'bransjer', ourWork: 'vart-arbeid', blog: 'blogg', cnc: 'cnc-bearbeiding', sheetMetal: 'platarbeid', printing: '3d-printing', injection: 'sproytestoping', surface: 'overflatebehandling', rapid: 'rask-prototyping' },
  hu: { services: 'szolgaltatasok', about: 'rolunk', contact: 'kapcsolat', quote: 'ajanlat', industries: 'iparagak', ourWork: 'munkaink', blog: 'blog', cnc: 'cnc-megmunkalas', sheetMetal: 'lemezfeldolgozas', printing: '3d-nyomtas', injection: 'frccsnyomas', surface: 'feluletkezeles', rapid: 'gyors-prototipus' },
  cs: { services: 'sluzby', about: 'o-nas', contact: 'kontakt', quote: 'nabidka', industries: 'prumysl', ourWork: 'nase-prace', blog: 'blog', cnc: 'cnc-obrabeni', sheetMetal: 'obrabeni-plechu', printing: '3d-tisk', injection: 'vstrekovani', surface: 'uprava-povrchu', rapid: 'rychle-prototypovani' },
};

// Static page definitions with path builder functions
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
  { key: 'industries', path: (s) => `/${s.industries}`, priority: '0.8', changefreq: 'weekly' },
  { key: 'about', path: (s) => `/${s.about}`, priority: '0.7', changefreq: 'monthly' },
  { key: 'contact', path: (s) => `/${s.contact}`, priority: '0.7', changefreq: 'monthly' },
  { key: 'ourWork', path: (s) => `/${s.ourWork}`, priority: '0.7', changefreq: 'monthly' },
  { key: 'quote', path: (s) => `/${s.quote}`, priority: '0.8', changefreq: 'weekly' },
  { key: 'quoteRequest', path: () => '/quote-request', priority: '0.7', changefreq: 'weekly' },
  { key: 'blog', path: (s) => `/${s.blog}`, priority: '0.8', changefreq: 'daily' },
];

interface Article {
  slug: string;
  language: string;
  updated_at: string;
  created_at?: string;
  translation_id?: string;
}

/**
 * Build full URL for a language + page combination
 */
function buildPageUrl(lang: string, page: PageDef): string {
  const s = SLUGS[lang];
  const pagePath = page.path(s);
  return `${siteUrl}/${lang}${pagePath}`;
}

/**
 * Build hreflang XML links for a static page across all languages
 */
function buildStaticPageHreflang(page: PageDef): string {
  const links = LANGUAGES.map(lang => {
    const url = buildPageUrl(lang, page);
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  const englishUrl = buildPageUrl('en', page);
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${englishUrl}"/>`);
  return links.join('\n');
}

/**
 * Build a static page <url> entry for a specific language
 */
function buildStaticUrlEntry(lang: string, page: PageDef, today: string): string {
  const loc = buildPageUrl(lang, page);
  return `  <url>
    <loc>${loc}</loc>
${buildStaticPageHreflang(page)}
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
}

/**
 * Build hreflang links for a blog article and its translations
 */
function buildBlogHreflang(siblings: Article[]): string {
  const links = siblings.map(sibling => {
    const lang = (sibling.language || 'en').trim().toLowerCase();
    const blogSlug = SLUGS[lang]?.blog || 'blog';
    const url = `${siteUrl}/${lang}/${blogSlug}/${sibling.slug}`;
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  const englishSibling = siblings.find(s => (s.language || '').trim().toLowerCase() === 'en');
  if (englishSibling) {
    links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}/en/${SLUGS.en.blog}/${englishSibling.slug}"/>`);
  }
  return links.join('\n');
}

/**
 * Build a blog article <url> entry with hreflang
 */
function buildBlogUrlEntry(article: Article, siblings: Article[], today: string): string {
  const lang = (article.language || 'en').trim().toLowerCase();
  const blogSlug = SLUGS[lang]?.blog || 'blog';
  const loc = `${siteUrl}/${lang}/${blogSlug}/${article.slug}`;
  const lastmod = (article.updated_at || article.created_at || today).split('T')[0];
  const hreflang = siblings.length > 1 ? `\n${buildBlogHreflang(siblings)}` : '';

  return `  <url>
    <loc>${loc}</loc>${hreflang}
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
}

/**
 * Format date to W3C format
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toISOString().split('T')[0];
}

/**
 * Generate the complete sitemap XML with full hreflang support
 */
async function generateSitemap(): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  // 1. Generate static page entries: 14 languages × 15 pages = 210 entries
  const staticEntries: string[] = [];
  for (const page of STATIC_PAGES) {
    for (const lang of LANGUAGES) {
      staticEntries.push(buildStaticUrlEntry(lang, page, today));
    }
  }

  // 2. Fetch all published articles
  const { data: articles, error } = await supabase
    .from("articles")
    .select("slug, language, updated_at, created_at, translation_id")
    .eq("status", "published")
    .order("language", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching articles:", error);
    throw new Error(`Failed to fetch articles: ${error.message}`);
  }

  console.log(`Found ${articles?.length || 0} published articles for sitemap`);

  // Log language distribution
  if (articles && articles.length > 0) {
    const langCounts: Record<string, number> = {};
    for (const article of articles) {
      const lang = (article.language || '').trim().toLowerCase();
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
    console.log(`Article language distribution:`, langCounts);
  }

  // 3. Group articles by translation_id for hreflang cross-referencing
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

  // 4. Build blog entries with hreflang
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
${blogEntries.join('\n')}
</urlset>`;

  return sitemap;
}

/**
 * Upload sitemap to Supabase Storage (auto-replaces existing)
 */
async function uploadSitemapToStorage(
  filename: string,
  content: string
): Promise<{ success: boolean; publicUrl: string | null; error?: string }> {
  try {
    const blob = new Blob([content], { type: "application/xml" });

    const { data, error } = await supabase.storage
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

/**
 * Main handler
 * Query params:
 * - type: "complete" (default) or specific language code (e.g., "en", "de")
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "complete";

    let sitemap: string;
    let stats = { type: "", urls: 0, languages: 0, articles: 0 };
    const uploadResults: Array<{ filename: string; publicUrl: string | null; success: boolean }> = [];

    // Always generate the full sitemap with hreflang
    sitemap = await generateSitemap();
    const urlCount = (sitemap.match(/<url>/g) || []).length;

    // Count articles
    const { count } = await supabase
      .from("articles")
      .select("*", { count: "exact", head: true })
      .eq("status", "published");

    stats = {
      type: "complete",
      urls: urlCount,
      languages: LANGUAGES.length,
      articles: count || 0
    };

    // Save to storage
    const result = await uploadSitemapToStorage("sitemap-complete.xml", sitemap);
    uploadResults.push({ filename: "sitemap-complete.xml", ...result });

    console.log(`Generated sitemap with ${stats.urls} URLs (${stats.articles} articles across ${stats.languages} languages)`);

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
