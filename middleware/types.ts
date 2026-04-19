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
  | 'other';

export interface ParsedRoute {
  lang: Lang;
  type: PageType;
  serviceId?: ServiceId;
  blogSlug?: string;
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
