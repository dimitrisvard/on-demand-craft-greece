import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import type { TenantConfig } from '@/types/tenant';
import { DEFAULT_TENANT_SLUG } from '@/types/tenant';
import { resolveSubdomain, fetchTenantConfig } from '@/utils/tenantApi';

interface TenantContextType {
  tenant: TenantConfig | null;
  loading: boolean;
  error: string | null;
  isTenantSubdomain: boolean;
  tenantSlug: string | null;
}

const TenantContext = createContext<TenantContextType>({
  tenant: null,
  loading: true,
  error: null,
  isTenantSubdomain: false,
  tenantSlug: null,
});

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<TenantConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const subdomain = useMemo(() => resolveSubdomain(), []);
  const isTenantSubdomain = subdomain !== null;

  useEffect(() => {
    async function loadTenant() {
      try {
        // If on a tenant subdomain, load that tenant; otherwise load Microns Hub default
        const slug = subdomain || DEFAULT_TENANT_SLUG;
        const config = await fetchTenantConfig(slug);

        if (!config && subdomain) {
          // Invalid tenant subdomain
          setError(`Tenant "${subdomain}" not found`);
        } else if (config) {
          setTenant(config);
          // Apply tenant CSS custom properties
          applyTenantTheme(config);
          // Update favicon
          applyTenantFavicon(config);
        }
      } catch (err) {
        console.error('Failed to load tenant config:', err);
        setError('Failed to load tenant configuration');
      } finally {
        setLoading(false);
      }
    }

    loadTenant();
  }, [subdomain]);

  return (
    <TenantContext.Provider value={{
      tenant,
      loading,
      error,
      isTenantSubdomain,
      tenantSlug: subdomain,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}

// ─── Theme Application ──────────────────────────────────────────────────────

function applyTenantTheme(config: TenantConfig) {
  const root = document.documentElement;
  root.style.setProperty('--tenant-primary', config.primaryColor);
  root.style.setProperty('--tenant-secondary', config.secondaryColor);
}

function applyTenantFavicon(config: TenantConfig) {
  if (!config.faviconUrl) return;

  let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = config.faviconUrl;
}
