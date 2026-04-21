import React from 'react';
import SEOMeta from '@/components/SEOMeta';
import ContentHero from '@/components/content/ContentHero';
import SectionRenderer from '@/components/content/SectionRenderer';
import FaqAccordion from '@/components/content/FaqAccordion';
import ContentSkeleton from '@/components/content/ContentSkeleton';
import { useContentPage } from '@/hooks/useContentPage';

const SITE = 'https://www.micronshub.eu';

const AboutPage: React.FC = () => {
  const { data, isLoading } = useContentPage('about');

  if (isLoading) return <ContentSkeleton />;

  return (
    <div className="min-h-screen">
      <SEOMeta
        title={data?.title || 'About Microns Hub'}
        description={
          data?.meta_description ||
          'Learn about Microns Hub — our team, infrastructure, and how we deliver on-demand manufacturing from Crete.'
        }
        canonicalUrl={`${SITE}/en/about`}
      />
      <ContentHero
        h1={data?.h1 || 'About Microns Hub'}
        tagline={data?.tagline}
        lead={data?.lead_paragraph}
      />
      {(data?.sections ?? []).map((s, i) => (
        <SectionRenderer key={i} section={s} index={i} />
      ))}
      <FaqAccordion items={data?.faq ?? []} />
    </div>
  );
};

export default AboutPage;
