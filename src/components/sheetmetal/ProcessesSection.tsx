
import React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Scissors, Layers, Square, Box, Wrench } from 'lucide-react';

const processes = [
  {
    id: 'laser-cutting',
    name: 'Laser Cutting',
    description: 'High-precision cutting using focused laser beams. Ideal for intricate designs and tight tolerances. Works with most sheet metal materials up to 25mm thickness.',
    icon: <Scissors className="h-6 w-6 mr-2" />,
  },
  {
    id: 'punching',
    name: 'Punching & Nibbling',
    description: 'High-speed mechanical process for creating holes, forms, and cutouts in sheet metal. Cost-effective for large production runs with standardized features.',
    icon: <Square className="h-6 w-6 mr-2" />,
  },
  {
    id: 'bending',
    name: 'Precision Bending',
    description: 'CNC-controlled press brakes for accurate folding and forming of metal sheets. Multiple bend angles and complex forms with tight tolerances.',
    icon: <Layers className="h-6 w-6 mr-2" />,
  },
  {
    id: 'welding',
    name: 'Welding & Assembly',
    description: 'MIG, TIG, and spot welding capabilities for permanent joints. Complete assemblies with hardware insertion and component mounting.',
    icon: <Wrench className="h-6 w-6 mr-2" />,
  },
  {
    id: 'finishing',
    name: 'Surface Finishing',
    description: 'Various finishing options including powder coating, plating, anodizing, and more. Enhances corrosion resistance, appearance, and functional properties.',
    icon: <Box className="h-6 w-6 mr-2" />,
  }
];

const ProcessesSection = () => {
  return (
    <section className="py-20 bg-white">
      <div className="container-custom">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Sheet Metal Fabrication Processes</h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Our comprehensive sheet metal fabrication capabilities deliver precision components
            through a variety of specialized manufacturing processes.
          </p>
        </div>
        
        <div className="max-w-4xl mx-auto">
          <Accordion type="single" collapsible className="w-full">
            {processes.map((process) => (
              <AccordionItem key={process.id} value={process.id} className="border-b border-gray-200">
                <AccordionTrigger className="py-6 flex items-center text-left text-lg font-medium hover:no-underline">
                  <div className="flex items-center">
                    <div className="text-brand-accent mr-3">{process.icon}</div>
                    <span>{process.name}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-0 pb-6 pl-12">
                  <p className="text-gray-700">{process.description}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default ProcessesSection;
