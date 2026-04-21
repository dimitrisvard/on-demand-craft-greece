/**
 * TranslatedRouteMatcher Component
 * Single catch-all handler that reverse-translates URLs and renders the correct component
 * This allows translated URLs like /de/dienstleistungen to work
 */

import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import NotFound from '../pages/NotFound';

// Lazy load page components (code-splitting)
const Services = lazy(() => import('../pages/Services'));
const Quote = lazy(() => import('../pages/Quote'));
const QuoteSuccess = lazy(() => import('../pages/QuoteSuccess'));
const QuoteRequestForm = lazy(() => import('../pages/QuoteRequestForm'));
const ContactSuccess = lazy(() => import('../pages/ContactSuccess'));
const ServicePage = lazy(() => import('../pages/ServicePage'));
const ContentPage = lazy(() => import('../pages/ContentPage'));

// Wrapper components that lock in the service slug at the route level.
const SurfaceFinishesRoute = () => <ServicePage slug="surface-finishes" />;
const SheetMetalRoute = () => <ServicePage slug="sheet-metal" />;
const CncMachiningRoute = () => <ServicePage slug="cnc-machining" />;
const ThreeDPrintingRoute = () => <ServicePage slug="3d-printing" />;
const InjectionMoldingRoute = () => <ServicePage slug="injection-molding" />;
const RapidPrototypingRoute = () => <ServicePage slug="rapid-prototyping" />;

// content_pages slugs — each routes to the generic DB-driven ContentPage.
const IndustriesContentRoute = () => <ContentPage slug="industries" />;
const OurWorkContentRoute = () => <ContentPage slug="our-work" />;
const AboutContentRoute = () => <ContentPage slug="about" />;
const ContactContentRoute = () => <ContentPage slug="contact" />;
const EducationContentRoute = () => <ContentPage slug="education" />;
const LegalNoticeContentRoute = () => <ContentPage slug="legal-notice" />;
const PrivacyPolicyContentRoute = () => <ContentPage slug="privacy-policy" />;

// Route mapping: English path -> Component
const ROUTE_MAP: Record<string, React.ComponentType<any>> = {
  '/services': Services,
  '/industries': IndustriesContentRoute,
  '/our-work': OurWorkContentRoute,
  '/about': AboutContentRoute,
  '/contact': ContactContentRoute,
  '/education': EducationContentRoute,
  '/quote': Quote,
  '/quote/success': QuoteSuccess,
  '/quote-request': QuoteRequestForm,
  '/contact/success': ContactSuccess,
  '/services/surface-finishes': SurfaceFinishesRoute,
  '/services/sheet-metal': SheetMetalRoute,
  '/services/cnc-machining': CncMachiningRoute,
  '/services/3d-printing': ThreeDPrintingRoute,
  '/services/injection-molding': InjectionMoldingRoute,
  '/services/rapid-prototyping': RapidPrototypingRoute,
  '/legal-notice': LegalNoticeContentRoute,
  '/privacy-policy': PrivacyPolicyContentRoute,
  // '/impressum' is handled as a legacy route in App.tsx (uses ImpressumPage).
};

// 301 Redirect map for old/bad slugs that need redirecting to correct URLs
// Format: { language: { oldSlug: 'full/path/to/new/slug' } }
// Note: Service pages need the /services/ prefix (translated), standalone pages don't
const OLD_SLUG_REDIRECTS: Record<string, Record<string, string>> = {
  // Swedish fixes - service pages need /tjanster/ prefix
  sv: {
    'spjutsgjutning': 'tjanster/formsprutning',  // /sv/tjanster/formsprutning
    'sprutgjutning': 'tjanster/formsprutning',
    'platarbe': 'tjanster/platbearbetning',      // /sv/tjanster/platbearbetning
  },
  // Danish fixes - service pages need /tjenester/ prefix
  da: {
    'spjutsgodsning': 'tjenester/sprojtestobning',  // /da/tjenester/sprojtestobning
    'sproejtestoebning': 'tjenester/sprojtestobning',
  },
  // Norwegian fixes - service pages need /tjenester/ prefix
  nb: {
    'spjutsgjetting': 'tjenester/sproytestoping',   // /nb/tjenester/sproytestoping
    'sproyetestoping': 'tjenester/sproytestoping',
  },
  // Polish fixes - service pages need /uslugi/ prefix
  pl: {
    'wykończenie-powierzchni': 'uslugi/wykonczenie-powierzchni',  // /pl/uslugi/wykonczenie-powierzchni
  },
};

