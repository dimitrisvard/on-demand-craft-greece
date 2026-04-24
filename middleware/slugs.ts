import { Lang, LANGUAGES, ServiceId, SERVICE_IDS, ParsedRoute, PageType, CONTENT_PAGE_SLUGS, ContentPageSlug } from './types';

// Slugs we render from content_pages. 'home' is handled by the dedicated
// homepage arm (empty URL segment), so exclude it; 'blog' isn't in
// CONTENT_PAGE_SLUGS to begin with (the blog index has its own pipeline).
const CONTENT_SLUG_SET = new Set<string>(
  CONTENT_PAGE_SLUGS.filter((s) => s !== 'home'),
);

// Localized-slug pages in SLUGS that should route through content_pages so
// every language gets the DB-backed SSR body. The content-page arm in
// middleware.ts falls back to the legacy renderer when the row is missing,
// so this is safe even before the content_pages rows for a given language
// are seeded.
const PAGE_TYPE_TO_CONTENT_SLUG: Partial<Record<PageType, ContentPageSlug>> = {
  'about': 'about',
  'contact': 'contact',
  'our-work': 'our-work',
  'industries': 'industries',
};

// Localized URL slugs per language. Mirrors vite.config.ts SLUGS map and the
// url_slug_* keys in src/locales/<lang>/translation.json. Kept inline here to
// avoid pulling React-dependent code into the edge bundle.
//
// "services" key is the service-index path segment; individual service slugs
// are keyed by their canonical English id (ServiceId).
export const SLUGS: Record<Lang, {
  services: string;
  about: string;
  contact: string;
  quote: string;
  industries: string;
  ourWork: string;
  blog: string;
  serviceDetail: Record<ServiceId, string>;
}> = {
  en: { services: 'services', about: 'about', contact: 'contact', quote: 'quote', industries: 'industries', ourWork: 'our-work', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'cnc-machining', 'sheet-metal': 'sheet-metal', '3d-printing': '3d-printing', 'injection-molding': 'injection-molding', 'surface-finishes': 'surface-finishes', 'rapid-prototyping': 'rapid-prototyping' } },
  de: { services: 'dienstleistungen', about: 'ueber-uns', contact: 'kontakt', quote: 'angebot', industries: 'branchen', ourWork: 'unsere-arbeit', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'cnc-bearbeitung', 'sheet-metal': 'blechbearbeitung', '3d-printing': '3d-druck', 'injection-molding': 'spritzguss', 'surface-finishes': 'oberflaechenveredelung', 'rapid-prototyping': 'rapid-prototyping' } },
  fr: { services: 'services', about: 'a-propos', contact: 'contact', quote: 'devis', industries: 'secteurs', ourWork: 'notre-travail', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'usinage-cnc', 'sheet-metal': 'tolerie', '3d-printing': 'impression-3d', 'injection-molding': 'injection-plastique', 'surface-finishes': 'finition-surface', 'rapid-prototyping': 'prototypage-rapide' } },
  es: { services: 'servicios', about: 'sobre-nosotros', contact: 'contacto', quote: 'cotizacion', industries: 'industrias', ourWork: 'nuestro-trabajo', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'mecanizado-cnc', 'sheet-metal': 'chapa-metalica', '3d-printing': 'impresion-3d', 'injection-molding': 'moldeo-por-inyeccion', 'surface-finishes': 'acabados-superficie', 'rapid-prototyping': 'prototipado-rapido' } },
  it: { services: 'servizi', about: 'chi-siamo', contact: 'contatto', quote: 'preventivo', industries: 'settori', ourWork: 'i-nostri-lavori', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'lavorazione-cnc', 'sheet-metal': 'lavorazione-lamiera', '3d-printing': 'stampa-3d', 'injection-molding': 'stampaggio-iniezione', 'surface-finishes': 'finitura-superficie', 'rapid-prototyping': 'prototipazione-rapida' } },
  nl: { services: 'diensten', about: 'over-ons', contact: 'contact', quote: 'offerte', industries: 'branches', ourWork: 'ons-werk', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'cnc-bewerking', 'sheet-metal': 'plaatbewerking', '3d-printing': '3d-printen', 'injection-molding': 'spuitgieten', 'surface-finishes': 'oppervlakteafwerking', 'rapid-prototyping': 'rapid-prototyping' } },
  pl: { services: 'uslugi', about: 'o-nas', contact: 'kontakt', quote: 'wycena', industries: 'branze', ourWork: 'nasza-praca', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'obrobka-cnc', 'sheet-metal': 'obrobka-bluzy', '3d-printing': 'druk-3d', 'injection-molding': 'wtrysk-tworzywa', 'surface-finishes': 'wykonczenie-powierzchni', 'rapid-prototyping': 'szybkie-prototypowanie' } },
  pt: { services: 'servicos', about: 'sobre-nos', contact: 'contato', quote: 'orcamento', industries: 'industrias', ourWork: 'nosso-trabalho', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'usinagem-cnc', 'sheet-metal': 'chapa-metalica', '3d-printing': 'impressao-3d', 'injection-molding': 'moldagem-injecao', 'surface-finishes': 'acabamento-superficie', 'rapid-prototyping': 'prototipagem-rapida' } },
  sv: { services: 'tjanster', about: 'om-oss', contact: 'kontakt', quote: 'offert', industries: 'branscher', ourWork: 'vart-arbete', blog: 'blogg',
    serviceDetail: { 'cnc-machining': 'cnc-bearbetning', 'sheet-metal': 'platbearbetning', '3d-printing': '3d-skrivning', 'injection-molding': 'formsprutning', 'surface-finishes': 'ytbehandling', 'rapid-prototyping': 'snabb-prototypering' } },
  da: { services: 'tjenester', about: 'om-os', contact: 'kontakt', quote: 'tilbud', industries: 'brancher', ourWork: 'vores-arbejde', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'cnc-bearbejdning', 'sheet-metal': 'pladearbejde', '3d-printing': '3d-printing', 'injection-molding': 'sprojtestobning', 'surface-finishes': 'overfladebehandling', 'rapid-prototyping': 'hurtig-prototypering' } },
  fi: { services: 'palvelut', about: 'meista', contact: 'yhteys', quote: 'tarjous', industries: 'toimialat', ourWork: 'tyomme', blog: 'blogi',
    serviceDetail: { 'cnc-machining': 'cnc-työstö', 'sheet-metal': 'levytyöstö', '3d-printing': '3d-tulostus', 'injection-molding': 'ruiskupuristus', 'surface-finishes': 'pinnan-viimeistely', 'rapid-prototyping': 'nopea-prototyyppaus' } },
  nb: { services: 'tjenester', about: 'om-oss', contact: 'kontakt', quote: 'tilbud', industries: 'bransjer', ourWork: 'vart-arbeid', blog: 'blogg',
    serviceDetail: { 'cnc-machining': 'cnc-bearbeiding', 'sheet-metal': 'platarbeid', '3d-printing': '3d-printing', 'injection-molding': 'sproytestoping', 'surface-finishes': 'overflatebehandling', 'rapid-prototyping': 'rask-prototyping' } },
  hu: { services: 'szolgaltatasok', about: 'rolunk', contact: 'kapcsolat', quote: 'ajanlat', industries: 'iparagak', ourWork: 'munkaink', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'cnc-megmunkalas', 'sheet-metal': 'lemezfeldolgozas', '3d-printing': '3d-nyomtas', 'injection-molding': 'frccsnyomas', 'surface-finishes': 'feluletkezeles', 'rapid-prototyping': 'gyors-prototipus' } },
  cs: { services: 'sluzby', about: 'o-nas', contact: 'kontakt', quote: 'nabidka', industries: 'prumysl', ourWork: 'nase-prace', blog: 'blog',
    serviceDetail: { 'cnc-machining': 'cnc-obrabeni', 'sheet-metal': 'obrabeni-plechu', '3d-printing': '3d-tisk', 'injection-molding': 'vstrekovani', 'surface-finishes': 'uprava-povrchu', 'rapid-prototyping': 'rychle-prototypovani' } },
};

