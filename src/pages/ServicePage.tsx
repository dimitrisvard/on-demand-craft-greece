import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import SEOMeta from '@/components/SEOMeta';
import CTASection from '@/components/CTASection';
import MaterialsTable from '@/components/services/MaterialsTable';
import ProcessSteps from '@/components/services/ProcessSteps';
import FAQAccordion from '@/components/services/FAQAccordion';
import LeadTimeTable from '@/components/services/LeadTimeTable';
import Differentiators from '@/components/services/Differentiators';
import {
  useServicePage,
  useHreflangAlternates,
  type ServicePageContent,
  type Tolerance,
  type Capability,
  type Application,
  type CrossLink,
} from '@/lib/service-pages';
import {
  generateServiceSchema,
  generateFAQPageSchema,
} from '@/lib/schema';

const SITE_BASE_URL = 'https://www.micronshub.eu';

const SERVICE_HERO_IMAGES: Record<string, string> = {
  'cnc-machining':     '/lovable-uploads/200d9297-1d4c-4f58-a7d0-492ec78f506b.png',
  'sheet-metal':       '/lovable-uploads/f6ea9e7f-263a-4ab2-a37b-8b5f4f41a537.png',
  '3d-printing':       '/lovable-uploads/59f13e48-0a66-4e3a-a3c3-e9db4fa53d08.png',
  'injection-molding': '/lovable-uploads/b31d113f-4829-4150-b985-c71d1f99dd5f.png',
  'surface-finishes':  '/lovable-uploads/e4960d66-a6c4-46ae-ab67-f061530c38cb.png',
  'rapid-prototyping': '/lovable-uploads/solidworks-rapid-prototyping.png',
};

interface ServicePageProps {
  slug: string;
}

const PageLoader = () => (
  <div className="min-h-screen pt-16 flex items-center justify-center">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary" />
  </div>
);

