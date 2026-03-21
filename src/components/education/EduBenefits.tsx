import React from 'react';

const benefits = [
  {
    icon: '🌍',
    title: 'Pan-European Delivery',
    desc: 'Parts shipped to any university in Europe. Climate-neutral logistics. No customs hassle within the EU.',
  },
  {
    icon: '💶',
    title: 'Student-Friendly Pricing',
    desc: 'Up to 15% educational discount. No minimum order. Even 1 prototype part is welcome.',
  },
  {
    icon: '⚡',
    title: 'Fast Lead Times',
    desc: '4–9 working days standard. Express options available when your deadline is tomorrow.',
  },
  {
    icon: '📋',
    title: 'University Procurement Compatible',
    desc: 'We work with PO numbers, NET30/60 terms, and institutional invoicing. Your procurement office will love us.',
  },
  {
    icon: '🔩',
    title: '50+ Materials',
    desc: 'Aluminum, titanium, stainless steel, engineering plastics, resins — whatever your project demands.',
  },
  {
    icon: '✅',
    title: 'Free DFM Feedback',
    desc: 'Upload your CAD and get free Design for Manufacturability analysis. We flag issues before production begins.',
  },
];

const EduBenefits: React.FC = () => {
  return (
    <section id="benefits" className="section bg-[#1F4690]">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-[#FF5722] font-semibold text-sm uppercase tracking-widest mb-3">
            Why Teams Choose Us
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-5 tracking-tight">
            Why European Engineering Teams Choose Microns Hub
          </h2>
          <p className="text-white/70 text-lg leading-relaxed">
            We've built our platform specifically around the needs of academic engineers — from lone
            thesis students to entire university departments.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {benefits.map((b, i) => (
            <div
              key={i}
              className="group bg-white/8 hover:bg-white/14 border border-white/15 rounded-2xl p-7 transition-all duration-300 hover:-translate-y-0.5"
            >
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center text-2xl mb-5">
                {b.icon}
              </div>
              <h3 className="text-white font-bold text-lg mb-2">{b.title}</h3>
              <p className="text-white/70 text-sm leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>

        {/* Stats row */}
        <div className="mt-16 pt-10 border-t border-white/15 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: '4–9', label: 'Day delivery' },
            { value: '50+', label: 'Materials available' },
            { value: '±0.01mm', label: 'CNC tolerance' },
            { value: '100%', label: 'EU-based manufacturing' },
          ].map((stat, i) => (
            <div key={i} className="text-center">
              <div className="font-mono text-3xl md:text-4xl font-extrabold text-white mb-1">
                {stat.value}
              </div>
              <div className="text-white/60 text-sm uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default EduBenefits;
