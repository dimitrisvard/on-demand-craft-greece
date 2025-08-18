import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
const WhySection = () => {
  const { t } = useTranslation();
  return <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-8 text-center">{t('service_surface-finishes_why_heading', 'Where and Why We Use Surface Finishing')}</h2>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Text Content */}
          <Card className="p-6">
            <CardContent className="pt-6 space-y-4 text-gray-700 leading-relaxed">
              <p>
                {t('service_surface-finishes_why_p1', "Surface finishing tailors a part's exterior to boost corrosion protection and lifespan, making it essential for components exposed to harsh environments. Precision coatings and heat treatments increase wear resistance and fatigue strength, reducing maintenance and replacements in critical systems.")}
              </p>
              <p>
                {t('service_surface-finishes_why_p2', "Smooth mechanical finishes like polishing or sandblasting minimize friction for moving parts, ensuring reliable performance in aerospace and automotive applications. Decorative and protective treatments—from painting to plating—also enhance a product's visual appeal and market value.")}
              </p>
            </CardContent>
          </Card>

          {/* Images Grid */}
          <div className="grid grid-cols-1 gap-1">
            <img src="/lovable-uploads/c9444021-f0d1-4e46-9ac9-9d5fef3afde3.png" alt={t('service_surface-finishes_why_image1_alt', 'Surface finishing application in various components')} className="rounded-lg w-full h-48 object-cover" />
            
            <img src="/lovable-uploads/f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png" alt={t('service_surface-finishes_why_image2_alt', 'Precision coating application')} className="rounded-lg object-cover w-full h-48 col-span-2" />
          </div>
        </div>
      </div>
    </section>;
};
export default WhySection;