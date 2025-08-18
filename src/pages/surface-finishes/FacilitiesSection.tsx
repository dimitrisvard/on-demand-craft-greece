import React from 'react';
import { useTranslation } from 'react-i18next';

const features = [
  { key: 'service_surface-finishes_facility_1', default: 'Automated finishing lines' },
  { key: 'service_surface-finishes_facility_2', default: 'Cleanroom environments' },
  { key: 'service_surface-finishes_facility_3', default: 'In-house quality control' },
  { key: 'service_surface-finishes_facility_4', default: 'Wide range of finishing processes' }
];

const FacilitiesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_surface-finishes_facilities_heading', 'Our Facilities')}</h2>
        <p className="text-gray-600 mb-8 text-center">{t('service_surface-finishes_facilities_desc', 'State-of-the-art facilities for consistent, high-quality surface finishing results.')}</p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feat, i) => (
            <li key={i} className="bg-gray-50 rounded-lg shadow p-6">
              <span className="font-medium text-lg">{t(feat.key, feat.default)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default FacilitiesSection;
