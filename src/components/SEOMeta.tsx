import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();

  // Default values
  const defaultTitle = t('home_title') || 'MicronsHub - Precision Manufacturing';
  const defaultDescription = t('home_subtitle') || 'Professional CNC machining, 3D printing, and manufacturing services';
  
  const pageTitle = title || defaultTitle;
  const pageDescription = description || defaultDescription;
  const pageKeywords = keywords || 'CNC machining, 3D printing, manufacturing, Greece, precision parts';

  // Generate canonical URL
  const baseUrl = window.location.origin;
  const currentPath = window.location.pathname;
  
  // Check if current path should have language prefix
  const shouldHaveLanguagePrefix = !['/dashboard', '/customers', '/partners', '/calendar', '/products', '/rfq', '/orders', '/cookie-policy'].some(route => currentPath.startsWith(route));
  
  let canonical;
  if (canonicalUrl) {
    canonical = canonicalUrl;
  } else if (shouldHaveLanguagePrefix) {
    // For language-prefixed routes, ensure canonical has language
    if (currentPath.startsWith(`/${currentLanguage}`)) {
      canonical = `${baseUrl}${currentPath}`;
    } else {
      // Use the cleaned path to avoid duplication
      const cleanPath = getPathWithoutLanguage(currentPath);
      canonical = `${baseUrl}/${currentLanguage}${cleanPath === '/' ? '' : cleanPath}`;
    }
  } else {
    // For non-language routes, use as-is
    canonical = `${baseUrl}${currentPath}`;
  }

  // Generate hreflang URLs for all supported languages
  const computedHreflangLinks = hreflangLinks || (disableDefaultHreflang ? [] : Object.keys(supportedLanguages).map(lang => {
    let url;
    if (shouldHaveLanguagePrefix) {
      // For language-prefixed routes, generate language alternatives using cleaned path
      const cleanPath = getPathWithoutLanguage(currentPath);
      url = `${baseUrl}/${lang}${cleanPath === '/' ? '' : cleanPath}`;
    } else {
      // For non-language routes, use the same URL for all languages
      url = `${baseUrl}${currentPath}`;
    }
    return { lang, url };
  }));

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
