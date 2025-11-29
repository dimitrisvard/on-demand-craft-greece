import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

interface QuoteBenefitItem {
  text: string;
}

interface QuoteSectionProps {
  benefits: QuoteBenefitItem[];
}

const QuoteSection: React.FC<QuoteSectionProps> = ({ benefits }) => {
  const { t, i18n } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  console.log('QuoteSection rendered, lang:', i18n.language);
  
  return (
    <section className="bg-gray-100 section">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('quote_section_title', 'Get A Quote in 24 hours For Your Project')}</h2>
          <p className="text-lg text-gray-600 mb-8">
            {t('quote_section_subtitle', 'Upload your CAD files and receive a detailed quote for your manufacturing project within 24 hours. Our platform supports all major file formats including STL, STEP, IGES, and more.')}
          </p>
          
          <ul className="space-y-4 mb-10 max-w-lg mx-auto text-left">
            {benefits.map((item, index) => (
              <li key={index} className="flex items-center">
                <CheckCircle size={20} className="text-brand-teal mr-2 shrink-0" />
                <span>{t(`quote_benefit_${index+1}`, item.text)}</span>
              </li>
            ))}
          </ul>
          
          <div className="flex flex-col items-center gap-6">
            <Link to={getLocalizedPath('/quote')} className="btn-primary inline-flex items-center justify-center w-full sm:w-auto px-8 py-4 text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300">
              {t('quote_section_button', 'Get Your Quote Now')} <ArrowRight size={20} className="ml-2" />
            </Link>
            
            <div className="flex items-center gap-3 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-900 px-6 py-3 rounded-xl border border-blue-200 shadow-md animate-fade-in">
              <ShieldCheck size={24} className="text-blue-600 shrink-0" />
              <div className="flex flex-col items-start">
                <span className="text-base font-bold">Made in EU 🇪🇺 | Tax-Free Shipping within Europe</span>
                <span className="text-xs font-medium text-blue-700 uppercase tracking-wider">No Customs • No Import Duties • Fast Delivery</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default QuoteSection;
