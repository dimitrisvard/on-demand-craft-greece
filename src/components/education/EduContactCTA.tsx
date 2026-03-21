import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowRight, Upload, Users, Phone, BookOpen } from 'lucide-react';

const actions = [
  {
    icon: <Upload size={22} />,
    title: 'Get an Instant Quote',
    description:
      'Upload your CAD file and see educational pricing in seconds. No account needed to start.',
    cta: 'Start Your Quote',
    href: '/quote',
    primary: true,
  },
  {
    icon: <Users size={22} />,
    title: 'Apply for Sponsorship',
    description:
      'Formula Student, robotics, or competition team? Apply for sponsored manufacturing.',
    cta: 'Apply Now',
    href: '/contact',
    primary: false,
  },
  {
    icon: <Phone size={22} />,
    title: 'Discuss a Lab Partnership',
    description:
      'Department head or lab manager? Let\'s set up a custom institutional arrangement.',
    cta: 'Book a Call',
    href: '/contact',
    primary: false,
  },
  {
    icon: <BookOpen size={22} />,
    title: 'Start Learning',
    description:
      'Not ready to order yet? Explore our daily engineering articles and level up your manufacturing knowledge.',
    cta: 'Browse 365+ Free Articles',
    href: '/en/blog',
    primary: false,
    external: true,
  },
];

const EduContactCTA: React.FC = () => {
  const { getLocalizedPath } = useLanguage();

  return (
    <section id="contact" className="section bg-[#1F4690]">
      <div className="container-custom">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-5 tracking-tight">
            Ready to Build Something Extraordinary?
          </h2>
          <p className="text-white/75 text-lg leading-relaxed">
            Whether you're machining parts for Formula Student, 3D printing prototypes for your
            thesis, or equipping an entire research lab — we're here to help.
          </p>
        </div>

        {/* Action cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
          {actions.map((action, i) => (
            <div
              key={i}
              className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-6 flex flex-col hover:bg-white/15 transition-all duration-200"
            >
              <div className="w-12 h-12 bg-white/15 rounded-xl flex items-center justify-center text-white mb-5">
                {action.icon}
              </div>
              <h3 className="text-white font-bold text-base mb-2">{action.title}</h3>
              <p className="text-white/65 text-sm leading-relaxed mb-6 flex-1">
                {action.description}
              </p>
              {action.external ? (
                <a
                  href={action.href}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold text-sm transition-all duration-200 ${
                    action.primary
                      ? 'bg-[#FF5722] hover:bg-[#E64A19] text-white shadow hover:shadow-lg hover:shadow-[#FF5722]/30'
                      : 'bg-white/15 hover:bg-white/25 text-white border border-white/25'
                  }`}
                >
                  {action.cta}
                  <ArrowRight size={14} />
                </a>
              ) : (
                <Link
                  to={getLocalizedPath(action.href)}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold text-sm transition-all duration-200 ${
                    action.primary
                      ? 'bg-[#FF5722] hover:bg-[#E64A19] text-white shadow hover:shadow-lg hover:shadow-[#FF5722]/30'
                      : 'bg-white/15 hover:bg-white/25 text-white border border-white/25'
                  }`}
                >
                  {action.cta}
                  <ArrowRight size={14} />
                </Link>
              )}
            </div>
          ))}
        </div>

        {/* Contact info */}
        <div className="text-center border-t border-white/20 pt-10">
          <p className="text-white/60 text-sm mb-3">Prefer to reach out directly?</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <a
              href="mailto:education@micronshub.eu"
              className="text-white font-semibold hover:text-[#FF5722] transition-colors flex items-center gap-2"
            >
              ✉️ education@micronshub.eu
            </a>
            <span className="hidden sm:block text-white/30">|</span>
            <a
              href="tel:+302104447830"
              className="text-white font-semibold hover:text-[#FF5722] transition-colors flex items-center gap-2"
            >
              📞 +30-210-444-7830
            </a>
          </div>
          <p className="text-white/40 text-xs mt-4">
            We typically respond to education inquiries within 1 business day.
          </p>
        </div>
      </div>
    </section>
  );
};

export default EduContactCTA;
