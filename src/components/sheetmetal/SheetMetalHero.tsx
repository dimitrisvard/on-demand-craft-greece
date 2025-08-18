
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

const SheetMetalHero = () => {
  const { getLocalizedPath } = useLanguage();
  
  return (
    <section className="relative">
      <div className="absolute inset-0 z-0">
        <img
          src="/lovable-uploads/f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png"
          alt="Sheet Metal Fabrication Process"
          className="w-full h-full object-cover opacity-60"
        />
      </div>
      
      <div className="container-custom relative z-10 py-20 md:py-32">
        <div className="max-w-4xl">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 animate-fade-in text-white">
            Sheet Metal Processing
          </h1>
          
          <Link to={getLocalizedPath('/quote')}>
            <Button size="lg" className="bg-brand-accent hover:bg-brand-accent/90 text-white">
              Get a Quote
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default SheetMetalHero;
