
import React from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
import SurfaceFinishingHero from './surface-finishes/SurfaceFinishingHero';
import FacilitiesSection from './surface-finishes/FacilitiesSection';
import TreatmentTabs from './surface-finishes/TreatmentTabs';
import WhySection from './surface-finishes/WhySection';
import CTASection from '@/components/CTASection';

const SurfaceFinishes = () => {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen">
      <SEOMeta 
        title={`${t('seo_surface_finishes_title', 'Surface Finishing Services')} | Microns Hub`}
        description={t('seo_surface_finishes_description', 'Comprehensive surface treatment services to enhance appearance, durability, and functionality. Various finishing options to meet your specific requirements.')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
      />
      <SurfaceFinishingHero />
      <FacilitiesSection />
      <TreatmentTabs />
      <WhySection />
      <CTASection />
    </div>
  );
};

export default SurfaceFinishes;
