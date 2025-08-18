import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/contexts/LanguageContext';

const serviceRangeItems = [
  'service_3d-printing_specs_range_1',
  'service_3d-printing_specs_range_2',
  'service_3d-printing_specs_range_3',
  'service_3d-printing_specs_range_4',
];

const specifications = [
  { name: 'service_3d-printing_specs_min_dimensions', value: '3 × 3 × 3 mm' },
  { name: 'service_3d-printing_specs_max_dimensions', value: '1000 × 1000 × 1000 mm' },
  { name: 'service_3d-printing_specs_wall_thickness', value: 'from 0.2 mm' },
  { name: 'service_3d-printing_specs_quantity', value: 'from 1 pc' }
];

const SpecsSection = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  return (
    <section className="py-16">
      <div className="container-custom">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Service Range */}
          <div>
            <h2 className="text-2xl font-bold mb-6">{t('service_3d-printing_specs_range_heading', 'Service Range')}</h2>
            <ul className="space-y-4">
              {serviceRangeItems.map((key, index) => (
                <li key={index} className="flex items-center">
                  <CheckCircle size={20} className="text-brand-accent mr-3 shrink-0" />
                  <span className="text-lg">{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>
          
          {/* Specifications */}
          <div>
            <h2 className="text-2xl font-bold mb-6">{t('service_3d-printing_specs_specifications_heading', 'Specifications')}</h2>
            <div className="bg-gray-50 rounded-lg p-6">
              <table className="w-full">
                <tbody>
                  {specifications.map((spec, index) => (
                    <tr key={index} className={index !== specifications.length - 1 ? "border-b border-gray-200" : ""}>
                      <td className="py-4 font-medium">{t(spec.name)}</td>
                      <td className="py-4 text-gray-700">{spec.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="mt-8 text-center">
              <Link to={getLocalizedPath('/quote')} className="btn-primary inline-flex items-center">
                {t('service_3d-printing_specs_get_quote', 'Get a Quote')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default SpecsSection;