// Reverse lookups built once at module load.
interface Reverse {
  pageType: Record<string, PageType>;
  service: Record<string, ServiceId>;
}
const REVERSE: Record<Lang, Reverse> = (() => {
  const out = {} as Record<Lang, Reverse>;
  for (const lang of LANGUAGES) {
    const slugs = SLUGS[lang];
    const pageType: Record<string, PageType> = {
      [slugs.services]: 'services-index',
      [slugs.about]: 'about',
      [slugs.contact]: 'contact',
      [slugs.quote]: 'quote',
      [slugs.industries]: 'industries',
      [slugs.ourWork]: 'our-work',
      [slugs.blog]: 'blog-index',
      // English fallback accepted across all langs (router already accepts it)
      'services': 'services-index', 'about': 'about', 'contact': 'contact',
      'quote': 'quote', 'quote-request': 'quote', 'industries': 'industries',
      'our-work': 'our-work', 'blog': 'blog-index',
    };
    const service: Record<string, ServiceId> = {};
    for (const id of SERVICE_IDS) {
      service[slugs.serviceDetail[id]] = id;
      service[id] = id; // English fallback
    }
    out[lang] = { pageType, service };
  }
  return out;
})();

export function resolvePageType(lang: Lang, segs: string[]): ParsedRoute | null {
  if (segs.length === 0) {
    return { lang, type: 'homepage', pathAfterLang: '' };
  }
  const first = segs[0];
  const rev = REVERSE[lang];
  const firstType = rev.pageType[first];

  // services index vs service detail
  if (firstType === 'services-index') {
    if (segs.length === 1) return { lang, type: 'services-index', pathAfterLang: first };
    const serviceId = rev.service[segs[1]];
    if (serviceId) return { lang, type: 'service-detail', serviceId, pathAfterLang: `${first}/${segs[1]}` };
    return null; // unknown service slug under a services index
  }

  // blog index vs blog article
  if (firstType === 'blog-index') {
    if (segs.length === 1) return { lang, type: 'blog-index', pathAfterLang: first };
    return { lang, type: 'blog-article', blogSlug: segs.slice(1).join('/'), pathAfterLang: segs.join('/') };
  }

  // Route the localized-slug pages (about / contact / our-work / industries)
  // through content_pages for every language so non-EN URLs pick up the
  // DB-backed SSR body. /fr/a-propos → content-page(contentSlug=about), etc.
  if (firstType && segs.length === 1) {
    const cs = PAGE_TYPE_TO_CONTENT_SLUG[firstType];
    if (cs) {
      return { lang, type: 'content-page', contentSlug: cs, pathAfterLang: first };
    }
  }

  // Accept the English canonical slugs for the DB-only content pages
  // (education / legal-notice / privacy-policy) across all 14 languages.
  // Localized variants populated in SLUGS above are handled by the block
  // immediately preceding this one.
  if (segs.length === 1 && CONTENT_SLUG_SET.has(first)) {
    return { lang, type: 'content-page', contentSlug: first as ContentPageSlug, pathAfterLang: first };
  }

  if (firstType) {
    return { lang, type: firstType, pathAfterLang: segs.join('/') };
  }

  // Fall through: unknown 1-segment URL might be a content_pages localized
  // slug we don't have in any static map (e.g. /cs/vzdelavani — DB row has
  // slug='education' and localized_slug='vzdelavani', but neither SLUGS nor
  // CONTENT_SLUG_SET knows about 'vzdelavani'). Hand it to the content-page
  // arm; fetchContentPageRaw queries (slug OR localized_slug), so it'll
  // resolve via the localized_slug column. If no row exists, the arm
  // returns undefined and the SPA shell handles it. Multi-segment unknowns
  // still return null — content_pages slugs are always single-segment, and
  // letting deeper paths through would expand the surface area for spurious
  // DB lookups on 404s.
  if (segs.length === 1) {
    return { lang, type: 'content-page', contentSlug: first as ContentPageSlug, pathAfterLang: first };
  }

  return null;
}

