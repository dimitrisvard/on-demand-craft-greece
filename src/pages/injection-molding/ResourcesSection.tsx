
import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ResourcesSection = () => {
  const resources = [
    {
      title: "Design Guide for Injection Molding",
      description: "Learn best practices for designing parts for injection molding, including wall thickness, draft angles, and more.",
      date: "April 2025",
      link: "#"
    },
    {
      title: "Material Selection for Injection Molded Parts",
      description: "A comprehensive guide to choosing the right material for your injection molded parts based on application requirements.",
      date: "March 2025",
      link: "#"
    },
    {
      title: "Cost Optimization in Injection Molding",
      description: "Strategies to reduce costs in your injection molding projects without sacrificing quality or performance.",
      date: "February 2025",
      link: "#"
    }
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Resources & Whitepapers</h2>
          <p className="text-gray-600 max-w-3xl mx-auto">
            Enhance your knowledge about injection molding with our free educational resources and whitepapers.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {resources.map((resource, index) => (
            <div key={index} className="border rounded-lg p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <FileText size={24} className="text-brand-accent mr-2" />
                <span className="text-sm text-gray-500">{resource.date}</span>
              </div>
              <h3 className="text-xl font-bold mb-3">{resource.title}</h3>
              <p className="text-gray-600 mb-6">{resource.description}</p>
              <Button variant="outline" className="flex items-center gap-2">
                <Download size={16} /> Download
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ResourcesSection;
