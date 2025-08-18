import React from 'react';
import { Factory, Wrench, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const FacilitiesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-20 bg-gray-50">
      <div className="container-custom">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="order-2 lg:order-1">
            <h2 className="text-3xl md:text-4xl font-bold mb-6 break-words text-balance">{t('about_facilities_title', 'Our Facilities')}</h2>
            <p className="text-lg text-gray-600 mb-6 break-words text-balance">
              {t('about_facilities_desc', 'Our state-of-the-art manufacturing facilities are equipped with the latest technology and machinery to deliver precision parts and exceptional quality.')}
            </p>
            
            <div className="space-y-6">
              {[
                {
                  icon: <Factory className="h-6 w-6 text-brand-primary" />,
                  title: t('about_facility1_title', 'Advanced Manufacturing Center'),
                  description: t('about_facility1_desc', '15,000 sq.ft. facility with modern CNC machines and automated production lines')
                },
                {
                  icon: <Wrench className="h-6 w-6 text-brand-primary" />,
                  title: t('about_facility2_title', 'Quality Control Lab'),
                  description: t('about_facility2_desc', 'Dedicated space for quality inspection with cutting-edge measuring equipment')
                },
                {
                  icon: <Truck className="h-6 w-6 text-brand-primary" />,
                  title: t('about_facility3_title', 'Packaging and Dispatch Room'),
                  description: t('about_facility3_desc', 'Specialized area for secure packaging, quality checks, and efficient order dispatching')
                }
              ].map((facility, index) => (
                <div key={index} className="flex gap-4 p-4 bg-white rounded-lg shadow-sm">
                  <div className="flex-shrink-0">{facility.icon}</div>
                  <div>
                    <h3 className="font-bold text-lg mb-1 break-words text-balance">{facility.title}</h3>
                    <p className="text-gray-600 break-words text-balance">{facility.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="order-1 lg:order-2">
            <div className="relative">
              <div className="aspect-[4/3] rounded-lg overflow-hidden">
                <img 
                  src="https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=800&h=600&q=80" 
                  alt="Manufacturing Facility"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-4 -right-4 bg-white p-6 rounded-lg shadow-lg">
                <Factory className="h-12 w-12 text-brand-primary" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FacilitiesSection;
