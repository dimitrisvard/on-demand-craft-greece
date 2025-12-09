
import React from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
import CncHero from './cnc/CncHero';
import NetworkSection from './cnc/NetworkSection';
import ServicesOverview from './cnc/ServicesOverview';
import WhatIsCnc from './cnc/WhatIsCnc';
import MaterialsSection from './cnc/MaterialsSection';
import SurfaceTreatments from './cnc/SurfaceTreatments';
import ProductionScale from './cnc/ProductionScale';
import TestimonialsSection from './cnc/TestimonialsSection';
import CaseStudySection from './cnc/CaseStudySection';
import AdvantagesSection from './cnc/AdvantagesSection';
import CTASection from '../components/CTASection';

const CncMachining = () => {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen pt-16">
      <SEOMeta 
        title={`${t('seo_cnc_title', 'CNC Machining Services')} | Microns Hub`}
        description={t('seo_cnc_description', 'Precision CNC machining services for complex parts. Our modern 3-, 4-, and 5-axis CNC machining centers deliver tight tolerances and excellent surface finishes.')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
      />
      <CncHero />
      <NetworkSection />
      <ServicesOverview />
      <WhatIsCnc />
      <MaterialsSection />
      <SurfaceTreatments />
      <ProductionScale />
      <TestimonialsSection />
      <CaseStudySection />
      <AdvantagesSection />
      <CTASection />
    </div>
  );
};

export default CncMachining;
