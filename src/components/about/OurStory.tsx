import React from 'react';
import { useTranslation } from 'react-i18next';

const OurStory = () => {
  const { t } = useTranslation();
  return (
    <section className="py-20">
      <div className="container-custom">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">{t('about_our_story_title', 'Our Story')}</h2>
            <p className="text-lg text-gray-600 mb-4">
              {t('about_our_story_p1', 'Microns Hub was founded in 2020 with a vision to transform the manufacturing industry in Greece. We recognized the challenges businesses face when trying to source quality manufacturing services - long lead times, minimum order requirements, and complicated quoting processes.')}
            </p>
            <p className="text-lg text-gray-600 mb-4">
              {t('about_our_story_p2', 'Our team of engineers and manufacturing experts came together to build an on-demand manufacturing platform that leverages digital technology to streamline the entire process from quoting to delivery.')}
            </p>
            <p className="text-lg text-gray-600">
              {t('about_our_story_p3', "Today, we're proud to be Greece's leading on-demand manufacturing platform, connecting businesses of all sizes with high-quality production capabilities while maintaining the precision and craftsmanship that Greek manufacturing is known for.")}
            </p>
          </div>
          
          <div className="relative">
            <div className="aspect-[4/3] rounded-lg overflow-hidden">
              <img 
                src="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&h=600&q=80" 
                alt={t('about_our_story_image_alt', 'Microns Hub Team')}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute -bottom-6 -right-6 bg-white p-4 rounded-lg shadow-lg border border-gray-100 w-48">
              <p className="font-bold text-brand-teal">{t('about_our_story_founded', 'Founded in')}</p>
              <p className="text-4xl font-bold">{t('about_our_story_year', '2020')}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default OurStory;
