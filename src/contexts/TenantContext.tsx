import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import type { TenantConfig } from '@/types/tenant';
import { DEFAULT_TENANT_SLUG } from '@/types/tenant';
import {
  resolveTenantIdentifier,
  fetchTenantConfig,
  fetchTenantByDomain,
} from '@/utils/tenantApi';
import type { TenantIdentifier } from '@/utils/tenantApi';

interface TenantContextType {
  tenant: TenantConfig | null;
  loading: boolean;
  error: string | null;
  isTenantSubdomain: boolean;
  isCustomDomain: boolean;
  tenantSlug: string | null;
}

const TenantContext = createContext<TenantContextType>({
  tenant: null,
  loading: true,
  error: null,
  isTenantSubdomain: false,
  isCustomDomain: false,
  tenantSlug: null,
});

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<TenantConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const identifier = useMemo(() => resolveTenantIdentifier(), []);
  const isTenantSubdomain = identifier.type === 'subdomain';
  const isCustomDomain = identifier.type === 'custom_domain';

  useEffect(() => {
    async function loadTenant() {
      try {
        let config: TenantConfig | null = null;

        switch (identifier.type) {
          case 'subdomain':
            config = await fetchTenantConfig(identifier.slug);
            if (!config) {
              setError(`Tenant "${identifier.slug}" not found`);
            }
            break;

          case 'custom_domain':
            config = await fetchTenantByDomain(identifier.hostname);
            if (!config) {
              // Unknown custom domain — fall back to default
              config = await fetchTenantConfig(DEFAULT_TENANT_SLUG);
            }
            break;

          case 'default':
            config = await fetchTenantConfig(DEFAULT_TENANT_SLUG);
            break;
        }

        if (config) {
          setTenant(config);
          applyTenantTheme(config);
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
  }, [identifier]);

  return (
    <TenantContext.Provider value={{
      tenant,
      loading,
      error,
      isTenantSubdomain,
      isCustomDomain,
      tenantSlug: identifier.type === 'subdomain' ? identifier.slug : tenant?.slug || null,
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
