import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { translateUrlPath, reverseTranslateUrlPath } from '@/utils/urlSlugTranslator';

// Supported languages
export const SUPPORTED_LANGUAGES = {
  en: { name: 'English', nativeName: 'English' },
  de: { name: 'German', nativeName: 'Deutsch' },
  fr: { name: 'French', nativeName: 'Français' },
  es: { name: 'Spanish', nativeName: 'Español' },
  it: { name: 'Italian', nativeName: 'Italiano' },
  nl: { name: 'Dutch', nativeName: 'Nederlands' },
  pl: { name: 'Polish', nativeName: 'Polski' },
  pt: { name: 'Portuguese', nativeName: 'Português' },
  sv: { name: 'Swedish', nativeName: 'Svenska' },
  da: { name: 'Danish', nativeName: 'Dansk' },
  fi: { name: 'Finnish', nativeName: 'Suomi' },
  nb: { name: 'Norwegian', nativeName: 'Norsk' },
  hu: { name: 'Hungarian', nativeName: 'Magyar' },
  cs: { name: 'Czech', nativeName: 'Čeština' }
};

export const DEFAULT_LANGUAGE = 'en';

// Routes that should NOT have language prefixes
const NON_LANGUAGE_ROUTES = [
  '/dashboard',
  '/customers',
  '/partners',
  '/calendar',
  '/products',
  '/rfq',
  '/orders',
  '/cookie-policy'
];

