import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const ServicesOverview = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  const services = [
    t('service_cnc-machining_services_1', '3-axis & 5-axis milling'),
    t('service_cnc-machining_services_2', 'CNC turning'),
    t('service_cnc-machining_services_3', 'Sheet-metal forming'),
    t('service_cnc-machining_services_4', 'Surface treatments'),
    t('service_cnc-machining_services_5', 'Prototyping & mass production'),
  ];
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-8 text-center">{t('service_cnc-machining_services_heading', 'Our CNC Machining Services')}</h2>
          
          <ul className="space-y-4 mb-12">
            {services.map((service, index) => (
              <li key={index} className="flex items-start">
                <CheckCircle size={20} className="text-brand-teal mt-0.5 mr-3 shrink-0" />
                <span className="text-lg">{service}</span>
              </li>
            ))}
          </ul>
          
          <div className="text-center mt-8">
            <Link to={getLocalizedPath('/quote')} className="btn-primary inline-flex items-center">
              {t('service_cnc-machining_services_get_quote', 'Get a Quote')}
              <ArrowRight size={16} className="ml-2" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ServicesOverview;
