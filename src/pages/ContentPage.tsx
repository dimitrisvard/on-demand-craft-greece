import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import SEOMeta from '@/components/SEOMeta';
import CTASection from '@/components/CTASection';
import FAQAccordion from '@/components/services/FAQAccordion';
import {
  useContentPage,
  type ContentPageContent,
  type ContentSection,
  type ProseSection as ProseSectionT,
  type ListSection as ListSectionT,
  type TableSection as TableSectionT,
  type GridSection as GridSectionT,
  type CtaSection as CtaSectionT,
  type ContentCrossLink,
  type ContentInternalLink,
} from '@/lib/content-pages';

const SITE_BASE_URL = 'https://www.micronshub.eu';

interface ContentPageProps {
  slug: string;
}

const PageLoader = () => (
  <div className="min-h-screen pt-16 flex items-center justify-center">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary" />
  </div>
);

const Hero: React.FC<{ content: ContentPageContent }> = ({ content }) => (
  <section className="relative bg-brand-dark text-white py-20 md:py-28">
    <div className="container-custom">
      <div className="max-w-3xl">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">{content.h1}</h1>
        {content.tagline && (
          <p className="text-xl md:text-2xl text-white/90 mb-8">{content.tagline}</p>
        )}
        {content.lead_paragraph && (
          <p className="text-lg text-white/80 leading-relaxed">
            {content.lead_paragraph}
          </p>
        )}
      </div>
    </div>
  </section>
);

