import React from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';

const testimonials = [
  {
    quoteKey: 'service_3d-printing_testimonial_1_quote',
    nameKey: 'service_3d-printing_testimonial_1_name',
    companyKey: 'service_3d-printing_testimonial_1_company',
    defaultQuote: '3D printing enabled us to bring our product to market much faster.',
    defaultName: 'Lisa Schmidt',
    defaultCompany: 'Startup Solutions'
  },
  {
    quoteKey: 'service_3d-printing_testimonial_2_quote',
    nameKey: 'service_3d-printing_testimonial_2_name',
    companyKey: 'service_3d-printing_testimonial_2_company',
    defaultQuote: 'Excellent quality and support for our prototyping needs.',
    defaultName: 'Markus Weber',
    defaultCompany: 'Tech Innovations AG'
  },
  {
    name: "Jessica Reed",
    position: "Senior Product Manager, InnovateX Labs",
    image: "/placeholder.svg",
    text: "Microns Hub's 3D printing service helped us iterate quickly on our prototype designs. The quality and speed of delivery exceeded our expectations."
  },
  {
    name: "Carlos Mendoza",
    position: "Lead Product Strategist, QuantumWave Solutions",
    image: "/placeholder.svg",
    text: "We've been working with Microns Hub for over a year now, and their 3D printing capabilities have been instrumental in bringing our complex designs to life."
  },
  {
    name: "Aisha Thompson",
    position: "Director of Product Development, ApexDynamics Corp.",
    image: "/placeholder.svg",
    text: "When we needed custom parts with intricate geometries for our medical devices, Microns Hub delivered flawlessly with their advanced 3D printing technologies."
  },
  {
    name: "Liam O'Connor",
    position: "Head of Product Innovation, NovaTech Industries",
    image: "/placeholder.svg",
    text: "The consistency and quality of Microns Hub's 3D printed parts have allowed us to streamline our production process significantly."
  }
];

const TestimonialsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-brand-light">
      <div className="container-custom">
        <h2 className="text-3xl font-bold text-center mb-12">{t('service_3d-printing_testimonials_heading', 'Customer Testimonials')}</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {testimonials.map((testimonial, index) => (
            <div key={index} className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center mr-3">
                  {testimonial.image ? (
                    <img 
                      src={testimonial.image} 
                      alt={testimonial.name} 
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <User size={24} className="text-gray-400" />
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-brand-dark">{t(testimonial.nameKey, testimonial.defaultName)}</h4>
                  <p className="text-sm text-gray-600">{t(testimonial.companyKey, testimonial.defaultCompany)}</p>
                </div>
              </div>
              <p className="text-gray-700 italic">"{t(testimonial.quoteKey, testimonial.defaultQuote)}"</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
