import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { ContentPageSection } from '@/hooks/useContentPage';

interface SectionRendererProps {
  section: ContentPageSection;
  /** Zero-based index used to alternate background shading on stacked sections. */
  index?: number;
}

const ProseSection: React.FC<{ s: ContentPageSection; alt: boolean }> = ({
  s,
  alt,
}) => (
  <section className={`section ${alt ? 'bg-brand-light' : 'bg-white'}`}>
    <div className="container-custom">
      <div className="max-w-3xl mx-auto">
        {s.h2 && (
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8 tracking-tight">
            {s.h2}
          </h2>
        )}
        <div className="space-y-4 text-brand-dark/80 leading-relaxed text-lg">
          {(s.paragraphs ?? []).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </div>
  </section>
);

const ListSection: React.FC<{ s: ContentPageSection; alt: boolean }> = ({
  s,
  alt,
}) => (
  <section className={`section ${alt ? 'bg-brand-light' : 'bg-white'}`}>
    <div className="container-custom">
      <div className="max-w-4xl mx-auto">
        {s.h2 && (
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-4 tracking-tight">
            {s.h2}
          </h2>
        )}
        {s.intro && (
          <p className="text-brand-dark/80 leading-relaxed text-lg mb-10 max-w-3xl">
            {s.intro}
          </p>
        )}
        <dl className="grid gap-5 md:grid-cols-2">
          {(s.items ?? []).map((item, i) => (
            <div
              key={i}
              className="bg-white p-6 rounded-lg shadow-lg border border-gray-100 hover:shadow-xl transition-all"
            >
              {item.term && (
                <dt className="font-bold text-brand-dark text-lg mb-2">
                  {item.term}
                </dt>
              )}
              <dd className="text-brand-dark/80 leading-relaxed">
                {item.description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  </section>
);

const TableSection: React.FC<{ s: ContentPageSection; alt: boolean }> = ({
  s,
  alt,
}) => {
  const columns = s.columns ?? [];
  const rows = s.rows ?? [];
  return (
    <section className={`section ${alt ? 'bg-brand-light' : 'bg-white'}`}>
      <div className="container-custom">
        <div className="max-w-5xl mx-auto">
          {s.h2 && (
            <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-4 tracking-tight">
              {s.h2}
            </h2>
          )}
          {s.intro && (
            <p className="text-brand-dark/80 leading-relaxed text-lg mb-10 max-w-3xl">
              {s.intro}
            </p>
          )}

          <div className="hidden md:block overflow-x-auto rounded-lg shadow-lg border border-gray-100 bg-white">
            <table className="w-full border-collapse text-left">
              <thead className="bg-brand-primary text-white">
                <tr>
                  {columns.map((c, i) => (
                    <th key={i} className="py-4 px-5 font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className={`${ri % 2 === 0 ? 'bg-white' : 'bg-brand-light/40'} border-t border-gray-100`}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={
                          ci === 0
                            ? 'py-4 px-5 font-semibold text-brand-dark'
                            : 'py-4 px-5 text-brand-dark/80'
                        }
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-4">
            {rows.map((row, ri) => (
              <div
                key={ri}
                className="bg-white p-5 rounded-lg shadow-lg border border-gray-100"
              >
                {row.map((cell, ci) => (
                  <div
                    key={ci}
                    className={ci === 0 ? 'font-bold text-brand-dark mb-2' : 'mt-2'}
                  >
                    {ci > 0 && columns[ci] && (
                      <div className="text-xs uppercase tracking-wide text-brand-muted mb-1">
                        {columns[ci]}
                      </div>
                    )}
                    <div className={ci === 0 ? '' : 'text-brand-dark/80'}>{cell}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const GridSection: React.FC<{ s: ContentPageSection; alt: boolean }> = ({
  s,
  alt,
}) => {
  const cards = s.cards ?? [];
  return (
    <section className={`section ${alt ? 'bg-brand-light' : 'bg-white'}`}>
      <div className="container-custom">
        {s.h2 && (
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-4 tracking-tight">
            {s.h2}
          </h2>
        )}
        {s.intro && (
          <p className="text-brand-dark/80 leading-relaxed text-lg mb-10 max-w-3xl">
            {s.intro}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {cards.map((c, i) => (
            <article
              key={i}
              className="bg-white p-6 rounded-lg shadow-lg border border-gray-100 hover:shadow-xl transition-all opacity-0 animate-fade-in flex flex-col"
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
            >
              <h3 className="text-xl font-bold mb-3 text-brand-dark">
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
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

const CtaBanner: React.FC<{ s: ContentPageSection }> = ({ s }) => (
  <section className="py-16 md:py-20 bg-brand-primary">
    <div className="container-custom text-center text-white">
      {s.h2 && (
        <h2 className="text-3xl md:text-4xl font-bold mb-4 tracking-tight">
          {s.h2}
        </h2>
      )}
      {s.body && (
        <p className="text-lg text-white/90 max-w-2xl mx-auto mb-8 leading-relaxed">
          {s.body}
        </p>
      )}
      {s.button_label && s.button_href && (
        <Link
          to={s.button_href}
          className="btn-secondary inline-flex items-center text-lg font-bold px-8 py-4 bg-white text-brand-primary hover:bg-brand-light"
        >
          {s.button_label}
          <ArrowRight size={18} className="ml-2" />
        </Link>
      )}
    </div>
  </section>
);

const SectionRenderer: React.FC<SectionRendererProps> = ({ section, index = 0 }) => {
  const alt = index % 2 === 1;
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
      return <CtaBanner s={section} />;
    default:
      return null;
  }
};

export default SectionRenderer;
