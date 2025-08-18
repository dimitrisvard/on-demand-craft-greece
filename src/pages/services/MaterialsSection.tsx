import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const materials = {
  metals: ["Aluminum 6061, 7075", "Steel 1018, 1045", "Stainless Steel 303, 304, 316", "Brass", "Copper", "Titanium"],
  plastics: ["ABS", "Nylon (PA)", "Polycarbonate (PC)", "PEEK", "Acrylic (PMMA)", "Delrin (POM)"],
  specialty: ["Carbon Fiber", "Fiberglass", "PTFE (Teflon)", "Ultem", "Medical-grade Plastics", "Custom Materials"]
};

const MaterialsSection = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  return (
    <section className="py-20">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('services_materials_title', 'Materials We Work With')}</h2>
          <p className="text-lg text-gray-600">
            {t('services_materials_desc', 'We offer a wide range of materials to suit various applications and requirements')}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
            <h3 className="text-xl font-bold mb-4">{t('services_materials_metals', 'Metals')}</h3>
            <ul className="space-y-3">
              {materials.metals.map((material, i) => (
                <li key={i} className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-brand-teal mr-3"></div>
                  {t(`services_materials_metals_${i}`, material)}
                </li>
              ))}
            </ul>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
            <h3 className="text-xl font-bold mb-4">{t('services_materials_plastics', 'Plastics')}</h3>
            <ul className="space-y-3">
              {materials.plastics.map((material, i) => (
                <li key={i} className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-brand-teal mr-3"></div>
                  {t(`services_materials_plastics_${i}`, material)}
                </li>
              ))}
            </ul>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100">
            <h3 className="text-xl font-bold mb-4">{t('services_materials_specialty', 'Specialty Materials')}</h3>
            <ul className="space-y-3">
              {materials.specialty.map((material, i) => (
                <li key={i} className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-brand-teal mr-3"></div>
                  {t(`services_materials_specialty_${i}`, material)}
                </li>
              ))}
            </ul>
          </div>
        </div>
        
        <div className="text-center mt-12">
          <Link to={getLocalizedPath('/materials')} className="text-brand-teal hover:underline inline-flex items-center font-medium">
            {t('services_materials_view_guide', 'View Complete Materials Guide')} <ArrowRight size={16} className="ml-2" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default MaterialsSection;
