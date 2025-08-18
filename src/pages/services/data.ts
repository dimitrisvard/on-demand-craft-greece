import { 
  LucideIcon, 
  Settings, 
  FileStack, 
  Printer, 
  Package, 
  Paintbrush,
  Clock
} from 'lucide-react';

export interface ServiceData {
  id: string;
  image: string;
  features: string[];
  capabilities: string[];
  link: string;
  icon?: LucideIcon;
}

export const services = [
  {
    id: 'cnc-machining',
    image: '/lovable-uploads/200d9297-1d4c-4f58-a7d0-492ec78f506b.png',
    features: [
      'Precision machining with tolerances as tight as ±0.01mm',
      '3-axis, 4-axis, and 5-axis capabilities',
      'Materials include aluminum, steel, copper, plastics, and more',
      'Prototype to production quantities',
      'Complex geometries and features',
      'Advanced surface finishes',
    ],
    capabilities: [
      'Precision machining with tolerances as tight as ±0.01mm',
      '3-axis, 4-axis, and 5-axis capabilities',
      'Materials include aluminum, steel, copper, plastics, and more',
      'Prototype to production quantities',
      'Complex geometries and features',
      'Advanced surface finishes',
    ],
    link: '/services/cnc-machining',
    icon: Settings
  },
  {
    id: 'sheet-metal',
    image: '/lovable-uploads/f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png',
    features: [
      'Laser cutting, punching, and nibbling',
      'CNC press brake bending up to 4m length',
      'MIG, TIG, and spot welding capabilities',
      'Various metal types including steel, aluminum, and stainless steel',
      'Surface finishing options including powder coating and plating',
      'Complete assemblies with hardware insertion',
    ],
    capabilities: [
      'Laser cutting, punching, and nibbling',
      'CNC press brake bending up to 4m length',
      'MIG, TIG, and spot welding capabilities',
      'Various metal types including steel, aluminum, and stainless steel',
      'Surface finishing options including powder coating and plating',
      'Complete assemblies with hardware insertion',
    ],
    link: '/services/sheet-metal',
    icon: FileStack
  },
  {
    id: '3d-printing',
    image: '/lovable-uploads/59f13e48-0a66-4e3a-a3c3-e9db4fa53d08.png',
    features: [
      'SLA, SLS, FDM, and MJF technologies',
      'Rapid prototyping and functional parts',
      'Various materials including plastics, resins, and nylon',
      'Complex geometries impossible with traditional manufacturing',
      'On-demand production with no tooling costs',
      'Quick turnaround times starting at 24 hours',
    ],
    capabilities: [
      'SLA, SLS, FDM, and MJF technologies',
      'Rapid prototyping and functional parts',
      'Various materials including plastics, resins, and nylon',
      'Complex geometries impossible with traditional manufacturing',
      'On-demand production with no tooling costs',
      'Quick turnaround times starting at 24 hours',
    ],
    link: '/services/3d-printing',
    icon: Printer
  },
  {
    id: 'injection-molding',
    image: '/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png',
    features: [
      'Custom tool design and manufacturing',
      'Prototype and production molds',
      'Wide range of thermoplastics and elastomers',
      'Parts with complex geometries and features',
      'High volume capability up to millions of parts',
      'Secondary operations including assembly and finishing',
    ],
    capabilities: [
      'Custom tool design and manufacturing',
      'Prototype and production molds',
      'Wide range of thermoplastics and elastomers',
      'Parts with complex geometries and features',
      'High volume capability up to millions of parts',
      'Secondary operations including assembly and finishing',
    ],
    link: '/services/injection-molding',
    icon: Package
  },
  {
    id: 'surface-finish',
    image: '/lovable-uploads/e4960d66-a6c4-46ae-ab67-f061530c38cb.png',
    features: [
      'Anodizing for aluminum parts',
      'Powder coating in various colors',
      'Electroplating (zinc, nickel, chrome)',
      'Passivation for stainless steel',
      'Bead blasting and polishing',
      'Painting and specialty coatings',
    ],
    capabilities: [
      'Anodizing for aluminum parts',
      'Powder coating in various colors',
      'Electroplating (zinc, nickel, chrome)',
      'Passivation for stainless steel',
      'Bead blasting and polishing',
      'Painting and specialty coatings',
    ],
    link: '/services/surface-finishes',
    icon: Paintbrush
  },
  {
    id: 'rapid-prototyping',
    image: '/lovable-uploads/solidworks-rapid-prototyping.png',
    features: [
      'Fast turnaround for prototypes',
      'Multiple technologies: 3D printing, CNC, vacuum casting',
      'Material and process flexibility',
      'Design validation before production',
      'Cost-effective for low volumes',
      'Support for complex geometries',
    ],
    capabilities: [
      '3D printing (SLA, SLS, FDM, MJF)',
      'CNC machining for prototypes',
      'Vacuum casting for small batches',
      'Material selection guidance',
      'Iterative design and testing',
      'Short lead times',
    ],
    link: '/services/rapid-prototyping',
    icon: Clock
  }
];
