import React from 'react';
import { useTranslation } from 'react-i18next';

const features = [
  { key: 'service_injection-molding_facilities_1', default: 'Modern injection molding machines (up to 1000t clamping force)' },
  { key: 'service_injection-molding_facilities_2', default: 'Automated production lines' },
  { key: 'service_injection-molding_facilities_3', default: 'In-house toolmaking and maintenance' },
  { key: 'service_injection-molding_facilities_4', default: 'Quality assurance laboratory' },
  { key: 'service_injection-molding_facilities_5', default: 'Cleanroom production (ISO 7/8)' },
];

const FacilitiesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_injection-molding_facilities_heading', 'Our Facilities')}</h2>
        <p className="text-gray-600 mb-8 text-center">{t('service_injection-molding_facilities_desc', 'State-of-the-art facilities ensure high-quality, efficient, and reliable injection molding production for every project.')}</p>
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