/**
 * Resolve the URL segment a given content_pages canonical slug should live
 * under for a specific language. Preference order:
 *   1. The row's own localized_slug column (source of truth when populated).
 *   2. The matching entry in SLUGS (static, matches the React router).
 *   3. The canonical English slug (safe fallback for education / legal-notice
 *      / privacy-policy until native translations are seeded).
 */
export function localizedContentSlug(
  lang: Lang,
  canonical: ContentPageSlug,
  override: string | null = null,
): string {
  if (override) return override;
  if (lang === 'en') return canonical;
  const s = SLUGS[lang];
  switch (canonical) {
    case 'about':      return s.about;
    case 'contact':    return s.contact;
    case 'our-work':   return s.ourWork;
    case 'industries': return s.industries;
    default:           return canonical;
  }
}

export function localizedPath(lang: Lang, type: PageType, extra?: string): string {
  const s = SLUGS[lang];
  switch (type) {
    case 'homepage': return `/${lang}`;
    case 'services-index': return `/${lang}/${s.services}`;
    case 'service-detail': {
      const id = (extra as ServiceId) || 'cnc-machining';
      return `/${lang}/${s.services}/${s.serviceDetail[id] || id}`;
    }
    case 'industries': return `/${lang}/${s.industries}`;
    case 'blog-index': return `/${lang}/${s.blog}`;
    case 'blog-article': return `/${lang}/${s.blog}/${extra || ''}`;
    case 'about': return `/${lang}/${s.about}`;
    case 'contact': return `/${lang}/${s.contact}`;
    case 'quote': return `/${lang}/${s.quote}`;
    case 'our-work': return `/${lang}/${s.ourWork}`;
    case 'content-page': return `/${lang}/${extra || ''}`;
    default: return `/${lang}`;
  }
}
