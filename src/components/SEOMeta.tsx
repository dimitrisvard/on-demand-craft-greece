import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from 'react-i18next';
import { translateUrlPath, reverseTranslateUrlPath } from '../utils/urlSlugTranslator';

interface SEOMetaProps {
  title?: string;
  description?: string;
  keywords?: string;
  canonicalUrl?: string;
  ogImage?: string;
  ogType?: string;
  hreflangLinks?: Array<{ lang: string; url: string }>;
  disableDefaultHreflang?: boolean;
}

const SEOMeta: React.FC<SEOMetaProps> = ({
  title,
  description,
  keywords,
  canonicalUrl,
  ogImage,
  ogType = 'website',
  hreflangLinks,
  disableDefaultHreflang = false
}) => {
  const { currentLanguage, supportedLanguages, getLocalizedPath, getPathWithoutLanguage } = useLanguage();
  const { t, i18n } = useTranslation();
  const { pathname: currentPath } = useLocation();

  // Default values
  const defaultTitle = t('home_title') || 'MicronsHub - Precision Manufacturing';
  const defaultDescription = t('home_subtitle') || 'Professional CNC machining, 3D printing, and manufacturing services';

  const pageTitle = title || defaultTitle;
  const pageDescription = description || defaultDescription;
  const pageKeywords = keywords || t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding');

  // Generate canonical URL
  const baseUrl = 'https://www.micronshub.eu';
  
  // Check if current path should have language prefix
  const shouldHaveLanguagePrefix = !['/dashboard', '/customers', '/partners', '/calendar', '/products', '/rfq', '/orders', '/cookie-policy'].some(route => currentPath.startsWith(route));
  
  // Helper function to get the English path from the current path
  const getEnglishPathFromCurrent = (): string => {
    const cleanPath = getPathWithoutLanguage(currentPath);
    if (currentLanguage !== 'en' && cleanPath !== '/') {
      const tForLang = i18n.getFixedT(currentLanguage);
      return reverseTranslateUrlPath(cleanPath, currentLanguage, tForLang);
    }
    return cleanPath;
  };

  // Helper function to translate a path for a specific language
  const getTranslatedPathForLanguage = (englishPath: string, targetLang: string): string => {
    if (targetLang === 'en' || englishPath === '/' || englishPath === '') {
      return englishPath === '/' ? '' : englishPath;
    }
    const tForLang = i18n.getFixedT(targetLang);
    return translateUrlPath(englishPath, targetLang, tForLang);
  };

  let canonical;
  if (canonicalUrl) {
    canonical = canonicalUrl;
  } else if (shouldHaveLanguagePrefix) {
    // For language-prefixed routes, ensure canonical has the correct translated URL
    // Get the English path first, then translate to current language
    const englishPath = getEnglishPathFromCurrent();
    const translatedPath = getTranslatedPathForLanguage(englishPath, currentLanguage);
    canonical = `${baseUrl}/${currentLanguage}${translatedPath}`;
  } else {
    // For non-language routes, use as-is
    canonical = `${baseUrl}${currentPath}`;
  }

  // Generate hreflang URLs for all supported languages with TRANSLATED slugs
  const computedHreflangLinks = hreflangLinks || (disableDefaultHreflang ? [] : (() => {
    // Get the English path first (reverse translate from current language)
    const englishPath = getEnglishPathFromCurrent();
    
    // Generate hreflang for each language with proper translated URLs
    const links = Object.keys(supportedLanguages).map(lang => {
      let url;
      if (shouldHaveLanguagePrefix) {
        // Translate the English path to this language
        const translatedPath = getTranslatedPathForLanguage(englishPath, lang);
        url = `${baseUrl}/${lang}${translatedPath}`;
      } else {
        // For non-language routes, use the same URL for all languages
        url = `${baseUrl}${currentPath}`;
      }
      return { lang, url };
    });
    
    // Add x-default pointing to English version
    const englishUrl = shouldHaveLanguagePrefix 
      ? `${baseUrl}/en${englishPath === '/' ? '' : englishPath}`
      : `${baseUrl}${currentPath}`;
    links.push({ lang: 'x-default', url: englishUrl });
    
    return links;
  })());

  return (
    <Helmet>
      {/* Basic Meta Tags */}
      <title>{pageTitle}</title>
      <meta name="description" content={pageDescription} />
      <meta name="keywords" content={pageKeywords} />
      <meta name="language" content={currentLanguage} />
      
      {/* Canonical URL */}
      <link rel="canonical" href={canonical} />
      
      {/* Hreflang Tags for International SEO */}
      {computedHreflangLinks.map(({ lang, url }) => (
        <link key={lang} rel="alternate" hrefLang={lang} href={url} />
      ))}
      
      {/* Open Graph Meta Tags */}
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={pageDescription} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonical} />
      <meta property="og:locale" content={currentLanguage} />
      {ogImage && <meta property="og:image" content={ogImage} />}
      
      {/* Twitter Card Meta Tags */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={pageDescription} />
      {ogImage && <meta name="twitter:image" content={ogImage} />}
      
      {/* Additional Language-Specific Meta Tags */}
      <meta httpEquiv="content-language" content={currentLanguage} />
      
      {/* Structured Data for Language */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          "name": "MicronsHub",
          "url": baseUrl,
          "inLanguage": currentLanguage,
          "availableLanguage": Object.keys(supportedLanguages),
          "description": pageDescription
        })}
      </script>
    </Helmet>
  );
};

export default SEOMeta;
