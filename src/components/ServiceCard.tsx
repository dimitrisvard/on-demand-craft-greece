import { Link } from 'react-router-dom';
import IconRenderer from './IconRenderer';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

interface ServiceCardProps {
  id: string;
  iconName: string;
  link: string;
  delay?: number;
  image: string;
}

const ServiceCard = ({ id, iconName, link, delay = 0, image }: ServiceCardProps) => {
  const { t, i18n } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  console.log('Current lang:', i18n.language, 'service_cnc-machining_title:', t('service_cnc-machining_title'), 'home_title:', t('home_title'));
  console.log('ServiceCard rendered', id, 'lang:', i18n.language);
  const [imgSrc, setImgSrc] = useState(image);
  const [errorCount, setErrorCount] = useState(0);
  const placeholder = '/placeholder.svg';

  useEffect(() => {
    // Debug: log the image path and try to fetch it
    console.log('ServiceCard image path:', imgSrc);
    fetch(imgSrc)
      .then(res => {
        console.log('Fetch status for', imgSrc, res.status);
      })
      .catch(err => {
        console.error('Fetch error for', imgSrc, err);
      });
  }, [imgSrc]);

  const handleImgError = () => {
    if (errorCount === 0) {
      // Try cache-busting reload
      setImgSrc(image + '?v=' + Date.now());
      setErrorCount(1);
    } else {
      setImgSrc(placeholder);
    }
  };

  return (
    <div 
      className={`bg-white p-6 rounded-lg shadow-lg border border-gray-100 hover:shadow-xl transition-all opacity-0 animate-fade-in`}
      style={{ animationDelay: `${delay}ms`, minWidth: 0 }}
    >
      <div className="aspect-[16/9] rounded-lg overflow-hidden bg-gray-100 shadow-md relative mb-4">
        <img 
          src={imgSrc} 
          alt={t(`service_${id}_title`)}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={handleImgError}
        />
      </div>
      <div className="bg-brand-light inline-flex p-3 rounded-lg text-brand-teal mb-4">
        <IconRenderer name={iconName} size={28} />
      </div>
      <h3 className="text-xl font-bold mb-2 text-brand-dark break-words whitespace-pre-line text-balance">{t(`service_${id}_title`)}</h3>
      <h4>{t('home_title')}</h4>
      <p className="text-gray-600 mb-4 break-words whitespace-pre-line text-balance">{t(`service_${id}_desc`)}</p>
      <Link to={getLocalizedPath(link)} className="text-brand-teal font-medium inline-flex items-center hover:underline flex-wrap">
        {t('learn_more', 'Learn More')}
        <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
};

export default ServiceCard;
