import { Lang, SITE_BASE } from '../types';
import { t } from '../i18n';
import { localizedPath } from '../slugs';
import { INDUSTRIES } from '../services';
import { escapeHtml, renderFooterLinks, renderBreadcrumbs } from './common';
import { itemListSchema, breadcrumbSchema } from '../schema';

export function renderIndustries(lang: Lang): { bodyHtml: string; jsonLd: string[] } {
  const title = t(lang, 'seo_industries_title', 'Industries We Serve');
  const description = t(lang, 'seo_industries_description',
    'Manufacturing solutions for aerospace, automotive, medical, electronics, and more.');
  const heroTitle = t(lang, 'industries_hero_title', title);
  const heroDesc = t(lang, 'industries_hero_desc', description);
  const ctaLabel = t(lang, 'seo_quote_title', 'Get a Manufacturing Quote');
  const homeLabel = t(lang, 'home_title', 'Home');

  const crumbs = [
    { label: homeLabel, href: localizedPath(lang, 'homepage') },
    { label: title, href: localizedPath(lang, 'industries') },
  ];

  const industryBlocks = INDUSTRIES.map((ind) => {
    const name = t(lang, `industry_${ind.translationKey}`, ind.id);
    const desc = t(lang, `industry_${ind.translationKey}_desc`, '');
    return `    <article>
      <h2>${escapeHtml(name)}</h2>
      <p>${escapeHtml(desc)}</p>
    </article>`;
  }).join('\n');

  const bodyHtml = `
  <header>
    <h1>${escapeHtml(heroTitle)}</h1>
    <p>${escapeHtml(heroDesc)}</p>
    <p>${escapeHtml(description)}</p>
  </header>
${renderBreadcrumbs(lang, crumbs)}
  <section>
${industryBlocks}
  </section>
  <section>
    <p><a href="${localizedPath(lang, 'services-index')}">${escapeHtml(t(lang, 'seo_services_title', 'Manufacturing Services'))}</a></p>
    <p><a href="${localizedPath(lang, 'quote')}">${escapeHtml(ctaLabel)}</a></p>
  </section>
${renderFooterLinks(lang)}
`;

  const jsonLd = [
    itemListSchema(INDUSTRIES.map((ind) => ({
      name: t(lang, `industry_${ind.translationKey}`, ind.id),
      url: `${SITE_BASE}${localizedPath(lang, 'industries')}#${ind.id}`,
    }))),
    breadcrumbSchema(lang, crumbs.map((c) => ({ name: c.label, path: c.href }))),
  ];

  return { bodyHtml, jsonLd };
}
