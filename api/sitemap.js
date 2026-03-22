/**
 * Consolidated Sitemap API
 * Handles all sitemap routes via query parameter `type`:
 *   /api/sitemap?type=main       → main sitemap with hreflang (default)
 *   /api/sitemap?type=complete   → pre-generated complete sitemap
 *   /api/sitemap?type=index      → sitemap index
 *   /api/sitemap?type=lang&lang=en → language-specific sitemap
 *
 * Vercel rewrites in vercel.json route the public URLs to this handler.
 */

const SUPABASE_URL = 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
const STORAGE_URL = SUPABASE_URL + '/storage/v1/object/public/sitemaps/sitemap-complete.xml';
const BASE_URL = 'https://www.micronshub.eu';

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function encodeSitemapUrl(url) {
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

const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'nb', 'hu', 'cs'];

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
  fi: { services: 'palvelut', about: 'meista', contact: 'yhteys', quote: 'tarjous', industries: 'toimialat', ourWork: 'tyomme', blog: 'blogi', cnc: 'cnc-ty\u00f6st\u00f6', sheetMetal: 'levyty\u00f6st\u00f6', printing: '3d-tulostus', injection: 'ruiskupuristus', surface: 'pinnan-viimeistely', rapid: 'nopea-prototyyppaus' },
  nb: { services: 'tjenester', about: 'om-oss', contact: 'kontakt', quote: 'tilbud', industries: 'bransjer', ourWork: 'vart-arbeid', blog: 'blogg', cnc: 'cnc-bearbeiding', sheetMetal: 'platarbeid', printing: '3d-printing', injection: 'sproytestoping', surface: 'overflatebehandling', rapid: 'rask-prototyping' },
  hu: { services: 'szolgaltatasok', about: 'rolunk', contact: 'kapcsolat', quote: 'ajanlat', industries: 'iparagak', ourWork: 'munkaink', blog: 'blog', cnc: 'cnc-megmunkalas', sheetMetal: 'lemezfeldolgozas', printing: '3d-nyomtas', injection: 'frccsnyomas', surface: 'feluletkezeles', rapid: 'gyors-prototipus' },
  cs: { services: 'sluzby', about: 'o-nas', contact: 'kontakt', quote: 'nabidka', industries: 'prumysl', ourWork: 'nase-prace', blog: 'blog', cnc: 'cnc-obrabeni', sheetMetal: 'obrabeni-plechu', printing: '3d-tisk', injection: 'vstrekovani', surface: 'uprava-povrchu', rapid: 'rychle-prototypovani' },
};

const STATIC_PAGES = [
  { key: 'home', path: () => '', priority: '1.0', changefreq: 'weekly' },
  { key: 'services', path: (s) => '/' + s.services, priority: '0.9', changefreq: 'weekly' },
  { key: 'cnc', path: (s) => '/' + s.services + '/' + s.cnc, priority: '0.9', changefreq: 'weekly' },
  { key: 'sheetMetal', path: (s) => '/' + s.services + '/' + s.sheetMetal, priority: '0.9', changefreq: 'weekly' },
  { key: 'printing', path: (s) => '/' + s.services + '/' + s.printing, priority: '0.9', changefreq: 'weekly' },
  { key: 'injection', path: (s) => '/' + s.services + '/' + s.injection, priority: '0.9', changefreq: 'weekly' },
  { key: 'surface', path: (s) => '/' + s.services + '/' + s.surface, priority: '0.8', changefreq: 'weekly' },
  { key: 'rapid', path: (s) => '/' + s.services + '/' + s.rapid, priority: '0.8', changefreq: 'weekly' },
  { key: 'industries', path: (s) => '/' + s.industries, priority: '0.8', changefreq: 'weekly' },
  { key: 'about', path: (s) => '/' + s.about, priority: '0.7', changefreq: 'monthly' },
  { key: 'contact', path: (s) => '/' + s.contact, priority: '0.7', changefreq: 'monthly' },
  { key: 'ourWork', path: (s) => '/' + s.ourWork, priority: '0.7', changefreq: 'monthly' },
  { key: 'quote', path: (s) => '/' + s.quote, priority: '0.8', changefreq: 'weekly' },
  { key: 'quoteRequest', path: () => '/quote-request', priority: '0.7', changefreq: 'weekly' },
  { key: 'blog', path: (s) => '/' + s.blog, priority: '0.8', changefreq: 'daily' },
];

