import React from 'react';
import {
  CheckCircle2,
  Clock,
  FileText,
  Infinity as InfinityIcon,
  ShieldCheck,
  TrendingUp,
  Users,
  LucideIcon,
} from 'lucide-react';
import SectionRenderer from '@/components/content/SectionRenderer';
import type { ContentPageSection } from '@/hooks/useContentPage';
import { SERVICE_IMAGES } from '@/lib/service-images';

function patchServiceCards(s: ContentPageSection): ContentPageSection {
  if (!s.cards?.length) return s;
  return {
    ...s,
    cards: s.cards.map((card) => {
      const slug = card.href?.split('/services/')?.[1]?.split('/')?.[0];
      const img = slug ? SERVICE_IMAGES[slug] : undefined;
      return img ? { ...card, image_url: img } : card;
    }),
  };
}

/**
 * Home page uses position-aware rendering: some DB sections look better with a
 * custom layout than the generic SectionRenderer. The order in the home
 * content_pages row (as seeded):
 *
 *   0  grid   Services
 *   1  list   Ordering process (5 steps)      → horizontal stepper
 *   2  grid   Industries
 *   3  list   Differentiators (6 items)       → icon grid
 *   4  grid   Stats (numbers + label)         → big-number grid
 *   5  table  Materials
 *   6  table  Lead times
 *   7  list   Standard deliverables           → checkmark grid
 *   8  grid   Featured work
 *   9  prose  Quality
 *   10 cta    Final banner
 */

const STEP_PREFIX_RE = /^step\s+\d+\s*[-—:]\s*/i;

const DIFFERENTIATOR_ICONS: Record<string, LucideIcon> = {
  Users,
  FileText,
  Clock,
  ShieldCheck,
  Infinity: InfinityIcon,
  TrendingUp,
};

function matchDifferentiatorIcon(term: string): LucideIcon {
  const t = (term || '').toLowerCase();
  if (t.includes('team') || t.includes('partner') || t.includes('engineer')) return Users;
  if (t.includes('drawing') || t.includes('report') || t.includes('document')) return FileText;
  if (t.includes('time') || t.includes('lead') || t.includes('fast')) return Clock;
  if (t.includes('quality') || t.includes('certif') || t.includes('iso')) return ShieldCheck;
  if (t.includes('scale') || t.includes('volume') || t.includes('growth')) return TrendingUp;
  return InfinityIcon;
}

