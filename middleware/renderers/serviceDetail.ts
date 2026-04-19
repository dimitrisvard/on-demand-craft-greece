import { Lang, ServiceId } from '../types';
import { t } from '../i18n';
import { localizedPath } from '../slugs';
import { SERVICES, SERVICE_IDS } from '../services';
import { escapeHtml, renderFooterLinks, renderBreadcrumbs } from './common';
import { serviceSchema, breadcrumbSchema } from '../schema';

export function renderServiceDetail(lang: Lang, serviceId: ServiceId): { bodyHtml: string; jsonLd: string[] } {
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
