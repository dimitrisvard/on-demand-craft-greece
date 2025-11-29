import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plane, Car, Stethoscope, Bot } from 'lucide-react';
import IconRenderer from '../IconRenderer';

interface Company {
  name: string;
  icon?: string;
  industry: string;
  translationKey?: string;
}

interface TrustedCompaniesProps {
  companies: Company[];
}

const TrustedCompanies: React.FC<TrustedCompaniesProps> = ({ companies }) => {
  const { t } = useTranslation();
  
  return (
    <section className="bg-gray-100 py-12">
      <div className="container-custom">
        <p className="text-center text-gray-500 mb-8 font-medium">{t('trusted_by_companies', 'Trusted by industry-leading companies')}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 justify-items-center items-center">
          {companies.map((company, i) => (
            <div key={i} className="flex flex-col items-center group transition-transform hover:scale-105 duration-300">
              <div className="h-24 w-24 lg:h-28 lg:w-28 bg-white rounded-full shadow-sm flex items-center justify-center text-primary mb-3 border-2 border-transparent group-hover:border-primary/10">
                {company.icon && <IconRenderer iconName={company.icon} className="w-10 h-10 md:w-12 md:h-12" />}
              </div>
              <p className="text-sm md:text-base text-center font-semibold text-gray-800 mt-2">
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
