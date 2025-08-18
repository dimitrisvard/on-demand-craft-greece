import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Box, CheckCircle } from 'lucide-react';

const advantages = [
  {
    titleKey: 'service_3d-printing_advantages_fast_title',
    defaultTitle: 'Fast',
    icon: <Clock size={32} className="text-brand-primary" />,
    points: [
      { key: 'service_3d-printing_advantages_fast_point1', default: 'Rapid prototyping in as little as 24 hours' },
      { key: 'service_3d-printing_advantages_fast_point2', default: 'Quick iterations for design validation' },
      { key: 'service_3d-printing_advantages_fast_point3', default: 'Expedited production for urgent needs' }
    ]
  },
  {
    titleKey: 'service_3d-printing_advantages_versatile_title',
    defaultTitle: 'Versatile',
    icon: <Box size={32} className="text-brand-primary" />,
    points: [
      { key: 'service_3d-printing_advantages_versatile_point1', default: 'Complex geometries impossible with traditional manufacturing' },
      { key: 'service_3d-printing_advantages_versatile_point2', default: 'Wide range of materials from plastics to metals' },
      { key: 'service_3d-printing_advantages_versatile_point3', default: 'Customizable mechanical and aesthetic properties' }
    ]
  },
  {
    titleKey: 'service_3d-printing_advantages_reliable_title',
    defaultTitle: 'Reliable',
    icon: <CheckCircle size={32} className="text-brand-primary" />,
    points: [
      { key: 'service_3d-printing_advantages_reliable_point1', default: 'ISO 9001 certified quality management' },
      { key: 'service_3d-printing_advantages_reliable_point2', default: 'Comprehensive inspection protocols' },
      { key: 'service_3d-printing_advantages_reliable_point3', default: 'Consistent results across production runs' }
    ]
  }
];

const AdvantagesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold text-center mb-12">{t('service_3d-printing_advantages_heading', 'Advantages of 3D Printing')}</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {advantages.map((advantage, index) => (
            <div key={index} className="text-center">
              <div className="flex justify-center mb-4">
                {advantage.icon}
              </div>
              <h3 className="text-xl font-bold mb-4">{t(advantage.titleKey, advantage.defaultTitle)}</h3>
              
              <ul className="space-y-3 text-left">
                {advantage.points.map((point, i) => (
                  <li key={i} className="flex items-start">
                    <svg className="w-5 h-5 text-brand-accent mr-2 mt-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-700">{t(point.key, point.default)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default AdvantagesSection;
