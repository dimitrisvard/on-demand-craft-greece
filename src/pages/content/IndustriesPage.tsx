import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import SEOMeta from '@/components/SEOMeta';
import ContentHero from '@/components/content/ContentHero';
import SectionRenderer from '@/components/content/SectionRenderer';
import FaqAccordion from '@/components/content/FaqAccordion';
import ContentSkeleton from '@/components/content/ContentSkeleton';
import { useContentPage } from '@/hooks/useContentPage';
import type { ContentPageSection } from '@/hooks/useContentPage';

const SITE = 'https://www.micronshub.eu';

const FALLBACK_INDUSTRY_IMAGE =
  'https://images.unsplash.com/photo-1581092795360-fd1ca04f0952?w=1400&q=80';

const IndustriesPage: React.FC = () => {
  const { data, isLoading } = useContentPage('industries');

  if (isLoading) return <ContentSkeleton />;

  const h1 = data?.h1 || 'Industries We Serve';
  const tagline = data?.tagline;
  const lead = data?.lead_paragraph;

  const sections = data?.sections ?? [];
  // Prose sections with images → alternating rows. Everything else keeps its
  // ordering and runs through SectionRenderer.
  const proseWithImages: ContentPageSection[] = [];
  const trailing: ContentPageSection[] = [];
  let seenNonProse = false;
  for (const s of sections) {
    if (!seenNonProse && s.type === 'prose') {
      proseWithImages.push(s);
    } else {
      seenNonProse = true;
      trailing.push(s);
    }
  }

  return (
    <div className="min-h-screen">
      <SEOMeta
        title={data?.title || 'Industries We Serve | Microns Hub'}
        description={
          data?.meta_description ||
          'Manufacturing for aerospace, automotive, medical, electronics, energy, robotics, and more.'
        }
        canonicalUrl={`${SITE}/en/industries`}
      />

      <ContentHero h1={h1} tagline={tagline} lead={lead} />

      {proseWithImages.length > 0 && (
        <section className="bg-white">
          {proseWithImages.map((s, i) => {
            const imageRight = i % 2 === 1;
            const img = s.image_url || FALLBACK_INDUSTRY_IMAGE;
            const alt = s.image_alt || s.h2 || 'Industry';
            const body = (s.paragraphs ?? [])[0] ?? '';
            return (
              <div
                key={i}
                className={`${i % 2 === 0 ? 'bg-white' : 'bg-brand-light'} py-12 md:py-16`}
              >
                <div className="container-custom">
                  <div
                    className={`grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 items-center ${
                      imageRight ? 'lg:[&>div:first-child]:order-2' : ''
                    }`}
                  >
                    <div className="relative">
                      <div className="aspect-[4/3] rounded-lg overflow-hidden shadow-lg border border-gray-100 bg-gray-100">
                        <img
                          src={img}
                          alt={alt}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                    <div>
                      {s.h2 && (
                        <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-4 tracking-tight">
                          {s.h2}
                        </h2>
                      )}
                      <p className="text-brand-dark/80 leading-relaxed text-lg mb-6">
                        {body}
                      </p>
                      <Link
                        to="/en/quote"
                        className="text-brand-primary font-semibold inline-flex items-center hover:underline underline-offset-4"
                      >
                        Get a quote for this industry
                        <ArrowRight size={16} className="ml-1.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {trailing.map((s, i) => (
        <SectionRenderer key={i} section={s} index={i} />
      ))}

      <FaqAccordion items={data?.faq ?? []} />
    </div>
  );
};

export default IndustriesPage;
