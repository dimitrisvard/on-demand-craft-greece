import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
export interface CaseStudyProps {
  id: string;
  title: string;
  client: string;
  industry: string;
  image: string;
  description: string;
  challenge?: string;
  solution?: string;
  results?: string;
}
const CaseStudyCard: React.FC<CaseStudyProps> = ({
  id,
  title,
  client,
  industry,
  image,
  description,
  challenge,
  solution,
  results
}) => {
  const { t } = useTranslation();
  return <div className="bg-white rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-shadow duration-300">
      <div className="aspect-[16/9] bg-gray-200">
        <img src={image} alt={t(`case_${id}_title`, title)} className="w-full h-full object-cover" />
      </div>
      <div className="p-6">
        <span className="inline-block px-3 py-1 text-sm font-medium text-brand-teal bg-brand-teal/10 rounded-full mb-4">
          {t(`industry_${industry}`, industry.charAt(0).toUpperCase() + industry.slice(1))}
        </span>
        <h3 className="text-xl font-bold mb-2">{t(`case_${id}_title`, title)}</h3>
        <p className="text-sm text-gray-500 mb-3">{t('case_client', 'Client')}: {t(`case_${id}_client`, client)}</p>
        <p className="text-gray-600 mb-4 line-clamp-3">{t(`case_${id}_description`, description)}</p>
        {challenge && <p className="text-gray-600 mb-2"><b>{t('case_challenge', 'Challenge')}:</b> {t(`case_${id}_challenge`, challenge)}</p>}
        {solution && <p className="text-gray-600 mb-2"><b>{t('case_solution', 'Solution')}:</b> {t(`case_${id}_solution`, solution)}</p>}
        {results && <p className="text-gray-600 mb-2"><b>{t('case_results', 'Results')}:</b> {t(`case_${id}_results`, results)}</p>}
      </div>
    </div>;
};
export default CaseStudyCard;