import React from 'react';
import { useTranslation } from 'react-i18next';

const processes = [
  { key: 'service_rapid-prototyping_process_1', default: '3D Printing' },
  { key: 'service_rapid-prototyping_process_2', default: 'CNC Machining' },
  { key: 'service_rapid-prototyping_process_3', default: 'Vacuum Casting' },
  { key: 'service_rapid-prototyping_process_4', default: 'Sheet Metal Prototyping' }
];

const ProcessesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_rapid-prototyping_processes_heading', 'Rapid Prototyping Processes')}</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {processes.map((proc, i) => (
            <li key={i} className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-2">{t(proc.key, proc.default)}</h3>
              <p className="text-gray-600">{t(`${proc.key}_desc`, 'Description coming soon.')}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default ProcessesSection; 