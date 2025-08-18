
import React from 'react';
import TestimonialCard from '../TestimonialCard';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';

const testimonials = [
  {
    quote: "Microns Hub delivered our sheet metal components with incredible precision and ahead of schedule. Their attention to detail helped us launch our product on time.",
    author: "Sarah Johnson",
    position: "Production Manager",
    company: "TechMed Devices"
  },
  {
    quote: "The team at Microns Hub worked closely with us to optimize our designs for manufacturing, which ultimately saved us both time and money.",
    author: "David Chen",
    position: "Engineering Director",
    company: "Innovate Systems"
  },
  {
    quote: "We've worked with many sheet metal fabricators, but none match the quality and consistency that Microns Hub delivers. They're our go-to partner now.",
    author: "Michael Rodriguez",
    position: "Procurement Specialist",
    company: "Aerospace Dynamics"
  },
  {
    quote: "From prototyping to production, their sheet metal capabilities exceeded our expectations. The complex parts they produced were flawless.",
    author: "Jennifer Williams",
    position: "Product Development Lead",
    company: "EcoTech Solutions"
  }
];

const TestimonialsSection = () => {
  return (
    <section className="py-20 bg-gray-50">
      <div className="container-custom">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">What Our Clients Say</h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Don't just take our word for it — hear from the companies who trust us with their 
            sheet metal fabrication projects.
          </p>
        </div>
        
        <div className="max-w-5xl mx-auto">
          <Carousel className="w-full">
            <CarouselContent>
              {testimonials.map((testimonial, index) => (
                <CarouselItem key={index} className="md:basis-1/2 lg:basis-1/2 p-2">
                  <TestimonialCard
                    quote={testimonial.quote}
                    author={testimonial.author}
                    position={testimonial.position}
                    company={testimonial.company}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <div className="flex justify-center gap-2 mt-8">
              <CarouselPrevious className="relative static translate-y-0 h-10 w-10" />
              <CarouselNext className="relative static translate-y-0 h-10 w-10" />
            </div>
          </Carousel>
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
