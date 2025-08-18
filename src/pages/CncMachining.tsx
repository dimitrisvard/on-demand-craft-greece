
import React from 'react';
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
  return (
    <div className="min-h-screen pt-16">
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
