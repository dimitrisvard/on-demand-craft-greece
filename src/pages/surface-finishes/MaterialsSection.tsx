import React from 'react';
import { useTranslation } from 'react-i18next';

const materials = [
  { key: 'service_surface-finishes_material_1', default: 'Aluminum' },
  { key: 'service_surface-finishes_material_2', default: 'Steel' },
  { key: 'service_surface-finishes_material_3', default: 'Copper' },
  { key: 'service_surface-finishes_material_4', default: 'Brass' },
  { key: 'service_surface-finishes_material_5', default: 'Plastics' }
];

const MaterialsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_surface-finishes_materials_heading', 'Materials for Surface Finishing')}</h2>
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