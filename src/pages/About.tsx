
import React from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
import CTASection from '../components/CTASection';
import HeroSection from '../components/about/HeroSection';
import OurStory from '../components/about/OurStory';
import MissionValues from '../components/about/MissionValues';
import QualityAssurance from '../components/about/QualityAssurance';
import FacilitiesSection from '../components/about/FacilitiesSection';

const About = () => {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen pt-16">
      <SEOMeta 
        title={`${t('seo_about_title', 'About Us')} | Microns Hub`}
        description={t('seo_about_description', 'Learn about Microns Hub, Greece\'s premier on-demand manufacturing platform. Our story, mission, values, and state-of-the-art facilities.')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
      />
      <HeroSection />
      <OurStory />
      <MissionValues />
      <FacilitiesSection />
      <QualityAssurance />
      <CTASection />
    </div>
  );
};

export default About;
