import { useEffect, useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { getPublishedPage } from '@/utils/tenantApi';
import TenantPageRenderer from '@/components/tenants/TenantPageRenderer';
import type { TenantPage } from '@/types/tenant';
import { Helmet } from 'react-helmet-async';

interface Props {
  pageSlug?: string;
}

export default function TenantLandingPage({ pageSlug = 'home' }: Props) {
  const { tenant, isTenantSubdomain, loading: tenantLoading } = useTenant();
  const [page, setPage] = useState<TenantPage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;

    (async () => {
      try {
        setLoading(true);
        const published = await getPublishedPage(tenant.id, pageSlug);
        setPage(published);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenant, pageSlug]);

  if (tenantLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen pt-16">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
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
