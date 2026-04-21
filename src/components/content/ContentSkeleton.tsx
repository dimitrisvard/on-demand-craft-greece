import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

const ContentSkeleton: React.FC = () => (
  <div className="min-h-screen pt-16">
    <section className="relative py-24 md:py-28 bg-gradient-to-br from-brand-dark via-brand-primary/90 to-brand-primary">
      <div className="container-custom text-white mt-16">
        <div className="max-w-3xl space-y-4">
          <Skeleton className="h-12 w-3/4 bg-white/20" />
          <Skeleton className="h-6 w-1/2 bg-white/10" />
          <Skeleton className="h-4 w-full bg-white/10" />
          <Skeleton className="h-4 w-5/6 bg-white/10" />
        </div>
      </div>
    </section>
    <section className="section bg-white">
      <div className="container-custom max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </section>
    <section className="section bg-brand-light">
      <div className="container-custom">
        <Skeleton className="h-8 w-1/3 mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-4">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </div>
      </div>
    </section>
  </div>
);

export default ContentSkeleton;
