import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowRight } from 'lucide-react';

const cases = [
  {
    emoji: '🏎️',
    label: 'Formula Student Team',
    title: 'Competition Deadline? Delivered.',
    story:
      'A Formula Student team needed 23 CNC-machined aluminum suspension components delivered in 6 days before their competition. Microns Hub delivered on time, under budget — the team finished 3rd overall.',
    services: ['CNC Machining', 'Anodizing'],
    material: 'Aluminum 7075-T6',
    tag: 'Competition',
    tagColor: '#FF5722',
  },
  {
    emoji: '🤖',
    label: 'Robotics Research Lab',
    title: 'Rapid Iteration at Scale',
    story:
      'A university robotics lab needed rapid iteration on custom gripper mechanisms. Over 12 months they ordered 150+ unique 3D-printed and machined parts — all through one platform with simplified PO-based ordering.',
    services: ['SLS 3D Printing', 'CNC Machining'],
    material: 'Nylon PA12, Stainless Steel 316L',
    tag: 'Research',
    tagColor: '#1F4690',
  },
  {
    emoji: '📐',
    label: "Master's Thesis Project",
    title: 'Thesis-Quality Precision',
    story:
      'A mechanical engineering student designed a novel heat exchanger for their thesis. Microns Hub manufactured the prototype in copper with ±0.02mm tolerance, plus free DFM feedback that improved the design before production.',
    services: ['CNC Machining'],
    material: 'Copper C110',
    tag: 'Student Project',
    tagColor: '#3A5BA0',
  },
  {
    emoji: '✈️',
    label: 'Aerospace Research Group',
    title: 'Certified Materials, No Compromises',
    story:
      'A university aerospace department required titanium test fixtures for wind tunnel experiments. Microns Hub delivered Grade 5 titanium parts with full material certification.',
    services: ['CNC Machining', 'Surface Treatment'],
    material: 'Titanium Grade 5 (Ti-6Al-4V)',
    tag: 'Research',
    tagColor: '#1F4690',
  },
];

const EduCaseStudies: React.FC = () => {
  const { getLocalizedPath } = useLanguage();

  return (
    <section id="case-studies" className="section bg-white">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-[#FF5722] font-semibold text-sm uppercase tracking-widest mb-3">
            Use Cases
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1D1D1D] mb-5 tracking-tight">
            Engineering Projects We're Proud to Support
          </h2>
          <p className="text-[#6C757D] text-lg leading-relaxed">
            From single thesis prototypes to full-season competition manufacturing — here's how
            engineering teams across Europe use Microns Hub.
          </p>
          <p className="text-[#6C757D] text-xs mt-2 italic">
            * Illustrative case studies. Real project details used with permission.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {cases.map((c, i) => (
            <div
              key={i}
              className="group rounded-2xl border border-gray-100 bg-white hover:border-[#1F4690]/25 hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col"
            >
              {/* Top accent bar */}
              <div className="h-1.5" style={{ background: c.tagColor }} />

              <div className="p-8 flex flex-col flex-1">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{c.emoji}</span>
                    <div>
                      <span
                        className="text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-full inline-block mb-1"
                        style={{ background: `${c.tagColor}15`, color: c.tagColor }}
                      >
                        {c.tag}
                      </span>
                      <p className="text-xs text-[#6C757D] font-medium">{c.label}</p>
                    </div>
                  </div>
                </div>

                <h3 className="text-xl font-bold text-[#1D1D1D] mb-3">{c.title}</h3>
                <p className="text-[#4A4A4A] text-sm leading-relaxed mb-6 flex-1">{c.story}</p>

                {/* Meta */}
                <div className="border-t border-gray-100 pt-5 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {c.services.map((svc, j) => (
                      <span
                        key={j}
                        className="text-xs bg-[#1F4690]/8 text-[#1F4690] font-semibold px-3 py-1 rounded-full"
                      >
                        {svc}
                      </span>
                    ))}
                  </div>
                  <p className="font-mono text-xs text-[#6C757D]">
                    <span className="text-[#4A4A4A] font-semibold">Material: </span>
                    {c.material}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            to={getLocalizedPath('/quote')}
            className="inline-flex items-center gap-2 bg-[#FF5722] hover:bg-[#E64A19] text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 shadow hover:shadow-lg hover:shadow-[#FF5722]/30 hover:-translate-y-0.5"
          >
            Start Your Own Project
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default EduCaseStudies;
