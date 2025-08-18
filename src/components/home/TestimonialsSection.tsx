import React from 'react';
import TestimonialCard from '../TestimonialCard';
import { useTranslation } from 'react-i18next';

interface Testimonial {
  quote: string;
  author: string;
  position: string;
  company: string;
}

interface TestimonialsSectionProps {
  testimonials: Testimonial[];
}

const TestimonialsSection: React.FC<TestimonialsSectionProps> = ({ testimonials }) => {
  const { t, i18n } = useTranslation();
  console.log('TestimonialsSection rendered, lang:', i18n.language);
  return (
    <section className="section">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('testimonials_title', 'What Our Clients Say')}</h2>
          <p className="text-lg text-gray-600">
            {t('testimonials_subtitle', "We've helped hundreds of companies bring their ideas to life")}
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => (
            <TestimonialCard
              key={index}
              quote={t(`testimonial_${index+1}_quote`, testimonial.quote)}
              author={t(`testimonial_${index+1}_author`, testimonial.author)}
              position={t(`testimonial_${index+1}_position`, testimonial.position)}
              company={t(`testimonial_${index+1}_company`, testimonial.company)}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
