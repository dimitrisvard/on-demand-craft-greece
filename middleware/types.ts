export const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'nb', 'hu', 'cs'] as const;
export type Lang = typeof LANGUAGES[number];

export const SERVICE_IDS = ['cnc-machining', 'sheet-metal', '3d-printing', 'injection-molding', 'surface-finishes', 'rapid-prototyping'] as const;
export type ServiceId = typeof SERVICE_IDS[number];

export type PageType =
  | 'homepage'
  | 'services-index'
  | 'service-detail'
  | 'industries'
  | 'blog-index'
  | 'blog-article'
  | 'about'
  | 'contact'
  | 'quote'
  | 'our-work'
  | 'content-page'
  | 'other';

export const CONTENT_PAGE_SLUGS = [
  'home',
  'industries', 'our-work', 'education',
  'about', 'contact', 'legal-notice', 'privacy-policy',
] as const;
export type ContentPageSlug = typeof CONTENT_PAGE_SLUGS[number];

// IETF-ish og:locale value per supported language. en_US is the Open Graph
// convention for English; other languages use the language-script-region form
// that Facebook / LinkedIn recognize.
export const OG_LOCALE: Record<Lang, string> = {
  en: 'en_US',
  de: 'de_DE',
  fr: 'fr_FR',
  es: 'es_ES',
  it: 'it_IT',
  nl: 'nl_NL',
  pl: 'pl_PL',
  pt: 'pt_PT',
  sv: 'sv_SE',
  da: 'da_DK',
  fi: 'fi_FI',
  nb: 'nb_NO',
  hu: 'hu_HU',
  cs: 'cs_CZ',
};

export interface ParsedRoute {
  lang: Lang;
  type: PageType;
  serviceId?: ServiceId;
  blogSlug?: string;
  contentSlug?: ContentPageSlug;
  pathAfterLang: string;
}

export interface PageMeta {
  title: string;
  description: string;
  ogType: string;
  image: string;
}

export const SITE_BASE = 'https://www.micronshub.eu';
export const DEFAULT_IMAGE = 'https://www.micronshub.eu/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png';
