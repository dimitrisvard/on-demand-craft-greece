
import React from 'react';
import InjectionMoldingHero from './injection-molding/InjectionMoldingHero';
import FacilitiesSection from './injection-molding/FacilitiesSection';
import AdvantagesSection from './injection-molding/AdvantagesSection';
import ProcessesSection from './injection-molding/ProcessesSection';
import DimensionsSection from './injection-molding/DimensionsSection';
import MaterialsSection from './injection-molding/MaterialsSection';
import RefinementSection from './injection-molding/RefinementSection';
import PrototypingSection from './injection-molding/PrototypingSection';
import AdditionalMethodsSection from './injection-molding/AdditionalMethodsSection';
import CaseStudySection from './injection-molding/CaseStudySection';
import CTASection from '../components/CTASection';
import TestimonialsSection from './injection-molding/TestimonialsSection';

const InjectionMolding = () => {
  return (
    <div className="min-h-screen pt-16">
      <InjectionMoldingHero />
      <FacilitiesSection />
      <TestimonialsSection />
      <AdvantagesSection />
      <ProcessesSection />
      <DimensionsSection />
      <MaterialsSection />
      <RefinementSection />
      <PrototypingSection />
      <CaseStudySection />
      <AdditionalMethodsSection />
      <CTASection />
    </div>
  );
};

export default InjectionMolding;
