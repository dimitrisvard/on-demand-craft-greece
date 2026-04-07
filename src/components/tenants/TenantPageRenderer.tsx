import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useTenant } from '@/contexts/TenantContext';
import type {
  TenantPageContent,
  TenantPageSection,
  HeroSection,
  ServicesSection,
  StatsSection,
  CtaBannerSection,
  TestimonialsSection,
  FaqSection,
} from '@/types/tenant';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  content: TenantPageContent;
}

export default function TenantPageRenderer({ content }: Props) {
  const { tenant } = useTenant();
  const primaryColor = tenant?.primaryColor || '#2563EB';

  return (
    <div className="min-h-screen">
      {content.sections.map((section, index) => (
        <SectionRenderer key={index} section={section} primaryColor={primaryColor} />
      ))}
    </div>
  );
}

function SectionRenderer({ section, primaryColor }: { section: TenantPageSection; primaryColor: string }) {
  switch (section.type) {
    case 'hero':
      return <HeroRenderer section={section} primaryColor={primaryColor} />;
    case 'services':
      return <ServicesRenderer section={section} primaryColor={primaryColor} />;
    case 'stats':
      return <StatsRenderer section={section} primaryColor={primaryColor} />;
    case 'cta_banner':
      return <CtaBannerRenderer section={section} primaryColor={primaryColor} />;
    case 'testimonials':
      return <TestimonialsRenderer section={section} />;
    case 'faq':
      return <FaqRenderer section={section} />;
    default:
      return null;
  }
}

function HeroRenderer({ section, primaryColor }: { section: HeroSection; primaryColor: string }) {
  return (
    <section
      className="relative py-24 md:py-32"
      style={{
        background: `linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor}dd 100%)`,
      }}
    >
      {section.background_image && (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${section.background_image})` }}
        />
      )}
      <div className="container mx-auto px-4 relative z-10 text-white">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">{section.headline}</h1>
          <p className="text-lg md:text-xl mb-8 text-white/90">{section.subheadline}</p>
          <Link to={section.cta_link}>
            <Button size="lg" className="bg-white text-gray-900 hover:bg-white/90 font-semibold px-8">
              {section.cta_text}
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function ServicesRenderer({ section, primaryColor }: { section: ServicesSection; primaryColor: string }) {
  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="container mx-auto px-4">
        <h2 className="text-3xl font-bold text-center mb-12">{section.title}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {section.items.map((item, index) => (
            <div
              key={index}
              className="p-6 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
            >
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg mb-4"
                style={{ backgroundColor: primaryColor }}
              >
                {item.capability.charAt(0).toUpperCase()}
              </div>
              <h3 className="text-lg font-semibold mb-2 capitalize">
                {item.capability.replace(/_/g, ' ')}
              </h3>
              <p className="text-gray-600 text-sm">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsRenderer({ section, primaryColor }: { section: StatsSection; primaryColor: string }) {
  return (
    <section className="py-16 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
          {section.items.map((item, index) => (
            <div key={index} className="text-center">
              <p className="text-3xl md:text-4xl font-bold" style={{ color: primaryColor }}>
                {item.value}
              </p>
              <p className="text-gray-600 mt-2">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaBannerRenderer({ section, primaryColor }: { section: CtaBannerSection; primaryColor: string }) {
  return (
    <section className="py-16" style={{ backgroundColor: primaryColor }}>
      <div className="container mx-auto px-4 text-center text-white">
        <h2 className="text-3xl font-bold mb-6">{section.headline}</h2>
        <Link to={section.cta_link}>
          <Button size="lg" className="bg-white text-gray-900 hover:bg-white/90 font-semibold px-8">
            {section.cta_text}
          </Button>
        </Link>
      </div>
    </section>
  );
}

function TestimonialsRenderer({ section }: { section: TestimonialsSection }) {
  if (section.items.length === 0) return null;

  return (
    <section className="py-16 bg-white">
      <div className="container mx-auto px-4">
        <h2 className="text-3xl font-bold text-center mb-12">What Our Customers Say</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {section.items.map((item, index) => (
            <div key={index} className="p-6 rounded-xl border border-gray-100 shadow-sm">
              <p className="text-gray-600 italic mb-4">"{item.quote}"</p>
              <div>
                <p className="font-semibold">{item.name}</p>
                <p className="text-sm text-gray-500">{item.company}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqRenderer({ section }: { section: FaqSection }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (section.items.length === 0) return null;

  return (
    <section className="py-16 bg-gray-50">
      <div className="container mx-auto px-4 max-w-3xl">
        <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>
        <div className="space-y-4">
          {section.items.map((item, index) => (
            <div key={index} className="bg-white rounded-lg border border-gray-100 shadow-sm">
              <button
                className="w-full flex justify-between items-center p-5 text-left"
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
              >
                <span className="font-medium">{item.question}</span>
                {openIndex === index ? (
                  <ChevronUp className="h-5 w-5 text-gray-400" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-gray-400" />
                )}
              </button>
              {openIndex === index && (
                <div className="px-5 pb-5 text-gray-600">{item.answer}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
