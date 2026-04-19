import { Lang, SITE_BASE, DEFAULT_IMAGE, ServiceId } from './types';
import { t } from './i18n';
import { SERVICES } from './services';
import { localizedPath } from './slugs';

const PROVIDER = {
  '@type': 'Organization',
  name: 'Microns Hub',
  url: SITE_BASE,
  logo: { '@type': 'ImageObject', url: `${SITE_BASE}/logo.png` },
};

export function organizationSchema(): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Microns Hub',
    url: SITE_BASE,
    logo: `${SITE_BASE}/logo.png`,
    description: 'European on-demand manufacturing platform offering CNC machining, sheet metal fabrication, 3D printing with 4-9 day delivery.',
    address: { '@type': 'PostalAddress', addressCountry: 'GR' },
  });
}

export function breadcrumbSchema(lang: Lang, items: { name: string; path: string }[]): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${SITE_BASE}${item.path}`,
    })),
  });
}

export function itemListSchema(items: { name: string; url: string }[]): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: item.url,
    })),
  });
}

export function serviceSchema(lang: Lang, serviceId: ServiceId): string {
  const svc = SERVICES[serviceId];
  const name = t(lang, `service_${svc.translationKey}_hero_title`, svc.id);
  const description = t(lang, `service_${svc.translationKey}_hero_subtitle`, '') ||
    t(lang, `seo_${svc.seoKeyBase}_description`, '');
  const detailUrl = `${SITE_BASE}${localizedPath(lang, 'service-detail', serviceId)}`;
  const quoteUrl = `${SITE_BASE}${localizedPath(lang, 'quote')}`;

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name,
    serviceType: name,
    description,
    provider: PROVIDER,
    areaServed: [
      { '@type': 'Place', name: 'European Union' },
      { '@type': 'Country', name: 'Greece' },
    ],
    url: detailUrl,
    image: `${SITE_BASE}${svc.image}`,
    inLanguage: lang,
    offers: {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      priceCurrency: 'EUR',
      url: quoteUrl,
    },
  });
}

export function articleSchema(params: {
  lang: Lang; title: string; description: string;
  createdAt: string; updatedAt: string; image: string; url: string;
}): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: params.title,
    description: params.description,
    inLanguage: params.lang,
    datePublished: params.createdAt,
    dateModified: params.updatedAt,
    image: params.image,
    publisher: PROVIDER,
    mainEntityOfPage: params.url,
  });
}
