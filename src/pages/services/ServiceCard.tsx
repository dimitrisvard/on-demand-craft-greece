import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ServiceData } from './data';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

interface ServiceCardProps {
  service: ServiceData;
  isReversed?: boolean;
}

const ServiceCard: React.FC<ServiceCardProps> = ({ service, isReversed = false }) => {
  const Icon = service.icon;
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  
  return (
    <div 
      id={service.id}
      className={`grid grid-cols-1 ${isReversed ? 'lg:grid-cols-[3fr_2fr] lg:flex-row-reverse' : 'lg:grid-cols-[2fr_3fr]'} gap-8 lg:gap-16 items-center`}
    >
      <div className="aspect-[16/9] rounded-lg overflow-hidden bg-gray-100 shadow-md relative">
        {!imageError ? (
          <img 
            src={service.image} 
            alt={service.title}
            className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => {
              console.log(`Image loaded successfully: ${service.image}`);
              setImageLoaded(true);
            }}
            onError={(e) => {
              console.error(`Failed to load image: ${service.image}`);
              setImageError(true);
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-200">
            <span className="text-gray-500">Image not available</span>
          </div>
        )}
        
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-brand-teal border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>
      
      <div>
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg bg-brand-light text-brand-teal mb-6">
          {Icon ? <Icon size={36} /> : <div className="w-9 h-9" />}
        </div>
        <h2 className="text-3xl font-bold mb-4">{t(`service_${service.id}_title`, '')}</h2>
        <p className="text-lg text-gray-600 mb-6">{t(`service_${service.id}_desc`, '')}</p>
        
        <h3 className="font-bold text-xl mb-3">{t('service_capabilities', 'Capabilities:')}</h3>
        <ul className="space-y-2 mb-6">
          {service.capabilities.map((capability, i) => (
            <li key={i} className="flex items-start">
              <svg className="w-5 h-5 text-brand-teal mr-2 mt-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{t(`service_${service.id}_capability_${i+1}`, capability)}</span>
            </li>
          ))}
        </ul>
        
        <Link to={getLocalizedPath(service.link)} className="inline-flex items-center text-brand-teal font-medium hover:underline">
          {t('service_learn_more', 'Learn more about')} {t(`service_${service.id}_title`, '')} <ArrowRight size={16} className="ml-2" />
        </Link>
      </div>
    </div>
  );
};

export default ServiceCard;
