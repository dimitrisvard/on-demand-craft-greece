import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const processSteps = [
  {
    key: 'design_analysis',
    step: '01'
  },
  {
    key: 'material_selection',
    step: '02'
  },
  {
    key: 'manufacturing',
    step: '03'
  },
  {
    key: 'quality_inspection',
    step: '04'
  }
];

const ProcessSection = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  return (
    <section className="py-20 bg-gray-50">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('services_process_title', 'Our Manufacturing Process')}</h2>
          <p className="text-lg text-gray-600">
            {t('services_process_desc', 'We follow a streamlined process to ensure quality, efficiency, and on-time delivery')}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {processSteps.map((item, i) => (
            <div key={i} className="relative p-6 bg-white rounded-lg shadow-md border border-gray-100">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-brand-teal text-white rounded-full flex items-center justify-center font-bold">
                {item.step}
              </div>
              <h3 className="text-xl font-bold mb-3 mt-4">{t(`services_process_step_${item.key}_title`, item.key.replace('_', ' '))}</h3>
              <p className="text-gray-600">{t(`services_process_step_${item.key}_desc`, '')}</p>
            </div>
          ))}
        </div>
        
        <div className="text-center mt-12">
          <Link to={getLocalizedPath('/how-it-works')} className="btn-primary inline-flex items-center">
            {t('services_process_view_detailed', 'View Detailed Process')} <ArrowRight size={16} className="ml-2" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default ProcessSection;
