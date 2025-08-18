import React from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Printer } from 'lucide-react';

const features = [
  { key: 'service_3d-printing_what_1', default: 'Layer-by-layer manufacturing' },
  { key: 'service_3d-printing_what_2', default: 'Digital design to physical part' },
  { key: 'service_3d-printing_what_3', default: 'No tooling required' },
];

const WhatIsPrinting = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_3d-printing_what_heading', 'What is 3D Printing?')}</h2>
        <p className="text-gray-600 mb-8 text-center">{t('service_3d-printing_what_desc', '3D printing, also known as additive manufacturing, builds parts layer by layer from a digital file.')}</p>
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

export default WhatIsPrinting;
