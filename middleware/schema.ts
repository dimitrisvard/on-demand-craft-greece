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

interface ServicePageRowLite {
  h1: string;
  meta_description: string;
  faq?: Array<{ question: string; answer: string }>;
}

export function serviceSchemaFromRow(row: ServicePageRowLite, canonicalUrl: string, lang: Lang): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: row.h1,
    serviceType: row.h1,
    description: row.meta_description,
    provider: PROVIDER,
    areaServed: [
      { '@type': 'Place', name: 'European Union' },
      { '@type': 'Country', name: 'Greece' },
    ],
    url: canonicalUrl,
    inLanguage: lang,
    offers: {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      priceCurrency: 'EUR',
      url: canonicalUrl,
    },
  });
}

export function faqPageSchemaFromRow(faq: Array<{ question: string; answer: string }> | undefined): string | null {
  if (!faq || faq.length === 0) return null;
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  });
}

interface ContentPageRowLite {
  language: string;
  title: string;
  meta_description: string;
  schema_type?: string | null;
  structured_data?: {
    contactPoints?: Array<Record<string, unknown>>;
    organization?: Record<string, unknown>;
    website?: Record<string, unknown>;
  } | null;
}

export function contentPageSchemaFromRow(row: ContentPageRowLite, canonicalUrl: string): string {
  const base: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': row.schema_type || 'WebPage',
    name: row.title,
    description: row.meta_description,
    url: canonicalUrl,
    inLanguage: row.language,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Microns Hub',
      url: SITE_BASE,
    },
  };

  if (row.schema_type === 'ContactPage' && row.structured_data?.contactPoints?.length) {
    base.contactPoint = row.structured_data.contactPoints.map((cp) => ({
      '@type': 'ContactPoint',
      ...cp,
    }));
  }

  if (row.schema_type === 'AboutPage' && row.structured_data?.organization) {
    base.mainEntity = {
      '@type': 'Organization',
      ...row.structured_data.organization,
    };
  }

  return JSON.stringify(base);
}

/**
 * WebSite + SearchAction JSON-LD. Google uses this to surface a sitelinks
 * search box on the homepage SERP result. Only emit on the /en home route.
 * Reads overrides from content_pages.home.structured_data.website when
 * present, otherwise falls back to the site default.
 */
export function websiteSchemaFromRow(row: ContentPageRowLite | null): string {
  const override = row?.structured_data?.website || {};
  const base = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Microns Hub',
    url: SITE_BASE,
    inLanguage: row?.language || 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_BASE}/en/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
    ...override,
  };
  return JSON.stringify(base);
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
