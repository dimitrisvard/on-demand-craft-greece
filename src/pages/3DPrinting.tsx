
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { ArrowRight, CheckCircle, Clock, Layers, Printer, Settings } from 'lucide-react';
import SEOMeta from '../components/SEOMeta';
import CTASection from '../components/CTASection';
import PrintingHero from './printing/PrintingHero';
import NetworkSection from './printing/NetworkSection';
import TestimonialsSection from './printing/TestimonialsSection';
import SpecsSection from './printing/SpecsSection';
import WhatIsPrinting from './printing/WhatIsPrinting';
import ProcessesSection from './printing/ProcessesSection';
import MaterialsSection from './printing/MaterialsSection';
import ProductionScale from './printing/ProductionScale';
import CaseStudySection from './printing/CaseStudySection';
import AdvantagesSection from './printing/AdvantagesSection';
import ResourcesSection from './printing/ResourcesSection';

const ThreeDPrinting = () => {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen pt-16">
      <SEOMeta 
        title={`${t('seo_3d_printing_title', '3D Printing Services')} | Microns Hub`}
        description={t('seo_3d_printing_description', 'Professional 3D printing services for rapid prototyping and production. Industrial-grade 3D printers for functional prototypes and end-use products.')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
      />
      <PrintingHero />
      <NetworkSection />
      <TestimonialsSection />
      <SpecsSection />
      <WhatIsPrinting />
      <ProcessesSection />
      <MaterialsSection />
      <ProductionScale />
      <CaseStudySection />
      <AdvantagesSection />
      <ResourcesSection />
      <CTASection />
    </div>
  );
};

export default ThreeDPrinting;
