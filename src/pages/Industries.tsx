import React from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
import CTASection from '../components/CTASection';
import IndustryHero from '../components/industries/IndustryHero';
import IndustryDetail from '../components/industries/IndustryDetail';
import FeaturedCaseStudies from '../components/industries/FeaturedCaseStudies';
import { industriesData, featuredCaseStudies } from '../data/industriesData';

// Industry descriptions
const industryDescriptions = {
  aerospace: "We deliver high-precision, lightweight components for the aerospace industry that meet strict safety standards and certification requirements.",
  automotive: "Our automotive manufacturing solutions help deliver quality parts for both traditional and electric vehicles with tight tolerances and excellent surface finishes.",
  "consumer-goods": "We help consumer product companies bring innovations to market with rapid prototyping, design validation, and production-ready parts.",
  education: "Supporting educational institutions with precise components for research, teaching aids, and laboratory equipment.",
  electronics: "We manufacture precision enclosures, heat sinks, and components for electronic devices with excellent thermal and EMI characteristics.",
  energy: "Our manufacturing capabilities support the energy sector with durable components for harsh environments and specialized applications.",
  engineering: "We provide engineering firms with precision machined parts, prototypes and testing fixtures to support their design and development process.",
  "machine-building": "We supply critical components for industrial machinery with tight tolerances and exceptional reliability for continuous operation.",
  medical: "Our medical device manufacturing meets strict quality standards with biocompatible materials and precision tolerances for life-critical applications.",
  robotics: "We produce precision components for robotics and automation systems that require exceptional accuracy and reliability."
};

// Industry applications
const industryApplications = {
  aerospace: ["Aircraft structural components", "Interior fixtures", "Engine components", "Testing equipment"],
  automotive: ["Engine components", "Transmission parts", "Chassis components", "Electric vehicle housings"],
  "consumer-goods": ["Product enclosures", "Functional prototypes", "Production tooling", "Custom fixtures"],
  education: ["Laboratory equipment", "Educational models", "Research prototypes", "Training aids"],
  electronics: ["Enclosures", "Heat sinks", "PCB fixtures", "Testing jigs"],
  energy: ["Valve components", "Solar mounting systems", "Turbine parts", "Connector housings"],
  engineering: ["Test fixtures", "Prototype parts", "Scale models", "Custom tools"],
  "machine-building": ["Gears and transmission components", "Structural frames", "Custom machine parts", "Automation elements"],
  medical: ["Surgical instruments", "Diagnostic equipment parts", "Implant prototypes", "Medical device enclosures"],
  robotics: ["End effectors", "Mechanical joints", "Automation system components", "Sensor mounts"]
};

const Industries = () => {
  const { t } = useTranslation();
  
  return (
    <div className="min-h-screen pt-16">
      <SEOMeta 
        title={`${t('seo_industries_title', 'Industries We Serve')} | Microns Hub`}
        description={t('seo_industries_description', 'Manufacturing solutions for aerospace, automotive, medical, electronics, and more. Precision parts for diverse industries.')}
        keywords={t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts, sheet metal, injection molding')}
      />
      {/* Hero Section */}
      <IndustryHero 
        title={t('industries_hero_title', 'Industries We Serve')}
        description={t('industries_hero_desc', 'Our manufacturing expertise spans diverse industries, providing tailored solutions for specialized applications and unique challenges.')}
        backgroundImage="https://images.unsplash.com/photo-1533073526757-2c8ca1df9f1c?auto=format&fit=crop&w=1920&q=80"
      />

      {/* Industries Section */}
      <section className="py-20">
        <div className="container-custom">
          <div className="space-y-24">
            {industriesData.map((industry, index) => (
              <IndustryDetail 
                key={industry.id}
                {...industry}
                name={t(`industry_${industry.id}`, industry.name)}
                description={t(`industry_${industry.id}_desc`, industryDescriptions[industry.id as keyof typeof industryDescriptions])}
                applications={(() => {
                  const raw = t(`industry_${industry.id}_applications`, undefined, { returnObjects: true });
                  if (Array.isArray(raw)) return raw;
                  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean);
                  return industryApplications[industry.id as keyof typeof industryApplications];
                })()}
                index={index}
              />
            ))}
          </div>
        </div>
      </section>
      
      {/* Case Studies Section */}
      <FeaturedCaseStudies caseStudies={featuredCaseStudies} />

      {/* CTA Section */}
      <CTASection />
    </div>
  );
};

export default Industries;
