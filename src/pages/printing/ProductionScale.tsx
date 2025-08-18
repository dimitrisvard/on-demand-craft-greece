import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Box, Settings } from 'lucide-react';

const scales = [
  { key: 'service_3d-printing_scale_1', default: 'Prototyping' },
  { key: 'service_3d-printing_scale_2', default: 'Small Batch Production' },
  { key: 'service_3d-printing_scale_3', default: 'Mass Customization' },
];

const productionOptions = [
  {
    title: "Prototyping",
    icon: <Clock size={32} className="text-brand-primary" />,
    description: "Get functional prototypes in as little as 24 hours. Iterate quickly with high-detail parts that accurately represent your final product.",
    features: [
      "Fastest turnaround times",
      "Perfect for design validation",
      "Various materials available",
      "Cost-effective for small quantities"
    ]
  },
  {
    title: "Series Production",
    icon: <Box size={32} className="text-brand-primary" />,
    description: "Cost-efficient production for medium to large quantities. Consistent quality across batches with economies of scale.",
    features: [
      "Optimized for cost efficiency",
      "Consistent quality across batches",
      "Material and process recommendations",
      "Dedicated production capacity"
    ]
  },
  {
    title: "Long-Term Contracts",
    icon: <Settings size={32} className="text-brand-primary" />,
    description: "Framework agreements for ongoing production needs. Reserved capacity, priority scheduling, and volume-based pricing.",
    features: [
      "Guaranteed production capacity",
      "Volume-based pricing discounts",
      "Priority scheduling",
      "Dedicated project management"
    ]
  }
];

const ProductionScale = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_3d-printing_scale_heading', 'Production Scale Options')}</h2>
        <p className="text-gray-600 mb-8 text-center">{t('service_3d-printing_scale_desc', 'From one-off prototypes to mass customization, 3D printing adapts to your needs.')}</p>
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
