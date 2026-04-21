import React from 'react';

interface ContentHeroProps {
  h1: string;
  tagline?: string | null;
  lead?: string | null;
  backgroundImage?: string;
  height?: 'default' | 'full';
  children?: React.ReactNode;
}

const ContentHero: React.FC<ContentHeroProps> = ({
  h1,
  tagline,
  lead,
  backgroundImage,
  height = 'default',
  children,
}) => {
  const sectionClasses =
    height === 'full'
      ? 'relative h-screen flex items-center'
      : 'relative py-24 md:py-28 flex items-center';

  return (
    <section className={sectionClasses}>
      {backgroundImage ? (
        <div
          className="absolute inset-0 bg-cover bg-center z-0"
          style={{ backgroundImage: `url(${backgroundImage})` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-black/40" />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-brand-dark via-brand-primary/90 to-brand-primary z-0" />
      )}

      <div className="container-custom relative z-10 text-white mt-16">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 tracking-tight leading-tight">
            {h1}
          </h1>
          {tagline && (
            <p className="text-xl md:text-2xl text-white/90 mb-6 font-light">
              {tagline}
            </p>
          )}
          {lead && (
            <p className="text-base md:text-lg text-gray-200 max-w-2xl font-light leading-relaxed">
              {lead}
            </p>
          )}
          {children && <div className="mt-8">{children}</div>}
        </div>
      </div>
    </section>
  );
};

export default ContentHero;
