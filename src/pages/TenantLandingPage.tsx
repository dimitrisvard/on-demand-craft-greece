import { useEffect, useState, Suspense } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { getPublishedPage } from '@/utils/tenantApi';
import TenantPageRenderer from '@/components/tenants/TenantPageRenderer';
import { hasCustomPage, getCustomPageComponent } from '@/pages/tenants/customPageRegistry';
import type { TenantPage } from '@/types/tenant';
import { Helmet } from 'react-helmet-async';

interface Props {
  pageSlug?: string;
}

export default function TenantLandingPage({ pageSlug = 'home' }: Props) {
  const { tenant, isTenantSubdomain, loading: tenantLoading } = useTenant();
  const [page, setPage] = useState<TenantPage | null>(null);
  const [loading, setLoading] = useState(true);

  const tenantSlug = tenant?.slug ?? null;

  // Check for a custom-built page component for this tenant
  const CustomPage = tenantSlug && hasCustomPage(tenantSlug)
    ? getCustomPageComponent(tenantSlug)
    : null;

  useEffect(() => {
    // Skip DB fetch if a custom component exists
    if (CustomPage || !tenant) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        const published = await getPublishedPage(tenant.id, pageSlug);
        setPage(published);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, pageSlug, CustomPage]);

  if (tenantLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen pt-16">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  // Render custom page component (its own nav/footer are baked in)
  if (CustomPage) {
    return (
      <Suspense fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      }>
        <CustomPage />
      </Suspense>
    );
  }

  // If no published page exists for this tenant, return null (let the normal page render)
  if (!page) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>{page.title} | {tenant?.name || 'Microns Hub'}</title>
      </Helmet>
      <div className="pt-16">
        <TenantPageRenderer content={page.content} />
      </div>
    </>
  );
}
