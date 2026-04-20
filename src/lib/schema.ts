import type { ServicePageContent, FAQItem } from './service-pages';

export function generateServiceSchema(content: ServicePageContent, canonicalUrl: string) {
  const base: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: content.h1,
    serviceType: content.h1,
    description: content.meta_description,
    url: canonicalUrl,
    provider: {
      '@type': 'Organization',
      name: 'Microns Hub',
      url: 'https://www.micronshub.eu',
      logo: { '@type': 'ImageObject', url: 'https://www.micronshub.eu/logo.png' },
    },
    areaServed: [{ '@type': 'Place', name: 'European Union' }],
  };
  if (content.schema_offer) {
    base.offers = {
      '@type': 'Offer',
      priceCurrency: content.schema_offer.priceCurrency,
      price: content.schema_offer.price,
      priceValidUntil: content.schema_offer.priceValidUntil,
      availability: 'https://schema.org/InStock',
    };
  }
  return base;
}

export function generateFAQPageSchema(faq: FAQItem[]) {
  if (!faq || faq.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function generateServiceItemListSchema(
  baseUrl: string,
  services: Array<{ slug: string; title: string; meta_description: string }>,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: services.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${baseUrl}/services/${s.slug}`,
      name: s.title,
      description: s.meta_description,
    })),
  };
}
