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
          
          <div className="flex flex-col items-center gap-4">
            <Link to={getLocalizedPath('/quote')} className="btn-primary inline-flex items-center justify-center w-full sm:w-auto">
              {t('quote_section_button', 'Get Your Quote Now')} <ArrowRight size={18} className="ml-2" />
            </Link>
            
            <div className="flex items-center gap-2 bg-blue-50 text-blue-800 px-4 py-2 rounded-full border border-blue-100 shadow-sm animate-fade-in">
              <ShieldCheck size={18} className="text-blue-600" />
              <span className="text-sm font-semibold">Made in EU 🇪🇺 | Tax-Free Shipping within Europe</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default QuoteSection;
