import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const CncHero = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  return (
    <section className="relative py-24 overflow-hidden">
      <img
        src="/lovable-uploads/200d9297-1d4c-4f58-a7d0-492ec78f506b.png"
        alt={t('service_cnc-machining_hero_image_alt', 'CNC machining in progress')}
        className="absolute inset-0 w-full h-full object-cover"
      />
      
      <div className="container-custom relative z-10 text-white">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 drop-shadow-lg">
            {t('service_cnc-machining_hero_title', 'Precision CNC Machining')}
          </h1>
          <h2 className="text-xl md:text-2xl mb-8 text-white/90 drop-shadow-lg">
            {t('service_cnc-machining_hero_subtitle', 'Versatile milling & turning for complex geometries')}
          </h2>
          <div className="flex flex-wrap gap-4 mb-12">
            <Link to={getLocalizedPath('/quote')} className="btn-secondary">
              {t('service_cnc-machining_hero_get_quote', 'Get a Quote')}
            </Link>
          </div>
          
          <div className="mt-16">
            <div className="flex flex-wrap items-center gap-8 opacity-80">
              {[1, 2, 3, 4, 5].map(num => <div key={num} className="relative group">
                  
                </div>)}
            </div>
          </div>
        </div>
      </div>
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
    </section>
  );
};

export default CncHero;
