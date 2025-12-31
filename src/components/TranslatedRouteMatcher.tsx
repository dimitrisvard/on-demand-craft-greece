/**
 * TranslatedRouteMatcher Component
 * Single catch-all handler that reverse-translates URLs and renders the correct component
 * This allows translated URLs like /de/dienstleistungen to work
 */

import React from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

// Lazy load page components (code-splitting)
const Services = lazy(() => import('../pages/Services'));
const Industries = lazy(() => import('../pages/Industries'));
const OurWork = lazy(() => import('../pages/OurWork'));
const About = lazy(() => import('../pages/About'));
const Contact = lazy(() => import('../pages/Contact'));
const SurfaceFinishes = lazy(() => import('../pages/SurfaceFinishes'));
const SheetMetalFabrication = lazy(() => import('../pages/SheetMetalFabrication'));
const CncMachining = lazy(() => import('../pages/CncMachining'));
const ThreeDPrinting = lazy(() => import('../pages/3DPrinting'));
const InjectionMolding = lazy(() => import('../pages/InjectionMolding'));
const RapidPrototyping = lazy(() => import('../pages/RapidPrototyping'));

// Route mapping: English path -> Component
const ROUTE_MAP: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  '/services': Services,
  '/industries': Industries,
  '/our-work': OurWork,
  '/about': About,
  '/contact': Contact,
  '/services/surface-finishes': SurfaceFinishes,
  '/services/sheet-metal': SheetMetalFabrication,
  '/services/cnc-machining': CncMachining,
  '/services/3d-printing': ThreeDPrinting,
  '/services/injection-molding': InjectionMolding,
  '/services/rapid-prototyping': RapidPrototyping,
};

interface TranslatedRouteMatcherProps {
  slug?: string; // For single-level routes like /:lang/:slug
  subslug?: string; // For two-level routes like /:lang/:slug/:subslug
}

const TranslatedRouteMatcher: React.FC<TranslatedRouteMatcherProps> = ({ slug, subslug }) => {
  const params = useParams();
  const location = useLocation();
  const { i18n } = useTranslation();
  const { getEnglishPath } = useLanguage();
  
  const lang = params.lang || i18n.language || 'en';
  const currentPath = location.pathname;
  
  // Build the current path segment from params
  let pathSegment = '';
  if (subslug && slug) {
    // Two-level route: /:lang/:slug/:subslug
    pathSegment = `/${slug}/${subslug}`;
  } else if (slug) {
    // Single-level route: /:lang/:slug
    pathSegment = `/${slug}`;
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
    return null; // No match - let React Router continue
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
  
  // No match found - let React Router continue to next route
  return null;
};

export default TranslatedRouteMatcher;
