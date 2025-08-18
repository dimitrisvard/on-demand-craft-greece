
import React from 'react';

interface IndustryHeroProps {
  title: string;
  description: string;
  backgroundImage: string;
}

const IndustryHero: React.FC<IndustryHeroProps> = ({ 
  title, 
  description,
  backgroundImage 
}) => {
  return (
    <section className="relative py-32 bg-gray-900">
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-40" 
        style={{ 
          backgroundImage: `url('${backgroundImage}')`,
          backgroundPosition: 'center',
        }} 
      />
      
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent" />
      
      <div className="container-custom relative z-10 text-white">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            {title}
          </h1>
          <p className="text-lg md:text-xl mb-8 text-white/90 max-w-2xl">
            {description}
          </p>
        </div>
      </div>
    </section>
  );
};

export default IndustryHero;
