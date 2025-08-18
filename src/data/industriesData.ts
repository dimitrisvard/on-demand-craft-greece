
import { Industry } from '../components/home/data';

// Define the industry data
export const industriesData: Industry[] = [
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

// Define the case study type
export interface CaseStudy {
  id: string;
  title: string;
  client: string;
  industry: string;
  image: string;
  description: string;
  challenge?: string;
  solution?: string;
  results?: string;
}

// Add featured case studies
export const featuredCaseStudies: CaseStudy[] = [
  {
    id: "aerospace-lightweight-component",
    title: "Lightweight Component Redesign for Aircraft",
    client: "Major Aerospace Manufacturer",
    industry: "aerospace",
    image: "/lovable-uploads/b8cf7ba7-ff7c-4b2f-b0f3-6e2a22c67a56.png",
    description: "Redesigning a critical component to reduce weight while maintaining structural integrity.",
    challenge: "Reduce component weight by 30% without compromising performance or safety standards.",
    solution: "Implemented advanced topology optimization and used titanium alloy with CNC machining for precision parts.",
    results: "Achieved 35% weight reduction and passed all FAA certification tests."
  },
  {
    id: "automotive-rapid-prototype",
    title: "Rapid Prototyping for Electric Vehicle Parts",
    client: "European EV Startup",
    industry: "automotive",
    image: "/lovable-uploads/60e70592-dead-43bf-8e13-84721335759b.png",
    description: "Delivered functional prototypes for innovative EV cooling systems in record time.",
    challenge: "Create functional prototypes for testing within a two-week window to meet investor deadline.",
    solution: "Combined 3D printing for complex geometries with CNC machining for functional parts requiring tight tolerances.",
    results: "Delivered fully functional prototypes in 10 days, helping the client secure next round of funding."
  },
  {
    id: "medical-precision-instruments",
    title: "High-Precision Medical Instruments",
    client: "Leading Medical Device Company",
    industry: "medical",
    image: "/lovable-uploads/aa09169f-4106-496d-88fe-6fd893387f51.png",
    description: "Manufacturing high-precision surgical instruments with exceptional tolerances.",
    challenge: "Produce surgical instruments with tolerances under 0.01mm that could be sterilized repeatedly.",
    solution: "Developed a specialized CNC machining process with custom fixtures and 100% inspection protocol.",
    results: "Delivered instruments with 0.005mm tolerance that maintained precision after 500+ sterilization cycles."
  }
];
