import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CaseStudyCard, { CaseStudyProps } from './CaseStudyCard';
interface FeaturedCaseStudiesProps {
  caseStudies: CaseStudyProps[];
}
const FeaturedCaseStudies: React.FC<FeaturedCaseStudiesProps> = ({
  caseStudies
}) => {
  const { t } = useTranslation();
  return <section className="py-20 bg-gray-50">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('industries_featured_case_studies_title', 'Featured Case Studies')}</h2>
          <p className="text-lg text-gray-600">
            {t('industries_featured_case_studies_desc', "See how we've helped companies across industries solve their manufacturing challenges")}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {caseStudies.map(caseStudy => <CaseStudyCard key={caseStudy.id} {...caseStudy} />)}
        </div>
        
        <div className="text-center mt-12">
          
        </div>
      </div>
    </section>;
};
export default FeaturedCaseStudies;