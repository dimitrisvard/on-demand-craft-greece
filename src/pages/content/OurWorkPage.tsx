import React from 'react';
import SEOMeta from '@/components/SEOMeta';
import ContentHero from '@/components/content/ContentHero';
import SectionRenderer from '@/components/content/SectionRenderer';
import FaqAccordion from '@/components/content/FaqAccordion';
import ContentSkeleton from '@/components/content/ContentSkeleton';
import { useContentPage } from '@/hooks/useContentPage';

const SITE = 'https://www.micronshub.eu';

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1581092795360-fd1ca04f0952?w=1200&q=80';

// Exact card titles → curated hero images. Keyed by the title strings that
// appear in content_pages.sections[0].cards for the our-work row.
const CASE_STUDY_IMAGES: Record<string, { src: string; alt: string }> = {
  'Robotics Integrator — Cobot Base Plate and Mounting Flange Set': {
    src: 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=1200&q=80',
    alt: 'CNC machined aluminum cobot base plate with mounting flanges',
  },
  'UAV Hardware Startup — Flight Controller Enclosure': {
    src: 'https://images.unsplash.com/photo-1579829366248-204fe8413f31?w=1200&q=80',
    alt: 'Sheet metal flight controller enclosure with powder coat finish',
  },
  'Medical Device Prototype — Surgical Instrument Handle': {
    src: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=1200&q=80',
    alt: 'CNC turned 316 stainless surgical instrument handle, polished',
  },
  'Formula Student Team — Suspension Upright Set': {
    src: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=1200&q=80',
    alt: 'Formula Student race car with machined aluminum suspension uprights',
  },
  'Electronics OEM — 19-inch Rack Chassis (2U)': {
    src: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&q=80',
    alt: '19-inch rack electronics chassis with EMI gasket and ventilation',
  },
  'EV Charging OEM — Outdoor Enclosure and Mounting Plate': {
    src: 'https://images.unsplash.com/photo-1593941707882-a5bac6861d75?w=1200&q=80',
    alt: 'EV charging station enclosure with galvanized mounting plate',
  },
  'Industrial Sensor Manufacturer — Injection Molded Housing': {
    src: 'https://images.unsplash.com/photo-1581092335397-9583eb92d232?w=1200&q=80',
    alt: 'Injection molded ABS sensor housing with brass inserts',
  },
  'Research Lab — Vacuum Chamber Custom Flange': {
    src: 'https://images.unsplash.com/photo-1567306301408-9b74779a11af?w=1200&q=80',
    alt: 'Research lab vacuum chamber with custom 316L stainless flange',
  },
  'Consumer Hardware Startup — Product Prototype Iteration': {
    src: 'https://images.unsplash.com/photo-1523289333742-be1143f6b766?w=1200&q=80',
    alt: 'Consumer hardware product prototypes in multiple iterations',
  },
  'Renewable Energy — Solar Mounting Bracket Batch': {
    src: 'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=1200&q=80',
    alt: 'Solar panel array with custom aluminum mounting brackets',
  },
};

interface CaseStudyCard {
  title: string;
  description: string;
  meta?: string;
}

const OurWorkPage: React.FC = () => {
  const { data, isLoading } = useContentPage('our-work');

  if (isLoading) return <ContentSkeleton />;

  const h1 = data?.h1 || 'Our Work';
  const tagline = data?.tagline;
  const lead = data?.lead_paragraph;

  const sections = data?.sections ?? [];
  const caseStudySection = sections.find(
    (s) => s.type === 'cards' || s.type === 'grid',
  );
  const cards: CaseStudyCard[] = caseStudySection?.cards ?? [];
  const otherSections = sections.filter((s) => s !== caseStudySection);

  return (
    <div className="min-h-screen">
      <SEOMeta
        title={data?.title || 'Our Work | Microns Hub'}
        description={
          data?.meta_description ||
          'Real manufacturing projects delivered by Microns Hub: aerospace, automotive, medical, electronics, and more.'
        }
        canonicalUrl={`${SITE}/en/our-work`}
      />

      <ContentHero h1={h1} tagline={tagline} lead={lead} />

      {cards.length > 0 && (
        <section className="section bg-white">
          <div className="container-custom">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {cards.map((c, i) => {
                const img = CASE_STUDY_IMAGES[c.title] || {
                  src: FALLBACK_IMAGE,
                  alt: c.title,
                };
                return (
                  <article
                    key={i}
                    className="bg-white rounded-lg shadow-lg border border-gray-100 hover:shadow-xl transition-all overflow-hidden flex flex-col opacity-0 animate-fade-in"
                    style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
                  >
                    <div className="aspect-[16/9] overflow-hidden bg-gray-100">
                      <img
                        src={img.src}
                        alt={img.alt}
                        loading="lazy"
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                    <div className="p-6 flex flex-col flex-1">
                      <h3 className="text-lg font-bold text-brand-dark leading-snug mb-3">
                        {c.title}
                      </h3>
                      <p className="text-brand-dark/80 leading-relaxed flex-1">
                        {c.description}
                      </p>
                      {c.meta && (
                        <p className="mt-4 pt-4 border-t border-gray-100 text-sm text-brand-muted">
                          {c.meta}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {otherSections.map((s, i) => (
        <SectionRenderer key={i} section={s} index={i + 1} />
      ))}

      <FaqAccordion items={data?.faq ?? []} />
    </div>
  );
};

export default OurWorkPage;
