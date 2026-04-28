import { escapeHtml } from '../inject.js';
import { Lang } from '../types.js';
import { t } from '../i18n.js';
import { localizedPath } from '../slugs.js';
import { SERVICES, SERVICE_IDS } from '../services.js';

export { escapeHtml };

/** Render the site-wide SEO footer block: cross-links to major sections. */
export function renderFooterLinks(lang: Lang): string {
  const items: { label: string; href: string }[] = [
    { label: t(lang, 'seo_services_title', 'Services'), href: localizedPath(lang, 'services-index') },
    { label: t(lang, 'seo_industries_title', 'Industries'), href: localizedPath(lang, 'industries') },
    { label: t(lang, 'seo_about_title', 'About'), href: localizedPath(lang, 'about') },
    { label: t(lang, 'seo_our_work_title', 'Our Work'), href: localizedPath(lang, 'our-work') },
    { label: t(lang, 'blog_title', 'Blog'), href: localizedPath(lang, 'blog-index') },
    { label: t(lang, 'seo_contact_title', 'Contact'), href: localizedPath(lang, 'contact') },
    { label: t(lang, 'seo_quote_title', 'Get a Quote'), href: localizedPath(lang, 'quote') },
  ];
  const lis = items.map((i) => `      <li><a href="${i.href}">${escapeHtml(i.label)}</a></li>`).join('\n');
  // Legal-entity line surfaces company identity to plain-curl / link-preview
  // bots that don't execute the React Footer. Greek Ε.Ε. passes through
  // escapeHtml unchanged — those codepoints are outside the replace set.
  const legal = `  <p class="legal">MICRONS HUB DV Ε.Ε. · VAT: EL803129638 · GEMI: 190254227000 · Industrial Area, Street B, Number 4, 71601 Heraklion, Crete, Greece</p>`;
  return `  <nav aria-label="site">\n    <ul>\n${lis}\n    </ul>\n  </nav>\n${legal}`;
}

/** Render a compact list of service links, used on homepage + services index. */
export function renderServicesList(lang: Lang): string {
  const items = SERVICE_IDS.map((id) => {
    const svc = SERVICES[id];
    const title = t(lang, `service_${svc.translationKey}_hero_title`,
      t(lang, `service_${svc.translationKey}_title`, id));
    const subtitle = t(lang, `service_${svc.translationKey}_hero_subtitle`, '');
    const description = t(lang, `seo_${svc.seoKeyBase}_description`, subtitle);
    return `      <li>
        <a href="${localizedPath(lang, 'service-detail', id)}">
          <strong>${escapeHtml(title)}</strong>
        </a>
        <p>${escapeHtml(description)}</p>
      </li>`;
  }).join('\n');
  return `    <ul>\n${items}\n    </ul>`;
}

/** Render breadcrumb HTML (separate from the JSON-LD version). */
export function renderBreadcrumbs(lang: Lang, crumbs: { label: string; href: string }[]): string {
  const parts = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    return last
      ? `<span aria-current="page">${escapeHtml(c.label)}</span>`
      : `<a href="${c.href}">${escapeHtml(c.label)}</a>`;
  }).join(' &rsaquo; ');
  return `  <nav aria-label="breadcrumb"><p>${parts}</p></nav>`;
}
