
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
import CTASection from '../components/CTASection';
import ServicesHero from './services/ServicesHero';
import ServiceCard from './services/ServiceCard';
import ProcessSection from './services/ProcessSection';
import MaterialsSection from './services/MaterialsSection';
import { services } from './services/data';
import { toast } from '@/components/ui/use-toast';

const Services = () => {
  const { t } = useTranslation();
  const [imagesPreloaded, setImagesPreloaded] = useState(false);

  // Preload images to ensure they're ready when needed
  useEffect(() => {
    let loadedCount = 0;
    const totalImages = services.length;
    
    services.forEach(service => {
      const img = new Image();
      img.onload = () => {
        console.log(`Preloading image: ${service.image}`);
        loadedCount++;
        if (loadedCount === totalImages) {
          setImagesPreloaded(true);
        }
      };
      img.onerror = () => {
        console.error(`Failed to preload image: ${service.image}`);
        loadedCount++;
        if (loadedCount === totalImages) {
          setImagesPreloaded(true);
          toast({
            title: "Some images failed to load",
            description: "We're working to fix this issue.",
            variant: "destructive"
          });
        }
      };
      img.src = service.image;
    });
  }, []);

  return (
    <div className="min-h-screen pt-16">
      <SEOMeta 
        title={`${t('seo_services_title', 'Manufacturing Services')} | Microns Hub`}
        description={t('seo_services_description', 'Comprehensive manufacturing solutions including CNC machining, 3D printing, sheet metal fabrication, injection molding, and more. Get your parts manufactured with precision and quality.')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
      />
      <ServicesHero />
      
      <section className="py-20">
        <div className="container-custom">
          <div className="space-y-20">
            {services.map((service, index) => (
              <ServiceCard
                key={service.id}
                service={service}
                isReversed={index % 2 !== 0}
              />
            ))}
          </div>
        </div>
      </section>

      <ProcessSection />
      <MaterialsSection />
      <CTASection />
    </div>
  );
};

export default Services;
