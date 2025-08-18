import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
export interface IndustryDetailProps {
  id: string;
  name: string;
  description?: string;
  applications?: string[];
  image: string;
  index: number;
}
const IndustryDetail: React.FC<IndustryDetailProps> = ({
  id,
  name,
  description,
  applications,
  image,
  index
}) => {
  const { t } = useTranslation();
  const isEven = index % 2 === 0;
  // Use translation keys for name, description, and applications
  const translatedName = t(`industry_${id}`, name);
  const translatedDescription = t(`industry_${id}_desc`, description || `Our precision manufacturing solutions provide exceptional results for the ${name} industry.`);
  const translatedApplications = (t(`industry_${id}_applications`, undefined, { returnObjects: true }) as string[]) || applications || [
    "Precision components", "Custom parts", "Prototyping services"
  ];
  return <div id={id} className={`grid grid-cols-1 ${isEven ? 'lg:grid-cols-[3fr_2fr]' : 'lg:grid-cols-[2fr_3fr] lg:flex-row-reverse'} gap-12 items-center`}>
      <div>
        <h2 className="text-3xl font-bold mb-6">{translatedName}</h2>
        <p className="text-lg text-gray-600 mb-6">{translatedDescription}</p>
        
        <h3 className="font-bold text-xl mb-4">{t('industry_applications', 'Applications')}</h3>
        <ul className="space-y-3 mb-8">
          {translatedApplications.map((app, i) => <li key={i} className="flex items-start">
              <svg className="w-5 h-5 text-brand-teal mr-2 mt-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{app}</span>
            </li>)}
        </ul>
        
        
      </div>
      
      <div className="rounded-lg overflow-hidden shadow-lg h-[300px]">
        <img src={image} alt={t('industry_image_alt', `${translatedName} industry applications`, { name: translatedName })} className="w-full h-full object-cover" />
      </div>
    </div>;
};
export default IndustryDetail;