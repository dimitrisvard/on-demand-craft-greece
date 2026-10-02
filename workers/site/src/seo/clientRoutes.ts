// Real client routes under /{lang}/ (SEO_PARITY.md §7.2): paths the React router renders as a page although the
// SEO handler has no document for them. With seo.strict_404 on they keep today's answer (null -> SPA shell 200).
//
// The React modules cannot be imported into the Worker (JSX, React, i18next), so the two tables below are copies.
// test/seo-soft404.test.ts parses the source files and fails when a copy drifts.

import type { Lang } from '../../../../middleware/types';
import { t } from '../../../../middleware/i18n';

// Keys of ROUTE_MAP, src/components/TranslatedRouteMatcher.tsx:46-66 (English path -> page component).
export const ROUTE_MAP_PATHS: readonly string[] = [
  '/services',
  '/industries',
  '/our-work',
  '/about',
  '/contact',
  '/education',
  '/quote',
  '/quote/success',
  '/quote-request',
  '/contact/success',
  '/services/surface-finishes',
  '/services/sheet-metal',
  '/services/cnc-machining',
  '/services/3d-printing',
  '/services/injection-molding',
  '/services/rapid-prototyping',
  '/legal-notice',
  '/privacy-policy',
];

// Routes of src/App.tsx under /:lang that are not in ROUTE_MAP and are not served by the SEO handler:
// /:lang/login (src/App.tsx:181). /:lang/quote/success, /:lang/contact/success and /:lang/quote-request are in
// ROUTE_MAP as well.
export const APP_ONLY_PATHS: readonly string[] = ['/login'];

// SLUG_TRANSLATION_KEYS, src/utils/urlSlugTranslator.ts:11-27 (English slug -> translation key), in file order:
// the client's reverse lookup returns the first match.
export const SLUG_TRANSLATION_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['services', 'url_slug_services'],
  ['about', 'url_slug_about'],
  ['contact', 'url_slug_contact'],
  ['quote', 'url_slug_quote'],
  ['industries', 'url_slug_industries'],
  ['our-work', 'url_slug_our_work'],
  ['blog', 'url_slug_blog'],
  ['cnc-machining', 'url_slug_cnc_machining'],
  ['sheet-metal', 'url_slug_sheet_metal'],
  ['3d-printing', 'url_slug_3d_printing'],
  ['injection-molding', 'url_slug_injection_molding'],
  ['surface-finishes', 'url_slug_surface_finishes'],
  ['rapid-prototyping', 'url_slug_rapid_prototyping'],
  ['legal-notice', 'url_slug_impressum'],
  ['education', 'url_slug_education'],
];

const CLIENT_PATHS = new Set<string>([...ROUTE_MAP_PATHS, ...APP_ONLY_PATHS]);

// reverseTranslateUrlSlug, src/utils/urlSlugTranslator.ts:70-97. The client's t() reads the same
// src/locales/<lang>/translation.json files as middleware/i18n.ts; every language has every url_slug_* key.
export function reverseTranslateSlug(slug: string, lang: Lang): string {
  if (lang === 'en') return slug;
  for (const [englishSlug, key] of SLUG_TRANSLATION_KEYS) {
    if (t(lang, key, englishSlug) === slug) return englishSlug;
  }
  if (slug === 'impressum' || slug === t(lang, 'url_slug_impressum', 'legal-notice')) return 'legal-notice';
  return slug;
}

// English form of /{lang}/<segs> as TranslatedRouteMatcher computes it (reverseTranslateUrlPath,
// src/utils/urlSlugTranslator.ts:142-174, including the blog special case).
export function englishPath(lang: Lang, segs: readonly string[]): string {
  if (segs.length === 0) return '/';
  if (lang !== 'en' && segs.length >= 2) {
    const first = segs[0];
    if (first === t(lang, 'url_slug_blog', 'blog') || first === 'blog') {
      return `/${reverseTranslateSlug(first, lang)}/${segs.slice(1).join('/')}`;
    }
  }
  return '/' + segs.map((s) => reverseTranslateSlug(s, lang)).join('/');
}

// True when the React router renders a real page for /{lang}/<segs> (segments decoded, empty ones dropped).
// The router only has /:lang/:slug and /:lang/:slug/:subslug catch-alls, so 3+ segments are never a page.
// Decoded segments are compared, which can exempt a percent-encoded variant the client would not match: the
// safe direction (keeps today's 200).
export function isClientRoute(lang: Lang, segs: readonly string[]): boolean {
  if (segs.length === 0 || segs.length > 2) return false;
  if (CLIENT_PATHS.has('/' + segs.join('/'))) return true;
  return CLIENT_PATHS.has(englishPath(lang, segs));
}
