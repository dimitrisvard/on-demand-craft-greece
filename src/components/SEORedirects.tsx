/**
 * SEO Redirects Component
 * Handles 301 redirects from old/malformed URLs to correct URLs
 * This runs on every navigation to check if a redirect is needed
 */

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { translateUrlPath } from '../utils/urlSlugTranslator';

// Map of old bad URLs to new correct URLs
// Format: { 'old-path': 'new-path' }
const REDIRECT_MAP: Record<string, string> = {
  // Dutch Fix - blog post
  '/nl/blog/knoedelen-ontwerpen-voor-diamant-vs-rechte-patronen': '/nl/blog/kartelen-ontwerpen-voor-diamant-vs-rechte-patronen',
  
  // Swedish Fixes - service pages (need /tjanster/ prefix)
  '/sv/spjutsgjutning': '/sv/tjanster/formsprutning',
  '/sv/platarbe': '/sv/tjanster/platbearbetning',
  '/sv/sprutgjutning': '/sv/tjanster/formsprutning', // Also handle this variant
  
  // Swedish Fix - blog post  
  '/sv/blog/krapplingsoperationer-design-for-diamant-vs-raka-monster': '/sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster',
  '/sv/blogg/krapplingsoperationer-design-for-diamant-vs-raka-monster': '/sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster',
  
  // Danish Fix - service page (need /tjenester/ prefix)
  '/da/spjutsgodsning': '/da/tjenester/sprojtestobning',
  '/da/sproejtestoebning': '/da/tjenester/sprojtestobning', // Also handle old variant
  
  // Norwegian Fix - service page (need /tjenester/ prefix)
  '/nb/spjutsgjetting': '/nb/tjenester/sproytestoping',
  '/nb/sproyetestoping': '/nb/tjenester/sproytestoping', // Also handle old variant
  
  // Italian Fix - blog post
  '/it/blog/minimizzare-chiacchiericcio-fresatura-cavita-profonde': '/it/blog/minimizzare-vibrazioni-fresatura-cavita-profonde',
  
  // Polish Fix - service page (need /uslugi/ prefix, handling special character)
  '/pl/wykończenie-powierzchni': '/pl/uslugi/wykonczenie-powierzchni',
  '/pl/wyko%C5%84czenie-powierzchni': '/pl/uslugi/wykonczenie-powierzchni', // URL encoded version
  
  // Frankenstein URLs - direct mappings for common cases
  '/csoffert': '/cs/nabidka',  // Czech: cs + offert (Swedish) -> cs/nabidka
  '/dawycena': '/pl/wycena',   // Mixed: da (Danish) + wycena (Polish) -> pl/wycena
  '/en/dawycena': '/pl/wycena', // Mixed: en + da (Danish) + wycena (Polish) -> pl/wycena
  '/danotre-travail': '/fr/notre-travail', // Mixed: da (Danish) + notre-travail (French) -> fr/notre-travail
  '/csservicos/usinagem-cnc': '/pt/servicos/usinagem-cnc', // Mixed: cs (Czech) + servicos/usinagem-cnc (Portuguese) -> pt/servicos/usinagem-cnc
  '/daservices/sheet-metal': '/da/tjenester/pladearbejde', // Mixed: da + services/sheet-metal (English) -> da/tjenester/pladearbejde
  '/deservicos/prototipagem-rapida': '/pt/servicos/prototipagem-rapida', // Mixed: de (German) + servicos/prototipagem-rapida (Portuguese) -> pt/servicos/prototipagem-rapida
  '/daservices/impression-3d': '/fr/services/impression-3d', // Mixed: da (Danish) + services/impression-3d (French) -> fr/services/impression-3d
  '/nbservicos/prototipagem-rapida': '/pt/servicos/prototipagem-rapida', // Mixed: nb (Norwegian) + servicos/prototipagem-rapida (Portuguese) -> pt/servicos/prototipagem-rapida
  '/svorcamento': '/sv/offert', // Swedish: sv + orcamento (Portuguese) -> sv/offert
  '/huorcamento': '/hu/ajanlat', // Hungarian: hu + orcamento (Portuguese) -> hu/ajanlat
  '/itorcamento': '/it/preventivo', // Italian: it + orcamento (Portuguese) -> it/preventivo
  '/daorcamento': '/da/tilbud', // Danish: da + orcamento (Portuguese) -> da/tilbud
  '/deorcamento': '/de/angebot', // German: de + orcamento (Portuguese) -> de/angebot
  '/enoffert': '/en/quote',    // English: en + offert (Swedish) -> en/quote
};

