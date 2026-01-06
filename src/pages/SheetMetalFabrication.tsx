import React from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
import CTASection from '../components/CTASection';
import SheetMetalHero from './sheetmetal/SheetMetalHero';
import ProcessesSection from './sheetmetal/ProcessesSection';
import MaterialsSection from './sheetmetal/MaterialsSection';
import SpecificationsSection from './sheetmetal/SpecificationsSection';
import AdvantagesSection from './sheetmetal/AdvantagesSection';
import CaseStudySection from './sheetmetal/CaseStudySection';
import TestimonialsSection from './sheetmetal/TestimonialsSection';
import FAQSection from './sheetmetal/FAQSection';

const SheetMetalFabrication = () => {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen pt-16">
      <SEOMeta 
        title={`${t('seo_sheet_metal_title', 'Sheet Metal Fabrication Services')} | Microns Hub`}
        description={t('seo_sheet_metal_description', 'Expert Sheet Metal Processing - Custom solutions tailored to your needs. Precision cutting, bending, and forming services with quick turnaround times.')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
      />
      
      <SheetMetalHero />
      <ProcessesSection />
      <MaterialsSection />
      <SpecificationsSection />
      <AdvantagesSection />
      <CaseStudySection />
      <TestimonialsSection />
      <FAQSection />
      <CTASection />
    </div>
  );
};

export default SheetMetalFabrication;
