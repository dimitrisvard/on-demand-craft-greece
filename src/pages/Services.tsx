import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import SEOMeta from '@/components/SEOMeta';
import CTASection from '@/components/CTASection';
import FAQAccordion from '@/components/services/FAQAccordion';
import Differentiators from '@/components/services/Differentiators';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  useServicePage,
  useServicePageList,
} from '@/lib/service-pages';
import {
  generateFAQPageSchema,
  generateServiceItemListSchema,
} from '@/lib/schema';

const SITE_BASE_URL = 'https://www.micronshub.eu';

const Services = () => {
  const { currentLanguage } = useLanguage();
  const { data: indexContent, isLoading: loadingIndex } = useServicePage('index', currentLanguage);
  const { data: services, isLoading: loadingList } = useServicePageList(currentLanguage);

  if (loadingIndex || loadingList) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary" />
      </div>
    );
  }

  const canonicalUrl = `${SITE_BASE_URL}/en/services`;
  const title = indexContent?.title ?? 'Manufacturing Services | Microns Hub';
  const description =
    indexContent?.meta_description ??
    'CNC machining, 3D printing, sheet metal, injection molding, rapid prototyping, and surface finishes on demand.';

  const itemListSchema = services
    ? generateServiceItemListSchema(
        `${SITE_BASE_URL}/${currentLanguage}`,
        services.map((s) => ({
          slug: s.slug,
          title: s.title,
          meta_description: s.meta_description,
        })),
      )
    : null;

  const faqSchema = indexContent?.faq ? generateFAQPageSchema(indexContent.faq) : null;

  return (
    <div className="min-h-screen pt-16">
      <SEOMeta title={title} description={description} canonicalUrl={canonicalUrl} />
      <Helmet>
        {itemListSchema && (
          <script type="application/ld+json">{JSON.stringify(itemListSchema)}</script>
        )}
        {faqSchema && (
          <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
        )}
      </Helmet>

      {indexContent && (
        <section className="relative bg-brand-dark text-white py-20 md:py-28">
          <div className="container-custom max-w-4xl">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">{indexContent.h1}</h1>
            {indexContent.tagline && (
              <p className="text-xl md:text-2xl text-white/90 mb-6">{indexContent.tagline}</p>
            )}
            {indexContent.lead_paragraph && (
              <p className="text-lg text-white/80 leading-relaxed">
                {indexContent.lead_paragraph}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="py-16">
        <div className="container-custom">
          <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-10">
            Our Services
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {(services ?? []).map((s) => (
              <Link
                key={s.slug}
                to={`/${currentLanguage}/services/${s.localized_slug ?? s.slug}`}
                className="group border border-brand-dark/10 rounded-lg bg-white p-6 hover:border-brand-primary transition-colors flex flex-col"
              >
                <h3 className="text-xl font-semibold text-brand-dark mb-3">{s.h1}</h3>
                {s.tagline && (
                  <p className="text-brand-dark/70 mb-4">{s.tagline}</p>
                )}
                <p className="text-sm text-brand-dark/70 leading-relaxed flex-1">
                  {s.meta_description}
                </p>
                <span className="mt-4 inline-flex items-center text-brand-primary font-medium">
                  Learn more
                  <ArrowRight
                    size={16}
                    className="ml-2 transition-transform group-hover:translate-x-1"
                  />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {indexContent?.differentiators?.length > 0 && (
        <Differentiators
          items={indexContent.differentiators}
          heading="Why Microns Hub"
        />
      )}

      {indexContent?.faq?.length > 0 && (
        <FAQAccordion items={indexContent.faq} heading="Frequently Asked Questions" />
      )}

      <CTASection />
    </div>
  );
};

export default Services;
