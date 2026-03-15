/**
 * Programmatic sitemap generator with full hreflang support
 * Accessible at: https://www.micronshub.eu/sitemap.xml
 *
 * Generates a comprehensive sitemap:
 * - 210 static page entries (14 languages × 15 page types), each with full hreflang
 * - Dynamic blog articles with hreflang cross-references via translation_id
 * - Fetches blog posts from Supabase REST API
 */

const BASE_URL = 'https://www.micronshub.eu';
const TODAY = new Date().toISOString().split('T')[0];

// All supported languages
const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'nb', 'hu', 'cs'];

// URL slugs per language (mirrors src/locales/{lang}/translation.json url_slug_* keys)
const SLUGS = {
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

// Static page definitions: [pageKey, priority, changefreq]
// pageKey maps to SLUGS entries to build the translated URL
const STATIC_PAGES = [
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

/**
 * Build full URL for a language + page combination
 */
function buildPageUrl(lang, page) {
  const s = SLUGS[lang];
  const pagePath = page.path(s);
  return `${BASE_URL}/${lang}${pagePath}`;
}

/**
 * Build hreflang XML links for a static page across all languages
 */
function buildStaticPageHreflang(page) {
  const links = LANGUAGES.map(lang => {
    const url = buildPageUrl(lang, page);
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  // x-default points to English
  const englishUrl = buildPageUrl('en', page);
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${englishUrl}"/>`);
  return links.join('\n');
}

/**
 * Build a static page <url> entry for a specific language
 */
function buildStaticUrlEntry(lang, page) {
  const loc = buildPageUrl(lang, page);
  return `  <url>
    <loc>${loc}</loc>
${buildStaticPageHreflang(page)}
    <lastmod>${TODAY}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
}

/**
 * Build hreflang links for a blog article and its translations
 * @param {Object} article - The current article
 * @param {Array} siblings - All articles sharing the same translation_id (including current)
 */
function buildBlogHreflang(article, siblings) {
  const links = siblings.map(sibling => {
    const lang = (sibling.language || 'en').trim().toLowerCase();
    const blogSlug = SLUGS[lang]?.blog || 'blog';
    const url = `${BASE_URL}/${lang}/${blogSlug}/${sibling.slug}`;
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  // x-default points to English version if available
  const englishSibling = siblings.find(s => (s.language || '').trim().toLowerCase() === 'en');
  if (englishSibling) {
    const englishBlogSlug = SLUGS.en.blog;
    links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}/en/${englishBlogSlug}/${englishSibling.slug}"/>`);
  }
  return links.join('\n');
}

/**
 * Build a blog article <url> entry with hreflang
 */
function buildBlogUrlEntry(article, siblings) {
  const lang = (article.language || 'en').trim().toLowerCase();
  const blogSlug = SLUGS[lang]?.blog || 'blog';
  const loc = `${BASE_URL}/${lang}/${blogSlug}/${article.slug}`;
  const lastmod = (article.updated_at || article.created_at || TODAY).split('T')[0];
  const hreflang = siblings.length > 1 ? `\n${buildBlogHreflang(article, siblings)}` : '';

  return `  <url>
    <loc>${loc}</loc>${hreflang}
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
}

/**
 * Fetch published blog articles from Supabase REST API
 */
async function fetchBlogArticles() {
  const SUPABASE_URL = 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

  if (!SUPABASE_ANON_KEY) {
    console.warn('[sitemap] SUPABASE_ANON_KEY not set — skipping blog articles in sitemap');
    return [];
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?select=slug,language,updated_at,created_at,translation_id&status=eq.published&order=created_at.desc`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.error(`[sitemap] Failed to fetch articles: ${response.status} ${response.statusText}`);
      return [];
    }

    const articles = await response.json();
    return Array.isArray(articles) ? articles : [];
  } catch (error) {
    console.error('[sitemap] Error fetching articles:', error);
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');

  try {
    // 1. Generate static page entries: 14 languages × 15 pages = 210 entries
    const staticEntries = [];
    for (const page of STATIC_PAGES) {
      for (const lang of LANGUAGES) {
        staticEntries.push(buildStaticUrlEntry(lang, page));
      }
    }

    // 2. Fetch and process blog articles with hreflang via translation_id
    const articles = await fetchBlogArticles();

    // Group articles by translation_id for hreflang cross-referencing
    const translationGroups = new Map(); // translation_id -> [articles]
    const orphanArticles = []; // articles without translation_id

    for (const article of articles) {
      const normalizedLang = (article.language || '').trim().toLowerCase();
      if (!LANGUAGES.includes(normalizedLang)) continue; // skip unknown languages

      if (article.translation_id) {
        if (!translationGroups.has(article.translation_id)) {
          translationGroups.set(article.translation_id, []);
        }
        translationGroups.get(article.translation_id).push(article);
      } else {
        orphanArticles.push(article);
      }
    }

    // Build blog entries with hreflang cross-references
    const blogEntries = [];

    // Articles with translation_id: full hreflang linking
    for (const [, siblings] of translationGroups) {
      for (const article of siblings) {
        blogEntries.push(buildBlogUrlEntry(article, siblings));
      }
    }

    // Orphan articles: no hreflang (standalone)
    for (const article of orphanArticles) {
      blogEntries.push(buildBlogUrlEntry(article, [article]));
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${staticEntries.join('\n')}
${blogEntries.join('\n')}
</urlset>`;

    res.status(200).send(xml);
  } catch (error) {
    console.error('[sitemap] Error generating sitemap:', error);

    // Fallback: return static pages only (no blog, no hreflang)
    const fallbackEntries = [];
    for (const page of STATIC_PAGES) {
      for (const lang of LANGUAGES) {
        const s = SLUGS[lang];
        const pagePath = page.path(s);
        fallbackEntries.push(`  <url>\n    <loc>${BASE_URL}/${lang}${pagePath}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <priority>${page.priority}</priority>\n  </url>`);
      }
    }

    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${fallbackEntries.join('\n')}
</urlset>`);
  }
}
