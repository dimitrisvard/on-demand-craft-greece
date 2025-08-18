
import React from 'react';
import CTASection from '../components/CTASection';
import HeroSection from '../components/about/HeroSection';
import OurStory from '../components/about/OurStory';
import MissionValues from '../components/about/MissionValues';
import QualityAssurance from '../components/about/QualityAssurance';
import FacilitiesSection from '../components/about/FacilitiesSection';

const About = () => {
  return (
    <div className="min-h-screen pt-16">
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