const CapabilitiesBlock: React.FC<{ items: Capability[] }> = ({ items }) => {
  if (!items?.length) return null;
  return (
    <section className="py-16">
      <div className="container-custom">
        <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">Capabilities</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((c, i) => (
            <div
              key={`${c.label}-${i}`}
              className="border border-brand-dark/10 rounded-lg bg-white p-5"
            >
              <div className="font-semibold text-brand-dark">{c.label}</div>
              <p className="mt-2 text-brand-dark/80 leading-relaxed">{c.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const ApplicationsBlock: React.FC<{ items: Application[] }> = ({ items }) => {
  if (!items?.length) return null;
  return (
    <section className="py-16 bg-brand-dark/5">
      <div className="container-custom">
        <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">Applications</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((a, i) => (
            <div
              key={`${a.name}-${i}`}
              className="border border-brand-dark/10 rounded-lg bg-white p-5"
            >
              <div className="font-semibold text-brand-dark">{a.name}</div>
              <p className="mt-2 text-brand-dark/80 leading-relaxed">{a.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const TolerancesBlock: React.FC<{ items: Tolerance[] }> = ({ items }) => {
  if (!items?.length) return null;
  return (
    <section className="py-16">
      <div className="container-custom max-w-4xl">
        <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">
          Tolerances &amp; Specifications
        </h2>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-brand-dark/10">
                <th className="py-3 px-4 font-semibold text-brand-dark">Spec</th>
                <th className="py-3 px-4 font-semibold text-brand-dark">Value</th>
                <th className="py-3 px-4 font-semibold text-brand-dark">Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t, i) => (
                <tr key={`${t.spec}-${i}`} className="border-b border-brand-dark/10">
                  <td className="py-3 px-4 font-medium">{t.spec}</td>
                  <td className="py-3 px-4 text-brand-dark/80">{t.value}</td>
                  <td className="py-3 px-4 text-brand-dark/80">{t.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-4">
          {items.map((t, i) => (
            <div
              key={`${t.spec}-${i}`}
              className="border border-brand-dark/10 rounded-lg p-4 bg-white"
            >
              <div className="font-semibold text-brand-dark">{t.spec}</div>
              <div className="mt-2 text-brand-dark">{t.value}</div>
              {t.notes && <div className="mt-1 text-sm text-brand-dark/70">{t.notes}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const CrossLinksBlock: React.FC<{ items: CrossLink[]; lang: string }> = ({ items, lang }) => {
  if (!items?.length) return null;
  return (
    <section className="py-16 bg-brand-dark/5">
      <div className="container-custom">
        <h2 className="text-3xl md:text-4xl font-bold text-brand-dark mb-8">Related Services</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {items.map((link) => (
            <Link
              key={link.slug}
              to={`/${lang}/services/${link.slug}`}
              className="group border border-brand-dark/10 rounded-lg bg-white p-5 hover:border-brand-primary transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-brand-dark">{link.label}</div>
                <ArrowRight
                  size={18}
                  className="text-brand-primary transition-transform group-hover:translate-x-1"
                />
              </div>
              <p className="mt-2 text-sm text-brand-dark/70 leading-relaxed">
                {link.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};

const Hero: React.FC<{ content: ServicePageContent; slug: string }> = ({ content, slug }) => {
  const { getLocalizedPath } = useLanguage();
  const heroImg = SERVICE_HERO_IMAGES[slug];
  return (
    <section className="relative bg-brand-dark text-white py-20 md:py-28">
      <div className="container-custom">
        <div className={`flex flex-col gap-10 ${heroImg ? 'md:flex-row md:items-center md:gap-14' : ''}`}>
          <div className="flex-1 max-w-2xl">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">{content.h1}</h1>
            {content.tagline && (
              <p className="text-xl md:text-2xl text-white/90 mb-6">{content.tagline}</p>
            )}
            {content.lead_paragraph && (
              <p className="text-lg text-white/80 leading-relaxed mb-8">
                {content.lead_paragraph}
              </p>
            )}
            <div className="flex flex-wrap gap-4">
              <Link
                to={getLocalizedPath('/quote')}
                className="btn-secondary inline-flex items-center"
              >
                Get a Quote <ArrowRight size={18} className="ml-2" />
              </Link>
              <Link
                to={getLocalizedPath('/contact')}
                className="btn-secondary bg-transparent border-white text-white hover:bg-white/10"
              >
                Contact Sales
              </Link>
            </div>
          </div>
          {heroImg && (
            <div className="flex-shrink-0 md:w-80 lg:w-96">
              <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/10">
                <img
                  src={heroImg}
                  alt={content.h1}
                  loading="eager"
                  className="w-full h-64 md:h-80 object-cover"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const ServicePage: React.FC<ServicePageProps> = ({ slug }) => {
  const { currentLanguage, supportedLanguages } = useLanguage();
  const { data: content, isLoading } = useServicePage(slug, currentLanguage);
  const { data: alternates } = useHreflangAlternates(slug, !!content);

  if (isLoading) return <PageLoader />;

  if (!content) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-brand-dark">Service not found</h1>
          <Link
            to={`/${currentLanguage}/services`}
            className="mt-4 inline-block text-brand-primary underline"
          >
            Browse all services
          </Link>
        </div>
      </div>
    );
  }

  const canonicalUrl = `${SITE_BASE_URL}/en/services/${slug}`;

  const hreflangLinks = (() => {
    const byLang = new Map<string, string | null>();
    (alternates ?? []).forEach((a) => byLang.set(a.language, a.localized_slug));

    const links = Object.keys(supportedLanguages).map((lang) => {
      const localized = byLang.get(lang);
      const segment = lang === 'en' ? slug : (localized ?? slug);
      return { lang, url: `${SITE_BASE_URL}/${lang}/services/${segment}` };
    });
    links.push({ lang: 'x-default', url: canonicalUrl });
    return links;
  })();

  const serviceSchema = generateServiceSchema(content, canonicalUrl);
  const faqSchema = generateFAQPageSchema(content.faq);

  return (
    <div className="min-h-screen pt-16">
      <SEOMeta
        title={content.title}
        description={content.meta_description}
        canonicalUrl={canonicalUrl}
        hreflangLinks={hreflangLinks}
      />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(serviceSchema)}</script>
        {faqSchema && (
          <script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
        )}
      </Helmet>

      <Hero content={content} slug={slug} />
      <CapabilitiesBlock items={content.capabilities} />
      <MaterialsTable materials={content.materials} heading="Materials" />
      <TolerancesBlock items={content.tolerances} />
      <ProcessSteps steps={content.process_steps} heading="How It Works" />
      <LeadTimeTable leadTimes={content.lead_times} heading="Lead Times" />
      <ApplicationsBlock items={content.applications} />
      <Differentiators items={content.differentiators} heading="Why Microns Hub" />
      <FAQAccordion items={content.faq} heading="Frequently Asked Questions" />
      <CrossLinksBlock items={content.cross_links} lang={currentLanguage} />
      <CTASection />
    </div>
  );
};

export default ServicePage;