interface LanguageContextType {
  currentLanguage: string;
  setLanguage: (lang: string) => void;
  supportedLanguages: typeof SUPPORTED_LANGUAGES;
  getLocalizedPath: (path: string) => string;
  getPathWithoutLanguage: (path: string) => string;
  getEnglishPath: (path: string, language: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

interface LanguageProviderProps {
  children: ReactNode;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children }) => {
  const [currentLanguage, setCurrentLanguage] = useState(DEFAULT_LANGUAGE);
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  // Check if a route should have language prefix
  const shouldHaveLanguagePrefix = (path: string) => {
    return !NON_LANGUAGE_ROUTES.some(route => path.startsWith(route));
  };

  // Clean path by removing ALL existing language prefixes
  const cleanPath = (path: string) => {
    let segments = path.split('/');
    
    // Remove all language prefixes from the beginning
    while (segments.length > 1 && SUPPORTED_LANGUAGES[segments[1] as keyof typeof SUPPORTED_LANGUAGES]) {
      segments = segments.slice(2);
    }
    
    return segments.join('/') || '/';
  };

  // Build proper language path
  const buildLanguagePath = (lang: string, path: string) => {
    if (path === '/') {
      return `/${lang}`;
    }
    return `/${lang}${path.startsWith('/') ? path : `/${path}`}`;
  };

  // Initialize language from URL or localStorage
  useEffect(() => {
    const pathSegments = location.pathname.split('/');
    const langFromUrl = pathSegments[1];
    
    console.log('LanguageContext initialization:', {
      pathname: location.pathname,
      langFromUrl,
      currentLanguage,
      shouldHaveLanguagePrefix: shouldHaveLanguagePrefix(location.pathname)
    });
    
    // If this is a non-language route, don't redirect
    if (!shouldHaveLanguagePrefix(location.pathname)) {
      // Set language from localStorage or default
      const savedLang = localStorage.getItem('preferred-language') || DEFAULT_LANGUAGE;
      console.log('Non-language route, using saved language:', savedLang);
      setCurrentLanguage(savedLang);
      i18n.changeLanguage(savedLang);
      return;
    }
    
    if (langFromUrl && SUPPORTED_LANGUAGES[langFromUrl as keyof typeof SUPPORTED_LANGUAGES]) {
      console.log('Setting language from URL:', langFromUrl);
      setCurrentLanguage(langFromUrl);
      i18n.changeLanguage(langFromUrl);
    } else {
      // Check localStorage for saved preference
      const savedLang = localStorage.getItem('preferred-language');
      console.log('No language in URL, using saved language:', savedLang);
      if (savedLang && SUPPORTED_LANGUAGES[savedLang as keyof typeof SUPPORTED_LANGUAGES]) {
        setCurrentLanguage(savedLang);
        i18n.changeLanguage(savedLang);
        
        // Only redirect if we're on a route that should have language prefix
        if (shouldHaveLanguagePrefix(location.pathname)) {
          const cleanCurrentPath = cleanPath(location.pathname);
          const newPath = buildLanguagePath(savedLang, cleanCurrentPath);
          console.log('Redirecting to:', newPath);
          navigate(newPath);
        }
      } else {
        // Default to English and redirect only if needed
        console.log('Using default language:', DEFAULT_LANGUAGE);
        setCurrentLanguage(DEFAULT_LANGUAGE);
        i18n.changeLanguage(DEFAULT_LANGUAGE);
        if (shouldHaveLanguagePrefix(location.pathname)) {
          const cleanCurrentPath = cleanPath(location.pathname);
          const newPath = buildLanguagePath(DEFAULT_LANGUAGE, cleanCurrentPath);
          console.log('Redirecting to default language:', newPath);
          navigate(newPath);
        }
      }
    }
  }, [location.pathname, i18n, navigate]);

  // Update i18n when language changes
  useEffect(() => {
    i18n.changeLanguage(currentLanguage);
    localStorage.setItem('preferred-language', currentLanguage);
  }, [currentLanguage, i18n]);

  const setLanguage = (lang: string) => {
    if (SUPPORTED_LANGUAGES[lang as keyof typeof SUPPORTED_LANGUAGES]) {
      // Get the current language from URL before changing
      const pathSegments = location.pathname.split('/');
      const currentLangFromUrl = pathSegments[1];
      const currentLangValid = SUPPORTED_LANGUAGES[currentLangFromUrl as keyof typeof SUPPORTED_LANGUAGES];
      const fromLanguage = currentLangValid ? currentLangFromUrl : currentLanguage;
      
      setCurrentLanguage(lang);
      
      // Only update URL if current route should have language prefix
      if (shouldHaveLanguagePrefix(location.pathname)) {
        // Step 1: Clean path (remove language prefix)
        let cleanCurrentPath = cleanPath(location.pathname);
        
        // Step 2: Reverse-translate from current language to English
        if (fromLanguage !== 'en' && cleanCurrentPath !== '/') {
          const tFromLanguage = i18n.getFixedT(fromLanguage);
          cleanCurrentPath = reverseTranslateUrlPath(cleanCurrentPath, fromLanguage, tFromLanguage);
        }
        
        // Step 3: Translate from English to new language
        if (lang !== 'en' && cleanCurrentPath !== '/') {
          const tToLanguage = i18n.getFixedT(lang);
          cleanCurrentPath = translateUrlPath(cleanCurrentPath, lang, tToLanguage);
        }
        
        // Step 4: Build and navigate to new path
        const newPath = buildLanguagePath(lang, cleanCurrentPath);
        navigate(newPath);
      }
    }
  };

  // Get localized path for current language
  const getLocalizedPath = (path: string) => {
    // If it's a non-language route, return as-is
    if (!shouldHaveLanguagePrefix(path)) {
      return path;
    }
    
    // Get the current language from the URL if available, otherwise use currentLanguage
    const pathSegments = location.pathname.split('/');
    const langFromUrl = pathSegments[1];
    const effectiveLanguage = (langFromUrl && SUPPORTED_LANGUAGES[langFromUrl as keyof typeof SUPPORTED_LANGUAGES]) 
      ? langFromUrl 
      : currentLanguage;
    
    // Clean the path first to remove any existing language prefixes
    let cleanPathValue = cleanPath(path);
    
    // If not English, translate the URL slug using the target language's translations
    // NOTE: This generates translated URLs (e.g., /de/dienstleistungen)
    // Routes in App.tsx currently use English paths, so this will cause routing issues
    // until routes are updated to handle both English and translated slugs
    if (effectiveLanguage !== 'en' && cleanPathValue !== '/') {
      const tForLanguage = i18n.getFixedT(effectiveLanguage);
      cleanPathValue = translateUrlPath(cleanPathValue, effectiveLanguage, tForLanguage);
    }
    
    const result = buildLanguagePath(effectiveLanguage, cleanPathValue);
    
    return result;
  };
  
  // Get English path from any language path (for routing)
  const getEnglishPath = (path: string, language: string) => {
    // Clean path (remove language prefix)
    let cleanPathValue = cleanPath(path);
    
    // If not English, reverse translate to English using source language's translations
    if (language !== 'en' && cleanPathValue !== '/') {
      const tForLanguage = i18n.getFixedT(language);
      cleanPathValue = reverseTranslateUrlPath(cleanPathValue, language, tForLanguage);
    }
    
    return cleanPathValue;
  };

  // Remove language prefix from path
  const getPathWithoutLanguage = (path: string) => {
    return cleanPath(path);
  };

  const value: LanguageContextType = {
    currentLanguage,
    setLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES,
    getLocalizedPath,
    getPathWithoutLanguage,
    getEnglishPath
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};
