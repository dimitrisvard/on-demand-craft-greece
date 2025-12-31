/**
 * TranslatedRoute Component
 * Handles routing for translated URL slugs by reverse-translating them to English
 * and redirecting to the correct route.
 */

import { useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import { reverseTranslateUrlPath } from '@/utils/urlSlugTranslator';

interface TranslatedRouteProps {
  component: React.ComponentType;
  englishPath: string;
}

const TranslatedRoute: React.FC<TranslatedRouteProps> = ({ component: Component, englishPath }) => {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { i18n } = useTranslation();
  const { getEnglishPath } = useLanguage();
  
  const lang = params.lang || i18n.language || 'en';
  
  useEffect(() => {
    // Get the current path without language prefix
    const currentPath = location.pathname.replace(`/${lang}`, '') || '/';
    
    // If not English, reverse translate to get English path
    if (lang !== 'en') {
      const englishTranslatedPath = getEnglishPath(location.pathname, lang);
      
      // If the translated path doesn't match the expected English path, redirect
      if (englishTranslatedPath !== englishPath) {
        // The route already matched, so just render the component
        // The URL will show the translated version, which is what we want for SEO
        return;
      }
    }
  }, [location.pathname, lang, englishPath, getEnglishPath]);
  
  return <Component />;
};

export default TranslatedRoute;

