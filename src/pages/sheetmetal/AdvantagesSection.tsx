import React from 'react';
import { useTranslation } from 'react-i18next';

const advantages = [
  { key: 'service_sheet-metal_advantage_1', default: 'Fast Turnaround', descKey: 'service_sheet-metal_advantage_1_desc', defaultDesc: 'Quick lead times for prototypes and production.' },
  { key: 'service_sheet-metal_advantage_2', default: 'Cost-Effective', descKey: 'service_sheet-metal_advantage_2_desc', defaultDesc: 'Affordable for both low and high volumes.' },
  { key: 'service_sheet-metal_advantage_3', default: 'Material Variety', descKey: 'service_sheet-metal_advantage_3_desc', defaultDesc: 'Wide range of metals and finishes available.' },
  { key: 'service_sheet-metal_advantage_4', default: 'Complex Geometries', descKey: 'service_sheet-metal_advantage_4_desc', defaultDesc: 'Supports intricate bends, cutouts, and assemblies.' }
];

const AdvantagesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_sheet-metal_advantages_heading', 'Advantages of Sheet Metal Fabrication')}</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {advantages.map((adv, i) => (
            <li key={i} className="bg-gray-50 rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-2">{t(adv.key, adv.default)}</h3>
              <p className="text-gray-600">{t(adv.descKey, adv.defaultDesc)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default AdvantagesSection; 