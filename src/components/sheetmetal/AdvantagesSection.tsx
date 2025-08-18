
import React from 'react';
import { Clock, Settings, Shield } from 'lucide-react';

const advantages = [
  {
    title: 'Fast',
    icon: <Clock className="h-12 w-12 text-brand-accent mb-4" />,
    points: [
      'Quick turnaround times - as fast as 3-5 days',
      'Streamlined online quotation system',
      '24/7 production capabilities for urgent jobs',
    ]
  },
  {
    title: 'Versatile',
    icon: <Settings className="h-12 w-12 text-brand-accent mb-4" />,
    points: [
      'Wide range of materials and thicknesses',
      'Multiple fabrication processes under one roof',
      'From simple brackets to complex assemblies',
    ]
  },
  {
    title: 'Reliable',
    icon: <Shield className="h-12 w-12 text-brand-accent mb-4" />,
    points: [
      'ISO 9001:2015 certified quality system',
      'Comprehensive inspection and reporting',
      'Consistent repeatability for production runs',
    ]
  }
];

const AdvantagesSection = () => {
  return (
    <section className="py-20 bg-brand-light">
      <div className="container-custom">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Why Choose Our Sheet Metal Services</h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            We combine cutting-edge technology with decades of expertise to deliver 
            exceptional quality, speed, and value.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {advantages.map((advantage) => (
            <div key={advantage.title} className="text-center p-6 bg-white rounded-lg shadow-sm">
              <div className="flex justify-center">{advantage.icon}</div>
              <h3 className="text-2xl font-bold mb-4">{advantage.title}</h3>
              <ul className="space-y-3 text-left">
                {advantage.points.map((point, index) => (
                  <li key={index} className="flex items-start">
                    <span className="inline-block h-2 w-2 bg-brand-accent rounded-full mt-2 mr-2"></span>
                    <span className="text-gray-700">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default AdvantagesSection;
