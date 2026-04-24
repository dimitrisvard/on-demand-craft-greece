import { Lang, ServiceId, SERVICE_IDS, SITE_BASE } from '../types';
import { t } from '../i18n';
import { localizedPath } from '../slugs';
import { SERVICES } from '../services';
import { escapeHtml, renderServicesList, renderFooterLinks, renderBreadcrumbs } from './common';
import { itemListSchema, breadcrumbSchema, faqPageSchemaFromRow } from '../schema';
import { labelsFor, ServicePageLabels } from '../labels/servicePageLabels';

interface ServicePageRow {
  slug: string;
  language: string;
  title: string;
  meta_description: string;
  h1: string;
  tagline: string;
  lead_paragraph: string;
  faq: Array<{ question: string; answer: string }>;
  differentiators: Array<{ title: string; description: string }>;
}

function renderDifferentiators(labels: ServicePageLabels, items: ServicePageRow['differentiators']): string {
  if (!items?.length) return '';
  const lis = items.map((d) =>
    `      <li><strong>${escapeHtml(d.title)}</strong> — ${escapeHtml(d.description)}</li>`
  ).join('\n');
  return `  <section>
    <h2>${escapeHtml(labels.whyMicronsHub)}</h2>
    <ul>
${lis}
    </ul>
  </section>`;
}

function renderFaq(labels: ServicePageLabels, items: ServicePageRow['faq']): string {
  if (!items?.length) return '';
  const blocks = items.map((f) =>
    `    <details>
      <summary>${escapeHtml(f.question)}</summary>
      <p>${escapeHtml(f.answer)}</p>
    </details>`
  ).join('\n');
  return `  <section>
    <h2>${escapeHtml(labels.faq)}</h2>
${blocks}
  </section>`;
}

function renderFromRows(
  lang: Lang,
  indexRow: ServicePageRow,
  list: ServicePageRow[],
): { bodyHtml: string; jsonLd: string[] } {
  const labels = labelsFor(lang);
  const homeLabel = t(lang, 'home_title', 'Home');
  const crumbs = [
    { label: homeLabel, href: localizedPath(lang, 'homepage') },
    { label: indexRow.h1, href: localizedPath(lang, 'services-index') },
  ];

  const quoteHref = localizedPath(lang, 'quote');
  const ctaLabel = t(lang, 'seo_quote_title', 'Get a Manufacturing Quote');

  const dbCards = list
    .filter((row) => SERVICE_IDS.includes(row.slug as ServiceId))
    .map((row) => {
      const id = row.slug as ServiceId;
      const href = localizedPath(lang, 'service-detail', id);
      return `      <li>
        <a href="${href}"><strong>${escapeHtml(row.h1)}</strong></a>
        ${row.tagline ? `<p><em>${escapeHtml(row.tagline)}</em></p>` : ''}
        <p>${escapeHtml(row.meta_description)}</p>
      </li>`;
    }).join('\n');

  // When the DB has no service detail rows for this language, still render the
  // hero + FAQ from the index row but fall back to the i18n-based cards list.
  const cardsBlock = dbCards
    ? `  <section>
    <h2>${escapeHtml(t(lang, 'services_section_title', 'Our Manufacturing Services'))}</h2>
    <ul>
${dbCards}
    </ul>
  </section>`
    : `  <section>
    <h2>${escapeHtml(t(lang, 'services_section_title', 'Our Manufacturing Services'))}</h2>
${renderServicesList(lang)}
  </section>`;

  const bodyHtml = `
  <header>
    <h1>${escapeHtml(indexRow.h1)}</h1>
    ${indexRow.tagline ? `<p><strong>${escapeHtml(indexRow.tagline)}</strong></p>` : ''}
    ${indexRow.lead_paragraph ? `<p>${escapeHtml(indexRow.lead_paragraph)}</p>` : ''}
  </header>
${renderBreadcrumbs(lang, crumbs)}
${cardsBlock}
${renderDifferentiators(labels, indexRow.differentiators)}
${renderFaq(labels, indexRow.faq)}
  <section>
    <p><a href="${quoteHref}">${escapeHtml(ctaLabel)}</a></p>
    <p><a href="${localizedPath(lang, 'industries')}">${escapeHtml(t(lang, 'seo_industries_title', 'Industries We Serve'))}</a></p>
  </section>
${renderFooterLinks(lang)}
`;

  const listItems = list.length
    ? list
      .filter((row) => SERVICE_IDS.includes(row.slug as ServiceId))
      .map((row) => ({
        name: row.h1,
        url: `${SITE_BASE}${localizedPath(lang, 'service-detail', row.slug as ServiceId)}`,
      }))
    : SERVICE_IDS.map((id) => {
      const svc = SERVICES[id];
      return {
        name: t(lang, `service_${svc.translationKey}_hero_title`, id),
        url: `${SITE_BASE}${localizedPath(lang, 'service-detail', id)}`,
      };
    });

  const jsonLd: string[] = [
    itemListSchema(listItems),
    breadcrumbSchema(lang, crumbs.map((c) => ({ name: c.label, path: c.href }))),
  ];
  const faqLd = faqPageSchemaFromRow(indexRow.faq);
  if (faqLd) jsonLd.push(faqLd);

  return { bodyHtml, jsonLd };
}

function renderFromI18nFallback(lang: Lang): { bodyHtml: string; jsonLd: string[] } {
  const title = t(lang, 'seo_services_title', 'Manufacturing Services');
  const description = t(lang, 'seo_services_description',
    'Comprehensive manufacturing solutions including CNC machining, 3D printing, sheet metal fabrication, injection molding.');
  const ctaLabel = t(lang, 'seo_quote_title', 'Get a Manufacturing Quote');
  const homeLabel = t(lang, 'home_title', 'Home');

  const crumbs = [
    { label: homeLabel, href: localizedPath(lang, 'homepage') },
    { label: title, href: localizedPath(lang, 'services-index') },
  ];

  const bodyHtml = `
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
  </header>
${renderBreadcrumbs(lang, crumbs)}
  <section>
    <h2>${escapeHtml(t(lang, 'services_section_title', 'Our Manufacturing Services'))}</h2>
${renderServicesList(lang)}
  </section>
  <section>
    <p><a href="${localizedPath(lang, 'quote')}">${escapeHtml(ctaLabel)}</a></p>
    <p><a href="${localizedPath(lang, 'industries')}">${escapeHtml(t(lang, 'seo_industries_title', 'Industries We Serve'))}</a></p>
  </section>
${renderFooterLinks(lang)}
`;

  const jsonLd = [
    itemListSchema(SERVICE_IDS.map((id) => {
      const svc = SERVICES[id];
      return {
        name: t(lang, `service_${svc.translationKey}_hero_title`, id),
        url: `${SITE_BASE}${localizedPath(lang, 'service-detail', id)}`,
      };
    })),
    breadcrumbSchema(lang, crumbs.map((c) => ({ name: c.label, path: c.href }))),
  ];

  return { bodyHtml, jsonLd };
}

export function renderServicesIndex(
  lang: Lang,
  indexRow: ServicePageRow | null,
  list: ServicePageRow[],
): { bodyHtml: string; jsonLd: string[] } {
  if (indexRow) return renderFromRows(lang, indexRow, list);
  return renderFromI18nFallback(lang);
}
