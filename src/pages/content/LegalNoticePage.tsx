import React from 'react';
import SEOMeta from '@/components/SEOMeta';
import ContentHero from '@/components/content/ContentHero';
import SectionRenderer from '@/components/content/SectionRenderer';
import ContentSkeleton from '@/components/content/ContentSkeleton';
import { useContentPage } from '@/hooks/useContentPage';

const SITE = 'https://www.micronshub.eu';

const LegalNoticePage: React.FC = () => {
  const { data, isLoading } = useContentPage('legal-notice');

  if (isLoading) return <ContentSkeleton />;

  return (
    <div className="min-h-screen">
      <SEOMeta
        title={data?.title || 'Legal Notice | Microns Hub'}
        description={
          data?.meta_description ||
          'Legal notice for MICRONS HUB DV Ε.Ε. — VAT ID EL803129638, GEMI 190254227000, registered in Heraklion, Crete, Greece.'
        }
        canonicalUrl={`${SITE}/en/legal-notice`}
      />
      <ContentHero
        h1={data?.h1 || 'Legal Notice'}
        tagline={data?.tagline}
        lead={data?.lead_paragraph}
      />
      {(data?.sections ?? []).map((s, i) => (
        <SectionRenderer key={i} section={s} index={i} />
      ))}
    </div>
  );
};

export default LegalNoticePage;
