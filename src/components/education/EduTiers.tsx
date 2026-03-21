import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  GraduationCap,
  Flag,
  FlaskConical,
  Check,
  ArrowRight,
} from 'lucide-react';

interface Tier {
  icon: React.ReactNode;
  badge: string;
  title: string;
  subtitle: string;
  audience: string;
  highlight: string;
  features: string[];
  cta: string;
  ctaHref: string;
  accent: boolean;
}

const tiers: Tier[] = [
  {
    icon: <GraduationCap size={28} />,
    badge: 'Tier 1',
    title: 'University Discount Program',
    subtitle: 'For students, researchers & faculty',
    audience:
      'Any student, researcher, PhD candidate, or faculty member with a valid university email',
    highlight: '10–15% Discount',
    features: [
      '10–15% off CNC, 3D printing, sheet metal & injection molding',
      'Access to all 50+ materials',
      'Same quality & lead times as commercial orders',
      'Free Design for Manufacturability (DFM) feedback on first order',
      'Dedicated student support via education@micronshub.eu',
      'No minimum order — even 1 piece welcome',
      'Instant university email verification',
      'Full access to 365+ Engineering Knowledge Base articles',
    ],
    cta: 'Claim Your Student Discount',
    ctaHref: '/quote',
    accent: false,
  },
  {
    icon: <Flag size={28} />,
    badge: 'Tier 2',
    title: 'Formula Student & Robotics Sponsorship',
    subtitle: 'For competition teams across Europe',
    audience:
      'Formula Student, Formula Electric, Robotics clubs, Baja SAE, EUROBOT, RoboCup, Hyperloop, and other engineering competition teams',
    highlight: 'Up to 40% Discount',
    features: [
      'Up to 40% off CNC machined & 3D printed parts',
      'Priority production during competition season (4–6 day delivery)',
      'Co-branded case study on Microns Hub website & social media',
      'Your team logo on our "Proud Partners" section',
      'Engineering consultation — design reviews for manufacturability',
      'Curated blog content paths for your competition discipline',
      'Invitation to annual Microns Hub Engineering Challenge',
    ],
    cta: 'Apply for Team Sponsorship',
    ctaHref: '/contact',
    accent: true,
  },
  {
    icon: <FlaskConical size={28} />,
    badge: 'Tier 3',
    title: 'Lab & Department Partnership',
    subtitle: 'For universities & research institutions',
    audience:
      'University department heads, lab managers, procurement officers, research group leaders',
    highlight: 'Custom Volume Pricing',
    features: [
      'Custom negotiated pricing for annual departmental needs',
      'Dedicated account manager for your lab',
      'Guaranteed lead times in partnership agreement',
      'NET30/NET60 payment terms & institutional PO support',
      'VAT-compliant invoicing across all EU countries',
      'Monthly spend tracking & usage reporting',
      'Free DFM review on every order',
      'Priority access to new services & materials',
    ],
    cta: 'Schedule a Partnership Call',
    ctaHref: '/contact',
    accent: false,
  },
];

const EduTiers: React.FC = () => {
  const { getLocalizedPath } = useLanguage();

  return (
    <section id="tiers" className="section bg-[#F5F7FA]">
      <div className="container-custom">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-[#FF5722] font-semibold text-sm uppercase tracking-widest mb-3">
            Partnership Programs
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1D1D1D] mb-5 tracking-tight">
            Built for Every Level of Academic Engineering
          </h2>
          <p className="text-[#6C757D] text-lg leading-relaxed">
            Whether you're a solo student, a competition team, or a university department — we have
            a program designed around your workflow and budget.
          </p>
        </div>

        {/* Tier cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {tiers.map((tier, i) => (
            <div
              key={i}
              className={`relative rounded-2xl flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${
                tier.accent
                  ? 'bg-[#1F4690] text-white shadow-xl shadow-[#1F4690]/30 ring-2 ring-[#FF5722]'
                  : 'bg-white text-[#1D1D1D] shadow-md'
              }`}
            >
              {tier.accent && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-[#FF5722] text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wider shadow">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="p-8 flex flex-col h-full">
                {/* Icon + Badge */}
                <div className="flex items-start justify-between mb-6">
                  <div
                    className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                      tier.accent ? 'bg-white/15 text-white' : 'bg-[#1F4690]/10 text-[#1F4690]'
                    }`}
                  >
                    {tier.icon}
                  </div>
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest ${
                      tier.accent
                        ? 'bg-white/20 text-white'
                        : 'bg-[#1F4690]/10 text-[#1F4690]'
                    }`}
                  >
                    {tier.badge}
                  </span>
                </div>

                {/* Title */}
                <h3
                  className={`text-xl font-bold mb-1 ${
                    tier.accent ? 'text-white' : 'text-[#1D1D1D]'
                  }`}
                >
                  {tier.title}
                </h3>
                <p
                  className={`text-sm mb-4 ${
                    tier.accent ? 'text-white/70' : 'text-[#6C757D]'
                  }`}
                >
                  {tier.subtitle}
                </p>

                {/* Highlight discount */}
                <div
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 mb-6 w-fit ${
                    tier.accent ? 'bg-[#FF5722] text-white' : 'bg-[#FF5722]/10 text-[#FF5722]'
                  }`}
                >
                  <span className="text-2xl font-extrabold">{tier.highlight}</span>
                </div>

                {/* Audience */}
                <p
                  className={`text-sm leading-relaxed mb-6 pb-6 border-b ${
                    tier.accent
                      ? 'text-white/75 border-white/20'
                      : 'text-[#6C757D] border-gray-100'
                  }`}
                >
                  <span className="font-semibold">For: </span>
                  {tier.audience}
                </p>

                {/* Features */}
                <ul className="space-y-3 mb-8 flex-1">
                  {tier.features.map((feat, j) => (
                    <li key={j} className="flex items-start gap-3 text-sm">
                      <Check
                        size={15}
                        className={`flex-shrink-0 mt-0.5 ${
                          tier.accent ? 'text-[#FF5722]' : 'text-[#1F4690]'
                        }`}
                      />
                      <span className={tier.accent ? 'text-white/85' : 'text-[#4A4A4A]'}>
                        {feat}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Link
                  to={getLocalizedPath(tier.ctaHref)}
                  className={`inline-flex items-center justify-center gap-2 w-full py-3.5 px-6 rounded-xl font-semibold transition-all duration-200 text-sm ${
                    tier.accent
                      ? 'bg-white text-[#1F4690] hover:bg-white/90 shadow'
                      : 'bg-[#1F4690] text-white hover:bg-[#162E5E] shadow hover:shadow-lg hover:shadow-[#1F4690]/30'
                  }`}
                >
                  {tier.cta}
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default EduTiers;
