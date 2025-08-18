import React from 'react';
import { useTranslation } from 'react-i18next';

const testimonials = [
  {
    quoteKey: 'service_sheet-metal_testimonial_1_quote',
    nameKey: 'service_sheet-metal_testimonial_1_name',
    companyKey: 'service_sheet-metal_testimonial_1_company',
    defaultQuote: 'Excellent quality and fast delivery for our custom sheet metal parts.',
    defaultName: 'Sven Richter',
    defaultCompany: 'Industrial Solutions AG'
  },
  {
    quoteKey: 'service_sheet-metal_testimonial_2_quote',
    nameKey: 'service_sheet-metal_testimonial_2_name',
    companyKey: 'service_sheet-metal_testimonial_2_company',
    defaultQuote: 'Great support and precision on every project.',
    defaultName: 'Petra Klein',
    defaultCompany: 'TechParts GmbH'
  }
];

const TestimonialsSection = () => {
  const { t } = useTranslation();
  return (
    <section className="py-16 bg-white">
      <div className="container-custom">
        <h2 className="text-3xl font-bold mb-6 text-center">{t('service_sheet-metal_testimonials_heading', 'Customer Testimonials')}</h2>
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