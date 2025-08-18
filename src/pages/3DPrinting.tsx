
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { ArrowRight, CheckCircle, Clock, Layers, Printer, Settings } from 'lucide-react';
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
  return (
    <div className="min-h-screen pt-16">
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
