import React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import type { ContentFAQItem } from '@/hooks/useContentPage';

interface FaqAccordionProps {
  items: ContentFAQItem[];
  heading?: string;
}

const FaqAccordion: React.FC<FaqAccordionProps> = ({
  items,
  heading = 'Frequently Asked Questions',
}) => {
  if (!items || items.length === 0) return null;

  return (
    <section className="section bg-white">
      <div className="container-custom">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-10 text-center tracking-tight">
            {heading}
          </h2>
          <Accordion type="single" collapsible className="space-y-3">
            {items.map((item, i) => (
              <AccordionItem
                key={`${item.q}-${i}`}
                value={`item-${i}`}
                className="bg-white border border-gray-100 rounded-lg shadow-sm hover:shadow-md transition-shadow px-5"
              >
                <AccordionTrigger className="text-left font-semibold text-brand-dark hover:no-underline py-4">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-brand-dark/80 leading-relaxed pb-4">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default FaqAccordion;
