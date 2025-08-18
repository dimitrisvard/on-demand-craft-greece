import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Clock, Wrench, Shield } from 'lucide-react';

const advantages = [
  {
    titleKey: 'service_cnc-machining_advantages_fast_title',
    defaultTitle: 'Fast',
    icon: Clock,
    points: [
      { key: 'service_cnc-machining_advantages_fast_point1', default: 'Rapid turnaround on quotes' },
      { key: 'service_cnc-machining_advantages_fast_point2', default: 'Express manufacturing options' },
      { key: 'service_cnc-machining_advantages_fast_point3', default: 'On-time delivery guarantee' }
    ]
  },
  {
    titleKey: 'service_cnc-machining_advantages_versatile_title',
    defaultTitle: 'Versatile',
    icon: Wrench,
    points: [
      { key: 'service_cnc-machining_advantages_versatile_point1', default: '3-axis and 5-axis capabilities' },
      { key: 'service_cnc-machining_advantages_versatile_point2', default: 'Wide range of materials' },
      { key: 'service_cnc-machining_advantages_versatile_point3', default: 'Complex geometries possible' }
    ]
  },
  {
    titleKey: 'service_cnc-machining_advantages_reliable_title',
    defaultTitle: 'Reliable',
    icon: Shield,
    points: [
      { key: 'service_cnc-machining_advantages_reliable_point1', default: 'ISO 9001 certified processes' },
      { key: 'service_cnc-machining_advantages_reliable_point2', default: 'Comprehensive quality control' },
      { key: 'service_cnc-machining_advantages_reliable_point3', default: '100% part inspection' }
    ]
  }
];

const AdvantagesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-20 bg-gray-50">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">{t('service_cnc-machining_advantages_heading', 'Advantages of CNC Machining')}</h2>
          <p className="text-gray-600 max-w-3xl mx-auto">
            {t('service_cnc-machining_advantages_desc', 'Choose us for CNC machining services that deliver on quality, speed, and reliability.')}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {advantages.map((advantage, index) => {
            const Icon = advantage.icon;
            return (
              <div key={index} className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
                <div className="bg-brand-light w-16 h-16 rounded-lg flex items-center justify-center mb-6">
                  <Icon className="text-brand-primary" size={32} />
                </div>
                <h3 className="text-xl font-bold mb-4">{t(advantage.titleKey, advantage.defaultTitle)}</h3>
                <ul className="space-y-3">
                  {advantage.points.map((point, idx) => (
                    <li key={idx} className="flex items-start">
                      <CheckCircle size={18} className="text-brand-teal mt-0.5 mr-2 shrink-0" />
                      <span>{t(point.key, point.default)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default AdvantagesSection;
