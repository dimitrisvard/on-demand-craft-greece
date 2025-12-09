
import React from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
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
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen pt-16">
      <SEOMeta 
        title={`${t('seo_injection_molding_title', 'Injection Molding Services')} | Microns Hub`}
        description={t('seo_injection_molding_description', 'Cost-effective injection molding for mass production of plastic parts. Tool design, manufacturing, and production with consistent quality.')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
      />
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
