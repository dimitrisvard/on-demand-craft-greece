import React from 'react';
import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const QualityAssurance = () => {
  const { t } = useTranslation();
  return (
    <section className="py-20">
      <div className="container-custom">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="order-2 lg:order-1">
            <div className="relative">
              <div className="aspect-video rounded-lg overflow-hidden">
                <img 
                  src="/lovable-uploads/cc3535ce-8c0f-47e6-a5b1-629c88e027ed.png" 
                  alt="Quality Control"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-4 -left-4 bg-brand-teal p-6 rounded-lg">
                <Shield className="h-12 w-12 text-white" />
              </div>
            </div>
          </div>
          
          <div className="order-1 lg:order-2">
            <h2 className="text-3xl md:text-4xl font-bold mb-6 break-words text-balance">{t('about_quality_assurance_title', 'Quality Assurance')}</h2>
            <p className="text-lg text-gray-600 mb-6 break-words text-balance">
              {t('about_quality_assurance_desc', 'Quality is at the core of everything we do. Every part we produce undergoes rigorous inspection to ensure it meets our exacting standards and your specific requirements.')}
            </p>
            <div className="space-y-6">
              {[
                {
                  title: t('about_quality1_title', 'ISO 9001:2015 Certified'),
                  description: t('about_quality1_desc', 'Our quality management system is ISO certified, ensuring consistent quality across all processes.')
                },
                {
                  title: t('about_quality2_title', 'Advanced Metrology'),
                  description: t('about_quality2_desc', 'We use coordinate measuring machines (CMM) and 3D scanning to verify dimensional accuracy.')
                },
                {
                  title: t('about_quality3_title', 'Material Certifications'),
                  description: t('about_quality3_desc', 'We provide material certifications and traceability for critical applications when required.')
                },
              ].map((item, index) => (
                <div key={index} className="border-b border-gray-200 pb-6 last:border-0 last:pb-0">
                  <h3 className="font-bold text-xl mb-2 break-words text-balance">{item.title}</h3>
                  <p className="text-gray-600 break-words text-balance">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default QualityAssurance;
