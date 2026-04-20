import { t } from './i18n';
import { Lang, PageMeta, ParsedRoute, DEFAULT_IMAGE } from './types';
import { SERVICES } from './services';

const BRAND = 'Microns Hub';

function withBrand(title: string): string {
  return title.includes(BRAND) ? title : `${title} | ${BRAND}`;
}

interface ServicePageMetaOverride {
  title: string;
  meta_description: string;
}

/**
 * Builds localized <head> metadata for a parsed route. All strings are pulled
 * from src/locales/<lang>/translation.json (clean UTF-8), replacing the old
 * hardcoded mojibake maps that lived in middleware.ts.
 *
 * For services-index and service-detail, a Supabase service_pages row may be
 * passed as a second argument; its title / meta_description take precedence
 * over the i18n keys. Callers that don't have the row pass undefined and the
 * original i18n-based behavior applies.
 */
export function getMeta(route: ParsedRoute, servicePage?: ServicePageMetaOverride | null): PageMeta {
  const { lang, type } = route;

  if (servicePage && (type === 'services-index' || type === 'service-detail')) {
    return {
      title: withBrand(servicePage.title),
      description: servicePage.meta_description,
      ogType: 'website',
      image: DEFAULT_IMAGE,
    };
  }

  switch (type) {
    case 'homepage':
      return {
        title: withBrand(t(lang, 'home_title', 'On-Demand Manufacturing Platform')),
        description: t(lang, 'home_subtitle',
          'European on-demand manufacturing platform. CNC machining, sheet metal, 3D printing, injection molding.'),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };

    case 'services-index':
      return {
        title: withBrand(t(lang, 'seo_services_title', 'Manufacturing Services')),
        description: t(lang, 'seo_services_description',
          'Comprehensive manufacturing solutions including CNC machining, 3D printing, sheet metal fabrication, injection molding, and more.'),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };

    case 'service-detail': {
      const svc = SERVICES[route.serviceId!];
      return {
        title: withBrand(t(lang, `seo_${svc.seoKeyBase}_title`,
          t(lang, `service_${svc.translationKey}_hero_title`, svc.id))),
        description: t(lang, `seo_${svc.seoKeyBase}_description`,
          t(lang, `service_${svc.translationKey}_hero_subtitle`, '')),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };
    }

    case 'industries':
      return {
        title: withBrand(t(lang, 'seo_industries_title', 'Industries We Serve')),
        description: t(lang, 'seo_industries_description',
          'Manufacturing solutions for aerospace, automotive, medical, electronics, and more.'),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };

    case 'blog-index':
      return {
        title: withBrand(t(lang, 'blog_title', 'Blog')),
        description: t(lang, 'blog_subtitle',
          'Insights, news, and technical articles about manufacturing and engineering.'),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };

    case 'about':
      return {
        title: withBrand(t(lang, 'seo_about_title', 'About Us')),
        description: t(lang, 'seo_about_description',
          'Learn about Microns Hub, Europe\u2019s on-demand manufacturing platform.'),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };

    case 'contact':
      return {
        title: withBrand(t(lang, 'seo_contact_title', 'Contact Us')),
        description: t(lang, 'seo_contact_description',
          'Get in touch with Microns Hub. Contact our team for manufacturing inquiries, quotes, and support.'),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };

    case 'quote':
      return {
        title: withBrand(t(lang, 'seo_quote_title', 'Get a Manufacturing Quote')),
        description: t(lang, 'seo_quote_description',
          'Upload your CAD files and get a detailed manufacturing quote within 24 hours.'),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };

    case 'our-work':
      return {
        title: withBrand(t(lang, 'seo_our_work_title', 'Our Work')),
        description: t(lang, 'seo_our_work_description',
          'View our portfolio of manufacturing projects across CNC machining, sheet metal, injection molding, and more.'),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };

    default:
      return {
        title: withBrand(BRAND),
        description: t(lang, 'home_subtitle', ''),
        ogType: 'website',
        image: DEFAULT_IMAGE,
      };
  }
}
