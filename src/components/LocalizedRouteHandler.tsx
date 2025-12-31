/**
 * LocalizedRouteHandler Component
 * Handles routing for pages with translated URLs
 * Reverse-translates the URL slug and renders the appropriate component
 */

import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import { reverseTranslateUrlPath, SLUG_TRANSLATION_KEYS } from '@/utils/urlSlugTranslator';

interface LocalizedRouteHandlerProps {
  component: React.ComponentType;
  englishPath: string; // Expected English path (e.g., '/services')
}

const LocalizedRouteHandler: React.FC<LocalizedRouteHandlerProps> = ({ component: Component, englishPath }) => {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { i18n } = useTranslation();
  const { getEnglishPath } = useLanguage();
  const [shouldRender, setShouldRender] = useState(false);
  
  const lang = params.lang || i18n.language || 'en';
  const currentPath = location.pathname;
  
  useEffect(() => {
    // If English, always render (route already matched)
    if (lang === 'en') {
      setShouldRender(true);
      return;
    }
    
    // Get path after language prefix (e.g., 'dienstleistungen' from '/de/dienstleistungen')
    const pathAfterLang = currentPath.replace(`/${lang}`, '') || '/';
    
    // Reverse translate to get English equivalent
    const englishEquivalent = getEnglishPath(currentPath, lang);
    
    // Check if reverse-translated path matches expected English path
    const expectedPathClean = englishPath.startsWith('/') ? englishPath : `/${englishPath}`;
    const equivalentPathClean = englishEquivalent.startsWith('/') ? englishEquivalent : `/${englishEquivalent}`;
    
    if (equivalentPathClean === expectedPathClean) {
      // This is a valid translated URL for this route
      setShouldRender(true);
    } else {
      // Not a match, could be 404 or different route
      // For now, let React Router handle 404s naturally
      setShouldRender(false);
    }
  }, [currentPath, lang, englishPath, getEnglishPath]);
  
  if (!shouldRender && lang !== 'en') {
    return null; // Let React Router continue matching
  }
  
  return <Component />;
};

export default LocalizedRouteHandler;

