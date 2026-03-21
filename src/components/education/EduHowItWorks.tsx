import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowRight } from 'lucide-react';

const steps = [
  {
    number: '01',
    title: 'Verify Your University',
    description:
      'Sign up with your .edu or university email address. Instant verification for most recognised European institutions.',
    detail: 'Supports .edu, .ac.uk, .ac.gr, .uni-*.de, .edu.fr, and hundreds more domains.',
  },
  {
    number: '02',
    title: 'Upload Your CAD',
    description:
      'Drop your STEP, STP, IGES, or STL file into our instant quoting engine. No account needed to start.',
    detail: 'Supported: .step .stp .iges .igs .sldprt .3dm .x_t .stl',
  },
  {
    number: '03',
    title: 'Configure & Quote',
    description:
      'Select material, quantity, surface finish, and lead time. See your educational price instantly — no waiting.',
    detail: 'Your 10–15% educational discount is applied automatically at checkout.',
  },
  {
    number: '04',
    title: 'We Manufacture',
    description:
      'Our network of vetted European manufacturing partners produces your parts to specification with full quality control.',
    detail: 'Data-driven quality management. Inspection reports available on request.',
  },
  {
    number: '05',
    title: 'Delivered to Your Lab',
    description:
      'Parts shipped directly to your university address. Pan-European delivery in 4–9 working days.',
    detail: 'Climate-neutral shipping. Tracking provided. No customs issues within the EU.',
  },
];

const EduHowItWorks: React.FC = () => {
  const { getLocalizedPath } = useLanguage();

  return (
    <section id="how-it-works" className="section bg-[#F5F7FA]">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-[#FF5722] font-semibold text-sm uppercase tracking-widest mb-3">
            The Process
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1D1D1D] mb-5 tracking-tight">
            From CAD File to Your Lab in 5 Steps
          </h2>
          <p className="text-[#6C757D] text-lg leading-relaxed">
            Ordering manufacturing parts shouldn't be complicated. We've made it as simple as
            uploading a file.
          </p>
        </div>

        {/* Steps */}
        <div className="relative">
          {/* Connecting line (desktop) */}
          <div className="hidden lg:block absolute left-[52px] top-16 bottom-16 w-px bg-gradient-to-b from-[#1F4690]/20 via-[#1F4690] to-[#1F4690]/20" />

          <div className="space-y-6">
            {steps.map((step, i) => (
              <div
                key={i}
                className="relative flex gap-6 lg:gap-10 items-start group"
              >
                {/* Step number */}
                <div className="flex-shrink-0 relative">
                  <div className="w-[104px] h-[104px] rounded-2xl bg-white border-2 border-[#1F4690]/20 group-hover:border-[#1F4690] flex flex-col items-center justify-center transition-all duration-200 shadow-sm group-hover:shadow-md z-10 relative">
                    <span className="font-mono text-xs text-[#6C757D] font-bold">STEP</span>
                    <span className="font-mono text-3xl font-extrabold text-[#1F4690]">
                      {step.number}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 bg-white rounded-2xl border border-gray-100 p-6 group-hover:border-[#1F4690]/20 group-hover:shadow-lg transition-all duration-300">
                  <h3 className="text-lg font-bold text-[#1D1D1D] mb-2">{step.title}</h3>
                  <p className="text-[#4A4A4A] text-sm leading-relaxed mb-3">{step.description}</p>
                  <p className="font-mono text-xs text-[#6C757D] bg-[#F5F7FA] rounded-lg px-3 py-2 inline-block">
                    {step.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-14">
          <Link
            to={getLocalizedPath('/quote')}
            className="inline-flex items-center gap-2 bg-[#1F4690] hover:bg-[#162E5E] text-white font-semibold px-8 py-4 rounded-xl transition-all duration-200 text-base shadow hover:shadow-lg hover:shadow-[#1F4690]/30 hover:-translate-y-0.5"
          >
            Start Your Quote Now
            <ArrowRight size={18} />
          </Link>
          <p className="text-[#6C757D] text-sm mt-3">
            No account required. Instant educational pricing.
          </p>
        </div>
      </div>
    </section>
  );
};

export default EduHowItWorks;
