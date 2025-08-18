import React from 'react';
import { useTranslation } from 'react-i18next';

const refinements = [
  { key: 'service_injection-molding_refinement_1', default: 'Surface Texturing' },
  { key: 'service_injection-molding_refinement_2', default: 'Painting & Printing' },
  { key: 'service_injection-molding_refinement_3', default: 'Laser Engraving' },
  { key: 'service_injection-molding_refinement_4', default: 'Assembly' },
  { key: 'service_injection-molding_refinement_5', default: 'Quality Control' },
];

const RefinementSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_injection-molding_refinement_heading', 'Post-Processing & Refinement')}</h2>
        <p className="text-gray-600 mb-8 text-center">{t('service_injection-molding_refinement_desc', 'We offer a range of post-processing and refinement options to ensure your parts meet all functional and aesthetic requirements.')}</p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {refinements.map((ref, i) => (
            <li key={i} className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-2">{t(ref.key, ref.default)}</h3>
              <p className="text-gray-600">{t(`${ref.key}_desc`, 'Description coming soon.')}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default RefinementSection;
