// sitemap-complete.xml as the deployed sitemap generator (version 19) builds it: 18 static pages x 14 languages
// first (page-major order), then the blog articles grouped by translation_id in first-seen order, then articles
// without a translation_id. Port of the builders, constants and encoders, byte for byte (the test compares the
// output with a copy of the live builders in test/oracles/).
//
// Rules
//   - Input rows come in the live query order: language ascending, updated_at descending (sortLikeLive).
//   - Languages are trimmed and lower-cased; a row whose language is not one of the 14 is left out (it still counts
//     as an article in the run output, as the live stats do).
//   - Static lastmod = the UTC day of generation; article lastmod = the date part of updated_at, else created_at.
//   - hreflang links come after <priority> (sitemap schema order); a group of one article has none.
//   - The XML never leaves the step that builds it (6 MB against the 1 MiB step-result limit).

export const SITEMAP_LANGUAGES: readonly string[] = Object.freeze(['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'nb', 'hu', 'cs']);

/** URL slugs per language (generator v19, including the content-page slugs of 2026-04-24). */
export const SLUGS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
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
});

export interface PageDef {
  key: string;
  path: (s: Readonly<Record<string, string>>) => string;
  priority: string;
  changefreq: string;
}

export const STATIC_PAGES: readonly PageDef[] = Object.freeze([
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
] satisfies PageDef[]);

/** Number of static <url> entries (18 pages x 14 languages). */
export const STATIC_URL_COUNT = STATIC_PAGES.length * SITEMAP_LANGUAGES.length;

/** Select list of the article read (id added by the paged reader). */
export const SITEMAP_ARTICLE_COLUMNS = 'slug,language,updated_at,created_at,translation_id';

export type SitemapArticle = {
  slug: string;
  language: string;
  updated_at: string;
  created_at?: string | null;
  translation_id?: string | null;
};

/** Escape special XML characters in text content. */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Percent-encodes non-ASCII characters of the path segments (e.g. the Finnish service slugs). */
export function encodeSitemapUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.pathname = urlObj.pathname
      .split('/')
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join('/');
    return urlObj.toString();
  } catch {
    return encodeURI(url);
  }
}

function normLang(language: string | null | undefined, fallback: string): string {
  return (language || fallback).trim().toLowerCase();
}

function buildPageUrl(siteUrl: string, lang: string, page: PageDef): string {
  const s = SLUGS[lang];
  return encodeSitemapUrl(`${siteUrl}/${lang}${page.path(s)}`);
}

function buildStaticPageHreflang(siteUrl: string, page: PageDef): string {
  const links = SITEMAP_LANGUAGES.map((lang) => {
    const url = escapeXml(buildPageUrl(siteUrl, lang, page));
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  const englishUrl = escapeXml(buildPageUrl(siteUrl, 'en', page));
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${englishUrl}"/>`);
  return links.join('\n');
}

function buildStaticUrlEntry(siteUrl: string, lang: string, page: PageDef, today: string, hreflang: string): string {
  const loc = escapeXml(buildPageUrl(siteUrl, lang, page));
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
${hreflang}
  </url>`;
}

/** Public URL of a blog article (blog segment per language, non-ASCII percent-encoded). */
export function articleUrl(siteUrl: string, language: string, slug: string): string {
  const lang = normLang(language, 'en');
  const blogSlug = SLUGS[lang]?.blog || 'blog';
  return encodeSitemapUrl(`${siteUrl}/${lang}/${blogSlug}/${slug}`);
}

function buildBlogHreflang(siteUrl: string, siblings: readonly SitemapArticle[]): string {
  const links = siblings.map((sibling) => {
    const lang = normLang(sibling.language, 'en');
    const url = escapeXml(articleUrl(siteUrl, lang, sibling.slug));
    return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}"/>`;
  });
  const englishSibling = siblings.find((s) => (s.language || '').trim().toLowerCase() === 'en');
  if (englishSibling) {
    const url = escapeXml(encodeSitemapUrl(`${siteUrl}/en/${SLUGS.en.blog}/${englishSibling.slug}`));
    links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${url}"/>`);
  }
  return links.join('\n');
}

