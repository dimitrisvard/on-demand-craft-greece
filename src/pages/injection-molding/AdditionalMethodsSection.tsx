import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const methods = [
  {
    titleKey: 'service_injection-molding_additional_die_casting_title',
    defaultTitle: 'Die Casting',
    descKey: 'service_injection-molding_additional_die_casting_desc',
    defaultDesc: 'Metal parts production through high-pressure injection of molten metal into a mold cavity',
    advantages: [
      { key: 'service_injection-molding_additional_die_casting_adv_1', default: 'High precision' },
      { key: 'service_injection-molding_additional_die_casting_adv_2', default: 'Complex geometries' },
      { key: 'service_injection-molding_additional_die_casting_adv_3', default: 'Excellent surface finish' }
    ],
    link: '/services/die-casting'
  },
  {
    titleKey: 'service_injection-molding_additional_vacuum_casting_title',
    defaultTitle: 'Vacuum Casting',
    descKey: 'service_injection-molding_additional_vacuum_casting_desc',
    defaultDesc: 'Production of small batch polyurethane parts using silicone molds created from master patterns',
    advantages: [
      { key: 'service_injection-molding_additional_vacuum_casting_adv_1', default: 'Low tooling costs' },
      { key: 'service_injection-molding_additional_vacuum_casting_adv_2', default: 'Fast turnaround' },
      { key: 'service_injection-molding_additional_vacuum_casting_adv_3', default: 'Excellent for prototypes' }
    ],
    link: '/services/vacuum-casting'
  },
  {
    titleKey: 'service_injection-molding_additional_gravity_casting_title',
    defaultTitle: 'Gravity Casting',
    descKey: 'service_injection-molding_additional_gravity_casting_desc',
    defaultDesc: 'Process where molten metal flows into a mold under the force of gravity alone',
    advantages: [
      { key: 'service_injection-molding_additional_gravity_casting_adv_1', default: 'Simple process' },
      { key: 'service_injection-molding_additional_gravity_casting_adv_2', default: 'Good for large parts' },
      { key: 'service_injection-molding_additional_gravity_casting_adv_3', default: 'Cost-effective' }
    ],
    link: '/services/gravity-casting'
  }
];

const AdditionalMethodsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-brand-light">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="text-3xl font-bold mb-4">{t('service_injection-molding_additional_methods_heading', 'Additional Manufacturing Methods')}</h2>
          <p className="text-gray-600">
            {t('service_injection-molding_additional_methods_desc', 'Beyond injection molding, Microns Hub offers several complementary manufacturing methods that may better suit certain applications or be used alongside injection molding for complex projects.')}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {methods.map((method, index) => (
            <div key={index} className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-bold mb-3">{t(method.titleKey, method.defaultTitle)}</h3>
              <p className="text-gray-700 mb-4">{t(method.descKey, method.defaultDesc)}</p>
              <h4 className="font-bold text-sm mb-2 text-brand-accent">{t('service_injection-molding_additional_methods_advantages', 'Key Advantages')}</h4>
              <ul className="mb-6 space-y-1">
                {method.advantages.map((adv, i) => (
                  <li key={i} className="text-sm">{t(adv.key, adv.default)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default AdditionalMethodsSection;