import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const clientLogos = [
  {
    name: "Client 1",
    image: "/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png"
  },
  {
    name: "Client 2",
    image: "/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png"
  },
  {
    name: "Client 3",
    image: "/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png"
  },
  {
    name: "Client 4",
    image: "/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png"
  },
  {
    name: "Client 5",
    image: "/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png"
  },
  {
    name: "Client 6",
    image: "/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png"
  }
];

const PrintingHero = () => {
  const { t } = useTranslation();
  return (
    <section className="relative py-24 overflow-hidden">
      <img
        src="/lovable-uploads/59f13e48-0a66-4e3a-a3c3-e9db4fa53d08.png"
        alt={t('service_3d-printing_hero_image_alt', '3D printing in process')}
        className="absolute inset-0 w-full h-full object-cover"
      />
      
      <div className="container-custom relative z-10 text-white">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 drop-shadow-lg">
            {t('service_3d-printing_hero_title', '3D Printed Parts – Order Easily Online')}
          </h1>
          <h2 className="text-xl md:text-2xl mb-8 text-white/90 drop-shadow-lg">
            {t('service_3d-printing_hero_subtitle', 'Additive Manufacturing for Prototypes and Series')}
          </h2>
          <div className="flex flex-wrap gap-4 mb-12">
            
          </div>
          
          {/* Client Logos Carousel */}
          
        </div>
      </div>
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
    </section>
  );
};

export default PrintingHero;
