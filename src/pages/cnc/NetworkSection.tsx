import React from 'react';
import { useTranslation } from 'react-i18next';

const features = [
  { key: 'service_cnc-machining_network_1', default: 'Global network of CNC partners' },
  { key: 'service_cnc-machining_network_2', default: 'Local production for fast delivery' },
  { key: 'service_cnc-machining_network_3', default: 'Certified quality standards' },
];

const NetworkSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_cnc-machining_network_heading', 'Our CNC Machining Network')}</h2>
        <p className="text-gray-600 mb-8 text-center">{t('service_cnc-machining_network_desc', 'We connect you with the best CNC machining partners worldwide for quality and speed.')}</p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feat, i) => (
            <li key={i} className="bg-white rounded-lg shadow p-6">
              <span className="font-medium text-lg">{t(feat.key, feat.default)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default NetworkSection;