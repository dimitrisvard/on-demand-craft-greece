/**
 * SEO Redirects Component
 * Handles 301 redirects from old/malformed URLs to correct URLs
 * This runs on every navigation to check if a redirect is needed
 */

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Map of old bad URLs to new correct URLs
// Format: { 'old-path': 'new-path' }
const REDIRECT_MAP: Record<string, string> = {
  // Dutch Fix - blog post
  '/nl/blog/knoedelen-ontwerpen-voor-diamant-vs-rechte-patronen': '/nl/blog/kartelen-ontwerpen-voor-diamant-vs-rechte-patronen',
  
  // Swedish Fixes - service pages
  '/sv/spjutsgjutning': '/sv/formsprutning',
  '/sv/platarbe': '/sv/platbearbetning',
  '/sv/sprutgjutning': '/sv/formsprutning', // Also handle this variant
  
  // Swedish Fix - blog post  
  '/sv/blog/krapplingsoperationer-design-for-diamant-vs-raka-monster': '/sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster',
  '/sv/blogg/krapplingsoperationer-design-for-diamant-vs-raka-monster': '/sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster',
  
  // Danish Fix - service page
  '/da/spjutsgodsning': '/da/sprojtestobning',
  '/da/sproejtestoebning': '/da/sprojtestobning', // Also handle old variant
  
  // Norwegian Fix - service page
  '/nb/spjutsgjetting': '/nb/sproytestoping',
  '/nb/sproyetestoping': '/nb/sproytestoping', // Also handle old variant
  
  // Italian Fix - blog post
  '/it/blog/minimizzare-chiacchiericcio-fresatura-cavita-profonde': '/it/blog/minimizzare-vibrazioni-fresatura-cavita-profonde',
  
  // Polish Fix - service page (handling special character)
  '/pl/wykończenie-powierzchni': '/pl/wykonczenie-powierzchni',
  '/pl/wyko%C5%84czenie-powierzchni': '/pl/wykonczenie-powierzchni', // URL encoded version
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
  
  // Check Frankenstein patterns
  for (const { pattern, extractLang, extractPath } of FRANKENSTEIN_PATTERNS) {
    const match = normalizedPath.match(pattern);
    if (match) {
      const lang = extractLang(match);
      const englishPath = extractPath(match);
      // This needs proper translation, but for now redirect to the language home
      // A more complete solution would use the url slug translator
      return `/${lang}${englishPath}`;
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

  useEffect(() => {
    const redirectPath = getRedirectPath(location.pathname);
    
    if (redirectPath && redirectPath !== location.pathname) {
      console.log(`[SEO Redirect] ${location.pathname} -> ${redirectPath}`);
      // Use replace to simulate 301 redirect (doesn't add to history)
      navigate(redirectPath, { replace: true });
    }
  }, [location.pathname, navigate]);

  // This component doesn't render anything
  return null;
};

export default SEORedirects;

/**
 * Export the redirect map for server-side configuration
 */
export { REDIRECT_MAP, getRedirectPath };