// Blog slug redirects (old blog post slugs -> new correct slugs)
const OLD_BLOG_SLUG_REDIRECTS: Record<string, Record<string, string>> = {
  // Dutch fix
  nl: {
    'knoedelen-ontwerpen-voor-diamant-vs-rechte-patronen': 'kartelen-ontwerpen-voor-diamant-vs-rechte-patronen',
  },
  // Swedish fix
  sv: {
    'krapplingsoperationer-design-for-diamant-vs-raka-monster': 'lattring-operationer-design-for-diamant-vs-raka-monster',
  },
  // Italian fix
  it: {
    'minimizzare-chiacchiericcio-fresatura-cavita-profonde': 'minimizzare-vibrazioni-fresatura-cavita-profonde',
  },
};

interface TranslatedRouteMatcherProps {
  slug?: string; // For single-level routes like /:lang/:slug
  subslug?: string; // For two-level routes like /:lang/:slug/:subslug
}

const TranslatedRouteMatcher: React.FC<TranslatedRouteMatcherProps> = ({ slug, subslug }) => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { getEnglishPath } = useLanguage();
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  
  const lang = params.lang || i18n.language || 'en';
  const currentSlug = params.slug || slug;
  const currentSubSlug = params.subslug || subslug;
  const currentPath = location.pathname;

  // Check for old slug redirects FIRST
  useEffect(() => {
    // Check if this is an old service page slug that needs redirecting
    if (currentSlug && OLD_SLUG_REDIRECTS[lang]?.[currentSlug]) {
      const newPathSegment = OLD_SLUG_REDIRECTS[lang][currentSlug];
      const newPath = `/${lang}/${newPathSegment}`;
      console.log(`[301 Redirect] Old slug: ${currentPath} -> ${newPath}`);
      setRedirectTo(newPath);
      return;
    }
    
    // Check if this is a blog path with an old article slug
    if (currentSlug && (currentSlug === 'blog' || currentSlug === 'blogg' || currentSlug === 'blogi') && currentSubSlug) {
      if (OLD_BLOG_SLUG_REDIRECTS[lang]?.[currentSubSlug]) {
        const newArticleSlug = OLD_BLOG_SLUG_REDIRECTS[lang][currentSubSlug];
        const newPath = `/${lang}/${currentSlug}/${newArticleSlug}`;
        console.log(`[301 Redirect] Old blog slug: ${currentPath} -> ${newPath}`);
        setRedirectTo(newPath);
        return;
      }
    }
    
    // Also check URL-decoded version for special characters
    try {
      const decodedSlug = currentSlug ? decodeURIComponent(currentSlug) : '';
      if (decodedSlug !== currentSlug && OLD_SLUG_REDIRECTS[lang]?.[decodedSlug]) {
        const newPathSegment = OLD_SLUG_REDIRECTS[lang][decodedSlug];
        const newPath = `/${lang}/${newPathSegment}`;
        console.log(`[301 Redirect] Old encoded slug: ${currentPath} -> ${newPath}`);
        setRedirectTo(newPath);
        return;
      }
    } catch {
      // Invalid encoding, continue
    }
  }, [lang, currentSlug, currentSubSlug, currentPath]);

  // If we have a redirect, perform it
  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }
  
  // Build the current path segment from params
  let pathSegment = '';
  if (currentSubSlug && currentSlug) {
    // Two-level route: /:lang/:slug/:subslug
    pathSegment = `/${currentSlug}/${currentSubSlug}`;
  } else if (currentSlug) {
    // Single-level route: /:lang/:slug
    pathSegment = `/${currentSlug}`;
  }
  
  // If English, check if pathSegment directly matches any route
  if (lang === 'en') {
    const Component = ROUTE_MAP[pathSegment];
    if (Component) {
      return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
          <Component />
        </Suspense>
      );
    }
    // No match - show 404 (this shouldn't happen if routes are ordered correctly)
    return <NotFound />;
  }
  
  // For non-English, reverse translate the current path to English
  const englishPath = getEnglishPath(currentPath, lang);
  
  // Check if reverse-translated path matches any known route
  const Component = ROUTE_MAP[englishPath];
  if (Component) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
        <Component />
      </Suspense>
    );
  }
  
  // No match found - show 404 page
  return <NotFound />;
};

export default TranslatedRouteMatcher;