function buildPageUrl(lang, page) {
  const s = SLUGS[lang];
  const pagePath = page.path(s);
  return encodeSitemapUrl(BASE_URL + '/' + lang + pagePath);
}

function buildStaticPageHreflang(page) {
  const links = LANGUAGES.map(lang => {
    const url = escapeXml(buildPageUrl(lang, page));
    return '    <xhtml:link rel="alternate" hreflang="' + lang + '" href="' + url + '"/>';
  });
  const englishUrl = escapeXml(buildPageUrl('en', page));
  links.push('    <xhtml:link rel="alternate" hreflang="x-default" href="' + englishUrl + '"/>');
  return links.join('\n');
}

function buildStaticUrlEntry(lang, page, today) {
  const loc = escapeXml(buildPageUrl(lang, page));
  return '  <url>\n    <loc>' + loc + '</loc>\n' + buildStaticPageHreflang(page) + '\n    <lastmod>' + today + '</lastmod>\n    <changefreq>' + page.changefreq + '</changefreq>\n    <priority>' + page.priority + '</priority>\n  </url>';
}

function buildBlogHreflang(article, siblings) {
  const links = siblings.map(sibling => {
    const lang = (sibling.language || 'en').trim().toLowerCase();
    const blogSlug = SLUGS[lang]?.blog || 'blog';
    const url = escapeXml(encodeSitemapUrl(BASE_URL + '/' + lang + '/' + blogSlug + '/' + sibling.slug));
    return '    <xhtml:link rel="alternate" hreflang="' + lang + '" href="' + url + '"/>';
  });
  const englishSibling = siblings.find(s => (s.language || '').trim().toLowerCase() === 'en');
  if (englishSibling) {
    const url = escapeXml(encodeSitemapUrl(BASE_URL + '/en/' + SLUGS.en.blog + '/' + englishSibling.slug));
    links.push('    <xhtml:link rel="alternate" hreflang="x-default" href="' + url + '"/>');
  }
  return links.join('\n');
}

function buildBlogUrlEntry(article, siblings, today) {
  const lang = (article.language || 'en').trim().toLowerCase();
  const blogSlug = SLUGS[lang]?.blog || 'blog';
  const loc = escapeXml(encodeSitemapUrl(BASE_URL + '/' + lang + '/' + blogSlug + '/' + article.slug));
  const lastmod = (article.updated_at || article.created_at || today).split('T')[0];
  const hreflang = siblings.length > 1 ? '\n' + buildBlogHreflang(article, siblings) : '';
  return '  <url>\n    <loc>' + loc + '</loc>' + hreflang + '\n    <lastmod>' + lastmod + '</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>';
}

async function fetchBlogArticles() {
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
  if (!SUPABASE_ANON_KEY) {
    console.warn('[sitemap] SUPABASE_ANON_KEY not set');
    return [];
  }
  try {
    const response = await fetch(
      SUPABASE_URL + '/rest/v1/articles?select=slug,language,updated_at,created_at,translation_id&status=eq.published&order=created_at.desc',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY } }
    );
    if (!response.ok) return [];
    const articles = await response.json();
    return Array.isArray(articles) ? articles : [];
  } catch (error) {
    console.error('[sitemap] Error fetching articles:', error);
    return [];
  }
}

