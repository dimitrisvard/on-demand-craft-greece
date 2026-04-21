import React from 'react';
import SEOMeta from '@/components/SEOMeta';
import ContentHero from '@/components/content/ContentHero';
import SectionRenderer from '@/components/content/SectionRenderer';
import ContentSkeleton from '@/components/content/ContentSkeleton';
import { useContentPage } from '@/hooks/useContentPage';

const SITE = 'https://www.micronshub.eu';

const PrivacyPolicyPage: React.FC = () => {
  const { data, isLoading } = useContentPage('privacy-policy');

  if (isLoading) return <ContentSkeleton />;

  return (
    <div className="min-h-screen">
      <SEOMeta
        title={data?.title || 'Privacy Policy | Microns Hub'}
        description={
          data?.meta_description ||
          'How Microns Hub processes personal data under Regulation (EU) 2016/679 (GDPR).'
        }
        canonicalUrl={`${SITE}/en/privacy-policy`}
      />
      <ContentHero
        h1={data?.h1 || 'Privacy Policy'}
        tagline={data?.tagline}
        lead={data?.lead_paragraph}
      />
      {(data?.sections ?? []).map((s, i) => (
        <SectionRenderer key={i} section={s} index={i} />
      ))}
    </div>
  );
};

export default PrivacyPolicyPage;
