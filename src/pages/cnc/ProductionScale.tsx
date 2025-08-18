import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, BarChart, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const scales = [
  { key: 'service_cnc-machining_scale_1', default: 'Prototyping' },
  { key: 'service_cnc-machining_scale_2', default: 'Small Batch Production' },
  { key: 'service_cnc-machining_scale_3', default: 'Mass Production' },
];

const ProductionScale = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_cnc-machining_scale_heading', 'Production Scale Options')}</h2>
        <p className="text-gray-600 mb-8 text-center">{t('service_cnc-machining_scale_desc', 'From one-off prototypes to mass production, CNC machining adapts to your needs.')}</p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {scales.map((scale, i) => (
            <li key={i} className="bg-white rounded-lg shadow p-6">
              <span className="font-medium text-lg">{t(scale.key, scale.default)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default ProductionScale;
