import { Lang, SITE_BASE } from '../types';
import { t } from '../i18n';
import { localizedPath } from '../slugs';
import { SERVICES, SERVICE_IDS, INDUSTRIES } from '../services';
import { escapeHtml, renderServicesList, renderFooterLinks } from './common';
import { organizationSchema, itemListSchema } from '../schema';

export function renderHomepage(lang: Lang): { bodyHtml: string; jsonLd: string[] } {
  const title = t(lang, 'home_title', 'Microns Hub — On-Demand Manufacturing');
  const subtitle = t(lang, 'home_subtitle',
    'Precision manufacturing delivered across Europe: CNC machining, sheet metal, 3D printing, injection molding.');
  const servicesHeading = t(lang, 'services_section_title', 'Our Manufacturing Services');
  const servicesIntro = t(lang, 'services_section_subtitle',
    'We offer comprehensive manufacturing solutions to bring your designs to life with precision and quality.');
  const industriesHeading = t(lang, 'industries_hero_title', 'Industries We Serve');
  const industriesIntro = t(lang, 'industries_hero_desc',
    'Our manufacturing expertise spans diverse industries from aerospace to consumer goods.');
  const ctaLabel = t(lang, 'seo_quote_title', 'Get a Manufacturing Quote');

  const industriesList = INDUSTRIES.map((ind) => {
    const name = t(lang, `industry_${ind.translationKey}`, ind.id);
    return `      <li>${escapeHtml(name)}</li>`;
  }).join('\n');

  const bodyHtml = `
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
  </header>
  <section>
    <h2>${escapeHtml(servicesHeading)}</h2>
    <p>${escapeHtml(servicesIntro)}</p>
${renderServicesList(lang)}
  </section>
  <section>
    <h2>${escapeHtml(industriesHeading)}</h2>
    <p>${escapeHtml(industriesIntro)}</p>
    <ul>
${industriesList}
    </ul>
    <p><a href="${localizedPath(lang, 'industries')}">${escapeHtml(industriesHeading)}</a></p>
  </section>
  <section>
    <p><a href="${localizedPath(lang, 'quote')}">${escapeHtml(ctaLabel)}</a></p>
  </section>
${renderFooterLinks(lang)}
`;

  const itemList = itemListSchema(
    SERVICE_IDS.map((id) => {
      const svc = SERVICES[id];
      return {
        name: t(lang, `service_${svc.translationKey}_hero_title`, id),
        url: `${SITE_BASE}${localizedPath(lang, 'service-detail', id)}`,
      };
    })
  );

  return { bodyHtml, jsonLd: [organizationSchema(), itemList] };
}
