import React from 'react';
import { useTranslation } from 'react-i18next';

const testimonials = [
  {
    quoteKey: 'service_rapid-prototyping_testimonial_1_quote',
    nameKey: 'service_rapid-prototyping_testimonial_1_name',
    companyKey: 'service_rapid-prototyping_testimonial_1_company',
    defaultQuote: 'Rapid prototyping helped us launch our product on time and within budget.',
    defaultName: 'Nina Hoffmann',
    defaultCompany: 'StartUp Lab'
  },
  {
    quoteKey: 'service_rapid-prototyping_testimonial_2_quote',
    nameKey: 'service_rapid-prototyping_testimonial_2_name',
    companyKey: 'service_rapid-prototyping_testimonial_2_company',
    defaultQuote: 'Great flexibility and support for our design iterations.',
    defaultName: 'Lars Becker',
    defaultCompany: 'Innovatech GmbH'
  }
];

const TestimonialsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_rapid-prototyping_testimonials_heading', 'Customer Testimonials')}</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {testimonials.map((test, i) => (
            <li key={i} className="bg-gray-50 rounded-lg shadow p-6">
              <blockquote className="italic text-lg mb-4">“{t(test.quoteKey, test.defaultQuote)}”</blockquote>
              <div className="font-bold">{t(test.nameKey, test.defaultName)}</div>
              <div className="text-gray-600">{t(test.companyKey, test.defaultCompany)}</div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default TestimonialsSection; 