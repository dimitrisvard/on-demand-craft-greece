import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const materials = {
  plastics: [
    { name: "ABS", description: "Durable, impact-resistant thermoplastic for functional parts" },
    { name: "PC (Polycarbonate)", description: "High-strength, temperature-resistant, transparent plastic" },
    { name: "PEEK", description: "High-performance engineering plastic with exceptional thermal and chemical resistance" },
    { name: "PEI (Polyetherimide)", description: "High heat and chemical resistant thermoplastic" },
    { name: "PET/PETG", description: "Food-safe plastic with good clarity and impact resistance" },
    { name: "PLA", description: "Biodegradable plastic derived from renewable resources like corn starch" },
    { name: "Nylon (PA)", description: "Strong, flexible, and durable material with good chemical resistance" },
    { name: "TPU/TPE", description: "Flexible, rubber-like materials with elastic properties" }
  ],
  resins: [
    { name: "Standard Resin", description: "General purpose photopolymer with good detail" },
    { name: "Clear Resin", description: "Transparent material for visual prototypes and optical applications" },
    { name: "Durable Resin", description: "Impact-resistant material for functional prototypes" },
    { name: "Flexible Resin", description: "Rubber-like material with elastic properties" },
    { name: "High-Temp Resin", description: "Heat-resistant material for applications requiring thermal stability" },
    { name: "Dental Resin", description: "Biocompatible material for dental applications" },
    { name: "Castable Resin", description: "Material designed for investment casting processes" },
    { name: "Medical Grade Resin", description: "Biocompatible material for medical applications" }
  ],
  metals: [
    { name: "Aluminum Alloys", description: "Lightweight metal with good strength and thermal conductivity" },
    { name: "Stainless Steel", description: "Corrosion-resistant metal with excellent mechanical properties" },
    { name: "Inconel", description: "Superalloy with excellent high-temperature strength and oxidation resistance" },
    { name: "Titanium", description: "Strong, lightweight metal with excellent corrosion resistance" },
    { name: "Tool Steel", description: "Hard, wear-resistant steel for tooling applications" },
    { name: "Copper Alloys", description: "Excellent thermal and electrical conductivity" },
    { name: "Maraging Steel", description: "High-strength steel with good toughness and dimensional stability" },
    { name: "Precious Metals", description: "Gold, silver, and platinum for jewelry and specialized applications" }
  ],
  composites: [
    { name: "Alumides", description: "Aluminum-filled nylon with metallic appearance and improved stiffness" },
    { name: "Carbon Fiber Composites", description: "Plastic reinforced with carbon fibers for high strength-to-weight ratio" },
    { name: "Fiberglass Composites", description: "Plastic reinforced with glass fibers for durability and low cost" },
    { name: "Polymer Plaster", description: "Gypsum-based material for full-color models and prototypes" },
    { name: "Wood-filled Polymers", description: "Plastics with wood particles for wood-like appearance and properties" },
    { name: "Metal-Polymer Hybrids", description: "Materials combining properties of both metals and polymers" },
    { name: "Ceramic Composites", description: "High-temperature resistant materials with ceramic particles" },
    { name: "Bio-composites", description: "Materials made from renewable, natural resources" }
  ]
};

const MaterialsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_3d-printing_materials_heading', 'Materials for 3D Printing')}</h2>
        
        <Tabs defaultValue="plastics" className="w-full">
          <TabsList className="grid grid-cols-4 mb-8">
            <TabsTrigger value="plastics">Plastics</TabsTrigger>
            <TabsTrigger value="resins">Resins</TabsTrigger>
            <TabsTrigger value="metals">Metals</TabsTrigger>
            <TabsTrigger value="composites">Composites</TabsTrigger>
          </TabsList>
          
          {Object.entries(materials).map(([category, items]) => (
            <TabsContent key={category} value={category} className="mt-0">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {items.map((material, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h3 className="font-bold text-brand-primary mb-2">{t(material.key, material.name)}</h3>
                    <p className="text-sm text-gray-700">{t(material.key, material.description)}</p>
                  </div>
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
};

export default MaterialsSection;
