import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';

const MillingSpecs = [
  { name: 'Maximum Dimensions', value: '7500×3000×2200 mm' },
  { name: 'Wall Thickness', value: 'From 0.2 mm' },
  { name: 'Tolerances', value: '±0.01 mm' },
  { name: 'Quantity', value: 'From 1 piece' },
];

const TurningSpecs = [
  { name: 'Length', value: '0.5–2500 mm' },
  { name: 'Diameter', value: '0.5–1000 mm' },
  { name: 'Tolerances', value: '±0.01 mm' },
  { name: 'Quantity', value: 'From 1 piece' },
];

const WhatIsCnc = () => {
  const { t } = useTranslation();
  return (
    <section className="py-20 bg-gray-50">
      <div className="container-custom">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">{t('service_cnc-machining_what_heading', 'What Is CNC Machining?')}</h2>
          <p className="text-center text-gray-600 mb-10">
            {t('service_cnc-machining_what_desc', 'Computer Numerical Control machining is a subtractive manufacturing process that uses computer-controlled machines to remove material and create precision parts.')}
          </p>
          <Tabs defaultValue="milling" className="mt-8">
            <TabsList className="grid w-full grid-cols-2 mb-8">
              <TabsTrigger value="milling">{t('service_cnc-machining_what_tab_milling', 'CNC Milling')}</TabsTrigger>
              <TabsTrigger value="turning">{t('service_cnc-machining_what_tab_turning', 'CNC Turning')}</TabsTrigger>
            </TabsList>
            <TabsContent value="milling" className="mt-6">
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-2xl font-bold mb-4">{t('service_cnc-machining_what_milling_heading', 'CNC Milling')}</h3>
                <p className="mb-6 text-gray-700">
                  {t('service_cnc-machining_what_milling_desc', 'CNC milling is a subtractive manufacturing process that uses rotating multi-edge cutting tools to remove material from a workpiece. The milling machine can move the cutting tool in multiple axes to create complex geometries with high precision.')}
                </p>
                <div className="mb-8">
                  <h4 className="text-xl font-semibold mb-4">{t('service_cnc-machining_what_milling_axes_heading', '3-Axis vs. 5-Axis Milling')}</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <div className="p-4 border-b bg-gray-50">
                      <p className="font-medium">{t('service_cnc-machining_what_milling_3axis', '3-Axis Milling')}</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {t('service_cnc-machining_what_milling_3axis_desc', 'Uses X, Y, and Z linear movement. Ideal for simple parts with features accessible from one or two orientations.')}
                      </p>
                    </div>
                    <div className="p-4">
                      <p className="font-medium">{t('service_cnc-machining_what_milling_5axis', '5-Axis Milling')}</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {t('service_cnc-machining_what_milling_5axis_desc', 'Adds rotation around two additional axes, allowing the cutting tool to approach the workpiece from any direction. Perfect for complex parts with intricate features or undercuts.')}
                      </p>
                    </div>
                  </div>
                </div>
                <h4 className="text-xl font-semibold mb-4">{t('service_cnc-machining_what_milling_specs_heading', 'Technical Specifications')}</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-white border">
                    <tbody>
                      {MillingSpecs.map((spec, index) => (
                        <tr key={index} className={index % 2 === 0 ? 'bg-gray-50' : ''}>
                          <td className="py-3 px-4 border font-medium">{t(`service_cnc-machining_what_milling_specs_${spec.name.replace(/\s+/g, '_').toLowerCase()}`, spec.name)}</td>
                          <td className="py-3 px-4 border">{spec.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="turning" className="mt-6">
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="text-2xl font-bold mb-4">{t('service_cnc-machining_what_turning_heading', 'CNC Turning')}</h3>
                <p className="mb-6 text-gray-700">
                  {t('service_cnc-machining_what_turning_desc', 'CNC turning is a machining process used to create rotationally symmetric parts on a lathe. The workpiece rotates while a cutting tool moves linearly to remove material and create the desired shape.')}
                </p>
                <div className="mb-8">
                  <h4 className="text-xl font-semibold mb-4">{t('service_cnc-machining_what_turning_capabilities_heading', 'Capabilities')}</h4>
                  <p className="text-gray-700 mb-4">
                    {t('service_cnc-machining_what_turning_capabilities_desc', 'CNC turning is ideal for creating cylindrical parts such as shafts, pins, bushings, and other rotationally symmetric components. Modern CNC lathes often feature live tooling and multiple turrets for complete machining in a single setup.')}
                  </p>
                </div>
                <h4 className="text-xl font-semibold mb-4">{t('service_cnc-machining_what_turning_specs_heading', 'Technical Specifications')}</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-white border">
                    <tbody>
                      {TurningSpecs.map((spec, index) => (
                        <tr key={index} className={index % 2 === 0 ? 'bg-gray-50' : ''}>
                          <td className="py-3 px-4 border font-medium">{t(`service_cnc-machining_what_turning_specs_${spec.name.replace(/\s+/g, '_').toLowerCase()}`, spec.name)}</td>
                          <td className="py-3 px-4 border">{spec.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  );
};

export default WhatIsCnc;
