import { Lang, SITE_BASE } from '../types';
import { t } from '../i18n';
import { localizedPath } from '../slugs';
import { SERVICES, SERVICE_IDS } from '../services';
import { escapeHtml, renderServicesList, renderFooterLinks, renderBreadcrumbs } from './common';
import { itemListSchema, breadcrumbSchema } from '../schema';

export function renderServicesIndex(lang: Lang): { bodyHtml: string; jsonLd: string[] } {
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
