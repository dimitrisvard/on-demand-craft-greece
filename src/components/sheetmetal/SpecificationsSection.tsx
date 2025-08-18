import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
const specifications = [{
  category: 'Production Volumes',
  specs: ['Prototyping: 1-10 parts', 'Low Volume: 10-100 parts', 'Medium Volume: 100-1,000 parts', 'High Volume: 1,000+ parts']
}, {
  category: 'Quality Control',
  specs: ['CMM measurement reports', 'First article inspection', 'Material certifications', 'Statistical process control']
}, {
  category: 'File Formats',
  specs: ['STEP, IGES, STP', 'SLDPRT, SLDASM (SolidWorks)', 'X_T, X_B (Parasolid)', 'DWG, DXF (AutoCAD)', 'PDF with dimensions']
}, {
  category: 'Lead Times',
  specs: ['Standard: 10-15 business days', 'Express: 5-7 business days', 'Rush: 3-4 business days', 'Super Rush: 1-2 business days']
}];
const materialSpecs = [{
  id: "mild-steel",
  name: "Mild Steel",
  grades: ["S235", "S275", "S355", "ST-37"],
  thickness: "0.4mm - 20mm",
  features: ["Good weldability", "Excellent formability", "Low cost", "High strength-to-weight ratio"]
}, {
  id: "stainless-steel",
  name: "Stainless Steel",
  grades: ["304", "316", "316L", "430"],
  thickness: "0.4mm - 25mm",
  features: ["Excellent corrosion resistance", "High temperature resistance", "Good aesthetic appearance", "Hygienic properties"]
}, {
  id: "aluminum",
  name: "Aluminum",
  grades: ["5083", "6082", "7075"],
  thickness: "0.5mm - 15mm",
  features: ["Lightweight", "Good corrosion resistance", "Excellent thermal conductivity", "Non-magnetic"]
}, {
  id: "copper-brass",
  name: "Copper & Brass",
  grades: ["C11000", "C26000", "C36000"],
  thickness: "0.5mm - 8mm",
  features: ["Excellent electrical conductivity", "Good thermal conductivity", "Antimicrobial properties", "Attractive appearance"]
}];
const bendingCapabilities = [["Specification", "Value"], ["Maximum Length", "4000mm"], ["Maximum Thickness (Steel)", "12mm"], ["Maximum Thickness (Stainless)", "10mm"], ["Maximum Thickness (Aluminum)", "15mm"], ["Minimum Flange", "8mm"], ["Bend Accuracy", "±0.5°"], ["Bending Force", "Up to 320 tons"]];
const laserCuttingCapabilities = [["Specification", "Value"], ["Working Range", "3000mm x 1500mm"], ["Maximum Power", "12kW"], ["Maximum Thickness (Mild Steel)", "25mm"], ["Maximum Thickness (Stainless Steel)", "20mm"], ["Maximum Thickness (Aluminum)", "15mm"], ["Positioning Accuracy", "±0.05mm"], ["Cutting Edge Quality", "Ra 3.2 - 6.3"]];
const SpecificationsSection = () => {
  return <section className="py-20 bg-white">
      <div className="container-custom">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">What is sheet metal processing?</h2>
          
        </div>

        <div className="mb-16 p-8 border-2 border-gray-200 rounded-lg bg-gray-50">
          <div className="prose prose-lg max-w-none">
            <p className="text-gray-700 mb-6">
              Sheet metal processing transforms flat, thin metal sheets—typically with a thickness much smaller than their length and width—into precise, functional components through a variety of cutting, forming, and joining techniques. As a semifinished product, sheet metal offers an ideal balance of rigidity and elasticity, making it versatile for applications in automotive, aerospace, electronics enclosures, appliance housings, and architectural panels.
            </p>
            
            <h3 className="text-gray-900 font-semibold mt-8 mb-4">Key operations include:</h3>
            <ul className="space-y-4 text-gray-700">
              <li>
                <strong>Cutting & Perforation:</strong> High‑speed lasers, water jets, plasma torches, or mechanical shears slice sheets to shape, while precision punching and nibbling create holes, slots, and custom perforation patterns.
              </li>
              <li>
                <strong>Forming & Bending:</strong> CNC‑controlled press brakes and roll‑forming lines impart bends, angles, and complex curves with repeatable accuracy, accommodating radii as tight as material limits allow.
              </li>
              <li>
                <strong>Deep Drawing & Stamping:</strong> Hydraulic or mechanical presses use dies to draw sheets into three‑dimensional parts—such as cups, housings, and automotive body panels—achieving deep depths while maintaining wall thickness.
              </li>
              <li>
                <strong>Joining & Secondary Finishing:</strong> Welds (MIG, TIG), rivets, adhesives, and clinching unify assemblies, followed by deburring, powder coating, anodizing, or plating to enhance corrosion resistance, surface finish, and aesthetics.
              </li>
            </ul>
            
            <p className="text-gray-700 mt-6">
              Through optimized toolpath programming, nesting algorithms, and automated material handling, modern sheet metal processing minimizes waste, accelerates lead times, and delivers consistent tolerances (often within ±0.1 mm), ensuring cost‑effective, high‑quality parts at scale.
            </p>
          </div>
        </div>

        <div className="text-center mb-16 mt-20">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Technical Specifications</h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Our sheet metal fabrication services offer extensive capabilities to meet your production needs.
          </p>
        </div>
        
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="w-full flex justify-center mb-8 bg-gray-100 p-1 rounded-lg">
            <TabsTrigger value="general" className="flex-1 max-w-[200px]">General</TabsTrigger>
            <TabsTrigger value="materials" className="flex-1 max-w-[200px]">Materials</TabsTrigger>
            <TabsTrigger value="bending" className="flex-1 max-w-[200px]">Bending</TabsTrigger>
            <TabsTrigger value="laser" className="flex-1 max-w-[200px]">Laser Cutting</TabsTrigger>
          </TabsList>
          
          <TabsContent value="general">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {specifications.map(spec => <div key={spec.category} className="bg-gray-50 rounded-lg p-6 shadow-sm border border-gray-100">
                  <h3 className="text-xl font-bold mb-4 text-brand-primary">{spec.category}</h3>
                  <ul className="space-y-3">
                    {spec.specs.map((item, index) => <li key={index} className="flex items-start">
                        <Check className="h-5 w-5 text-brand-accent mr-2 mt-0.5 shrink-0" />
                        <span className="text-gray-700">{item}</span>
                      </li>)}
                  </ul>
                </div>)}
            </div>
          </TabsContent>
          
          <TabsContent value="materials">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {materialSpecs.map(material => <div key={material.id} className="bg-gray-50 rounded-lg p-6 shadow-sm border border-gray-100">
                  <h3 className="text-xl font-bold mb-4 text-brand-primary">{material.name}</h3>
                  
                  <div className="mb-4">
                    <h4 className="font-semibold text-gray-700">Available Grades</h4>
                    <p className="text-gray-600">{material.grades.join(", ")}</p>
                  </div>
                  
                  <div className="mb-4">
                    <h4 className="font-semibold text-gray-700">Thickness Range</h4>
                    <p className="text-gray-600">{material.thickness}</p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold text-gray-700">Features</h4>
                    <ul className="space-y-2">
                      {material.features.map((feature, index) => <li key={index} className="flex items-start">
                          <Check className="h-5 w-5 text-brand-accent mr-2 mt-0.5 shrink-0" />
                          <span className="text-gray-600">{feature}</span>
                        </li>)}
                    </ul>
                  </div>
                </div>)}
            </div>
          </TabsContent>
          
          <TabsContent value="bending">
            <div className="bg-gray-50 rounded-lg p-6 shadow-sm border border-gray-100">
              <h3 className="text-2xl font-bold mb-6 text-brand-primary text-center">Press Brake Bending Capabilities</h3>
              
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/2 font-bold text-lg">{bendingCapabilities[0][0]}</TableHead>
                    <TableHead className="w-1/2 font-bold text-lg">{bendingCapabilities[0][1]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bendingCapabilities.slice(1).map((row, index) => <TableRow key={index}>
                      <TableCell className="font-medium">{row[0]}</TableCell>
                      <TableCell>{row[1]}</TableCell>
                    </TableRow>)}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          
          <TabsContent value="laser">
            <div className="bg-gray-50 rounded-lg p-6 shadow-sm border border-gray-100">
              <h3 className="text-2xl font-bold mb-6 text-brand-primary text-center">Laser Cutting Capabilities</h3>
              
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/2 font-bold text-lg">{laserCuttingCapabilities[0][0]}</TableHead>
                    <TableHead className="w-1/2 font-bold text-lg">{laserCuttingCapabilities[0][1]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {laserCuttingCapabilities.slice(1).map((row, index) => <TableRow key={index}>
                      <TableCell className="font-medium">{row[0]}</TableCell>
                      <TableCell>{row[1]}</TableCell>
                    </TableRow>)}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>;
};
export default SpecificationsSection;
