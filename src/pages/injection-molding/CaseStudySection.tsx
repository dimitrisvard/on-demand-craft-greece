import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const caseStudies = [
  { key: 'service_injection-molding_case_1', default: 'Automotive Sensor Housing' },
  { key: 'service_injection-molding_case_2', default: 'Medical Device Enclosure' },
  { key: 'service_injection-molding_case_3', default: 'Consumer Electronics Shell' },
];

const CaseStudySection = () => {
  const { t } = useTranslation();
  return <section className="py-16 bg-white">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">{t('service_injection-molding_case_heading', 'Case Studies')}</h2>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="rounded-lg overflow-hidden shadow-lg">
            <img alt="Automotive component case study" className="w-full h-auto object-cover" src="/lovable-uploads/881fc5f0-0bb2-4644-b382-38f7fc40cdfb.png" />
          </div>
          
          <div>
            <h3 className="text-2xl font-bold mb-3">{t(caseStudies[0].key, caseStudies[0].default)}</h3>
            <p className="text-gray-600 mb-2">{t(`${caseStudies[0].key}_client`, 'Client: Leading Automotive Supplier')}</p>
            <p className="text-gray-800 mb-6">
              {t(`${caseStudies[0].key}_desc`, 'A major automotive supplier needed to redesign a complex interior trim component to reduce weight while maintaining structural integrity. The part had to withstand temperature fluctuations and meet strict quality standards.')}
            </p>
            
            <h4 className="font-bold text-lg mb-2">{t('service_injection-molding_case_approach', 'Our Approach:')}</h4>
            <ul className="list-disc pl-5 mb-6 space-y-1">
              <li>{t(`${caseStudies[0].key}_approach_material`, 'Material selection: Switched from ABS to a glass-filled polypropylene composite')}</li>
              <li>{t(`${caseStudies[0].key}_approach_redesign`, 'Redesigned part with optimized wall thickness and ribbing structure')}</li>
              <li>{t(`${caseStudies[0].key}_approach_rapid`, 'Created rapid prototype tools for testing and validation')}</li>
              <li>{t(`${caseStudies[0].key}_approach_specialized`, 'Developed specialized post-processing for Class A surface finish')}</li>
            </ul>
            
            <h4 className="font-bold text-lg mb-2">{t('service_injection-molding_case_results', 'Results:')}</h4>
            <ul className="list-disc pl-5 mb-6 space-y-1">
              <li>{t(`${caseStudies[0].key}_result_weight`, '30% weight reduction')}</li>
              <li>{t(`${caseStudies[0].key}_result_cost`, '15% cost savings in materials')}</li>
              <li>{t(`${caseStudies[0].key}_result_temperature`, 'Improved temperature resistance')}</li>
              <li>{t(`${caseStudies[0].key}_result_implementation`, 'Successful implementation across multiple vehicle models')}</li>
            </ul>
            
            <Button className="mt-4 flex items-center gap-2">
              {t('service_injection-molding_case_read_full', 'Read Full Case Study')} <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </div>
    </section>;
};

export default CaseStudySection;
