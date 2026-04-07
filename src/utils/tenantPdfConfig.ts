import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_TENANT_ID } from '@/types/tenant';

export interface TenantPdfConfig {
  tenantName: string;
  logoUrl: string | null;
  primaryColor: string;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  website: string | null;
}

const DEFAULT_CONFIG: TenantPdfConfig = {
  tenantName: 'Microns Hub',
  logoUrl: '/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png',
  primaryColor: '#2563EB',
  contactEmail: 'info@micronshub.eu',
  contactPhone: '+302104447830',
  address: 'Kosti Fragkouli 3, Heraklion Greece 71414',
  website: 'https://micronshub.eu',
};

let pdfConfigCache: Map<string, { config: TenantPdfConfig; expiry: number }> = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 min

/**
 * Fetch tenant PDF configuration for branded document generation.
 * Falls back to Microns Hub defaults if tenant not found.
 */
export async function getTenantPdfConfig(tenantId?: string | null): Promise<TenantPdfConfig> {
  const id = tenantId || DEFAULT_TENANT_ID;

  // Check cache
  const cached = pdfConfigCache.get(id);
  if (cached && cached.expiry > Date.now()) {
    return cached.config;
  }

  try {
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('name, logo_url, primary_color, contact_email, contact_phone, address, website')
      .eq('id', id)
      .single();

    if (error || !tenant) {
      return DEFAULT_CONFIG;
    }

    const config: TenantPdfConfig = {
      tenantName: tenant.name || DEFAULT_CONFIG.tenantName,
      logoUrl: tenant.logo_url || DEFAULT_CONFIG.logoUrl,
      primaryColor: tenant.primary_color || DEFAULT_CONFIG.primaryColor,
      contactEmail: tenant.contact_email || DEFAULT_CONFIG.contactEmail,
      contactPhone: tenant.contact_phone || DEFAULT_CONFIG.contactPhone,
      address: tenant.address || DEFAULT_CONFIG.address,
      website: tenant.website || DEFAULT_CONFIG.website,
    };

    pdfConfigCache.set(id, { config, expiry: Date.now() + CACHE_TTL });
    return config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Fetch the tenant logo as a base64 data URL for embedding in PDFs.
 * Returns null if the logo is not available.
 */
export async function getTenantLogoBase64(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null;

  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return null;

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
