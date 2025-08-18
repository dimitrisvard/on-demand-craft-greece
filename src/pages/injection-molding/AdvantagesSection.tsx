import React from 'react';
import { DollarSign, Layers, Wrench, Workflow, Palette, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const advantages = [
  {
    titleKey: 'service_injection-molding_advantage_cost_title',
    descKey: 'service_injection-molding_advantage_cost_desc',
    icon: DollarSign
  },
  {
    titleKey: 'service_injection-molding_advantage_versatility_title',
    descKey: 'service_injection-molding_advantage_versatility_desc',
    icon: Layers
  },
  {
    titleKey: 'service_injection-molding_advantage_precision_title',
    descKey: 'service_injection-molding_advantage_precision_desc',
    icon: Wrench
  },
  {
    titleKey: 'service_injection-molding_advantage_single_source_title',
    descKey: 'service_injection-molding_advantage_single_source_desc',
    icon: Workflow
  },
  {
    titleKey: 'service_injection-molding_advantage_customization_title',
    descKey: 'service_injection-molding_advantage_customization_desc',
    icon: Palette
  },
  {
    titleKey: 'service_injection-molding_advantage_consultation_title',
    descKey: 'service_injection-molding_advantage_consultation_desc',
    icon: User
  }
];

const AdvantagesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">{t('service_injection-molding_advantages_heading', 'Advantages of Injection Molding')}</h2>
          <p className="text-gray-600 max-w-3xl mx-auto">
            {t('service_injection-molding_advantages_desc', 'Discover why injection molding is the preferred method for producing high-quality plastic parts at scale.')}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {advantages.map((advantage, index) => {
            const Icon = advantage.icon;
            return (
              <div key={index} className="p-6 border rounded-lg bg-brand-light hover:shadow-md transition-shadow">
                <div className="text-brand-accent mb-4">
                  <Icon size={32} />
                </div>
                <h3 className="text-xl font-bold mb-2">{t(advantage.titleKey)}</h3>
                <p className="text-gray-600">{t(advantage.descKey)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default AdvantagesSection;
