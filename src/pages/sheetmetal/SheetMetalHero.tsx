import React from 'react';
import { useTranslation } from 'react-i18next';

const SheetMetalHero = () => {
  const { t } = useTranslation();
  return (
    <section className="relative h-[400px] flex items-center justify-center bg-gray-100">
      <img
        src="/lovable-uploads/f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png"
        alt={t('service_sheet-metal_hero_image_alt', 'Sheet metal fabrication in progress')}
        className="absolute inset-0 w-full h-full object-cover opacity-40"
      />
      <div className="relative z-10 text-center">
        <h1 className="text-4xl font-bold mb-4 text-brand-dark">
          {t('service_sheet-metal_hero_heading', 'Sheet Metal Fabrication')}
        </h1>
        <p className="text-lg text-gray-700">
          {t('service_sheet-metal_hero_subheading', 'Precision sheet metal parts for prototypes and production.')}
        </p>
      </div>
    </section>
  );
};

export default SheetMetalHero; 