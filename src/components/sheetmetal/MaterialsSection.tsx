import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
const materials = {
  metals: [{
    name: 'Mild Steel',
    code: 'ASTM A36, S235JR, ST-37',
    description: 'Economical, good formability'
  }, {
    name: 'Stainless Steel',
    code: 'AISI 304, 316L',
    description: 'Corrosion resistant'
  }, {
    name: 'Aluminum',
    code: '5083, 6082, 7075',
    description: 'Lightweight, corrosion resistant'
  }, {
    name: 'Galvanized Steel',
    code: 'G90, G60',
    description: 'Zinc coated for corrosion protection'
  }, {
    name: 'Copper',
    code: 'C11000, C12200',
    description: 'Excellent electrical conductivity'
  }, {
    name: 'Brass',
    code: 'C26000, C36000',
    description: 'Good formability, decorative'
  }, {
    name: 'Tool Steel',
    code: 'A2, D2, O1',
    description: 'High hardness and wear resistance'
  }, {
    name: 'Spring Steel',
    code: '1074, 1095',
    description: 'High yield strength, good elasticity'
  }],
  specialtyAlloys: [{
    name: 'Inconel',
    code: '625, 718',
    description: 'Heat and corrosion resistant'
  }, {
    name: 'Titanium',
    code: 'Grade 2, Grade 5',
    description: 'High strength-to-weight ratio'
  }, {
    name: 'Hastelloy',
    code: 'C-22, C-276',
    description: 'Superior corrosion resistance'
  }, {
    name: 'Nickel',
    code: '200, 201',
    description: 'Corrosion resistant, ductile'
  }, {
    name: 'Beryllium Copper',
    code: 'C17200',
    description: 'High strength, non-magnetic'
  }, {
    name: 'Kovar',
    code: 'ASTM F15',
    description: 'Low thermal expansion'
  }]
};
const specifications = {
  category: 'Material Thickness',
  specs: ['Steel: 0.4mm - 20mm', 'Aluminum: 0.5mm - 15mm', 'Stainless Steel: 0.4mm - 25mm', 'Copper/Brass: 0.5mm - 8mm', 'Surface Finish: 0.4-3.2 Ra']
};
const MaterialsSection = () => {
  return <section className="py-20 bg-gray-50">
      <div className="container-custom">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Available Materials</h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            We work with a wide range of materials to meet your specific application requirements,
            from common metals to specialty alloys.
          </p>
        </div>
        
        <div className="max-w-5xl mx-auto">
          <Tabs defaultValue="metals">
            <TabsList className="grid w-full grid-cols-2 mb-8">
              <TabsTrigger value="metals">Common Metals</TabsTrigger>
              <TabsTrigger value="specialtyAlloys">Specialty Alloys</TabsTrigger>
            </TabsList>
            
            <TabsContent value="metals" className="mt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {materials.metals.map(material => <div key={material.name} className="bg-white p-4 rounded-md shadow-sm border border-gray-100">
                    <h3 className="font-bold text-lg mb-1">{material.name}</h3>
                    <div className="text-sm text-gray-500 mb-2">{material.code}</div>
                    <p className="text-sm text-gray-700">{material.description}</p>
                  </div>)}
              </div>
            </TabsContent>
            
            <TabsContent value="specialtyAlloys" className="mt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {materials.specialtyAlloys.map(material => <div key={material.name} className="bg-white p-4 rounded-md shadow-sm border border-gray-100">
                    <h3 className="font-bold text-lg mb-1">{material.name}</h3>
                    <div className="text-sm text-gray-500 mb-2">{material.code}</div>
                    <p className="text-sm text-gray-700">{material.description}</p>
                  </div>)}
              </div>
            </TabsContent>
          </Tabs>

          
        </div>
      </div>
    </section>;
};
export default MaterialsSection;