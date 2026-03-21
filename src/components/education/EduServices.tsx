import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowRight } from 'lucide-react';

const services = [
  {
    emoji: '⚙️',
    name: 'CNC Machining',
    description:
      'From suspension uprights to test fixtures — precision metal and plastic parts with tolerances down to ±0.01mm. Ideal for Formula Student components, research apparatus, and functional prototypes.',
    specs: ['3/4/5-axis milling & turning', '50+ metals & plastics', 'From 1 piece', 'Tolerances to ±0.01mm'],
    href: '/services/cnc-machining',
    color: '#1F4690',
  },
  {
    emoji: '🖨️',
    name: '3D Printing',
    description:
      'Rapid iteration for concept models, wind tunnel parts, enclosures, and complex geometries. Multiple technologies from affordable FDM to production-grade MJF and metal DMLS.',
    specs: ['FDM, SLA, SLS, MJF, DMLS', 'Wall thickness from 0.2mm', 'From 1 piece', 'Metals & engineering plastics'],
    href: '/services/3d-printing',
    color: '#3A5BA0',
  },
  {
    emoji: '📐',
    name: 'Sheet Metal Fabrication',
    description:
      'Brackets, enclosures, chassis panels, and mounting plates — laser cut and bent to your specs. Perfect for robot frames, electronic housings, and structural components.',
    specs: ['Laser cutting, bending, punching', '0.5mm–25mm thickness', 'Steel, aluminum, stainless', 'From 1 piece'],
    href: '/services/sheet-metal',
    color: '#1F4690',
  },
  {
    emoji: '🏭',
    name: 'Injection Molding',
    description:
      'Moving from prototype to production? Rapid tooling and injection molding for plastic components at scale — from 100 to 100,000+ pieces.',
    specs: ['Rapid tooling from 15 days', '30+ plastic materials', '100 to 100,000+ pieces', 'Design assistance included'],
    href: '/services/injection-molding',
    color: '#3A5BA0',
  },
];

const EduServices: React.FC = () => {
  const { getLocalizedPath } = useLanguage();

  return (
    <section id="services" className="section bg-white">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-[#FF5722] font-semibold text-sm uppercase tracking-widest mb-3">
            Manufacturing Capabilities
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1D1D1D] mb-5 tracking-tight">
            Everything You Need, One Platform
          </h2>
          <p className="text-[#6C757D] text-lg leading-relaxed">
            From single prototype parts to departmental production runs — all services, all
            materials, all under one roof.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {services.map((service, i) => (
            <div
              key={i}
              className="group rounded-2xl border border-gray-100 bg-white hover:border-[#1F4690]/30 hover:shadow-xl transition-all duration-300 overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-start gap-5 mb-5">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ background: `${service.color}15` }}
                  >
                    {service.emoji}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#1D1D1D] mb-1">{service.name}</h3>
                    <p className="text-[#6C757D] text-sm leading-relaxed">{service.description}</p>
                  </div>
                </div>

                {/* Specs in monospace */}
                <div className="bg-[#F5F7FA] rounded-xl p-4 mb-5">
                  <div className="grid grid-cols-2 gap-2">
                    {service.specs.map((spec, j) => (
                      <div key={j} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FF5722] flex-shrink-0" />
                        <span className="font-mono text-xs text-[#4A4A4A]">{spec}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Link
                  to={getLocalizedPath(service.href)}
                  className="inline-flex items-center gap-2 text-[#1F4690] font-semibold text-sm hover:gap-3 transition-all duration-200"
                >
                  Learn more
                  <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Surface finishes note */}
        <div className="mt-10 p-6 rounded-2xl bg-[#1F4690]/5 border border-[#1F4690]/15 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="text-2xl">✨</div>
          <div className="flex-1">
            <h4 className="font-bold text-[#1D1D1D] mb-1">Surface Finishing Available</h4>
            <p className="text-[#6C757D] text-sm">
              Anodizing, powder coating, bead blasting, electroplating, painting, and heat treatment
              — complete your parts to exact specification.
            </p>
          </div>
          <Link
            to={getLocalizedPath('/services/surface-finishes')}
            className="flex-shrink-0 inline-flex items-center gap-2 text-[#1F4690] font-semibold text-sm hover:gap-3 transition-all"
          >
            Explore finishes <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default EduServices;
