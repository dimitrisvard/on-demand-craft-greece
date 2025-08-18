import React from 'react';
import CTASection from '../components/CTASection';
import PrototypingSection from './injection-molding/PrototypingSection';
import { useTranslation } from 'react-i18next';

const RapidPrototypingHero = () => {
  const { t } = useTranslation();
  return (
    <section className="relative py-24 overflow-hidden">
      <img
        src="/lovable-uploads/solidworks-rapid-prototyping.png"
        alt="Rapid Prototyping Hero"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="container-custom relative z-10 text-white">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 drop-shadow-lg">
            {t('service_rapid-prototyping_hero_title', 'Rapid Prototyping')}
          </h1>
          <h2 className="text-xl md:text-2xl mb-8 text-white/90 drop-shadow-lg">
            {t('service_rapid-prototyping_hero_subtitle', 'Accelerate your product development with fast, flexible prototyping solutions')}
          </h2>
        </div>
      </div>
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
    </section>
  );
};

const RapidPrototyping = () => {
  return (
    <div className="min-h-screen pt-16">
      <RapidPrototypingHero />
      <PrototypingSection />
      <CTASection />
    </div>
  );
};

export default RapidPrototyping; 