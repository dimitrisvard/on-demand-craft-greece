import { Link } from 'react-router-dom';
import IconRenderer from './IconRenderer';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';
import OptimizedImage from './OptimizedImage';

interface ServiceCardProps {
  id: string;
  iconName: string;
  link: string;
  delay?: number;
  image: string;
}

const ServiceCard = ({ id, iconName, link, delay = 0, image }: ServiceCardProps) => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  const [imgSrc, setImgSrc] = useState(image);
  const placeholder = '/placeholder.svg';

  const handleImgError = () => {
    if (imgSrc !== placeholder) setImgSrc(placeholder);
  };

  return (
    <div
      className={`bg-white p-6 rounded-lg shadow-lg border border-gray-100 hover:shadow-xl transition-all opacity-0 animate-fade-in`}
      style={{ animationDelay: `${delay}ms`, minWidth: 0 }}
    >
      <div className="aspect-[16/9] rounded-lg overflow-hidden bg-gray-100 shadow-md relative mb-4">
        <OptimizedImage
          src={imgSrc}
          alt={t(`service_${id}_title`)}
          width={450}
          height={253}
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="w-full h-full object-cover"
          onError={handleImgError}
        />
      </div>
      <div className="bg-brand-light inline-flex p-3 rounded-lg text-brand-teal mb-4">
        <IconRenderer name={iconName} size={28} />
      </div>
      <h3 className="text-xl font-bold mb-2 text-brand-dark break-words whitespace-pre-line text-balance">{t(`service_${id}_title`)}</h3>
      {/* Description removed for cleaner look */}
      <Link to={getLocalizedPath(link)} className="mt-4 w-full block text-center bg-brand-primary text-white font-bold py-3 rounded hover:bg-brand-dark transition-colors">
        {t('get_quote_for', 'Get Quote for')} {t(`service_${id}_title`)}
      </Link>
    </div>
  );
};

export default ServiceCard;
