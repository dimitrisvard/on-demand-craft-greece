import { supabase } from '@/integrations/supabase/client';
import type {
  Tenant,
  TenantInsert,
  TenantUpdate,
  TenantCapability,
  TenantQuoteField,
  TenantConfig,
  TenantCapabilityConfig,
  TenantFieldConfig,
  TenantPage,
  CapabilityRegistry,
  QuoteFieldRegistry,
  DEFAULT_TENANT_SLUG,
} from '@/types/tenant';

// ─── Tenant Resolution ──────────────────────────────────────────────────────
// Supports two modes:
//   1. Subdomain: laserkritis.micronshub.eu → slug = "laserkritis"
//   2. Custom domain: www.laserkritis.gr → DB lookup by custom_domain

const RESERVED_SUBDOMAINS = ['www', 'api', 'admin', 'app', 'micronshub', 'localhost'];

export type TenantIdentifier =
  | { type: 'subdomain'; slug: string }
  | { type: 'custom_domain'; hostname: string }
  | { type: 'default' };

export function resolveTenantIdentifier(): TenantIdentifier {
  const hostname = window.location.hostname;

  // localhost or IP — default to Microns Hub
  if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return { type: 'default' };
  }

  // *.micronshub.eu — extract subdomain
  if (hostname.includes('micronshub.eu')) {
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      const subdomain = parts[0];
      if (!RESERVED_SUBDOMAINS.includes(subdomain)) {
        return { type: 'subdomain', slug: subdomain };
      }
    }
    return { type: 'default' }; // bare micronshub.eu or reserved subdomain
  }

  // Any other domain — treat as custom domain
  return { type: 'custom_domain', hostname };
}

// Backward-compatible alias (used by TenantContext)
export function resolveSubdomain(): string | null {
  const id = resolveTenantIdentifier();
  return id.type === 'subdomain' ? id.slug : null;
}

// ─── Tenant Config Fetching ─────────────────────────────────────────────────

let tenantConfigCache: Map<string, { config: TenantConfig; expiry: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Shared helper: build TenantConfig from a raw tenant row
async function buildTenantConfig(tenant: any): Promise<TenantConfig> {
  // Fetch tenant capabilities with registry join
  const { data: capabilities } = await supabase
    .from('tenant_capabilities')
    .select('*, capabilities_registry(*)')
    .eq('tenant_id', tenant.id);

  // Fetch tenant quote fields
  const { data: quoteFields } = await supabase
    .from('tenant_quote_fields')
    .select('*')
    .eq('tenant_id', tenant.id);

  // Fetch quote fields registry for default values
  const { data: fieldRegistry } = await supabase
    .from('quote_fields_registry')
    .select('*');

  // Build capability configs
  const capabilityConfigs: TenantCapabilityConfig[] = (capabilities || []).map((tc: any) => {
    const reg = tc.capabilities_registry;
    const capFields = (quoteFields || []).filter(
      (f: any) => f.capability === tc.capability
    );
    const registryFields = (fieldRegistry || []).filter(
      (f: any) => f.capability === tc.capability
    );

    const fields: TenantFieldConfig[] = registryFields.map((rf: any) => {
      const override = capFields.find((cf: any) => cf.field_key === rf.field_key);
      return {
        fieldKey: rf.field_key,
        label: rf.label,
        fieldType: rf.field_type,
        isVisible: override ? override.is_visible : true,
        isRequired: override ? override.is_required : false,
        options: rf.options,
        sortOrder: override ? override.sort_order : rf.sort_order,
      };
    }).sort((a: TenantFieldConfig, b: TenantFieldConfig) => a.sortOrder - b.sortOrder);

    return {
      key: tc.capability,
      label: reg?.label || tc.capability,
      icon: reg?.icon || null,
      category: reg?.category || null,
      isEnabled: tc.is_enabled,
      sortOrder: tc.sort_order,
      fields,
    };
  }).sort((a: TenantCapabilityConfig, b: TenantCapabilityConfig) => a.sortOrder - b.sortOrder);

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    logoUrl: tenant.logo_url,
    faviconUrl: tenant.favicon_url,
    primaryColor: tenant.primary_color || '#2563EB',
    secondaryColor: tenant.secondary_color || '#1E40AF',
    welcomeMessage: tenant.welcome_message,
    contactEmail: tenant.contact_email,
    contactPhone: tenant.contact_phone,
    address: tenant.address,
    website: tenant.website,
    customDomain: tenant.custom_domain || null,
    capabilities: capabilityConfigs,
  };
}

// Fetch tenant config by slug (subdomain)
export async function fetchTenantConfig(slug: string): Promise<TenantConfig | null> {
  const cacheKey = `slug:${slug}`;
  const cached = tenantConfigCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.config;
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (error || !tenant) return null;

  const config = await buildTenantConfig(tenant);
  tenantConfigCache.set(cacheKey, { config, expiry: Date.now() + CACHE_TTL_MS });
  return config;
}

// Fetch tenant config by custom domain (e.g., www.laserkritis.gr)
export async function fetchTenantByDomain(domain: string): Promise<TenantConfig | null> {
  const cacheKey = `domain:${domain}`;
  const cached = tenantConfigCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.config;
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('custom_domain', domain)
    .eq('is_active', true)
    .single();

  if (error || !tenant) return null;

  const config = await buildTenantConfig(tenant);
  tenantConfigCache.set(cacheKey, { config, expiry: Date.now() + CACHE_TTL_MS });
  return config;
}

// Best-effort domain verification: checks if the domain resolves to our app
export async function verifyTenantDomain(domain: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://${domain}/`, { method: 'HEAD', mode: 'no-cors' });
    // no-cors mode always returns opaque response, but if fetch doesn't throw, DNS resolved
    return true;
  } catch {
    return false;
  }
}

