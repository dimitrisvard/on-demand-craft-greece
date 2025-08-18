import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
const CaseStudySection = () => {
  return <section className="py-20 bg-white">
      <div className="container-custom">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Featured Case Study</h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            See how our sheet metal fabrication expertise solved real-world challenges.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div>
            <img src="https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?q=80&w=1470&auto=format&fit=crop" alt="Industrial control panel assembly" className="rounded-lg shadow-md w-full h-auto object-cover" />
          </div>
          
          <div>
            <h3 className="text-2xl font-bold mb-2">Custom Control Panel Enclosures</h3>
            <p className="text-sm text-brand-accent font-medium mb-4">Aerospace Industry</p>
            
            <p className="text-gray-700 mb-4">
              A leading aerospace manufacturer needed custom control panel enclosures 
              for their testing equipment. The requirements included precision cutouts, 
              EMI shielding, and a specialized coating for harsh environments.
            </p>
            
            <div className="space-y-3 mb-6">
              <div className="flex">
                <span className="font-semibold text-brand-dark w-32">Challenge:</span>
                <span className="text-gray-700">Complex design with tight tolerances and specialized coating requirements</span>
              </div>
              <div className="flex">
                <span className="font-semibold text-brand-dark w-32">Solution:</span>
                <span className="text-gray-700">Precision laser cutting combined with CNC bending and custom powder coating</span>
              </div>
              <div className="flex">
                <span className="font-semibold text-brand-dark w-32">Result:</span>
                <span className="text-gray-700">40% reduction in assembly time and 100% pass rate for EMI testing</span>
              </div>
            </div>
            
            
          </div>
        </div>
      </div>
    </section>;
};
export default CaseStudySection;