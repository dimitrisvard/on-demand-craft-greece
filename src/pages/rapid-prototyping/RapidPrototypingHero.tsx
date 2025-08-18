import React from 'react';
import { useTranslation } from 'react-i18next';

const RapidPrototypingHero = () => {
  const { t } = useTranslation();
  return (
    <section className="relative h-[400px] flex items-center justify-center bg-gray-100">
      <img
        src="/lovable-uploads/solidworks-rapid-prototyping.png"
        alt={t('service_rapid-prototyping_hero_image_alt', 'Rapid prototyping in progress')}
        className="absolute inset-0 w-full h-full object-cover opacity-40"
      />
      <div className="relative z-10 text-center">
        <h1 className="text-4xl font-bold mb-4 text-brand-dark">
          {t('service_rapid-prototyping_hero_heading', 'Rapid Prototyping Services')}
        </h1>
        <p className="text-lg text-gray-700">
          {t('service_rapid-prototyping_hero_subheading', 'Accelerate your product development with fast, high-quality prototypes.')}
        </p>
      </div>
    </section>
  );
};

export default RapidPrototypingHero; 