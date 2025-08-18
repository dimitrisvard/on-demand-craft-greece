import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';

const metals = [
  { name: 'Aluminum', code: 'EN AW-5083, 6061, 6082, 7075' },
  { name: 'Stainless Steel', code: '1.4301 (304), 1.4404 (316L)' },
  { name: 'Carbon Steel', code: 'S235JR, C45' },
  { name: 'Tool Steel', code: '1.2379, 1.2316, 1.2343' },
  { name: 'Titanium', code: 'Ti Grade 2, Ti Grade 5 (Ti6Al4V)' },
  { name: 'Brass', code: 'CuZn39Pb3, MS58' },
  { name: 'Copper', code: 'Cu-ETP, Cu-DHP' },
  { name: 'Inconel', code: 'Inconel 718, 625' },
];

const plastics = [
  { name: 'Standard Plastics', examples: 'POM, PA66, PE, PP, ABS' },
  { name: 'Engineering Plastics', examples: 'PC, PMMA, PET, PSU' },
  { name: 'High-Performance', examples: 'PEEK, PPS, PEI (Ultem)' },
  { name: 'Fiber-Reinforced', examples: 'Carbon fiber/Glass fiber-reinforced nylon, PEEK' },
];

const materials = [
  { key: 'service_cnc-machining_material_1', default: 'Aluminum (5083, 6061, 6082, 7075)' },
  { key: 'service_cnc-machining_material_2', default: 'Stainless Steel (304, 316L)' },
  { key: 'service_cnc-machining_material_3', default: 'Carbon Steel (S235JR, C45)' },
  { key: 'service_cnc-machining_material_4', default: 'Tool Steel (1.2379, 1.2316, 1.2343)' },
  { key: 'service_cnc-machining_material_5', default: 'Titanium (Grade 2, Grade 5)' },
  { key: 'service_cnc-machining_material_6', default: 'Brass (CuZn39Pb3, MS58)' },
  { key: 'service_cnc-machining_material_7', default: 'Copper (Cu-ETP, Cu-DHP)' },
  { key: 'service_cnc-machining_material_8', default: 'Inconel (718, 625)' }
];

const MaterialsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-20 bg-white">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">{t('service_cnc-machining_materials_heading', 'Available Materials')}</h2>
          <p className="text-gray-600 max-w-3xl mx-auto">
            {t('service_cnc-machining_materials_desc', 'Our CNC machining services support a wide range of materials to meet your specific requirements, from common metals to specialty engineering plastics.')}
          </p>
        </div>
        <div className="max-w-5xl mx-auto">
          <Tabs defaultValue="metals">
            <TabsList className="grid w-full grid-cols-2 mb-8">
              <TabsTrigger value="metals">{t('service_cnc-machining_materials_tab_metals', 'Metals')}</TabsTrigger>
              <TabsTrigger value="plastics">{t('service_cnc-machining_materials_tab_plastics', 'Plastics')}</TabsTrigger>
            </TabsList>
            <TabsContent value="metals" className="mt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {metals.map(metal => (
                  <div key={metal.name} className="bg-white p-4 rounded-md shadow-sm border border-gray-100">
                    <h3 className="font-bold text-lg mb-1">{t(`service_cnc-machining_materials_metal_${metal.name.replace(/\s+/g, '_').toLowerCase()}`, metal.name)}</h3>
                    <div className="text-sm text-gray-500">{metal.code}</div>
                  </div>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="plastics" className="mt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
                {plastics.map(plastic => (
                  <div key={plastic.name} className="bg-white p-4 rounded-md shadow-sm border border-gray-100">
                    <h3 className="font-bold text-lg mb-1">{t(`service_cnc-machining_materials_plastic_${plastic.name.replace(/\s+/g, '_').toLowerCase()}`, plastic.name)}</h3>
                    <div className="text-sm text-gray-500">{plastic.examples}</div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  );
};

export default MaterialsSection;
