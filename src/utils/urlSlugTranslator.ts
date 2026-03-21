/**
 * URL Slug Translator
 * Maps English URL slugs to their translated versions in different languages
 * Used for SEO-friendly multilingual URLs (e.g., /en/services → /de/dienstleistungen)
 */

import { TFunction } from 'i18next';

// English slug to translation key mapping
// This maps the English URL segment to the translation key that contains the translated slug
export const SLUG_TRANSLATION_KEYS: Record<string, string> = {
  'services': 'url_slug_services',
  'about': 'url_slug_about',
  'contact': 'url_slug_contact',
  'quote': 'url_slug_quote',
  'industries': 'url_slug_industries',
  'our-work': 'url_slug_our_work',
  'blog': 'url_slug_blog',
  'cnc-machining': 'url_slug_cnc_machining',
  'sheet-metal': 'url_slug_sheet_metal',
  '3d-printing': 'url_slug_3d_printing',
  'injection-molding': 'url_slug_injection_molding',
  'surface-finishes': 'url_slug_surface_finishes',
  'rapid-prototyping': 'url_slug_rapid_prototyping',
  'legal-notice': 'url_slug_impressum',
  'education': 'url_slug_education',
  // 'impressum' is handled as a legacy route and will reverse-translate to 'legal-notice'
};

/**
 * Translate a URL slug from English to the current language
 * @param englishSlug - The English URL slug (e.g., 'services')
 * @param language - Target language code (e.g., 'de')
 * @param t - Translation function from i18next
 * @returns Translated slug (e.g., 'dienstleistungen') or original slug if translation not found
 */
export function translateUrlSlug(
  englishSlug: string,
  language: string,
  t: TFunction
): string {
  // If English, return as-is
  if (language === 'en') {
    return englishSlug;
  }

  // Get translation key for this slug
  const translationKey = SLUG_TRANSLATION_KEYS[englishSlug];
  if (!translationKey) {
    // No translation key found, return original
    return englishSlug;
  }

  // Get translated slug with fallback to English slug
  const translatedSlug = t(translationKey, { defaultValue: englishSlug });
  
  // If translation returned the key (meaning it wasn't found), use English slug
  if (translatedSlug === translationKey || !translatedSlug) {
    return englishSlug;
  }

  return translatedSlug;
}

/**
 * Reverse translate a URL slug from any language back to English
 * @param slug - The slug in any language
 * @param language - Source language code
 * @param t - Translation function from i18next
 * @returns English slug
 */
export function reverseTranslateUrlSlug(
  slug: string,
  language: string,
  t: TFunction
): string {
  // If English, return as-is
  if (language === 'en') {
    return slug;
  }

  // Check each translation key to find which one matches this slug
  for (const [englishSlug, translationKey] of Object.entries(SLUG_TRANSLATION_KEYS)) {
    const translatedSlug = t(translationKey, { defaultValue: englishSlug });
    if (translatedSlug === slug) {
      return englishSlug;
    }
  }

  // Special case: 'impressum' in any language should reverse-translate to 'legal-notice'
  if (slug === 'impressum' || slug === t('url_slug_impressum', { defaultValue: 'legal-notice' })) {
    return 'legal-notice';
  }

  // Not found, assume it's already English
  return slug;
}

/**
 * Translate a full URL path
 * @param englishPath - English path like '/services' or '/services/cnc-machining' or '/blog/article-slug'
 * @param language - Target language code
 * @param t - Translation function
 * @returns Translated path like '/dienstleistungen' or '/dienstleistungen/cnc-fraesen' or '/blog/article-slug' (blog slugs are NOT translated)
 */
export function translateUrlPath(
  englishPath: string,
  language: string,
  t: TFunction
): string {
  if (englishPath === '/' || englishPath === '') {
    return '/';
  }

  // Remove leading slash and split into segments
  const segments = englishPath.split('/').filter(Boolean);
  
  // Special handling for blog paths: only translate '/blog', keep article slug unchanged
  // Blog posts have manually-entered slugs that should NOT be auto-translated
  if (segments.length >= 2 && segments[0] === 'blog') {
    // Translate 'blog' part only, keep the rest (article slug) as-is
    const translatedBlog = translateUrlSlug('blog', language, t);
    const articleSlug = segments.slice(1).join('/'); // Everything after 'blog'
    return `/${translatedBlog}/${articleSlug}`;
  }
  
  // Translate each segment for all other paths
  const translatedSegments = segments.map(segment => 
    translateUrlSlug(segment, language, t)
  );

  return '/' + translatedSegments.join('/');
}

/**
 * Reverse translate a full URL path back to English
 * @param path - Path in any language
 * @param language - Source language code
 * @param t - Translation function
 * @returns English path
 */
export function reverseTranslateUrlPath(
  path: string,
  language: string,
  t: TFunction
): string {
  if (path === '/' || path === '') {
    return '/';
  }

  // Remove leading slash and split into segments
  const segments = path.split('/').filter(Boolean);
  
  // Special handling for blog paths: only reverse-translate '/blog', keep article slug unchanged
  // Blog posts have manually-entered slugs that should NOT be reverse-translated
  if (segments.length >= 2) {
    const firstSegment = segments[0];
    // Check if first segment is a translated version of 'blog'
    const translatedBlog = t('url_slug_blog', { defaultValue: 'blog' });
    if (firstSegment === translatedBlog || firstSegment === 'blog') {
      // Reverse translate 'blog' part only, keep the rest (article slug) as-is
      const englishBlog = reverseTranslateUrlSlug(firstSegment, language, t);
      const articleSlug = segments.slice(1).join('/'); // Everything after 'blog'
      return `/${englishBlog}/${articleSlug}`;
    }
  }
  
  // Reverse translate each segment for all other paths
  const englishSegments = segments.map(segment => 
    reverseTranslateUrlSlug(segment, language, t)
  );

  return '/' + englishSegments.join('/');
}

