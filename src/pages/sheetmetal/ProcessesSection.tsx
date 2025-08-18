import React from 'react';
import { useTranslation } from 'react-i18next';

const processes = [
  { key: 'service_sheet-metal_process_1', default: 'Laser Cutting', descKey: 'service_sheet-metal_process_1_desc', defaultDesc: 'High-precision cutting using focused laser beams. Ideal for intricate designs and tight tolerances. Works with most sheet metal materials up to 25mm thickness.' },
  { key: 'service_sheet-metal_process_2', default: 'Bending', descKey: 'service_sheet-metal_process_2_desc', defaultDesc: 'CNC-controlled press brakes for accurate folding and forming of metal sheets. Multiple bend angles and complex forms with tight tolerances.' },
  { key: 'service_sheet-metal_process_3', default: 'Punching', descKey: 'service_sheet-metal_process_3_desc', defaultDesc: 'High-speed mechanical process for creating holes, forms, and cutouts in sheet metal. Cost-effective for large production runs with standardized features.' },
  { key: 'service_sheet-metal_process_4', default: 'Welding', descKey: 'service_sheet-metal_process_4_desc', defaultDesc: 'MIG, TIG, and spot welding capabilities for permanent joints. Complete assemblies with hardware insertion and component mounting.' },
  { key: 'service_sheet-metal_process_5', default: 'Assembly', descKey: 'service_sheet-metal_process_5_desc', defaultDesc: 'Final assembly of sheet metal components, including hardware insertion, fasteners, and quality checks.' }
];

const ProcessesSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_sheet-metal_processes_heading', 'Sheet Metal Processes')}</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {processes.map((proc, i) => (
            <li key={i} className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-2">{t(proc.key, proc.default)}</h3>
              <p className="text-gray-600">{t(proc.descKey, proc.defaultDesc)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default ProcessesSection; 