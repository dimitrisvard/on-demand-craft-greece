import React from 'react';
import { useTranslation } from 'react-i18next';

const advantages = [
  { key: 'service_rapid-prototyping_advantage_1', default: 'Speed to Market', descKey: 'service_rapid-prototyping_advantage_1_desc', defaultDesc: 'Quickly validate and iterate your designs.' },
  { key: 'service_rapid-prototyping_advantage_2', default: 'Cost Savings', descKey: 'service_rapid-prototyping_advantage_2_desc', defaultDesc: 'Reduce development costs with rapid iterations.' },
  { key: 'service_rapid-prototyping_advantage_3', default: 'Design Flexibility', descKey: 'service_rapid-prototyping_advantage_3_desc', defaultDesc: 'Test multiple concepts and features easily.' },
  { key: 'service_rapid-prototyping_advantage_4', default: 'Real-World Testing', descKey: 'service_rapid-prototyping_advantage_4_desc', defaultDesc: 'Evaluate form, fit, and function before production.' }
];

const AdvantagesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_rapid-prototyping_advantages_heading', 'Advantages of Rapid Prototyping')}</h2>
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