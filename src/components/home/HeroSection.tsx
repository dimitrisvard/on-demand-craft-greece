import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

interface HeroSectionProps {
  heroImage: string;
}

const HERO_WEBP_BASE = '/lovable-uploads/b17e4baa-4be2-4892-a725-5871867d3dc3';

const HeroSection: React.FC<HeroSectionProps> = ({ heroImage }) => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  const isDefaultHero = heroImage.includes('b17e4baa-4be2-4892-a725-5871867d3dc3');
  return (
    <section className="relative h-screen flex items-center">
      {/* Background Image: <img> with absolute positioning lets the browser pick WebP via <picture>
          and gives Lighthouse a real LCP candidate it can prioritise. */}
      <div className="absolute inset-0 z-0">
        {isDefaultHero ? (
          <picture>
            <source
              type="image/webp"
              srcSet={`${HERO_WEBP_BASE}-800.webp 800w, ${HERO_WEBP_BASE}-1600.webp 1600w`}
              sizes="100vw"
            />
            <img
              src={heroImage}
              alt=""
              // @ts-expect-error fetchpriority is valid HTML
              fetchpriority="high"
              decoding="sync"
              loading="eager"
              className="w-full h-full object-cover"
            />
          </picture>
        ) : (
          <img
            src={heroImage}
            alt=""
            // @ts-expect-error fetchpriority is valid HTML
            fetchpriority="high"
            decoding="sync"
            loading="eager"
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-black/30"></div>
      </div>
      
      <div className="container-custom relative z-10 text-white mt-16">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-extrabold mb-6 tracking-tight leading-tight">
            {t('hero_title', 'Precision CNC Machining For Your Custom Parts')}
          </h1>
          <p className="text-lg md:text-xl mb-10 text-gray-200 max-w-2xl font-light">
            {t('hero_subtitle', 'From prototype to production, our digital manufacturing platform delivers high-quality CNC machining, sheet metal fabrication and custom parts with exceptional precision.')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <Link to={getLocalizedPath('/quote')} className="btn-primary text-lg font-bold px-8 py-4 shadow-lg hover:shadow-xl transition-all">
              {t('hero_get_quote', 'Get an Engineer-Reviewed Quote')}
            </Link>
            <Link to={getLocalizedPath('/services')} className="btn-secondary text-lg px-8 py-4 bg-transparent border-2 border-white text-white hover:bg-white hover:text-gray-900 transition-all">
              {t('hero_explore_services', 'Explore Services')}
            </Link>
          </div>

          {/* Trust Badges */}
          <div className="flex flex-wrap gap-4 sm:gap-6 text-sm sm:text-base font-medium text-white/90">
            <div className="flex items-center gap-2">
              <span>✅</span> Made in EU
            </div>
            <div className="flex items-center gap-2">
              <span>✅</span> ISO 9001:2015 Certified
            </div>
            <div className="flex items-center gap-2">
              <span>✅</span> Direct Factory Pricing
            </div>
          </div>
        </div>
      </div>
      
      <div className="absolute bottom-8 left-0 right-0 mx-auto text-center">
        <a href="#services" className="text-white inline-flex flex-col items-center animate-bounce">
          <span className="mb-2 text-sm font-medium opacity-80">{t('hero_learn_more', 'Scroll for Capabilities')}</span>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </a>
      </div>
    </section>
  );
};

export default HeroSection;
