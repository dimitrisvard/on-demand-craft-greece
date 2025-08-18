import React from 'react';
import { useTranslation } from 'react-i18next';

const advantages = [
  { key: 'service_surface-finishes_advantage_1', default: 'Improved Appearance', descKey: 'service_surface-finishes_advantage_1_desc', defaultDesc: 'Enhance the look and feel of your parts.' },
  { key: 'service_surface-finishes_advantage_2', default: 'Corrosion Protection', descKey: 'service_surface-finishes_advantage_2_desc', defaultDesc: 'Protect parts from rust and wear.' },
  { key: 'service_surface-finishes_advantage_3', default: 'Functional Coatings', descKey: 'service_surface-finishes_advantage_3_desc', defaultDesc: 'Add electrical, thermal, or chemical properties.' },
  { key: 'service_surface-finishes_advantage_4', default: 'Custom Colors & Textures', descKey: 'service_surface-finishes_advantage_4_desc', defaultDesc: 'Match your brand or product requirements.' }
];

const AdvantagesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_surface-finishes_advantages_heading', 'Advantages of Surface Finishing')}</h2>
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