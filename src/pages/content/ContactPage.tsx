import React from 'react';
import { Mail, MapPin, Phone, Clock, Zap } from 'lucide-react';
import SEOMeta from '@/components/SEOMeta';
import ContentHero from '@/components/content/ContentHero';
import FaqAccordion from '@/components/content/FaqAccordion';
import ContentSkeleton from '@/components/content/ContentSkeleton';
import ContactForm from '@/components/contact/ContactForm';
import { useContentPage } from '@/hooks/useContentPage';

const SITE = 'https://www.micronshub.eu';

const InfoRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ icon, title, children }) => (
  <div className="flex items-start gap-4">
    <div className="flex-shrink-0 bg-brand-light p-3 rounded-lg text-brand-teal">
      {icon}
    </div>
    <div>
      <h3 className="font-bold text-brand-dark mb-1">{title}</h3>
      <div className="text-brand-dark/80 leading-relaxed">{children}</div>
    </div>
  </div>
);

const ContactPage: React.FC = () => {
  const { data, isLoading } = useContentPage('contact');

  if (isLoading) return <ContentSkeleton />;

  const h1 = data?.h1 || 'Contact Microns Hub';
  const tagline = data?.tagline || 'We reply within one working day.';
  const lead =
    data?.lead_paragraph ||
    'Questions about tolerances, materials, lead times, or pricing? Drop us a line.';

  return (
    <div className="min-h-screen">
      <SEOMeta
        title={data?.title || 'Contact | Microns Hub'}
        description={
          data?.meta_description ||
          'Contact the Microns Hub engineering team for CNC machining, sheet metal, 3D printing, and injection molding inquiries.'
        }
        canonicalUrl={`${SITE}/en/contact`}
      />

      <ContentHero h1={h1} tagline={tagline} lead={lead} />

      <section className="section bg-white">
        <div className="container-custom">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
            <div className="lg:col-span-3">
              <ContactForm />
            </div>

            <aside className="lg:col-span-2">
              <div className="bg-brand-light rounded-lg p-8 md:p-10">
                <h2 className="text-2xl font-bold text-brand-dark mb-6">
                  Other ways to reach us
                </h2>
                <div className="space-y-6">
                  <InfoRow icon={<Mail size={22} />} title="Email">
                    <a
                      href="mailto:info@micronshub.eu"
                      className="hover:text-brand-primary underline-offset-2 hover:underline"
                    >
                      info@micronshub.eu
                    </a>
                  </InfoRow>
                  <InfoRow icon={<Phone size={22} />} title="Phone">
                    <a
                      href="tel:+302104447830"
                      className="hover:text-brand-primary underline-offset-2 hover:underline"
                    >
                      +30 210 444 7830
                    </a>
                  </InfoRow>
                  <InfoRow icon={<MapPin size={22} />} title="Address">
                    Industrial Area, Street B, Number 4,
                    <br />
                    71601 Heraklion, Crete, Greece
                  </InfoRow>
                  <InfoRow icon={<Clock size={22} />} title="Business hours">
                    Monday–Friday, 09:00–18:00 EET/EEST
                  </InfoRow>
                  <InfoRow icon={<Zap size={22} />} title="Response time">
                    Within one working day
                  </InfoRow>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <FaqAccordion items={data?.faq ?? []} />
    </div>
  );
};

export default ContactPage;
