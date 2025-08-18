import React from 'react';
import { useTranslation } from 'react-i18next';

const SurfaceFinishingHero = () => {
  const { t } = useTranslation();
  return (
    <section className="relative h-[400px] flex items-center justify-center bg-gray-100">
      <img
        src="/lovable-uploads/solidworks-rapid-prototyping.png"
        alt={t('service_surface-finishes_hero_image_alt', 'Surface finishing in progress')}
        className="absolute inset-0 w-full h-full object-cover opacity-40"
      />
      <div className="relative z-10 text-center">
        <h1 className="text-4xl font-bold mb-4 text-brand-dark">
          {t('service_surface-finishes_hero_heading', 'Surface Finishing Services')}
        </h1>
        <p className="text-lg text-gray-700 mb-2">
          {t('service_surface-finishes_hero_offer', 'We offer these (and more) surface treatments')}
        </p>
        <p className="text-lg text-gray-700">
          {t('service_surface-finishes_hero_subheading', 'Enhance the appearance and performance of your parts.')}
        </p>
      </div>
    </section>
  );
};

export default SurfaceFinishingHero;
