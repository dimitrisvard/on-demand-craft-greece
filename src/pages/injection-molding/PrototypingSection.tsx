import React from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, CheckCircle, BadgeDollarSign, Layers } from 'lucide-react';

const PrototypingSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-brand-light">
      <div className="container-custom">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-2">
            <h2 className="text-3xl font-bold mb-4">{t('service_injection-molding_prototyping_heading', 'Rapid Prototyping')}</h2>
            <p className="text-gray-700 mb-6">
              {t('service_injection-molding_prototyping_desc_1', 'Accelerate your product development with our rapid injection molding services. We combine traditional injection molding with advanced prototyping technologies to deliver functional parts quickly.')}
            </p>
            <p className="text-gray-700 mb-6">
              {t('service_injection-molding_prototyping_desc_2', 'Our complementary processes including 3D printing, vacuum casting, and CNC machining allow us to create prototypes that match your final production requirements in material properties and appearance.')}
            </p>
            <p className="text-gray-700 mb-6">
              {t('service_injection-molding_prototyping_desc_3', 'This integrated approach enables you to test, validate, and refine your designs before committing to full-scale production tooling and manufacturing.')}
            </p>
          </div>
          
          <div className="lg:col-span-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="text-brand-accent mb-4">
                  <Zap size={36} />
                </div>
                <h3 className="text-xl font-bold mb-3">{t('service_injection-molding_prototyping_speed_title', 'Speed')}</h3>
                <p className="text-gray-700">
                  {t('service_injection-molding_prototyping_speed_desc', 'Aluminum tooling can be produced in days rather than weeks, allowing for faster iterations and time-to-market. Get functional prototypes in 1-2 weeks compared to 4-8 weeks for traditional steel molds.')}
                </p>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="text-brand-accent mb-4">
                  <CheckCircle size={36} />
                </div>
                <h3 className="text-xl font-bold mb-3">{t('service_injection-molding_prototyping_verification_title', 'Design Verification')}</h3>
                <p className="text-gray-700">
                  {t('service_injection-molding_prototyping_verification_desc', 'Test your designs with production-grade materials before committing to expensive tooling. Identify and fix design issues early in the development process to avoid costly mistakes.')}
                </p>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="text-brand-accent mb-4">
                  <BadgeDollarSign size={36} />
                </div>
                <h3 className="text-xl font-bold mb-3">{t('service_injection-molding_prototyping_cost_title', 'Cost Savings')}</h3>
                <p className="text-gray-700">
                  {t('service_injection-molding_prototyping_cost_desc', 'Aluminum molds cost significantly less than steel production molds, making them ideal for prototyping and low-volume production runs. Save 40-60% on initial tooling costs.')}
                </p>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="text-brand-accent mb-4">
                  <Layers size={36} />
                </div>
                <h3 className="text-xl font-bold mb-3">{t('service_injection-molding_prototyping_flexibility_title', 'Flexibility')}</h3>
                <p className="text-gray-700">
                  {t('service_injection-molding_prototyping_flexibility_desc', 'Make design changes quickly and affordably. Rapid tooling allows for faster iterations and modifications compared to traditional tooling methods. Adapt to market feedback quickly.')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PrototypingSection;
