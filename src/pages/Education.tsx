import React from 'react';
import { useTranslation } from 'react-i18next';
import SEOMeta from '../components/SEOMeta';
import EduHero from '../components/education/EduHero';
import EduTiers from '../components/education/EduTiers';
import EduServices from '../components/education/EduServices';
import EduBenefits from '../components/education/EduBenefits';
import EduUniversities from '../components/education/EduUniversities';
import EduHowItWorks from '../components/education/EduHowItWorks';
import EduCaseStudies from '../components/education/EduCaseStudies';
import EduKnowledgeHub from '../components/education/EduKnowledgeHub';
import EduFAQ from '../components/education/EduFAQ';
import EduContactCTA from '../components/education/EduContactCTA';

const Education: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen pt-16">
      <SEOMeta
        title={t(
          'seo_education_title',
          'Education & University Partnerships | Microns Hub — Precision Manufacturing for Students'
        )}
        description={t(
          'seo_education_description',
          '10-15% educational discount on CNC machining, 3D printing, and sheet metal fabrication for European universities, Formula Student teams, and research labs. Upload your CAD → get your parts in days.'
        )}
        keywords={t(
          'seo_education_keywords',
          'CNC machining student discount, university manufacturing partner, Formula Student parts, 3D printing educational discount, engineering student manufacturing, precision parts Europe, university sponsorship manufacturing'
        )}
      />

      <EduHero />
      <EduTiers />
      <EduServices />
      <EduBenefits />
      <EduUniversities />
      <EduHowItWorks />
      <EduCaseStudies />
      <EduKnowledgeHub />
      <EduFAQ />
      <EduContactCTA />
    </div>
  );
};

export default Education;