// ─── Main sitemap (with hreflang, blog entries, storage fallback) ───
async function handleMain(req, res) {
  try {
    const storageResponse = await fetch(STORAGE_URL);
    if (storageResponse.ok) {
      const xml = await storageResponse.text();
      if (xml && xml.includes('<urlset') && xml.length > 100) {
        return res.status(200).send(xml);
      }
    }
  } catch (e) {
    console.warn('[sitemap] Storage fetch failed, falling back to dynamic generation:', e.message);
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const staticEntries = [];
    for (const page of STATIC_PAGES) {
      for (const lang of LANGUAGES) {
        staticEntries.push(buildStaticUrlEntry(lang, page, today));
      }
    }

    const articles = await fetchBlogArticles();
    const translationGroups = new Map();
    const orphanArticles = [];
    for (const article of articles) {
      const normalizedLang = (article.language || '').trim().toLowerCase();
      if (!LANGUAGES.includes(normalizedLang)) continue;
      if (article.translation_id) {
        if (!translationGroups.has(article.translation_id)) translationGroups.set(article.translation_id, []);
        translationGroups.get(article.translation_id).push(article);
      } else {
        orphanArticles.push(article);
      }
    }

    const blogEntries = [];
    for (const [, siblings] of translationGroups) {
      for (const article of siblings) blogEntries.push(buildBlogUrlEntry(article, siblings, today));
    }
    for (const article of orphanArticles) blogEntries.push(buildBlogUrlEntry(article, [article], today));

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + staticEntries.join('\n') + '\n' + blogEntries.join('\n') + '\n</urlset>';
    res.status(200).send(xml);
  } catch (error) {
    console.error('[sitemap] Error generating sitemap:', error);
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>');
  }
}

// ─── Complete sitemap (storage-first, fallback to main) ───
async function handleComplete(req, res) {
  try {
    const response = await fetch(STORAGE_URL);
    if (!response.ok) throw new Error('Supabase Storage returned ' + response.status);
    const xml = await response.text();
    if (!xml || !xml.includes('<urlset') || xml.length < 100) {
      throw new Error('Sitemap from storage appears empty or invalid');
    }
    res.status(200).send(xml);
  } catch (error) {
    console.error('[sitemap-complete] Error fetching from storage:', error.message);
    try {
      return handleMain(req, res);
    } catch (fallbackError) {
      console.error('[sitemap-complete] Fallback also failed:', fallbackError.message);
      res.status(500).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>');
    }
  }
}

// ─── Sitemap index ───
async function handleIndex(req, res) {
  try {
    const sitemapUrl = SUPABASE_URL + '/storage/v1/object/public/sitemaps/sitemap-index.xml';
    const response = await fetch(sitemapUrl, { headers: { 'Accept': 'application/xml' } });
    if (!response.ok) {
      console.error('Failed to fetch sitemap-index: ' + response.status + ' ' + response.statusText);
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</sitemapindex>');
    }
    const xml = await response.text();
    res.status(200).send(xml);
  } catch (error) {
    console.error('Error serving sitemap-index:', error);
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</sitemapindex>');
  }
}

// ─── Language-specific sitemap ───
async function handleLang(req, res) {
  const url = req.url || '';
  const match = url.match(/lang=([a-z]{2})/i);
  const lang = match ? match[1].toLowerCase() : 'en';

  const validLangs = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'sv', 'da', 'fi', 'cs', 'hu', 'pt', 'nb'];
  if (!validLangs.includes(lang)) {
    return res.status(404).send('Sitemap not found');
  }

  try {
    const sitemapUrl = SUPABASE_URL + '/storage/v1/object/public/sitemaps/sitemap-' + lang + '.xml';
    const response = await fetch(sitemapUrl, { headers: { 'Accept': 'application/xml' } });
    if (!response.ok) {
      console.error('Failed to fetch sitemap-' + lang + ': ' + response.status + ' ' + response.statusText);
      return res.status(404).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>');
    }
    const xml = await response.text();
    res.status(200).send(xml);
  } catch (error) {
    console.error('Error serving sitemap-' + lang + ':', error);
    res.status(404).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>');
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');

  const urlObj = new URL(req.url, 'http://localhost');
  const type = urlObj.searchParams.get('type') || 'main';

  switch (type) {
    case 'complete':
      return handleComplete(req, res);
    case 'index':
      return handleIndex(req, res);
    case 'lang':
      return handleLang(req, res);
    default:
      return handleMain(req, res);
  }
}
