import React from 'react';
import { useTranslation } from 'react-i18next';

const ServicesHero = () => {
  const { t } = useTranslation();
  return (
    <section className="relative py-24 overflow-hidden">
      <img
        src="/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png"
        alt="Manufacturing services"
        className="absolute inset-0 w-full h-full object-cover"
      />
      
      <div className="container-custom relative z-10 text-white">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold mb-6 drop-shadow-lg">
            {t('services_hero_title', 'Manufacturing Services')}
          </h1>
          <p className="text-lg md:text-xl mb-8 text-white/80 drop-shadow-lg">
            {t('services_hero_desc', 'From precision CNC machining to advanced 3D printing, we offer comprehensive manufacturing solutions to turn your designs into reality.')}
          </p>
        </div>
      </div>
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
    </section>
  );
};

export default ServicesHero;
