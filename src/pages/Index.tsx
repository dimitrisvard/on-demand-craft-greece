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
import MeetYourEngineer from '../components/home/MeetYourEngineer';
import TestimonialsSection from '../components/home/TestimonialsSection';
import IndustriesSection from '../components/home/IndustriesSection';
import HomeContentSections from '../components/home/HomeContentSections';
import FaqAccordion from '../components/content/FaqAccordion';
import TenantLandingPage from './TenantLandingPage';
import { useTenant } from '../contexts/TenantContext';
import { useContentPage } from '../hooks/useContentPage';
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
  const { isTenantSubdomain, isCustomDomain } = useTenant();
  const { data: home, isLoading } = useContentPage('home');

  // Render tenant-specific landing page for subdomains and custom domains
  if (isTenantSubdomain || isCustomDomain) {
    return <TenantLandingPage />;
  }

  // Every language renders the DB-driven layout below the hero once the
  // content_pages.home row loads. If a language row is missing we fall back
  // to the original static composition — useContentPage already handles the
  // EN fallback when a localized row is absent.
  const renderDbSections = !isLoading && home && home.sections.length > 0;

  return (
    <div className="min-h-screen">
      <SEOMeta
        title={home?.title || t('home_title')}
        description={home?.meta_description || t('home_subtitle')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
        ogImage="/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png"
      />
      <HeroSection heroImage={heroImage} />

      {renderDbSections ? (
        <>
          <HomeContentSections sections={home!.sections} />
          {home!.faq.length > 0 && (
            <FaqAccordion items={home!.faq} />
          )}
        </>
      ) : (
        <>
          <TrustedCompanies companies={trustedCompanies} />
          <ServicesSection />
          <HowItWorksSection steps={workflowSteps} />
          <QuoteSection benefits={quoteBenefits} />
          <ComparisonTable />
          <MeetYourEngineer />
          <TestimonialsSection testimonials={testimonials} />
          <IndustriesSection industries={industries} />
          <CTASection />
        </>
      )}
    </div>
  );
};

export default Index;
