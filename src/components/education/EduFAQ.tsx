import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    q: 'Who qualifies for the educational discount?',
    a: 'Any student (undergraduate, master\'s, PhD), researcher, faculty member, or staff at a recognised European university or technical institution. You\'ll need a valid university email address for verification.',
  },
  {
    q: 'How much is the discount?',
    a: '10–15% off standard pricing across all services — CNC machining, 3D printing, sheet metal, and injection molding. Sponsorship tiers offer even higher discounts (up to 40% for Formula Student and robotics teams).',
  },
  {
    q: 'Can I pay with a university purchase order (PO)?',
    a: 'Yes! We support institutional invoicing with NET30 and NET60 payment terms. We generate VAT-compliant invoices for all EU countries. Your procurement office can set up a direct billing arrangement with us.',
  },
  {
    q: 'Is there a minimum order quantity?',
    a: 'No minimum. You can order a single prototype part. We\'re here for 1-piece thesis projects and 500-piece competition runs alike. Every order gets the same quality and attention.',
  },
  {
    q: 'How fast can you deliver?',
    a: 'Standard lead time is 4–9 working days from order confirmation. Express options are available for urgent deadlines. We ship to all European countries — including Switzerland, Norway, and the UK.',
  },
  {
    q: 'What file formats do you accept?',
    a: 'STEP (.step, .stp), IGES (.iges, .igs), SolidWorks (.sldprt), Rhino (.3dm), SAT, Parasolid (.x_t), and STL for 3D printing. We recommend STEP for the best compatibility with our quoting engine.',
  },
  {
    q: 'How do I apply for team sponsorship?',
    a: 'Fill out our sponsorship application form with your team details, competition info, expected parts needed, and social media links. We review applications on a rolling basis and respond within 5 business days.',
  },
  {
    q: 'Can you help with design improvements?',
    a: 'Absolutely. Every educational order includes free DFM (Design for Manufacturability) feedback. We\'ll flag potential issues and suggest improvements before production begins — saving you time and money.',
  },
  {
    q: 'Do you handle customs and import duties?',
    a: 'For EU shipments, there are no customs issues — it\'s a single market. For Switzerland, Norway, and UK universities, we handle all export documentation and can advise on applicable duties.',
  },
  {
    q: 'What is the Microns Hub Engineering Knowledge Base?',
    a: 'Our blog at micronshub.eu/en/blog is a massive, free engineering resource with 365+ articles and growing — we publish a new in-depth article every single day. Topics cover CNC machining fundamentals, material selection, surface finishing techniques, DFM best practices, CAD/CAM workflows, G-code programming, and AI in manufacturing. It\'s designed as a daily learning resource for engineering students, researchers, and competition teams. Subscribe free to get each new article delivered to your inbox.',
  },
];

const EduFAQ: React.FC = () => {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="faq" className="section bg-white">
      <div className="container-custom">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <p className="text-[#FF5722] font-semibold text-sm uppercase tracking-widest mb-3">
            Questions Answered
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#1D1D1D] mb-5 tracking-tight">
            Frequently Asked Questions
          </h2>
          <p className="text-[#6C757D] text-lg leading-relaxed">
            Everything you need to know about our education program. Can't find your answer?{' '}
            <a
              href="mailto:education@micronshub.eu"
              className="text-[#1F4690] font-semibold hover:underline"
            >
              Email us directly.
            </a>
          </p>
        </div>

        <div className="max-w-3xl mx-auto space-y-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="border border-gray-100 rounded-2xl overflow-hidden bg-white hover:border-[#1F4690]/20 transition-colors duration-200"
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 text-left px-6 py-5 font-semibold text-[#1D1D1D] hover:text-[#1F4690] transition-colors duration-200"
                aria-expanded={open === i}
              >
                <span className="text-sm md:text-base">{faq.q}</span>
                <ChevronDown
                  size={18}
                  className={`flex-shrink-0 text-[#1F4690] transition-transform duration-300 ${
                    open === i ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {open === i && (
                <div className="px-6 pb-5">
                  <div className="pt-0 border-t border-gray-50">
                    <p className="text-[#4A4A4A] text-sm leading-relaxed pt-4">{faq.a}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* FAQ structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqs.map((faq) => ({
              '@type': 'Question',
              name: faq.q,
              acceptedAnswer: {
                '@type': 'Answer',
                text: faq.a,
              },
            })),
          }),
        }}
      />
    </section>
  );
};

export default EduFAQ;
