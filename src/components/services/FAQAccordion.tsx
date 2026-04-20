import React from 'react';
import type { FAQItem } from '@/lib/service-pages';

interface FAQAccordionProps {
  items: FAQItem[];
  heading?: string;
}

const FAQAccordion: React.FC<FAQAccordionProps> = ({ items, heading }) => {
  if (!items?.length) return null;

  return (
    <section className="py-16">
      <div className="container-custom max-w-3xl">
        {heading && (
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">{heading}</h2>
        )}
        <div className="space-y-3">
          {items.map((item, i) => (
            <details
              key={`${item.question}-${i}`}
              className="group border border-brand-dark/10 rounded-lg bg-white overflow-hidden"
            >
              <summary className="flex items-center justify-between cursor-pointer list-none px-5 py-4 font-medium text-brand-dark hover:bg-brand-dark/5">
                <span className="pr-4">{item.question}</span>
                <span
                  className="flex-shrink-0 w-6 h-6 rounded-full border border-brand-dark/20 flex items-center justify-center text-brand-dark transition-transform group-open:rotate-45"
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>
              <div className="px-5 pb-5 text-brand-dark/80 leading-relaxed">
                {item.answer}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQAccordion;