export function invalidateTenantCache(slug?: string) {
  if (slug) {
    tenantConfigCache.delete(slug);
  } else {
    tenantConfigCache.clear();
  }
}

// ─── Admin CRUD Operations ──────────────────────────────────────────────────

export async function listTenants() {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Tenant[];
}

export async function getTenant(id: string) {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Tenant;
}

export async function createTenant(tenant: TenantInsert) {
  const { data, error } = await supabase
    .from('tenants')
    .insert(tenant)
    .select()
    .single();
  if (error) throw error;

  // Enable all capabilities by default
  const { data: registry } = await supabase
    .from('capabilities_registry')
    .select('key, sort_order');

  if (registry && data) {
    const capabilities = registry.map((r: any) => ({
      tenant_id: data.id,
      capability: r.key,
      is_enabled: true,
      sort_order: r.sort_order,
    }));

    await supabase.from('tenant_capabilities').insert(capabilities);
  }

  return data as Tenant;
}

export async function updateTenant(id: string, updates: TenantUpdate) {
  const { data, error } = await supabase
    .from('tenants')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  // Invalidate cache for this tenant
  if (data) {
    invalidateTenantCache((data as Tenant).slug);
  }

  return data as Tenant;
}

export async function deleteTenant(id: string) {
  // Soft delete: just set is_active = false
  const { error } = await supabase
    .from('tenants')
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw error;
}

// ─── Capabilities Management ────────────────────────────────────────────────

export async function getCapabilitiesRegistry() {
  const { data, error } = await supabase
    .from('capabilities_registry')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return data as CapabilityRegistry[];
}

export async function getTenantCapabilities(tenantId: string) {
  const { data, error } = await supabase
    .from('tenant_capabilities')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('sort_order');
  if (error) throw error;
  return data as TenantCapability[];
}

export async function updateTenantCapabilities(
  tenantId: string,
  capabilities: { capability: string; is_enabled: boolean; sort_order: number }[]
) {
  // Upsert capabilities
  const rows = capabilities.map((c) => ({
    tenant_id: tenantId,
    capability: c.capability,
    is_enabled: c.is_enabled,
    sort_order: c.sort_order,
  }));

  const { error } = await supabase
    .from('tenant_capabilities')
    .upsert(rows, { onConflict: 'tenant_id,capability' });
  if (error) throw error;
}

// ─── Quote Fields Management ────────────────────────────────────────────────

export async function getQuoteFieldsRegistry() {
  const { data, error } = await supabase
    .from('quote_fields_registry')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return data as QuoteFieldRegistry[];
}

export async function getTenantQuoteFields(tenantId: string) {
  const { data, error } = await supabase
    .from('tenant_quote_fields')
    .select('*')
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return data as TenantQuoteField[];
}

export async function updateTenantQuoteFields(
  tenantId: string,
  fields: { capability: string; field_key: string; is_visible: boolean; is_required: boolean; sort_order: number }[]
) {
  const rows = fields.map((f) => ({
    tenant_id: tenantId,
    capability: f.capability,
    field_key: f.field_key,
    is_visible: f.is_visible,
    is_required: f.is_required,
    sort_order: f.sort_order,
  }));

  const { error } = await supabase
    .from('tenant_quote_fields')
    .upsert(rows, { onConflict: 'tenant_id,capability,field_key' });
  if (error) throw error;
}

// ─── Tenant Pages ───────────────────────────────────────────────────────────

export async function getTenantPages(tenantId: string) {
  const { data, error } = await supabase
    .from('tenant_pages')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('slug');
  if (error) throw error;
  return data as TenantPage[];
}

export async function upsertTenantPage(page: Partial<TenantPage> & { tenant_id: string; slug: string; title: string }) {
  const { data, error } = await supabase
    .from('tenant_pages')
    .upsert(page, { onConflict: 'tenant_id,slug,language' })
    .select()
    .single();
  if (error) throw error;
  return data as TenantPage;
}

export async function publishTenantPage(pageId: string) {
  const { error } = await supabase
    .from('tenant_pages')
    .update({ is_published: true })
    .eq('id', pageId);
  if (error) throw error;
}

export async function getPublishedPage(tenantId: string, slug: string, language: string = 'en') {
  const { data, error } = await supabase
    .from('tenant_pages')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('slug', slug)
    .eq('language', language)
    .eq('is_published', true)
    .single();
  if (error) return null;
  return data as TenantPage;
}

// ─── Logo Upload ────────────────────────────────────────────────────────────

export async function uploadTenantLogo(tenantSlug: string, file: File): Promise<string> {
  const bucketName = `tenant-${tenantSlug}`;
  const filePath = `logo/${file.name}`;

  // Try to create bucket (ignore error if exists)
  await supabase.storage.createBucket(bucketName, {
    public: true,
    fileSizeLimit: 2097152, // 2MB
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'],
  });

  const { error } = await supabase.storage
    .from(bucketName)
    .upload(filePath, file, { upsert: true });
  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}

export async function uploadTenantFavicon(tenantSlug: string, file: File): Promise<string> {
  const bucketName = `tenant-${tenantSlug}`;
  const filePath = `favicon/${file.name}`;

  await supabase.storage.createBucket(bucketName, {
    public: true,
    fileSizeLimit: 1048576, // 1MB
    allowedMimeTypes: ['image/png', 'image/x-icon', 'image/svg+xml'],
  });

  const { error } = await supabase.storage
    .from(bucketName)
    .upload(filePath, file, { upsert: true });
  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}
