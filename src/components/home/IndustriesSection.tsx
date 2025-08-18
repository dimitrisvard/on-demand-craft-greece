import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

interface Industry {
  name: string;
  image: string;
  id?: string;
}

interface IndustriesSectionProps {
  industries: Industry[];
}

const IndustriesSection: React.FC<IndustriesSectionProps> = ({ industries }) => {
  const { t, i18n } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  console.log('IndustriesSection rendered, lang:', i18n.language);
  return (
    <section className="section bg-brand-light">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-brand-dark">{t('industries_section_title', 'Industries We Serve')}</h2>
          <p className="text-lg text-brand-muted">
            {t('industries_section_subtitle', 'We provide manufacturing solutions across diverse industries')}
          </p>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {industries.map((industry, index) => (
            <Link 
              key={index} 
              to={getLocalizedPath(`/industries#${industry.id || industry.name.toLowerCase().replace(/\s+/g, '-')}`)}
              className="group relative overflow-hidden rounded-lg transition-all hover:shadow-xl"
            >
              <div className="aspect-[3/2] bg-gray-200">
                <img 
                  src={industry.image} 
                  alt={industry.name} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex items-end p-4 group-hover:bg-gradient-to-t group-hover:from-black/90 transition-all duration-300">
                <h3 className="text-white font-medium group-hover:font-semibold group-hover:transform group-hover:translate-y-[-4px] transition-all duration-300">
                  {t('industry_' + industry.id, industry.name)}
                </h3>
              </div>
            </Link>
          ))}
        </div>
        
        <div className="text-center mt-12">
          <Link to={getLocalizedPath('/industries')} className="btn-primary inline-flex items-center">
            {t('view_all_industries', 'View All Industries')} <ArrowRight size={16} className="ml-2" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default IndustriesSection;
