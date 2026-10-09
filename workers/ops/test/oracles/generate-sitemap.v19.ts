// @ts-nocheck
// TEST-ONLY ORACLE: copy of the deployed edge function generate-sitemap (version 19), used by test/p5/content/** to
// compare the Worker port with the live code on the same inputs. Never imported by src/.
// The copied regions are the live text unchanged; the edits are:
//   - the imports, the Deno.env reads and createClient are replaced by siteUrl = SITE_URL and a settable supabase client
//   - fetchAllPublishedArticles, uploadSitemapToStorage and the serve() handler are left out
//   - exports added at the end
// Generated from the live source; do not edit by hand.
/* eslint-disable */

const siteUrl = "https://www.micronshub.eu";
let supabase: any = null;
export function setOracleSupabase(client: any): void { supabase = client; }

// All supported languages
const LANGUAGES = ["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "fi", "nb", "hu", "cs"];

// URL slugs per language — must match api/sitemap.xml.js and src/locales translations
// NOTE: education / legalNotice / privacyPolicy slugs added 2026-04-24 so the
// 3 content_pages rows for those slugs appear in the sitemap across all 14 langs.
// localized_slug values sourced from content_pages table (cs has bespoke
// slugs; other 13 languages currently share the English slug per the DB).
const SLUGS: Record<string, Record<string, string>> = {
  en: { services: 'services', about: 'about', contact: 'contact', quote: 'quote', industries: 'industries', ourWork: 'our-work', blog: 'blog', cnc: 'cnc-machining', sheetMetal: 'sheet-metal', printing: '3d-printing', injection: 'injection-molding', surface: 'surface-finishes', rapid: 'rapid-prototyping', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  de: { services: 'dienstleistungen', about: 'ueber-uns', contact: 'kontakt', quote: 'angebot', industries: 'branchen', ourWork: 'unsere-arbeit', blog: 'blog', cnc: 'cnc-bearbeitung', sheetMetal: 'blechbearbeitung', printing: '3d-druck', injection: 'spritzguss', surface: 'oberflaechenveredelung', rapid: 'rapid-prototyping', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  fr: { services: 'services', about: 'a-propos', contact: 'contact', quote: 'devis', industries: 'secteurs', ourWork: 'notre-travail', blog: 'blog', cnc: 'usinage-cnc', sheetMetal: 'tolerie', printing: 'impression-3d', injection: 'injection-plastique', surface: 'finition-surface', rapid: 'prototypage-rapide', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  es: { services: 'servicios', about: 'sobre-nosotros', contact: 'contacto', quote: 'cotizacion', industries: 'industrias', ourWork: 'nuestro-trabajo', blog: 'blog', cnc: 'mecanizado-cnc', sheetMetal: 'chapa-metalica', printing: 'impresion-3d', injection: 'moldeo-por-inyeccion', surface: 'acabados-superficie', rapid: 'prototipado-rapido', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  it: { services: 'servizi', about: 'chi-siamo', contact: 'contatto', quote: 'preventivo', industries: 'settori', ourWork: 'i-nostri-lavori', blog: 'blog', cnc: 'lavorazione-cnc', sheetMetal: 'lavorazione-lamiera', printing: 'stampa-3d', injection: 'stampaggio-iniezione', surface: 'finitura-superficie', rapid: 'prototipazione-rapida', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  nl: { services: 'diensten', about: 'over-ons', contact: 'contact', quote: 'offerte', industries: 'branches', ourWork: 'ons-werk', blog: 'blog', cnc: 'cnc-bewerking', sheetMetal: 'plaatbewerking', printing: '3d-printen', injection: 'spuitgieten', surface: 'oppervlakteafwerking', rapid: 'rapid-prototyping', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  pl: { services: 'uslugi', about: 'o-nas', contact: 'kontakt', quote: 'wycena', industries: 'branze', ourWork: 'nasza-praca', blog: 'blog', cnc: 'obrobka-cnc', sheetMetal: 'obrobka-bluzy', printing: 'druk-3d', injection: 'wtrysk-tworzywa', surface: 'wykonczenie-powierzchni', rapid: 'szybkie-prototypowanie', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  pt: { services: 'servicos', about: 'sobre-nos', contact: 'contato', quote: 'orcamento', industries: 'industrias', ourWork: 'nosso-trabalho', blog: 'blog', cnc: 'usinagem-cnc', sheetMetal: 'chapa-metalica', printing: 'impressao-3d', injection: 'moldagem-injecao', surface: 'acabamento-superficie', rapid: 'prototipagem-rapida', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  sv: { services: 'tjanster', about: 'om-oss', contact: 'kontakt', quote: 'offert', industries: 'branscher', ourWork: 'vart-arbete', blog: 'blogg', cnc: 'cnc-bearbetning', sheetMetal: 'platbearbetning', printing: '3d-skrivning', injection: 'formsprutning', surface: 'ytbehandling', rapid: 'snabb-prototypering', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  da: { services: 'tjenester', about: 'om-os', contact: 'kontakt', quote: 'tilbud', industries: 'brancher', ourWork: 'vores-arbejde', blog: 'blog', cnc: 'cnc-bearbejdning', sheetMetal: 'pladearbejde', printing: '3d-printing', injection: 'sprojtestobning', surface: 'overfladebehandling', rapid: 'hurtig-prototypering', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  fi: { services: 'palvelut', about: 'meista', contact: 'yhteys', quote: 'tarjous', industries: 'toimialat', ourWork: 'tyomme', blog: 'blogi', cnc: 'cnc-työstö', sheetMetal: 'levytyöstö', printing: '3d-tulostus', injection: 'ruiskupuristus', surface: 'pinnan-viimeistely', rapid: 'nopea-prototyyppaus', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  nb: { services: 'tjenester', about: 'om-oss', contact: 'kontakt', quote: 'tilbud', industries: 'bransjer', ourWork: 'vart-arbeid', blog: 'blogg', cnc: 'cnc-bearbeiding', sheetMetal: 'platarbeid', printing: '3d-printing', injection: 'sproytestoping', surface: 'overflatebehandling', rapid: 'rask-prototyping', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  hu: { services: 'szolgaltatasok', about: 'rolunk', contact: 'kapcsolat', quote: 'ajanlat', industries: 'iparagak', ourWork: 'munkaink', blog: 'blog', cnc: 'cnc-megmunkalas', sheetMetal: 'lemezfeldolgozas', printing: '3d-nyomtas', injection: 'frccsnyomas', surface: 'feluletkezeles', rapid: 'gyors-prototipus', education: 'education', legalNotice: 'legal-notice', privacyPolicy: 'privacy-policy' },
  cs: { services: 'sluzby', about: 'o-nas', contact: 'kontakt', quote: 'nabidka', industries: 'prumysl', ourWork: 'nase-prace', blog: 'blog', cnc: 'cnc-obrabeni', sheetMetal: 'obrabeni-plechu', printing: '3d-tisk', injection: 'vstrekovani', surface: 'uprava-povrchu', rapid: 'rychle-prototypovani', education: 'vzdelavani', legalNotice: 'pravni-informace', privacyPolicy: 'zasady-ochrany-osobnich-udaju' },
};

/**
 * Escape special XML characters in text content
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Encode non-ASCII characters in a URL path for sitemap compliance.
 * Preserves valid URL characters but percent-encodes characters like ö, ä, ü.
 */
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
  { key: 'education', path: (s) => `/${s.education}`, priority: '0.7', changefreq: 'monthly' },
  { key: 'legalNotice', path: (s) => `/${s.legalNotice}`, priority: '0.3', changefreq: 'yearly' },
  { key: 'privacyPolicy', path: (s) => `/${s.privacyPolicy}`, priority: '0.3', changefreq: 'yearly' },
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
  return encodeSitemapUrl(`${siteUrl}/${lang}${pagePath}`);
}

/**
 * Build hreflang XML links for a static page across all languages
 */
function buildStaticPageHreflang(page: PageDef): string {
  const links = LANGUAGES.map(lang => {
    const url = escapeXml(buildPageUrl(lang, page));
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  const englishUrl = escapeXml(buildPageUrl('en', page));
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${englishUrl}"/>`);
  return links.join('\n');
}

/**
 * Build a static page <url> entry for a specific language
 *
 * SCHEMA ORDER FIX (2026-04-29): xhtml:link extension elements must appear
 * AFTER all standard sitemap elements (loc, lastmod, changefreq, priority)
 * per the official sitemap XSD's <xs:any namespace="##other"/> position.
 * Putting xhtml:link between loc and lastmod caused GSC "Sitemap could not
 * be read" errors because Google validates strictly against the schema.
 */
function buildStaticUrlEntry(lang: string, page: PageDef, today: string): string {
  const loc = escapeXml(buildPageUrl(lang, page));
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
${buildStaticPageHreflang(page)}
  </url>`;
}

/**
 * Build hreflang links for a blog article and its translations
 */
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

/**
 * Build a blog article <url> entry with hreflang
 *
 * SCHEMA ORDER FIX (2026-04-29): same as buildStaticUrlEntry — xhtml:link
 * MUST come after priority, not between loc and lastmod.
 */
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

/**
 * Format date to W3C format
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toISOString().split('T')[0];
}

/**
 * Upsert every article URL into gsc_monitored_urls so the Index Status tab
 * and the Indexing API workflow can see all articles. Existing rows are
 * preserved (upsert on `url`), so historical GSC submissions are untouched.
 */
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

  // Upsert in chunks of 500 to stay well under payload limits.
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

/**
 * Generate the complete sitemap XML with full hreflang support.
 * Accepts pre-fetched articles so the caller can reuse them.
 */
async function generateSitemap(articles: Article[]): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  // 1. Generate static page entries: 14 languages × 18 pages = 252 entries
  const staticEntries: string[] = [];
  for (const page of STATIC_PAGES) {
    for (const lang of LANGUAGES) {
      staticEntries.push(buildStaticUrlEntry(lang, page, today));
    }
  }

  console.log(`Found ${articles.length} published articles for sitemap`);

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


export { escapeXml, encodeSitemapUrl, generateSitemap, syncArticlesToMonitoredUrls, LANGUAGES, SLUGS, STATIC_PAGES };
