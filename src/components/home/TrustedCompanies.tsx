import React from 'react';
import { useTranslation } from 'react-i18next';
import IconRenderer from '../IconRenderer';
import OptimizedImage from '../OptimizedImage';

interface Company {
  name: string;
  icon?: string;
  image?: string;
  industry: string;
  translationKey?: string;
}

interface TrustedCompaniesProps {
  companies: Company[];
}

const TrustedCompanies: React.FC<TrustedCompaniesProps> = ({ companies }) => {
  const { t } = useTranslation();
  
  return (
    <section className="bg-white py-16">
      <div className="container-custom">
        <p className="text-center text-gray-500 mb-12 font-medium uppercase tracking-wider">{t('trusted_by_companies', 'Trusted by industry-leading companies')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8 w-full">
          {companies.map((company, i) => (
            <div key={i} className="flex flex-col items-center group w-full">
              <div className="w-full aspect-[4/3] overflow-hidden rounded-xl shadow-md hover:shadow-xl transition-all duration-300 bg-gray-50">
                {company.image ? (
                  <OptimizedImage
                    src={company.image}
                    alt={company.translationKey ? t(company.translationKey) : company.name}
                    width={400}
                    height={300}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-8">
                    {company.icon && <IconRenderer iconName={company.icon} className="w-16 h-16 text-primary/80" />}
                  </div>
                )}
              </div>
              <p className="text-lg md:text-xl text-center font-bold text-gray-900 mt-4 group-hover:text-primary transition-colors">
                {company.translationKey ? t(company.translationKey) : company.name}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustedCompanies;