const ProseSection: React.FC<{ s: ProseSectionT; alt: boolean }> = ({ s, alt }) => (
  <section className={`py-16 ${alt ? 'bg-brand-dark/5' : ''}`}>
    <div className="container-custom max-w-3xl">
      <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">{s.h2}</h2>
      <div className="space-y-4 text-brand-dark/80 leading-relaxed">
        {s.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </div>
  </section>
);

const ListSection: React.FC<{ s: ListSectionT; alt: boolean }> = ({ s, alt }) => (
  <section className={`py-16 ${alt ? 'bg-brand-dark/5' : ''}`}>
    <div className="container-custom max-w-3xl">
      <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">{s.h2}</h2>
      {s.intro && (
        <p className="text-brand-dark/80 leading-relaxed mb-8">{s.intro}</p>
      )}
      <dl className="space-y-5">
        {s.items.map((item, i) => (
          <div
            key={i}
            className="border border-brand-dark/10 rounded-lg bg-white p-5"
          >
            {item.term && (
              <dt className="font-semibold text-brand-dark">{item.term}</dt>
            )}
            <dd className="mt-2 text-brand-dark/80 leading-relaxed">
              {item.description}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  </section>
);

const TableSection: React.FC<{ s: TableSectionT; alt: boolean }> = ({ s, alt }) => (
  <section className={`py-16 ${alt ? 'bg-brand-dark/5' : ''}`}>
    <div className="container-custom max-w-5xl">
      <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">{s.h2}</h2>
      {s.intro && (
        <p className="text-brand-dark/80 leading-relaxed mb-8">{s.intro}</p>
      )}

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse text-left bg-white rounded-lg overflow-hidden border border-brand-dark/10">
          <thead>
            <tr className="border-b-2 border-brand-dark/10 bg-brand-dark/5">
              {s.columns.map((c, i) => (
                <th key={i} className="py-3 px-4 font-semibold text-brand-dark">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((row, ri) => (
              <tr key={ri} className="border-b border-brand-dark/10 last:border-b-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="py-3 px-4 text-brand-dark/80">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-4">
        {s.rows.map((row, ri) => (
          <div
            key={ri}
            className="border border-brand-dark/10 rounded-lg p-4 bg-white"
          >
            {row.map((cell, ci) => (
              <div key={ci} className={ci === 0 ? 'font-semibold text-brand-dark' : 'mt-1 text-brand-dark/80'}>
                {s.columns[ci] && ci > 0 && (
                  <span className="text-xs uppercase tracking-wide text-brand-dark/50 mr-2">
                    {s.columns[ci]}:
                  </span>
                )}
                {cell}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  </section>
);

const GridSection: React.FC<{ s: GridSectionT; alt: boolean }> = ({ s, alt }) => (
  <section className={`py-16 ${alt ? 'bg-brand-dark/5' : ''}`}>
    <div className="container-custom">
      <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">{s.h2}</h2>
      {s.intro && (
        <p className="text-brand-dark/80 leading-relaxed mb-8 max-w-3xl">
          {s.intro}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {s.cards.map((c, i) => (
          <article
            key={i}
            className="border border-brand-dark/10 rounded-lg bg-white p-6"
          >
            <h3 className="font-semibold text-brand-dark text-lg">{c.title}</h3>
            <p className="mt-2 text-brand-dark/80 leading-relaxed">{c.description}</p>
            {c.meta && (
              <p className="mt-3 text-sm text-brand-dark/60">{c.meta}</p>
            )}
          </article>
        ))}
      </div>
    </div>
  </section>
);

const CtaSectionBlock: React.FC<{ s: CtaSectionT; alt: boolean }> = ({ s, alt }) => (
  <section className={`py-16 ${alt ? 'bg-brand-dark/5' : ''}`}>
    <div className="container-custom max-w-3xl text-center">
      <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-4">{s.h2}</h2>
      <p className="text-brand-dark/80 leading-relaxed mb-8">{s.body}</p>
      <Link
        to={s.button_href}
        className="btn-primary inline-flex items-center"
      >
        {s.button_label}
        <ArrowRight size={18} className="ml-2" />
      </Link>
    </div>
  </section>
);

const SectionRenderer: React.FC<{ section: ContentSection; alt: boolean }> = ({
  section,
  alt,
}) => {
  switch (section.type) {
    case 'prose':
      return <ProseSection s={section} alt={alt} />;
    case 'list':
      return <ListSection s={section} alt={alt} />;
    case 'table':
      return <TableSection s={section} alt={alt} />;
    case 'grid':
    case 'cards':
      return <GridSection s={section} alt={alt} />;
    case 'cta':
      return <CtaSectionBlock s={section} alt={alt} />;
    default:
      return null;
  }
};

const CrossLinksBlock: React.FC<{ items: ContentCrossLink[] }> = ({ items }) => {
  if (!items?.length) return null;
  return (
    <section className="py-16 bg-brand-dark/5">
      <div className="container-custom">
        <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">
          Related
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {items.map((link, i) => (
            <Link
              key={`${link.href}-${i}`}
              to={link.href}
              className="group border border-brand-dark/10 rounded-lg bg-white p-5 hover:border-brand-primary transition-colors flex items-center justify-between"
            >
              <span className="font-semibold text-brand-dark">{link.label}</span>
              <ArrowRight
                size={18}
                className="text-brand-primary transition-transform group-hover:translate-x-1"
              />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};

const InternalLinksBlock: React.FC<{ items: ContentInternalLink[] }> = ({ items }) => {
  if (!items?.length) return null;
  return (
    <section className="py-12 border-t border-brand-dark/10">
      <div className="container-custom">
        <nav aria-label="page" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-brand-dark/70">
          {items.map((link, i) => (
            <Link
              key={`${link.href}-${i}`}
              to={link.href}
              className="hover:text-brand-primary hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
};

const ContentPage: React.FC<ContentPageProps> = ({ slug }) => {
  const { currentLanguage } = useLanguage();
  const { data: content, isLoading } = useContentPage(slug, currentLanguage);

  if (isLoading) return <PageLoader />;

  if (!content) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-brand-dark">Page not found</h1>
          <Link
            to={`/${currentLanguage}`}
            className="mt-4 inline-block text-brand-primary underline"
          >
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const canonicalUrl = `${SITE_BASE_URL}/${currentLanguage}/${slug}`;

  return (
    <div className="min-h-screen pt-16">
      <SEOMeta
        title={content.title}
        description={content.meta_description}
        canonicalUrl={canonicalUrl}
      />

      <Hero content={content} />

      {content.sections.map((section, i) => (
        <SectionRenderer key={i} section={section} alt={i % 2 === 1} />
      ))}

      {content.faq?.length > 0 && (
        <FAQAccordion items={content.faq} heading="Frequently Asked Questions" />
      )}

      <CrossLinksBlock items={content.cross_links} />
      <InternalLinksBlock items={content.internal_links} />

      <CTASection />
    </div>
  );
};

export default ContentPage;
