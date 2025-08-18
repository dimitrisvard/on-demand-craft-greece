import React from 'react';
import { useTranslation } from 'react-i18next';

interface Company {
  name: string;
  logo: string;
  industry: string;
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 justify-items-center items-center">
          {companies.map((company, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="h-20 w-36 lg:h-24 lg:w-40 bg-white p-3 rounded-md shadow-sm flex items-center justify-center">
                <img 
                  src={company.logo} 
                  alt={company.name} 
                  className="w-full h-full object-contain" 
                />
              </div>
              <p className="text-xs text-center font-medium text-gray-600 mt-2">{company.name}</p>
              <p className="text-xs text-center text-gray-400">{t('industry_' + company.industry.toLowerCase().replace(/\s+/g, '_'), company.industry)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustedCompanies;
