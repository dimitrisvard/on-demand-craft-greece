import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const InjectionMoldingHero = () => {
  const { t } = useTranslation();
  // Sample client logos for the carousel
  const clientLogos = [{
    name: 'Client 1',
    logo: '/lovable-uploads/f1bcd6bc-2981-44d4-85e5-03d3873eeeb9.png'
  }, {
    name: 'Client 2',
    logo: '/lovable-uploads/3039d310-f098-41d9-bd6d-f0bbd96cd6d0.png'
  }, {
    name: 'Client 3',
    logo: '/lovable-uploads/719284b6-0e9d-45f4-9e4f-08da2200b964.png'
  }, {
    name: 'Client 4',
    logo: '/lovable-uploads/5927e3e8-dd8a-4a30-bd15-a8e34ef43439.png'
  }, {
    name: 'Client 5',
    logo: '/lovable-uploads/e518498a-a91f-4cbe-857f-ccbead46b1b0.png'
  }];
  
  return <section className="relative bg-cover bg-center h-[500px] flex items-center text-white" style={{
    backgroundImage: "url('/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png')",
    backgroundPosition: "center",
    backgroundSize: "cover",
    backgroundRepeat: "no-repeat"
  }}>
      <div className="absolute inset-0 bg-black opacity-60" />
      <div className="container-custom relative z-10">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t('service_injection-molding_hero_title', 'Injection Molded Parts – Order Easily Online')}
          </h1>
          <h2 className="text-xl md:text-2xl mb-8 text-gray-200">
            {t('service_injection-molding_hero_subtitle', 'Shaping for Your Series Production')}
          </h2>
          
        </div>
        {/* Client Logo Carousel */}
        <div className="mt-12">
          <div className="flex flex-wrap gap-6 items-center">
            {clientLogos.map((client, index) => (
              <div key={index} className="bg-white/90 p-3 rounded-lg">
                <img 
                  src={client.logo} 
                  alt={client.name} 
                  className="h-12 w-auto object-contain" 
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>;
};

export default InjectionMoldingHero;
