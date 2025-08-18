import React from 'react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useTranslation } from 'react-i18next';

const materials = [
  { key: 'service_injection-molding_materials_1', default: 'ABS (Acrylnitril-Butadien-Styrol)' },
  { key: 'service_injection-molding_materials_2', default: 'Polypropylen (PP)' },
  { key: 'service_injection-molding_materials_3', default: 'Polyethylen (PE)' },
  { key: 'service_injection-molding_materials_4', default: 'Polycarbonat (PC)' },
  { key: 'service_injection-molding_materials_5', default: 'Polyamid (PA6, PA66)' },
  { key: 'service_injection-molding_materials_6', default: 'POM (Polyoxymethylen)' },
  { key: 'service_injection-molding_materials_7', default: 'TPE (Thermoplastische Elastomere)' },
  { key: 'service_injection-molding_materials_8', default: 'Weitere technische Kunststoffe' },
];

const MaterialsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-gray-50">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_injection-molding_materials_heading', 'Materials for Injection Molding')}</h2>
        <p className="text-gray-600 mb-8 text-center">{t('service_injection-molding_materials_desc', 'We offer a wide range of thermoplastics and technical plastics for injection molding, tailored to your application.')}</p>
        <Tabs defaultValue="plastics" className="w-full">
          <TabsList className="flex justify-center mb-8">
            <TabsTrigger value="plastics">{t('service_injection-molding_materials_tab_plastics', 'Plastics')}</TabsTrigger>
            <TabsTrigger value="elastomers">{t('service_injection-molding_materials_tab_elastomers', 'Elastomers')}</TabsTrigger>
          </TabsList>
          <TabsContent value="plastics">
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {materials.map((mat, i) => (
                <li key={i} className="bg-white rounded shadow p-4">
                  {t(mat.key, mat.default)}
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="elastomers">
            <div className="bg-white rounded shadow p-4 text-center">
              {t('service_injection-molding_materials_elastomers_desc', 'We also process a variety of thermoplastic elastomers (TPE) and other specialty materials for demanding applications.')}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
};

interface MaterialCardProps {
  name: string;
  fullName: string;
  features: string[];
  applications: string;
}

const MaterialCard = ({ name, fullName, features, applications }: MaterialCardProps) => {
  return (
    <div className="border rounded-lg p-4 hover:shadow-md transition-shadow">
      <h3 className="font-bold text-lg mb-1 text-brand-accent">{name}</h3>
      <p className="text-sm text-gray-500 mb-3">{fullName}</p>
      <h4 className="font-medium mb-1">Features:</h4>
      <ul className="list-disc pl-5 mb-3 text-sm">
        {features.map((feature, i) => (
          <li key={i}>{feature}</li>
        ))}
      </ul>
      <h4 className="font-medium mb-1">Common Applications:</h4>
      <p className="text-sm text-gray-700">{applications}</p>
    </div>
  );
};

export default MaterialsSection;
