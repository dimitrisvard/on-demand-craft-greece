import React from 'react';
import { useTranslation } from 'react-i18next';

const specs = [
  { key: 'service_sheet-metal_spec_1', default: 'Max Part Size', valueKey: 'service_sheet-metal_spec_1_value', defaultValue: '2500 × 1250 mm' },
  { key: 'service_sheet-metal_spec_2', default: 'Min Thickness', valueKey: 'service_sheet-metal_spec_2_value', defaultValue: '0.5 mm' },
  { key: 'service_sheet-metal_spec_3', default: 'Tolerances', valueKey: 'service_sheet-metal_spec_3_value', defaultValue: '±0.1 mm' },
  { key: 'service_sheet-metal_spec_4', default: 'Batch Size', valueKey: 'service_sheet-metal_spec_4_value', defaultValue: 'From 1 piece' }
];

const SpecificationsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_sheet-metal_specs_heading', 'Sheet Metal Specifications')}</h2>
        <table className="w-full max-w-2xl mx-auto border border-gray-200 rounded-lg">
          <tbody>
            {specs.map((spec, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="p-4 font-medium text-gray-700">{t(spec.key, spec.default)}</td>
                <td className="p-4 text-gray-600">{t(spec.valueKey, spec.defaultValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default SpecificationsSection; 