import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';

const treatments = {
  thermal: [
    'Heat Treating',
    'Annealing',
    'Normalizing',
    'Case Hardening',
    'Tempering',
    'Stress Relieving'
  ],
  electrochemical: [
    'Anodizing',
    'Electroplating',
    'Passivation',
    'Chemical Conversion',
    'Electroless Nickel Plating',
    'Chrome Plating'
  ],
  mechanical: [
    'Sandblasting',
    'Bead Blasting',
    'Polishing',
    'Brushing',
    'Tumbling',
    'Lapping'
  ]
};

const SurfaceTreatments = () => {
  const { t } = useTranslation();
  return (
    <section className="py-20 bg-gray-50">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">{t('service_cnc-machining_surface_heading', 'Surface Treatments')}</h2>
          <p className="text-gray-600 max-w-3xl mx-auto">
            {t('service_cnc-machining_surface_desc', 'Enhance the appearance, durability, and performance of your CNC machined parts with our comprehensive surface treatment options.')}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>{t('service_cnc-machining_surface_thermal', 'Thermal')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {treatments.thermal.map((treatment, index) => (
                  <li key={index} className="flex items-center">
                    <div className="w-2 h-2 bg-brand-accent rounded-full mr-2"></div>
                    {t(`service_cnc-machining_surface_thermal_${treatment.replace(/\s+/g, '_').toLowerCase()}`, treatment)}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>{t('service_cnc-machining_surface_electrochemical', 'Electrochemical')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {treatments.electrochemical.map((treatment, index) => (
                  <li key={index} className="flex items-center">
                    <div className="w-2 h-2 bg-brand-accent rounded-full mr-2"></div>
                    {t(`service_cnc-machining_surface_electrochemical_${treatment.replace(/\s+/g, '_').toLowerCase()}`, treatment)}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>{t('service_cnc-machining_surface_mechanical', 'Mechanical')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {treatments.mechanical.map((treatment, index) => (
                  <li key={index} className="flex items-center">
                    <div className="w-2 h-2 bg-brand-accent rounded-full mr-2"></div>
                    {t(`service_cnc-machining_surface_mechanical_${treatment.replace(/\s+/g, '_').toLowerCase()}`, treatment)}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
};

export default SurfaceTreatments;
