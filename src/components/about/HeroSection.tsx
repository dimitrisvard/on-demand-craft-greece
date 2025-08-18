import React from 'react';
import { useTranslation } from 'react-i18next';

const HeroSection = () => {
  const { t } = useTranslation();
  return (
    <section className="relative py-24 bg-gray-900">
      <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ 
        backgroundImage: "url('https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1920&q=80')",
      }} />
      
      <div className="container-custom relative z-10 text-white">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold mb-6 break-words text-balance">
            {t('about_hero_title', 'About Microns Hub')}
          </h1>
          <p className="text-lg md:text-xl mb-8 text-white/80 break-words text-balance">
            {t('about_hero_subtitle', "We're on a mission to revolutionize manufacturing in Greece through digital innovation and precision engineering.")}
          </p>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
