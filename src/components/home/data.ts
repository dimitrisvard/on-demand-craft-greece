import { LucideIcon } from 'lucide-react';

export const heroImage = "/lovable-uploads/b17e4baa-4be2-4892-a725-5871867d3dc3.png";

export const trustedCompanies = [
  { 
    name: "Aerospace & Defense", 
    image: "/lovable-uploads/aerospace-and-defence.jpg",
    industry: "Aerospace",
    translationKey: "trusted_company_aerospace"
  },
  { 
    name: "Automotive", 
    image: "/lovable-uploads/automotive.jpg",
    industry: "Automotive",
    translationKey: "trusted_company_automotive"
  },
  { 
    name: "Medical Technology", 
    image: "/lovable-uploads/medical-industry.jpg",
    industry: "Medical",
    translationKey: "trusted_company_medical"
  },
  { 
    name: "Industrial Automation", 
    image: "/lovable-uploads/industrial-automation.jpg",
    industry: "Automation",
    translationKey: "trusted_company_automation"
  }
];

export interface ServiceItem {
  id: string;
  iconName: string;
  link: string;
  delay: number;
  image: string;
}

export const services: ServiceItem[] = [
  {
    id: "cnc-machining",
    iconName: "Settings",
    link: "/services/cnc-machining",
    delay: 0,
    image: "/lovable-uploads/200d9297-1d4c-4f58-a7d0-492ec78f506b.png"
  },
  {
    id: "sheet-metal",
    iconName: "Layers",
    link: "/services/sheet-metal",
    delay: 100,
    image: "/lovable-uploads/f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png"
  },
  {
    id: "3d-printing",
    iconName: "Package",
    link: "/services/3d-printing",
    delay: 200,
    image: "/lovable-uploads/59f13e48-0a66-4e3a-a3c3-e9db4fa53d08.png"
  },
  {
    id: "injection-molding",
    iconName: "Factory",
    link: "/services/injection-molding",
    delay: 300,
    image: "/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png"
  },
  {
    id: "surface-finishing",
    iconName: "Wrench",
    link: "/services/surface-finishing",
    delay: 400,
    image: "/lovable-uploads/e4960d66-a6c4-46ae-ab67-f061530c38cb.png"
  },
  {
    id: "rapid-prototyping",
    iconName: "Clock",
    link: "/services/rapid-prototyping",
    delay: 500,
    image: "/lovable-uploads/solidworks-rapid-prototyping.png"
  }
];

export interface WorkflowStepItem {
  title: string;
  description: string;
  iconName: string;
  image: string;
  step: number;
}

export const workflowSteps: WorkflowStepItem[] = [
  {
    title: "Upload Your Files",
    description: "Upload your CAD files in any common format (STL, STEP, etc.) and receive an instant quote with detailed pricing breakdown.",
    iconName: "Upload",
    image: "/lovable-uploads/f239043e-a42b-4b5f-8fa3-8c964cdf24ab.png",
    step: 1
  },
  {
    title: "Choose Manufacturing Process",
    description: "Select your preferred manufacturing process, material specifications, and surface finish from our wide range of options.",
    iconName: "Settings",
    image: "/lovable-uploads/d6fe3791-124e-467d-b139-0de39711af5e.png",
    step: 2
  },
  {
    title: "Place Your Order",
    description: "Review your order details, make any final adjustments, and securely complete your purchase with multiple payment options.",
    iconName: "ShoppingCart",
    image: "/lovable-uploads/16c64550-bebe-424d-b0a9-1897d23c0968.png",
    step: 3
  },
  {
    title: "Receive Your Parts",
    description: "We manufacture your parts with precision and ship them directly to your specified address with real-time tracking.",
    iconName: "Truck",
    image: "/lovable-uploads/e684a8c7-882d-4e2a-b7f1-c2390897e274.png",
    step: 4
  }
];

export const quoteBenefits = [
  { text: "Professional engineering review for every project" },
  { text: "Direct communication with our manufacturing team" },
  { text: "Consistent quality across all production runs" },
  { text: "Full control over your intellectual property" }
];

export const testimonials = [
  {
    quote: "Microns Hub delivered our prototype parts in just 3 days. The quality was exceptional and helped us meet our tight development timeline.",
    author: "Natela Desiatova",
    position: "Product Manager",
    company: "TechInnovate"
  },
  {
    quote: "The online quoting system is incredibly easy to use. We uploaded our CAD files and had pricing within minutes. The parts arrived exactly as specified.",
    author: "Matt Exner",
    position: "Engineering Director",
    company: "AeroTech Systems"
  },
  {
    quote: "We've been using Microns Hub for all our manufacturing needs. Their combination of quality, speed, and competitive pricing is unmatched in Greece.",
    author: "David Sides",
    position: "CEO",
    company: "NextGen Medical"
  }
];

export interface Industry {
  id: string;
  name: string;
  image: string;
}

export const industries: Industry[] = [
  { id: "aerospace", name: "Aerospace", image: "/lovable-uploads/b8cf7ba7-ff7c-4b2f-b0f3-6e2a22c67a56.png" },
  { id: "automotive", name: "Automotive", image: "/lovable-uploads/60e70592-dead-43bf-8e13-84721335759b.png" },
  { id: "consumer-goods", name: "Consumer Goods", image: "/lovable-uploads/af68ca9b-890c-4621-9c34-647ab740638a.png" },
  { id: "education", name: "Education", image: "/lovable-uploads/3039d310-f098-41d9-bd6d-f0bbd96cd6d0.png" },
  { id: "electronics", name: "Electronics", image: "/lovable-uploads/5e121727-74d3-4cd9-a408-cbc38c44eb3d.png" },
  { id: "energy", name: "Energy", image: "/lovable-uploads/826bb430-78bf-44d2-bd1a-51ffc0114f0c.png" },
  { id: "engineering", name: "Engineering", image: "/lovable-uploads/b85d87d8-d572-45bb-96f5-0fc03ef5527b.png" },
  { id: "machine-building", name: "Machine Building", image: "/lovable-uploads/a47a5177-0329-402a-97c3-aa30856e045f.png" },
  { id: "medical", name: "Medical", image: "/lovable-uploads/87b2d570-3452-484d-95f7-9f5f5e34302b.png" },
  { id: "robotics", name: "Robotics and Automation", image: "/lovable-uploads/f9f6c191-3f92-4b8d-be22-0c26f59e729b.png" }
];
