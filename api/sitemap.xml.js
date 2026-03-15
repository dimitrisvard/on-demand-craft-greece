/**
 * Programmatic sitemap generator
 * Accessible at: https://www.micronshub.eu/sitemap.xml
 *
 * Generates a comprehensive sitemap for all 14 languages × all static pages
 * plus dynamic blog posts fetched from Supabase.
 * Does NOT depend on Supabase Storage files (which may be empty/missing).
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

/**
 * Build hreflang alternate links for a given English path
 * Returns XML <xhtml:link> elements for all 14 languages
 */
function buildHreflangLinks(englishPageSlug) {
  const links = LANGUAGES.map(lang => {
    const url = `${BASE_URL}/${lang}${englishPageSlug ? '/' + buildTranslatedPath(englishPageSlug, lang) : ''}`;
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  // x-default points to English version
  const defaultUrl = `${BASE_URL}/en${englishPageSlug ? '/' + englishPageSlug : ''}`;
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${defaultUrl}"/>`);
  return links.join('\n');
}

/**
 * Translate English page path segments to the given language
 * e.g., 'services/cnc-machining' in 'de' → 'dienstleistungen/cnc-bearbeitung'
 */
function buildTranslatedPath(englishPath, lang) {
  if (lang === 'en') return englishPath;
  const parts = englishPath.split('/');
  return parts.map(part => {
    const s = SLUGS[lang];
    // Map English slug keys to their language equivalents
    const mapping = {
      'services': s.services,
      'about': s.about,
      'contact': s.contact,
      'quote': s.quote,
      'quote-request': 'quote-request', // no translation
      'industries': s.industries,
      'our-work': s.ourWork,
      'blog': s.blog,
      'cnc-machining': s.cnc,
      'sheet-metal': s.sheetMetal,
      '3d-printing': s.printing,
      'injection-molding': s.injection,
      'surface-finishes': s.surface,
      'rapid-prototyping': s.rapid,
    };
    return mapping[part] || part;
  }).join('/');
}

/**
 * Build a <url> entry with hreflang links
 */
function buildUrlEntry(englishPath, priority = '0.8', changefreq = 'weekly', lastmod = TODAY) {
  const canonicalLangs = LANGUAGES.map(lang => {
    const translatedPath = buildTranslatedPath(englishPath, lang);
    return `${BASE_URL}/${lang}/${translatedPath}`;
  });
  // Use the English URL as primary <loc>
  const loc = `${BASE_URL}/en/${buildTranslatedPath(englishPath, 'en')}`;

  return `  <url>
    <loc>${loc}</loc>
${buildHreflangLinks(englishPath)}
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

/**
 * Build a blog post URL entry with hreflang links for all available translations
 * Blog post slugs are NOT translated between languages (each language has its own slug)
 */
function buildBlogUrlEntry(article) {
  const lang = article.language || 'en';
  const blogSlug = SLUGS[lang]?.blog || 'blog';
  const loc = `${BASE_URL}/${lang}/${blogSlug}/${article.slug}`;
  const lastmod = (article.updated_at || article.created_at || TODAY).split('T')[0];

  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`;
}

/**
 * Fetch published blog articles from Supabase REST API
 * Returns array of { slug, language, updated_at, created_at }
 */
async function fetchBlogArticles() {
  const SUPABASE_URL = 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
  // Use SUPABASE_ANON_KEY env var (set in Vercel project settings)
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

  if (!SUPABASE_ANON_KEY) {
    console.warn('[sitemap] SUPABASE_ANON_KEY not set — skipping blog articles in sitemap');
    return [];
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?select=slug,language,updated_at,created_at&status=eq.published&order=created_at.desc`,
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

// Static page definitions: [englishPath, priority, changefreq]
const STATIC_PAGES = [
  ['', '1.0', 'weekly'],                             // homepages (/{lang})
  ['services', '0.9', 'weekly'],
  ['services/cnc-machining', '0.9', 'weekly'],
  ['services/sheet-metal', '0.9', 'weekly'],
  ['services/3d-printing', '0.9', 'weekly'],
  ['services/injection-molding', '0.9', 'weekly'],
  ['services/surface-finishes', '0.8', 'weekly'],
  ['services/rapid-prototyping', '0.8', 'weekly'],
  ['industries', '0.8', 'weekly'],
  ['about', '0.7', 'monthly'],
  ['contact', '0.7', 'monthly'],
  ['our-work', '0.7', 'monthly'],
  ['quote', '0.8', 'weekly'],
  ['quote-request', '0.7', 'weekly'],
  ['blog', '0.8', 'daily'],
];

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');

  try {
    // Build static page entries (homepages handled specially — no path segment)
    const staticEntries = STATIC_PAGES.map(([englishPath, priority, changefreq]) => {
      if (englishPath === '') {
        // Homepage: /{lang} (no sub-path)
        const hreflangLinks = LANGUAGES.map(lang =>
          `    <xhtml:link rel="alternate" hreflang="${lang}" href="${BASE_URL}/${lang}"/>`
        ).join('\n');
        const xDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}/en"/>`;
        return `  <url>
    <loc>${BASE_URL}/en</loc>
${hreflangLinks}
${xDefault}
    <lastmod>${TODAY}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
      }
      return buildUrlEntry(englishPath, priority, changefreq);
    });

    // Fetch dynamic blog posts
    const articles = await fetchBlogArticles();
    const blogEntries = articles.map(buildBlogUrlEntry);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${staticEntries.join('\n')}
${blogEntries.join('\n')}
</urlset>`;

    res.status(200).send(xml);
  } catch (error) {
    console.error('[sitemap] Error generating sitemap:', error);

    // Fallback: return minimal valid sitemap with all static pages (no blog)
    const fallbackEntries = STATIC_PAGES.map(([englishPath, priority]) => {
      if (englishPath === '') {
        return LANGUAGES.map(lang =>
          `  <url>\n    <loc>${BASE_URL}/${lang}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <priority>${priority}</priority>\n  </url>`
        ).join('\n');
      }
      return LANGUAGES.map(lang =>
        `  <url>\n    <loc>${BASE_URL}/${lang}/${buildTranslatedPath(englishPath, lang)}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <priority>${priority}</priority>\n  </url>`
      ).join('\n');
    });

    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${fallbackEntries.join('\n')}
</urlset>`);
  }
}
