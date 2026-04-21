import { Lang, SITE_BASE, ContentPageSlug } from '../types';
import { escapeHtml, renderFooterLinks, renderBreadcrumbs } from './common';
import { contentPageSchemaFromRow, breadcrumbSchema, faqPageSchemaFromRow } from '../schema';

interface ProseSection {
  type: 'prose';
  h2: string;
  paragraphs: string[];
  image_url?: string;
  image_alt?: string;
}

interface ListSectionItem {
  term?: string;
  description: string;
}
interface ListSection {
  type: 'list';
  h2: string;
  intro?: string;
  items: ListSectionItem[];
}

interface TableSection {
  type: 'table';
  h2: string;
  intro?: string;
  columns: string[];
  rows: string[][];
}

interface GridSectionCard {
  title: string;
  description: string;
  meta?: string;
  image_url?: string;
  image_alt?: string;
  href?: string;
}
interface GridSection {
  type: 'grid' | 'cards';
  h2: string;
  intro?: string;
  cards: GridSectionCard[];
}

interface CtaSection {
  type: 'cta';
  h2: string;
  body: string;
  button_label: string;
  button_href: string;
}

type ContentSection = ProseSection | ListSection | TableSection | GridSection | CtaSection;

export interface ContentPageRow {
  slug: string;
  language: Lang;
  localized_slug: string | null;
  title: string;
  meta_description: string;
  h1: string;
  tagline: string | null;
  lead_paragraph: string;
  sections: ContentSection[];
  faq: Array<{ question: string; answer: string }>;
  cross_links: Array<{ label: string; href: string }>;
  internal_links: Array<{ label: string; href: string }>;
  schema_type: string | null;
  structured_data: {
    contactPoints?: Array<Record<string, unknown>>;
    organization?: Record<string, unknown>;
  } | null;
}

function renderProse(s: ProseSection): string {
  const ps = s.paragraphs.map((p) => `    <p>${escapeHtml(p)}</p>`).join('\n');
  // Emit the image as a semantic <figure> so screen readers and crawlers can
  // associate it with the surrounding prose. Alt falls back to the section's
  // h2 when image_alt is absent so we never ship empty alt text.
  const figure = s.image_url
    ? `    <figure><img src="${escapeHtml(s.image_url)}" alt="${escapeHtml(s.image_alt || s.h2 || '')}" loading="lazy" /></figure>\n`
    : '';
  return `  <section>
    <h2>${escapeHtml(s.h2)}</h2>
${figure}${ps}
  </section>`;
}

function renderList(s: ListSection): string {
  const items = s.items.map((i) => {
    const term = i.term ? `      <dt>${escapeHtml(i.term)}</dt>\n` : '';
    return `${term}      <dd>${escapeHtml(i.description)}</dd>`;
  }).join('\n');
  const intro = s.intro ? `    <p>${escapeHtml(s.intro)}</p>\n` : '';
  return `  <section>
    <h2>${escapeHtml(s.h2)}</h2>
${intro}    <dl>
${items}
    </dl>
  </section>`;
}

function renderTable(s: TableSection): string {
  const thead = s.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const tbody = s.rows.map((r) =>
    `        <tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`
  ).join('\n');
  const intro = s.intro ? `    <p>${escapeHtml(s.intro)}</p>\n` : '';
  return `  <section>
    <h2>${escapeHtml(s.h2)}</h2>
${intro}    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>
${tbody}
      </tbody>
    </table>
  </section>`;
}

function renderGrid(s: GridSection): string {
  const cards = s.cards.map((c) => {
    const img = c.image_url
      ? `        <img src="${escapeHtml(c.image_url)}" alt="${escapeHtml(c.image_alt || c.title)}" loading="lazy" />\n`
      : '';
    const heading = c.href
      ? `<a href="${escapeHtml(c.href)}">${escapeHtml(c.title)}</a>`
      : escapeHtml(c.title);
    const meta = c.meta ? `        <p><small>${escapeHtml(c.meta)}</small></p>\n` : '';
    return `      <article>
${img}        <h3>${heading}</h3>
        <p>${escapeHtml(c.description)}</p>
${meta}      </article>`;
  }).join('\n');
  const intro = s.intro ? `    <p>${escapeHtml(s.intro)}</p>\n` : '';
  return `  <section>
    <h2>${escapeHtml(s.h2)}</h2>
${intro}    <div class="grid">
${cards}
    </div>
  </section>`;
}

function renderCta(s: CtaSection): string {
  return `  <section>
    <h2>${escapeHtml(s.h2)}</h2>
    <p>${escapeHtml(s.body)}</p>
    <p><a href="${escapeHtml(s.button_href)}">${escapeHtml(s.button_label)}</a></p>
  </section>`;
}

function renderSection(s: ContentSection): string {
  switch (s.type) {
    case 'prose': return renderProse(s);
    case 'list':  return renderList(s);
    case 'table': return renderTable(s);
    case 'grid':
    case 'cards': return renderGrid(s);
    case 'cta':   return renderCta(s);
    default: return '';
  }
}

function renderFaq(items: ContentPageRow['faq']): string {
  if (!items?.length) return '';
  const blocks = items.map((f) =>
    `    <dt>${escapeHtml(f.question)}</dt>
    <dd>${escapeHtml(f.answer)}</dd>`
  ).join('\n');
  return `  <section>
    <h2>Frequently Asked Questions</h2>
    <dl>
${blocks}
    </dl>
  </section>`;
}

function renderCrossLinks(items: ContentPageRow['cross_links']): string {
  if (!items?.length) return '';
  const lis = items.map((l) =>
    `      <li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`
  ).join('\n');
  return `  <section>
    <h2>Related</h2>
    <ul>
${lis}
    </ul>
  </section>`;
}

function renderInternalLinks(items: ContentPageRow['internal_links']): string {
  if (!items?.length) return '';
  const lis = items.map((l) =>
    `      <li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`
  ).join('\n');
  return `  <nav aria-label="page">
    <ul>
${lis}
    </ul>
  </nav>`;
}

export function renderContentFromRow(
  lang: Lang,
  row: ContentPageRow,
  slug: ContentPageSlug,
): { bodyHtml: string; jsonLd: string[] } {
  const canonicalPath = `/${lang}/${slug}`;
  const canonicalUrl = `${SITE_BASE}${canonicalPath}`;

  const crumbs = [
    { label: 'Home', href: `/${lang}` },
    { label: row.h1, href: canonicalPath },
  ];

  const bodyHtml = `
  <header>
    <h1>${escapeHtml(row.h1)}</h1>
    ${row.tagline ? `<p><strong>${escapeHtml(row.tagline)}</strong></p>` : ''}
    ${row.lead_paragraph ? `<p>${escapeHtml(row.lead_paragraph)}</p>` : ''}
  </header>
${renderBreadcrumbs(lang, crumbs)}
${(row.sections || []).map(renderSection).join('\n')}
${renderFaq(row.faq)}
${renderCrossLinks(row.cross_links)}
${renderInternalLinks(row.internal_links)}
${renderFooterLinks(lang)}
`;

  const jsonLd: string[] = [
    contentPageSchemaFromRow(row, canonicalUrl),
    breadcrumbSchema(lang, crumbs.map((c) => ({ name: c.label, path: c.href }))),
  ];
  const faqLd = faqPageSchemaFromRow(row.faq);
  if (faqLd) jsonLd.push(faqLd);

  return { bodyHtml, jsonLd };
}
