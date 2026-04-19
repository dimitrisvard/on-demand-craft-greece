import { Lang, PageType } from '../types';
import { t, tArray } from '../i18n';
import { localizedPath } from '../slugs';
import { escapeHtml, renderFooterLinks, renderBreadcrumbs } from './common';
import { breadcrumbSchema } from '../schema';

type SimpleType = 'about' | 'contact' | 'quote' | 'our-work';

interface PageSpec {
  seoTitleKey: string;
  seoDescKey: string;
  heroTitleKey?: string;
  heroDescKey?: string;
  paragraphKeys: string[];
  listKeys?: string[]; // keys that hold arrays
}

const SPECS: Record<SimpleType, PageSpec> = {
  about: {
    seoTitleKey: 'seo_about_title',
    seoDescKey: 'seo_about_description',
    heroTitleKey: 'about_hero_title',
    heroDescKey: 'about_hero_subtitle',
    paragraphKeys: [
      'about_our_story_p1', 'about_our_story_p2', 'about_our_story_p3',
      'about_mission_desc', 'about_vision_desc', 'about_promise_desc',
      'about_quality_assurance_desc', 'about_facilities_desc',
    ],
  },
  contact: {
    seoTitleKey: 'seo_contact_title',
    seoDescKey: 'seo_contact_description',
    heroTitleKey: 'contact_hero_title',
    heroDescKey: 'contact_hero_subtitle',
    paragraphKeys: [
      'contact_intro', 'contact_description', 'contact_subtitle',
      'contact_hours_title', 'contact_address_title',
    ],
  },
  quote: {
    seoTitleKey: 'seo_quote_title',
    seoDescKey: 'seo_quote_description',
    heroTitleKey: 'quote_hero_title',
    heroDescKey: 'quote_hero_subtitle',
    paragraphKeys: [
      'quote_intro', 'quote_subtitle', 'quote_description',
      'quote_process_title', 'quote_process_description',
    ],
  },
  'our-work': {
    seoTitleKey: 'seo_our_work_title',
    seoDescKey: 'seo_our_work_description',
    heroTitleKey: 'our_work_title',
    heroDescKey: 'our_work_intro',
    paragraphKeys: [
      'our_work_intro', 'our_work_description', 'our_work_subtitle',
    ],
  },
};

export function renderSimplePage(lang: Lang, type: SimpleType): { bodyHtml: string; jsonLd: string[] } {
  const spec = SPECS[type];
  const title = t(lang, spec.seoTitleKey, type);
  const description = t(lang, spec.seoDescKey, '');
  const heroTitle = spec.heroTitleKey ? t(lang, spec.heroTitleKey, title) : title;
  const heroDesc = spec.heroDescKey ? t(lang, spec.heroDescKey, description) : description;
  const homeLabel = t(lang, 'home_title', 'Home');

  const crumbs = [
    { label: homeLabel, href: localizedPath(lang, 'homepage') },
    { label: title, href: localizedPath(lang, type as PageType) },
  ];

  const paragraphs = spec.paragraphKeys
    .map((k) => t(lang, k, ''))
    .filter((s) => s && s.length > 20)
    .map((s) => `    <p>${escapeHtml(s)}</p>`)
    .join('\n');

  const ctaLabel = t(lang, 'seo_quote_title', 'Get a Quote');

  const bodyHtml = `
  <header>
    <h1>${escapeHtml(heroTitle)}</h1>
    <p>${escapeHtml(heroDesc)}</p>
    <p>${escapeHtml(description)}</p>
  </header>
${renderBreadcrumbs(lang, crumbs)}
  <section>
${paragraphs}
  </section>
  <section>
    <p><a href="${localizedPath(lang, 'services-index')}">${escapeHtml(t(lang, 'seo_services_title', 'Services'))}</a></p>
    <p><a href="${localizedPath(lang, 'quote')}">${escapeHtml(ctaLabel)}</a></p>
  </section>
${renderFooterLinks(lang)}
`;

  const jsonLd = [
    breadcrumbSchema(lang, crumbs.map((c) => ({ name: c.label, path: c.href }))),
  ];

  return { bodyHtml, jsonLd };
}