// Additional patterns for "Frankenstein" URLs (malformed concatenations)
// These are URLs like /csoffert or /en/dawycena that need special handling
const FRANKENSTEIN_PATTERNS: Array<{ pattern: RegExp; extractLang: (match: RegExpMatchArray) => string; extractPath: (match: RegExpMatchArray) => string }> = [
  // Pattern: /{lang}{slug} without slash -> /{lang}/{translated-slug}
  // e.g., /csoffert -> /cs/nabidka
  {
    pattern: /^\/(cs|da|de|en|es|fi|fr|hu|it|nb|nl|pl|pt|sv)(quote|offert|nabidka|wycena|tilbud|devis|ajanlat|preventivo|orcamento)$/i,
    extractLang: (match) => match[1].toLowerCase(),
    extractPath: () => '/quote'
  },
  // Pattern: /{lang}/{otherlang}{slug} mixed language
  // e.g., /en/dawycena -> redirect to proper language
  {
    pattern: /^\/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)\/(da|de|fr|es|it|nl|pl|pt|sv|fi|nb|hu|cs)(wycena|offert|nabidka|tilbud|devis|ajanlat|preventivo|orcamento|quote)$/i,
    extractLang: (match) => match[2].toLowerCase(),
    extractPath: () => '/quote'
  }
];

/**
 * Check if the current path needs a redirect
 */
function getRedirectPath(currentPath: string): string | null {
  // Normalize path by removing trailing slash
  const normalizedPath = currentPath.endsWith('/') && currentPath !== '/' 
    ? currentPath.slice(0, -1) 
    : currentPath;
  
  // Check exact match in redirect map
  if (REDIRECT_MAP[normalizedPath]) {
    return REDIRECT_MAP[normalizedPath];
  }
  
  // Check URL-decoded version
  try {
    const decodedPath = decodeURIComponent(normalizedPath);
    if (decodedPath !== normalizedPath && REDIRECT_MAP[decodedPath]) {
      return REDIRECT_MAP[decodedPath];
    }
  } catch {
    // Invalid URL encoding, continue
  }
  
  return null;
}

/**
 * Check if the current path needs a redirect (with translation support)
 * This version uses i18n to translate paths
 */
function getRedirectPathWithTranslation(currentPath: string, t: any, lang: string): string | null {
  // Normalize path by removing trailing slash
  const normalizedPath = currentPath.endsWith('/') && currentPath !== '/' 
    ? currentPath.slice(0, -1) 
    : currentPath;
  
  // Check exact match in redirect map
  if (REDIRECT_MAP[normalizedPath]) {
    return REDIRECT_MAP[normalizedPath];
  }
  
  // Check URL-decoded version
  try {
    const decodedPath = decodeURIComponent(normalizedPath);
    if (decodedPath !== normalizedPath && REDIRECT_MAP[decodedPath]) {
      return REDIRECT_MAP[decodedPath];
    }
  } catch {
    // Invalid URL encoding, continue
  }
  
  // Check Frankenstein patterns
  for (const { pattern, extractLang, extractPath } of FRANKENSTEIN_PATTERNS) {
    const match = normalizedPath.match(pattern);
    if (match) {
      const extractedLang = extractLang(match);
      const englishPath = extractPath(match);
      
      // Translate the English path to the extracted language
      const translatedPath = translateUrlPath(englishPath, extractedLang, t);
      return `/${extractedLang}${translatedPath}`;
    }
  }
  
  return null;
}

/**
 * SEO Redirects Component
 * Place this near the top of your app to handle redirects
 */
const SEORedirects: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { i18n } = useTranslation();

  useEffect(() => {
    // Check for Frankenstein patterns first to extract language
    const normalizedPath = location.pathname.endsWith('/') && location.pathname !== '/' 
      ? location.pathname.slice(0, -1) 
      : location.pathname;
    
    let detectedLang = 'en';
    let needsTranslation = false;
    
    // Check if this is a Frankenstein URL
    for (const { pattern, extractLang } of FRANKENSTEIN_PATTERNS) {
      const match = normalizedPath.match(pattern);
      if (match) {
        detectedLang = extractLang(match);
        needsTranslation = true;
        break;
      }
    }
    
    // If not a Frankenstein URL, try to detect language from path segments
    if (!needsTranslation) {
      const pathSegments = location.pathname.split('/');
      detectedLang = pathSegments[1] || 'en';
    }
    
    // Get translation function for the detected language
    const tForLang = i18n.getFixedT(detectedLang);
    const redirectPath = getRedirectPathWithTranslation(location.pathname, tForLang, detectedLang);
    
    if (redirectPath && redirectPath !== location.pathname) {
      console.log(`[SEO Redirect] ${location.pathname} -> ${redirectPath}`);
      // Use replace to simulate 301 redirect (doesn't add to history)
      navigate(redirectPath, { replace: true });
    }
  }, [location.pathname, navigate, i18n]);

  // This component doesn't render anything
  return null;
};

export default SEORedirects;

/**
 * Export the redirect map for server-side configuration
 */
export { REDIRECT_MAP, getRedirectPath };
