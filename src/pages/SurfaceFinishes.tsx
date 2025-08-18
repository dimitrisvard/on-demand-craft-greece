
import React from 'react';
import SurfaceFinishingHero from './surface-finishes/SurfaceFinishingHero';
import FacilitiesSection from './surface-finishes/FacilitiesSection';
import TreatmentTabs from './surface-finishes/TreatmentTabs';
import WhySection from './surface-finishes/WhySection';
import CTASection from '@/components/CTASection';

const SurfaceFinishes = () => {
  return (
    <div className="min-h-screen">
      <SurfaceFinishingHero />
      <FacilitiesSection />
      <TreatmentTabs />
      <WhySection />
      <CTASection />
    </div>
  );
};

export default SurfaceFinishes;
