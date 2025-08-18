import React from 'react';
import { useTranslation } from 'react-i18next';

const materials = [
  { key: 'service_rapid-prototyping_material_1', default: 'PLA (Polylactic Acid)' },
  { key: 'service_rapid-prototyping_material_2', default: 'ABS (Acrylonitrile Butadiene Styrene)' },
  { key: 'service_rapid-prototyping_material_3', default: 'PETG (Polyethylene Terephthalate Glycol)' },
  { key: 'service_rapid-prototyping_material_4', default: 'Nylon (Polyamide)' },
  { key: 'service_rapid-prototyping_material_5', default: 'Resins (Standard, Tough, Flexible, Dental, etc.)' },
  { key: 'service_rapid-prototyping_material_6', default: 'Metals (Stainless Steel, Titanium, Aluminum)' }
];

const MaterialsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_rapid-prototyping_materials_heading', 'Materials for Rapid Prototyping')}</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {materials.map((mat, i) => (
            <li key={i} className="bg-gray-50 rounded-lg shadow p-6">
              <span className="font-medium text-lg">{t(mat.key, mat.default)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default MaterialsSection; 