import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  GraduationCap,
  Microscope,
  Rocket,
  Users,
} from 'lucide-react';
import SEOMeta from '@/components/SEOMeta';
import SectionRenderer from '@/components/content/SectionRenderer';
import FaqAccordion from '@/components/content/FaqAccordion';
import ContentSkeleton from '@/components/content/ContentSkeleton';
import { useContentPage } from '@/hooks/useContentPage';
import type { ContentPageSection } from '@/hooks/useContentPage';

const SITE = 'https://www.micronshub.eu';
const HERO_IMAGE =
  'https://images.unsplash.com/photo-1532619675605-1ede6c2ed2b0?w=1600&q=80';

const AUDIENCE_ICONS = [
  GraduationCap, // Formula Student
  Bot,           // Robotics
  Microscope,    // Research labs
  Users,         // Engineering faculty
  Rocket,        // Student startups
] as const;

const STEP_PREFIX_RE = /^step\s+\d+\s*[-—:]\s*/i;

const EducationPage: React.FC = () => {
  const { data, isLoading } = useContentPage('education');

  if (isLoading) return <ContentSkeleton />;

  const h1 = data?.h1 || 'Education & Research Partnerships';
  const tagline = data?.tagline;

  const sections = data?.sections ?? [];
  // By convention in the DB: sections[0..4] = audience prose, sections[5] = grid,
  // sections[6] = table, sections[7] = list (steps), sections[8] = cta.
  const audience = sections.filter((s) => s.type === 'prose').slice(0, 5);
  const orderTypes = sections.find((s) => s.type === 'grid' || s.type === 'cards');
  const pricingTable = sections.find((s) => s.type === 'table');
  const steps = sections.find((s) => s.type === 'list');
  const finalCta = sections.find((s) => s.type === 'cta');

  return (
    <div className="min-h-screen">
      <SEOMeta
        title={data?.title || 'Education & Research Partnerships | Microns Hub'}
        description={
          data?.meta_description ||
          'Educational pricing, NET30 terms, DFM review, and technical partnership for universities, Formula Student teams, and research labs.'
        }
        canonicalUrl={`${SITE}/en/education`}
      />

      <section className="relative h-[85vh] min-h-[540px] flex items-center">
        <div
          className="absolute inset-0 bg-cover bg-center z-0"
          style={{ backgroundImage: `url(${HERO_IMAGE})` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-brand-dark/80 to-brand-primary/60" />
        </div>
        <div className="container-custom relative z-10 text-white mt-16">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 tracking-tight leading-tight">
              {h1}
            </h1>
            {tagline && (
              <p className="text-xl md:text-2xl text-white/90 mb-8 font-light">
                {tagline}
              </p>
            )}
            <Link
              to="/en/quote?source=education"
              className="btn-primary inline-flex items-center text-lg font-bold px-8 py-4 shadow-lg hover:shadow-xl"
            >
              Get Educational Pricing
              <ArrowRight size={18} className="ml-2" />
            </Link>
          </div>
        </div>
      </section>

      {audience.length > 0 && (
        <section className="section bg-white">
          <div className="container-custom">
            <div className="max-w-3xl mx-auto text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-brand-dark tracking-tight mb-4">
                Who we serve
              </h2>
              <p className="text-brand-dark/70 leading-relaxed text-lg">
                Purpose-built terms for the people driving Europe&rsquo;s next
                generation of engineers and researchers.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {audience.map((s, i) => {
                const Icon = AUDIENCE_ICONS[i] ?? GraduationCap;
                const body = (s.paragraphs ?? [])[0] ?? '';
                return (
                  <article
                    key={i}
                    className="bg-white p-6 rounded-lg shadow-lg border border-gray-100 hover:shadow-xl transition-all flex flex-col opacity-0 animate-fade-in"
                    style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'forwards' }}
                  >
                    <div className="bg-brand-light inline-flex p-3 rounded-lg text-brand-teal mb-4 self-start">
                      <Icon size={28} />
                    </div>
                    <h3 className="text-xl font-bold text-brand-dark mb-3">
                      {s.h2}
                    </h3>
                    <p className="text-brand-dark/80 leading-relaxed">
                      {body}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {orderTypes && <SectionRenderer section={orderTypes} index={1} />}
      {pricingTable && <SectionRenderer section={pricingTable} index={0} />}

      {steps && Array.isArray(steps.items) && steps.items.length > 0 && (
        <section className="section bg-brand-light">
          <div className="container-custom">
            <div className="max-w-3xl mx-auto text-center mb-12">
              {steps.h2 && (
                <h2 className="text-3xl md:text-4xl font-bold text-brand-dark tracking-tight mb-4">
                  {steps.h2}
                </h2>
              )}
              {steps.intro && (
                <p className="text-brand-dark/70 leading-relaxed text-lg">
                  {steps.intro}
                </p>
              )}
            </div>

            <ol className="grid grid-cols-1 md:grid-cols-5 gap-6 md:gap-4 relative">
              {steps.items.map((item, i) => {
                const rawTerm = item.term ?? '';
                const title = rawTerm.replace(STEP_PREFIX_RE, '');
                return (
                  <li
                    key={i}
                    className="relative bg-white rounded-lg shadow-lg border border-gray-100 p-6 flex flex-col items-center text-center"
                  >
                    <div className="w-12 h-12 rounded-full bg-brand-primary text-white text-xl font-extrabold flex items-center justify-center mb-4 shadow-md">
                      {i + 1}
                    </div>
                    <h3 className="font-bold text-brand-dark mb-2">{title}</h3>
                    <p className="text-sm text-brand-dark/80 leading-relaxed">
                      {item.description}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      )}

      <FaqAccordion items={data?.faq ?? []} />

      {finalCta && <SectionRenderer section={finalCta as ContentPageSection} />}
    </div>
  );
};

export default EducationPage;