const Stepper: React.FC<{ s: ContentPageSection }> = ({ s }) => {
  const items = s.items ?? [];
  if (!items.length) return null;
  return (
    <section className="section bg-brand-light">
      <div className="container-custom">
        <div className="max-w-3xl mx-auto text-center mb-12">
          {s.h2 && (
            <h2 className="text-3xl md:text-4xl font-bold text-brand-dark tracking-tight mb-4">
              {s.h2}
            </h2>
          )}
          {s.intro && (
            <p className="text-brand-dark/70 leading-relaxed text-lg">
              {s.intro}
            </p>
          )}
        </div>
        <ol className="grid grid-cols-1 md:grid-cols-5 gap-6 md:gap-4">
          {items.map((item, i) => {
            const title = (item.term ?? '').replace(STEP_PREFIX_RE, '');
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
  );
};

const DifferentiatorsGrid: React.FC<{ s: ContentPageSection }> = ({ s }) => {
  const items = s.items ?? [];
  if (!items.length) return null;
  return (
    <section className="section bg-brand-light">
      <div className="container-custom">
        <div className="max-w-3xl mx-auto text-center mb-12">
          {s.h2 && (
            <h2 className="text-3xl md:text-4xl font-bold text-brand-dark tracking-tight mb-4">
              {s.h2}
            </h2>
          )}
          {s.intro && (
            <p className="text-brand-dark/70 leading-relaxed text-lg">{s.intro}</p>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((item, i) => {
            const Icon = matchDifferentiatorIcon(item.term ?? '');
            return (
              <article
                key={i}
                className="bg-white p-6 rounded-lg shadow-lg border border-gray-100 hover:shadow-xl transition-all flex flex-col opacity-0 animate-fade-in"
                style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
              >
                <div className="bg-brand-light inline-flex p-3 rounded-lg text-brand-teal mb-4 self-start">
                  <Icon size={28} />
                </div>
                {item.term && (
                  <h3 className="text-xl font-bold text-brand-dark mb-3">
                    {item.term}
                  </h3>
                )}
                <p className="text-brand-dark/80 leading-relaxed flex-1">
                  {item.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

const statsGridCols = (n: number): string => {
  if (n <= 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (n === 3) return 'grid-cols-1 sm:grid-cols-3';
  if (n === 4) return 'grid-cols-2 md:grid-cols-4';
  if (n === 5) return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5';
  if (n === 6) return 'grid-cols-2 md:grid-cols-3';
  return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
};

const StatsGrid: React.FC<{ s: ContentPageSection }> = ({ s }) => {
  const cards = s.cards ?? [];
  if (!cards.length) return null;
  return (
    <section className="section bg-brand-primary text-white">
      <div className="container-custom">
        <div className="max-w-3xl mx-auto text-center mb-12">
          {s.h2 && (
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              {s.h2}
            </h2>
          )}
          {s.intro && (
            <p className="text-white/80 leading-relaxed text-lg">{s.intro}</p>
          )}
        </div>
        <div className={`grid gap-6 ${statsGridCols(cards.length)}`}>
          {cards.map((c, i) => (
            <div
              key={i}
              className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 text-center border border-white/15 hover:bg-white/15 transition-colors flex flex-col"
            >
              <div className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-brand-accent mb-3 leading-none">
                {c.title}
              </div>
              <p className="text-white/90 leading-snug font-medium">{c.description}</p>
              {c.meta && <p className="mt-auto pt-3 text-sm text-white/60">{c.meta}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const DeliverablesGrid: React.FC<{ s: ContentPageSection }> = ({ s }) => {
  const items = s.items ?? [];
  if (!items.length) return null;
  return (
    <section className="section bg-brand-light">
      <div className="container-custom">
        <div className="max-w-3xl mx-auto text-center mb-12">
          {s.h2 && (
            <h2 className="text-3xl md:text-4xl font-bold text-brand-dark tracking-tight mb-4">
              {s.h2}
            </h2>
          )}
          {s.intro && (
            <p className="text-brand-dark/70 leading-relaxed text-lg">
              {s.intro}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {items.map((item, i) => (
            <div
              key={i}
              className="bg-white p-5 rounded-lg shadow-lg border border-gray-100 flex items-start gap-3"
            >
              <CheckCircle2
                size={22}
                className="text-brand-teal flex-shrink-0 mt-0.5"
              />
              <div>
                {item.term && (
                  <div className="font-bold text-brand-dark mb-1">
                    {item.term}
                  </div>
                )}
                <p className="text-brand-dark/80 leading-relaxed text-sm">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

interface HomeContentSectionsProps {
  sections: ContentPageSection[];
}

/**
 * Sections that need custom home-page treatment, keyed by array index in the
 * content_pages row. Everything else flows through the shared SectionRenderer.
 */
const CUSTOM_INDICES: Record<number, (s: ContentPageSection) => React.ReactElement> = {
  1: (s) => <Stepper s={s} />,
  3: (s) => <DifferentiatorsGrid s={s} />,
  4: (s) => <StatsGrid s={s} />,
  7: (s) => <DeliverablesGrid s={s} />,
};

const HomeContentSections: React.FC<HomeContentSectionsProps> = ({ sections }) => {
  return (
    <>
      {sections.map((section, i) => {
        const s = i === 0 ? patchServiceCards(section) : section;
        const Custom = CUSTOM_INDICES[i];
        if (Custom) return <React.Fragment key={i}>{Custom(s)}</React.Fragment>;
        return <SectionRenderer key={i} section={s} index={i} />;
      })}
    </>
  );
};

export default HomeContentSections;
