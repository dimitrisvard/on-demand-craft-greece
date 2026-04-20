import { Lang, ServiceId, SITE_BASE } from '../types';
import { t } from '../i18n';
import { localizedPath } from '../slugs';
import { SERVICES, SERVICE_IDS } from '../services';
import { escapeHtml, renderFooterLinks, renderBreadcrumbs } from './common';
import { serviceSchema, serviceSchemaFromRow, faqPageSchemaFromRow, breadcrumbSchema } from '../schema';

interface ServicePageRow {
  slug: string;
  language: string;
  localized_slug: string | null;
  title: string;
  meta_description: string;
  h1: string;
  tagline: string;
  lead_paragraph: string;
  capabilities: Array<{ label: string; detail: string }>;
  applications: Array<{ name: string; description: string }>;
  materials: Array<{ material: string; grade: string; properties: string; uses: string }>;
  tolerances: Array<{ spec: string; value: string; notes?: string }>;
  process_steps: Array<{ step: number; title: string; description: string }>;
  lead_times: Array<{ tier: string; quantity_range: string; working_days: string }>;
  faq: Array<{ question: string; answer: string }>;
  differentiators: Array<{ title: string; description: string }>;
  cross_links: Array<{ slug: string; label: string; description: string }>;
}

function renderCapabilities(items: ServicePageRow['capabilities']): string {
  if (!items?.length) return '';
  const lis = items.map((c) =>
    `      <li><strong>${escapeHtml(c.label)}</strong> — ${escapeHtml(c.detail)}</li>`
  ).join('\n');
  return `  <section>
    <h2>Capabilities</h2>
    <ul>
${lis}
    </ul>
  </section>`;
}

function renderApplications(items: ServicePageRow['applications']): string {
  if (!items?.length) return '';
  const lis = items.map((a) =>
    `      <li><strong>${escapeHtml(a.name)}</strong> — ${escapeHtml(a.description)}</li>`
  ).join('\n');
  return `  <section>
    <h2>Applications</h2>
    <ul>
${lis}
    </ul>
  </section>`;
}

function renderMaterials(items: ServicePageRow['materials']): string {
  if (!items?.length) return '';
  const rows = items.map((m) =>
    `        <tr><td>${escapeHtml(m.material)}</td><td>${escapeHtml(m.grade)}</td><td>${escapeHtml(m.properties)}</td><td>${escapeHtml(m.uses)}</td></tr>`
  ).join('\n');
  return `  <section>
    <h2>Materials</h2>
    <table>
      <thead><tr><th>Material</th><th>Grade</th><th>Properties</th><th>Common Uses</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`;
}

function renderTolerances(items: ServicePageRow['tolerances']): string {
  if (!items?.length) return '';
  const rows = items.map((t_) =>
    `        <tr><td>${escapeHtml(t_.spec)}</td><td>${escapeHtml(t_.value)}</td><td>${escapeHtml(t_.notes ?? '')}</td></tr>`
  ).join('\n');
  return `  <section>
    <h2>Tolerances &amp; Specifications</h2>
    <table>
      <thead><tr><th>Spec</th><th>Value</th><th>Notes</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`;
}

function renderProcessSteps(items: ServicePageRow['process_steps']): string {
  if (!items?.length) return '';
  const ordered = [...items].sort((a, b) => a.step - b.step);
  const lis = ordered.map((s) =>
    `      <li><strong>Step ${s.step}: ${escapeHtml(s.title)}</strong> — ${escapeHtml(s.description)}</li>`
  ).join('\n');
  return `  <section>
    <h2>How It Works</h2>
    <ol>
${lis}
    </ol>
  </section>`;
}

function renderLeadTimes(items: ServicePageRow['lead_times']): string {
  if (!items?.length) return '';
  const rows = items.map((lt) =>
    `        <tr><td>${escapeHtml(lt.tier)}</td><td>${escapeHtml(lt.quantity_range)}</td><td>${escapeHtml(lt.working_days)}</td></tr>`
  ).join('\n');
  return `  <section>
    <h2>Lead Times</h2>
    <table>
      <thead><tr><th>Tier</th><th>Quantity</th><th>Working Days</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`;
}

function renderDifferentiators(items: ServicePageRow['differentiators']): string {
  if (!items?.length) return '';
  const lis = items.map((d) =>
    `      <li><strong>${escapeHtml(d.title)}</strong> — ${escapeHtml(d.description)}</li>`
  ).join('\n');
  return `  <section>
    <h2>Why Microns Hub</h2>
    <ul>
${lis}
    </ul>
  </section>`;
}

function renderFaq(items: ServicePageRow['faq']): string {
  if (!items?.length) return '';
  const blocks = items.map((f) =>
    `    <details>
      <summary>${escapeHtml(f.question)}</summary>
      <p>${escapeHtml(f.answer)}</p>
    </details>`
  ).join('\n');
  return `  <section>
    <h2>Frequently Asked Questions</h2>
${blocks}
  </section>`;
}

function renderCrossLinks(lang: Lang, items: ServicePageRow['cross_links']): string {
  if (!items?.length) return '';
  const lis = items.map((link) => {
    const id = SERVICE_IDS.includes(link.slug as ServiceId) ? (link.slug as ServiceId) : null;
    const href = id ? localizedPath(lang, 'service-detail', id) : `/${lang}/services/${link.slug}`;
    return `      <li>
        <a href="${href}"><strong>${escapeHtml(link.label)}</strong></a>
        <p>${escapeHtml(link.description)}</p>
      </li>`;
  }).join('\n');
  return `  <section>
    <h2>Related Services</h2>
    <ul>
${lis}
    </ul>
  </section>`;
}

