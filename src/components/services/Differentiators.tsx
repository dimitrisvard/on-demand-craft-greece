import React from 'react';
import { Check, Zap, Clock, Shield, Award } from 'lucide-react';
import type { Differentiator } from '@/lib/service-pages';

interface DifferentiatorsProps {
  items: Differentiator[];
  heading?: string;
}

const iconCycle = [Check, Zap, Clock, Shield, Award];

const Differentiators: React.FC<DifferentiatorsProps> = ({ items, heading }) => {
  if (!items?.length) return null;

  return (
    <section className="py-16 bg-brand-dark/5">
      <div className="container-custom">
        {heading && (
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8 text-center">
            {heading}
          </h2>
        )}
        <div className="grid gap-6 lg:grid-cols-3">
          {items.map((item, i) => {
            const Icon = iconCycle[i % iconCycle.length];
            return (
              <div
                key={`${item.title}-${i}`}
                className="border border-brand-dark/10 rounded-lg bg-white p-6"
              >
                <div className="w-12 h-12 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center mb-4">
                  <Icon size={24} aria-hidden="true" />
                </div>
                <h3 className="font-semibold text-brand-dark text-lg mb-2">{item.title}</h3>
                <p className="text-brand-dark/80 leading-relaxed">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Differentiators;
