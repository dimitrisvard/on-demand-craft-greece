import React from 'react';
import { useTranslation } from 'react-i18next';

const caseStudies = [
  { key: 'service_3d-printing_case_1', default: 'Custom Medical Implant' },
  { key: 'service_3d-printing_case_2', default: 'Lightweight Aerospace Bracket' },
  { key: 'service_3d-printing_case_3', default: 'Functional Prototyping for Consumer Goods' },
];

const CaseStudySection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_3d-printing_case_heading', 'Case Studies')}</h2>
        <p className="text-gray-600 mb-8 text-center">{t('service_3d-printing_case_desc', 'See how our 3D printing solutions have helped customers across industries.')}</p>
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {caseStudies.map((cs, i) => (
            <li key={i} className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-2">{t(cs.key, cs.default)}</h3>
              <p className="text-gray-600">{t(`${cs.key}_desc`, 'Description coming soon.')}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default CaseStudySection;