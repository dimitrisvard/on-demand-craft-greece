import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowRight, Upload, Clock, Percent, BookOpen, Globe } from 'lucide-react';

const trustBadges = [
  { icon: <Globe size={16} />, text: 'Delivery Across All of Europe' },
  { icon: <Clock size={16} />, text: '4–9 Working Day Lead Times' },
  { icon: <Percent size={16} />, text: '10–15% Educational Discount' },
  { icon: <BookOpen size={16} />, text: '150+ Free Engineering Articles' },
];

const EduHero: React.FC = () => {
  const { getLocalizedPath } = useLanguage();

  return (
    <section
      id="hero"
      className="relative min-h-[92vh] flex items-center overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0D1B2A 0%, #1F4690 55%, #162E5E 100%)',
      }}
    >
      {/* Technical grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Subtle geometric accent */}
      <div
        className="absolute top-0 right-0 w-[55%] h-full opacity-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 80% at 80% 50%, #FF5722 0%, transparent 70%)',
        }}
      />

      <div className="container-custom relative z-10 py-24 md:py-32">
        <div className="max-w-4xl">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#FF5722] animate-pulse" />
            <span className="text-white/90 text-sm font-medium tracking-wide uppercase">
              Education &amp; University Partnerships
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white leading-[1.08] tracking-tight mb-6">
            Engineering the Future,{' '}
            <span className="text-[#FF5722]">Together.</span>
          </h1>

          {/* Subheadline */}
          <p className="text-white/80 text-lg md:text-xl max-w-3xl leading-relaxed mb-10">
            Microns Hub partners with universities, research labs, Formula Student teams, and
            student engineering projects across Europe. Get exclusive educational pricing,
            dedicated support, parts delivered in as fast as&nbsp;4 working days, and access
            to our daily engineering knowledge base with&nbsp;
            <span className="text-white font-semibold">150+ free in-depth articles</span> on
            manufacturing, materials, and design.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 mb-12">
            <Link
              to={getLocalizedPath('/quote')}
              className="inline-flex items-center justify-center gap-2 bg-[#FF5722] hover:bg-[#E64A19] text-white font-semibold px-8 py-4 rounded-lg transition-all duration-200 text-lg shadow-lg shadow-[#FF5722]/30 hover:shadow-[#FF5722]/50 hover:-translate-y-0.5"
            >
              Get Your Educational Quote
              <ArrowRight size={20} />
            </Link>
            <a
              href="#tiers"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold px-8 py-4 rounded-lg transition-all duration-200 text-lg backdrop-blur-sm"
            >
              Apply for Sponsorship
            </a>
          </div>

          {/* Text link */}
          <a
            href="#knowledge-hub"
            className="inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors text-base font-medium"
          >
            <BookOpen size={16} />
            Explore 150+ Free Engineering Articles
            <ArrowRight size={14} />
          </a>
        </div>

        {/* Trust badges */}
        <div className="mt-16 pt-8 border-t border-white/10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {trustBadges.map((badge, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-[#FF5722]">
                  {badge.icon}
                </div>
                <span className="text-white/80 text-sm font-medium leading-snug">
                  {badge.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default EduHero;