function buildBlogUrlEntry(siteUrl: string, article: SitemapArticle, siblings: readonly SitemapArticle[], today: string): string {
  const loc = escapeXml(articleUrl(siteUrl, article.language, article.slug));
  const lastmod = (article.updated_at || article.created_at || today).split('T')[0];
  const hreflang = siblings.length > 1 ? `\n${buildBlogHreflang(siteUrl, siblings)}` : '';
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>${hreflang}
  </url>`;
}

export interface SitemapBuild {
  xml: string;
  /** <url> entries (static + articles). */
  urls: number;
  /** Rows read (every language, as the live stats count them). */
  articles: number;
  groups: number;
  orphans: number;
}

/** The complete sitemap for rows in live query order; today = YYYY-MM-DD (UTC) of the generation. */
export function buildSitemapXml(articles: readonly SitemapArticle[], o: { siteUrl: string; today: string }): SitemapBuild {
  const { siteUrl, today } = o;
  const staticEntries: string[] = [];
  for (const page of STATIC_PAGES) {
    const hreflang = buildStaticPageHreflang(siteUrl, page);
    for (const lang of SITEMAP_LANGUAGES) staticEntries.push(buildStaticUrlEntry(siteUrl, lang, page, today, hreflang));
  }

  const translationGroups = new Map<string, SitemapArticle[]>();
  const orphanArticles: SitemapArticle[] = [];
  for (const article of articles) {
    const normalizedLang = (article.language || '').trim().toLowerCase();
    if (!SITEMAP_LANGUAGES.includes(normalizedLang)) continue;
    if (article.translation_id) {
      let group = translationGroups.get(article.translation_id);
      if (!group) {
        group = [];
        translationGroups.set(article.translation_id, group);
      }
      group.push(article);
    } else {
      orphanArticles.push(article);
    }
  }

  const blogEntries: string[] = [];
  for (const [, siblings] of translationGroups) {
    for (const article of siblings) blogEntries.push(buildBlogUrlEntry(siteUrl, article, siblings, today));
  }
  for (const article of orphanArticles) blogEntries.push(buildBlogUrlEntry(siteUrl, article, [article], today));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${staticEntries.join('\n')}
${blogEntries.join('\n')}
</urlset>`;

  return { xml, urls: staticEntries.length + blogEntries.length, articles: articles.length, groups: translationGroups.size, orphans: orphanArticles.length };
}

/** Number of <url> elements of an XML text (the live stats count). */
export function countUrlElements(xml: string): number {
  return (xml.match(/<url>/g) || []).length;
}

export type MonitoredUrlRow = {
  url: string;
  label: string;
  language: string;
  service_type: 'blog_article';
  priority: 5;
};

/** gsc_monitored_urls rows of the articles (languages outside the 14 left out). */
export function monitoredUrlRows(articles: readonly SitemapArticle[], siteUrl: string): MonitoredUrlRow[] {
  const rows: MonitoredUrlRow[] = [];
  for (const article of articles) {
    const lang = (article.language || '').trim().toLowerCase();
    if (!SITEMAP_LANGUAGES.includes(lang)) continue;
    const blogSlug = SLUGS[lang]?.blog || 'blog';
    rows.push({
      url: encodeSitemapUrl(`${siteUrl}/${lang}/${blogSlug}/${article.slug}`),
      label: `${lang.toUpperCase()} — ${article.slug}`.slice(0, 200),
      language: lang,
      service_type: 'blog_article',
      priority: 5,
    });
  }
  return rows;
}

/** Sort key of a PostgreSQL timestamptz text (microseconds since the epoch; null for an unreadable value). */
export function instantKey(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const fraction = /\.(\d+)/.exec(ts)?.[1] ?? '';
  const micro = Number((fraction + '000000').slice(3, 6));
  return ms * 1000 + micro;
}

/** Rows in the live query order: language ascending, then updated_at descending (NULLs first, as PostgreSQL). */
export function sortLikeLive<T extends SitemapArticle>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const la = a.language ?? '';
    const lb = b.language ?? '';
    if (la !== lb) return la < lb ? -1 : 1;
    const ka = instantKey(a.updated_at);
    const kb = instantKey(b.updated_at);
    if (ka === kb) return 0;
    if (ka === null) return -1;
    if (kb === null) return 1;
    return kb - ka;
  });
}
