import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

interface HeroSectionProps {
  heroImage: string;
}

const HeroSection: React.FC<HeroSectionProps> = ({ heroImage }) => {
  const { t, i18n } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  console.log('HeroSection language:', i18n.language, 'hero_title:', t('hero_title'));
  return (
    <section className="relative h-screen flex items-center">
      {/* Background Image */}
      <div className="absolute inset-0 bg-cover bg-center z-0" style={{ 
        backgroundImage: `url(${heroImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}>
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
