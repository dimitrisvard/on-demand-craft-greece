import React from 'react';
import type { ProcessStep } from '@/lib/service-pages';

interface ProcessStepsProps {
  steps: ProcessStep[];
  heading?: string;
}

const ProcessSteps: React.FC<ProcessStepsProps> = ({ steps, heading }) => {
  if (!steps?.length) return null;

  const ordered = [...steps].sort((a, b) => a.step - b.step);

  return (
    <section className="py-16 bg-brand-dark/5">
      <div className="container-custom">
        {heading && (
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">{heading}</h2>
        )}

        <div className="hidden lg:block relative">
          <div className="absolute top-6 left-0 right-0 h-0.5 bg-brand-primary/30" aria-hidden="true" />
          <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${ordered.length}, minmax(0, 1fr))` }}>
            {ordered.map((s) => (
              <li key={s.step} className="px-3 text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-brand-primary text-white flex items-center justify-center font-bold text-lg relative z-10">
                  {s.step}
                </div>
                <h3 className="mt-4 font-semibold text-brand-dark">{s.title}</h3>
                <p className="mt-2 text-sm text-brand-dark/70 leading-relaxed">{s.description}</p>
              </li>
            ))}
          </ol>
        </div>

        <ol className="lg:hidden space-y-6">
          {ordered.map((s) => (
            <li key={s.step} className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-brand-primary text-white flex items-center justify-center font-bold">
                {s.step}
              </div>
              <div>
                <h3 className="font-semibold text-brand-dark">{s.title}</h3>
                <p className="mt-1 text-sm text-brand-dark/70 leading-relaxed">{s.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
};

export default ProcessSteps;
