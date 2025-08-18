import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import ServiceCard from '../ServiceCard';
import { ServiceData, services } from '../../pages/services/data';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const ServicesSection: React.FC = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  console.log('ServicesSection rendered');
  return (
    <section id="services" className="section bg-brand-light">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-brand-dark break-words whitespace-pre-line text-balance">{t('services_section_title', 'Our Manufacturing Services')}</h2>
          <p className="text-lg text-brand-muted break-words whitespace-pre-line text-balance">
            {t('services_section_subtitle', 'We offer comprehensive manufacturing solutions to bring your designs to life with precision and quality.')}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <ServiceCard 
              key={service.id}
              id={service.id}
              iconName={service.icon ? service.icon.displayName || '' : ''}
              link={service.link}
              delay={index * 100}
              image={service.image}
            />
          ))}
        </div>
        
        <div className="text-center mt-12">
          <Link to={getLocalizedPath('/services')} className="btn-primary inline-flex items-center flex-wrap">
            {t('view_all_services', 'View All Services')} <ArrowRight size={16} className="ml-2" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;
