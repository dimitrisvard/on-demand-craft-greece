import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

const resources = [
  { key: 'service_3d-printing_resource_1', default: '3D Printing Design Guide', descKey: 'service_3d-printing_resource_1_desc', defaultDesc: 'Best practices for designing parts for 3D printing.' },
  { key: 'service_3d-printing_resource_2', default: 'Material Selection Chart', descKey: 'service_3d-printing_resource_2_desc', defaultDesc: 'Compare properties of common 3D printing materials.' },
  { key: 'service_3d-printing_resource_3', default: 'Post-Processing Tips', descKey: 'service_3d-printing_resource_3_desc', defaultDesc: 'How to finish and refine your 3D printed parts.' }
];

const ResourcesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_3d-printing_resources_heading', '3D Printing Resources')}</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {resources.map((res, i) => (
            <li key={i} className="bg-gray-50 rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-2">{t(res.key, res.default)}</h3>
              <p className="text-gray-600">{t(res.descKey, res.defaultDesc)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default ResourcesSection;
