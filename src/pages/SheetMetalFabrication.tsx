import React from 'react';
import { Helmet } from 'react-helmet';
import CTASection from '../components/CTASection';
import SheetMetalHero from './sheetmetal/SheetMetalHero';
import ProcessesSection from './sheetmetal/ProcessesSection';
import MaterialsSection from './sheetmetal/MaterialsSection';
import SpecificationsSection from './sheetmetal/SpecificationsSection';
import AdvantagesSection from './sheetmetal/AdvantagesSection';
import CaseStudySection from './sheetmetal/CaseStudySection';
import TestimonialsSection from './sheetmetal/TestimonialsSection';

const SheetMetalFabrication = () => {
  return (
    <div className="min-h-screen pt-16">
      <Helmet>
        <title>Sheet Metal Fabrication Services | Microns Hub</title>
        <meta 
          name="description" 
          content="Expert Sheet Metal Processing - Custom solutions tailored to your needs. Precision cutting, bending, and forming services with quick turnaround times."
        />
      </Helmet>
      
      <SheetMetalHero />
      <ProcessesSection />
      <MaterialsSection />
      <SpecificationsSection />
      <AdvantagesSection />
      <CaseStudySection />
      <TestimonialsSection />
      <CTASection />
    </div>
  );
};

export default SheetMetalFabrication;
