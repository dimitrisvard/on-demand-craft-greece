import React from 'react';
import { Target, Globe, Award } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const MissionValues = () => {
  const { t } = useTranslation();
  return (
    <section className="py-20 bg-gray-50">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 break-words text-balance">{t('about_mission_values_title', 'Our Mission & Values')}</h2>
          <p className="text-lg text-gray-600 break-words text-balance">
            {t('about_mission_values_subtitle', "We're guided by a commitment to excellence and innovation in everything we do")}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              title: t('about_mission_title', 'Mission'),
              description: t('about_mission_desc', 'To democratize access to high-quality manufacturing services and empower businesses to bring their ideas to life efficiently and cost-effectively.'),
              icon: <Target className="h-8 w-8 text-brand-teal" />,
            },
            {
              title: t('about_vision_title', 'Vision'),
              description: t('about_vision_desc', 'To become the leading manufacturing platform in Europe, known for quality, speed, and technological innovation in the industry.'),
              icon: <Globe className="h-8 w-8 text-brand-teal" />,
            },
            {
              title: t('about_promise_title', 'Promise'),
              description: t('about_promise_desc', 'To deliver precision parts with outstanding quality, on time, every time - backed by our 100% satisfaction guarantee.'),
              icon: <Award className="h-8 w-8 text-brand-teal" />,
            },
          ].map((item, index) => (
            <div key={index} className="bg-white p-8 rounded-lg shadow-md border border-gray-100">
              <div className="mb-4">{item.icon}</div>
              <h3 className="text-xl font-bold mb-3 break-words text-balance">{item.title}</h3>
              <p className="text-gray-600 break-words text-balance">{item.description}</p>
            </div>
          ))}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
          {[
            { title: t('about_quality_title', 'Quality'), description: t('about_quality_desc', 'We never compromise on precision and excellence') },
            { title: t('about_innovation_title', 'Innovation'), description: t('about_innovation_desc', 'We continuously evolve our technology and processes') },
            { title: t('about_reliability_title', 'Reliability'), description: t('about_reliability_desc', 'We deliver on our promises, consistently') },
            { title: t('about_transparency_title', 'Transparency'), description: t('about_transparency_desc', 'We maintain clear communication and fair pricing') },
          ].map((value, index) => (
            <div key={index} className="p-6 border-l-4 border-brand-teal bg-white shadow-sm">
              <h4 className="font-bold text-lg mb-2 break-words text-balance">{value.title}</h4>
              <p className="text-gray-600 break-words text-balance">{value.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default MissionValues;