function renderFromRow(lang: Lang, serviceId: ServiceId, row: ServicePageRow): { bodyHtml: string; jsonLd: string[] } {
  const homeLabel = t(lang, 'home_title', 'Home');
  const servicesLabel = t(lang, 'seo_services_title', 'Services');
  const ctaLabel = t(lang, 'seo_quote_title', 'Get a Quote');
  const contactLabel = t(lang, 'seo_contact_title', 'Contact');

  const crumbs = [
    { label: homeLabel, href: localizedPath(lang, 'homepage') },
    { label: servicesLabel, href: localizedPath(lang, 'services-index') },
    { label: row.h1, href: localizedPath(lang, 'service-detail', serviceId) },
  ];

  const canonicalUrl = `${SITE_BASE}${localizedPath(lang, 'service-detail', serviceId)}`;
  const quoteHref = localizedPath(lang, 'quote');
  const contactHref = localizedPath(lang, 'contact');

  const bodyHtml = `
  <header>
    <h1>${escapeHtml(row.h1)}</h1>
    ${row.tagline ? `<p><strong>${escapeHtml(row.tagline)}</strong></p>` : ''}
    ${row.lead_paragraph ? `<p>${escapeHtml(row.lead_paragraph)}</p>` : ''}
  </header>
${renderBreadcrumbs(lang, crumbs)}
${renderCapabilities(row.capabilities)}
${renderMaterials(row.materials)}
${renderTolerances(row.tolerances)}
${renderProcessSteps(row.process_steps)}
${renderLeadTimes(row.lead_times)}
${renderApplications(row.applications)}
${renderDifferentiators(row.differentiators)}
${renderFaq(row.faq)}
${renderCrossLinks(lang, row.cross_links)}
  <section>
    <p><a href="${quoteHref}">${escapeHtml(ctaLabel)}</a></p>
    <p><a href="${contactHref}">${escapeHtml(contactLabel)}</a></p>
  </section>
${renderFooterLinks(lang)}
`;

  const jsonLd: string[] = [
    serviceSchemaFromRow(row, canonicalUrl, lang),
    breadcrumbSchema(lang, crumbs.map((c) => ({ name: c.label, path: c.href }))),
  ];
  const faqLd = faqPageSchemaFromRow(row.faq);
  if (faqLd) jsonLd.push(faqLd);

  return { bodyHtml, jsonLd };
}

function renderFromI18nFallback(lang: Lang, serviceId: ServiceId): { bodyHtml: string; jsonLd: string[] } {
  const svc = SERVICES[serviceId];
  const title = t(lang, `service_${svc.translationKey}_hero_title`,
    t(lang, `seo_${svc.seoKeyBase}_title`, serviceId));
  const subtitle = t(lang, `service_${svc.translationKey}_hero_subtitle`, '');
  const seoDescription = t(lang, `seo_${svc.seoKeyBase}_description`, subtitle);
  const capabilitiesHeading = t(lang, 'service_capabilities_title', 'Capabilities');
  const relatedHeading = t(lang, 'services_section_title', 'Related Services');
  const ctaLabel = t(lang, 'seo_quote_title', 'Get a Quote');
  const homeLabel = t(lang, 'home_title', 'Home');
  const servicesLabel = t(lang, 'seo_services_title', 'Services');

  const crumbs = [
    { label: homeLabel, href: localizedPath(lang, 'homepage') },
    { label: servicesLabel, href: localizedPath(lang, 'services-index') },
    { label: title, href: localizedPath(lang, 'service-detail', serviceId) },
  ];

  const capabilities = svc.capabilities
    .map((c) => `      <li>${escapeHtml(c)}</li>`)
    .join('\n');

  const relatedIds = SERVICE_IDS.filter((id) => id !== serviceId).slice(0, 3);
  const related = relatedIds.map((id) => {
    const rSvc = SERVICES[id];
    const rTitle = t(lang, `service_${rSvc.translationKey}_hero_title`, id);
    const rSubtitle = t(lang, `service_${rSvc.translationKey}_hero_subtitle`, '');
    return `      <li>
        <a href="${localizedPath(lang, 'service-detail', id)}"><strong>${escapeHtml(rTitle)}</strong></a>
        <p>${escapeHtml(rSubtitle)}</p>
      </li>`;
  }).join('\n');

  const bodyHtml = `
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
    <p>${escapeHtml(seoDescription)}</p>
  </header>
${renderBreadcrumbs(lang, crumbs)}
  <section>
    <h2>${escapeHtml(capabilitiesHeading)}</h2>
    <ul>
${capabilities}
    </ul>
  </section>
  <section>
    <p><a href="${localizedPath(lang, 'quote')}">${escapeHtml(ctaLabel)}</a></p>
  </section>
  <section>
    <h2>${escapeHtml(relatedHeading)}</h2>
    <ul>
${related}
    </ul>
    <p><a href="${localizedPath(lang, 'services-index')}">${escapeHtml(servicesLabel)}</a></p>
  </section>
${renderFooterLinks(lang)}
`;

  const jsonLd = [
    serviceSchema(lang, serviceId),
    breadcrumbSchema(lang, crumbs.map((c) => ({ name: c.label, path: c.href }))),
  ];

  return { bodyHtml, jsonLd };
}

export function renderServiceDetail(
  lang: Lang,
  serviceId: ServiceId,
  row: ServicePageRow | null,
): { bodyHtml: string; jsonLd: string[] } {
  if (row) return renderFromRow(lang, serviceId, row);
  return renderFromI18nFallback(lang, serviceId);
}
