import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

const overview = [
  { key: 'service_surface-finishes_overview_1', default: 'Anodizing' },
  { key: 'service_surface-finishes_overview_2', default: 'Powder Coating' },
  { key: 'service_surface-finishes_overview_3', default: 'Electroplating' },
  { key: 'service_surface-finishes_overview_4', default: 'Polishing' },
  { key: 'service_surface-finishes_overview_5', default: 'Painting' }
];

const ServiceOverview = () => {
  const { t } = useTranslation();
  const { getLocalizedPath } = useLanguage();
  const services = [
    { key: 'service_surface-finishes_overview_service_1', default: 'Anodizing & Hard Anodizing' },
    { key: 'service_surface-finishes_overview_service_2', default: 'Black Finishing & Passivation' },
    { key: 'service_surface-finishes_overview_service_3', default: 'Phosphate Conversion Coating & Nickel Plating' },
    { key: 'service_surface-finishes_overview_service_4', default: 'Galvanizing (Zinc Plating)' },
    { key: 'service_surface-finishes_overview_service_5', default: 'Heat Treatments: Hardening, Quenching & Tempering, Case Hardening, Nitriding' },
    { key: 'service_surface-finishes_overview_service_6', default: 'Mechanical Finishes: Laser Engraving, Polishing, Grinding, Sandblasting, Glass Bead Blasting' },
    { key: 'service_surface-finishes_overview_service_7', default: 'Powder Coating' }
  ];

  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_surface-finishes_overview_heading', 'Surface Finishing Overview')}</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {overview.map((item, i) => (
            <li key={i} className="bg-white rounded-lg shadow p-6">
              <span className="font-medium text-lg">{t(item.key, item.default)}</span>
            </li>
          ))}
        </ul>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {services.map((service, i) => (
            <li key={i} className="bg-white rounded-lg shadow p-6">
              <span className="text-base">{t(service.key, service.default)}</span>
            </li>
          ))}
        </ul>
        <div className="text-center mt-8">
          <Link to={getLocalizedPath('/quote')}>
            <Button size="lg">{t('service_surface-finishes_overview_get_quote', 'Get a Quote')}</Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default ServiceOverview;
