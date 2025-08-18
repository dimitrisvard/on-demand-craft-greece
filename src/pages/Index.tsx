import React from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
import CTASection from '../components/CTASection';
import HeroSection from '../components/home/HeroSection';
import TrustedCompanies from '../components/home/TrustedCompanies';
import ServicesSection from '../components/home/ServicesSection';
import HowItWorksSection from '../components/home/HowItWorksSection';
import QuoteSection from '../components/home/QuoteSection';
import ComparisonTable from '../components/home/ComparisonTable';
import TestimonialsSection from '../components/home/TestimonialsSection';
import IndustriesSection from '../components/home/IndustriesSection';
import {
  heroImage,
  trustedCompanies,
  services,
  workflowSteps,
  quoteBenefits,
  testimonials,
  industries
} from '../components/home/data';

const Index = () => {
  const { t } = useTranslation();
  console.log('Index page rendered');
  
  return (
    <div className="min-h-screen">
      <SEOMeta 
        title={t('home_title')}
        description={t('home_subtitle')}
        keywords="CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding"
        ogImage="/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png"
      />
      <HeroSection heroImage={heroImage} />
      <TrustedCompanies companies={trustedCompanies} />
      <ServicesSection />
      <HowItWorksSection steps={workflowSteps} />
      <QuoteSection benefits={quoteBenefits} />
      <ComparisonTable />
      <TestimonialsSection testimonials={testimonials} />
      <IndustriesSection industries={industries} />
      <CTASection />
    </div>
  );
};

export default Index;
