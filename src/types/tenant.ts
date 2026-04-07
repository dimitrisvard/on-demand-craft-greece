// Multi-tenant system types

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  welcome_message: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  website: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantInsert {
  slug: string;
  name: string;
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string;
  secondary_color?: string;
  welcome_message?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  website?: string | null;
  is_active?: boolean;
}

export interface TenantUpdate {
  name?: string;
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string;
  secondary_color?: string;
  welcome_message?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  website?: string | null;
  is_active?: boolean;
}

export interface CapabilityRegistry {
  key: string;
  label: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface TenantCapability {
  id: string;
  tenant_id: string;
  capability: string;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
}

export interface QuoteFieldRegistry {
  id: string;
  capability: string;
  field_key: string;
  label: string;
  field_type: string;
  options: any | null;
  default_value: string | null;
  sort_order: number;
}

export interface TenantQuoteField {
  id: string;
  tenant_id: string;
  capability: string;
  field_key: string;
  is_visible: boolean;
  is_required: boolean;
  sort_order: number;
}

export type TenantRole = 'super_admin' | 'tenant_admin' | 'tenant_operator' | 'customer';

export interface UserTenantRole {
  id: string;
  user_id: string;
  tenant_id: string | null;
  role: TenantRole;
  created_at: string;
}

export interface TenantPage {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  content: TenantPageContent;
  html: string | null;
  language: string;
  is_published: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TenantPageContent {
  sections: TenantPageSection[];
}

export type TenantPageSection =
  | HeroSection
  | ServicesSection
  | StatsSection
  | CtaBannerSection
  | TestimonialsSection
  | FaqSection;

export interface HeroSection {
  type: 'hero';
  headline: string;
  subheadline: string;
  cta_text: string;
  cta_link: string;
  background_image: string | null;
}

export interface ServicesSection {
  type: 'services';
  title: string;
  items: { capability: string; description: string }[];
}

export interface StatsSection {
  type: 'stats';
  items: { value: string; label: string }[];
}

export interface CtaBannerSection {
  type: 'cta_banner';
  headline: string;
  cta_text: string;
  cta_link: string;
}

export interface TestimonialsSection {
  type: 'testimonials';
  items: { name: string; company: string; quote: string }[];
}

export interface FaqSection {
  type: 'faq';
  items: { question: string; answer: string }[];
}

// Combined tenant config for frontend use
export interface TenantConfig {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  welcomeMessage: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  website: string | null;
  capabilities: TenantCapabilityConfig[];
}

export interface TenantCapabilityConfig {
  key: string;
  label: string;
  icon: string | null;
  category: string | null;
  isEnabled: boolean;
  sortOrder: number;
  fields: TenantFieldConfig[];
}

export interface TenantFieldConfig {
  fieldKey: string;
  label: string;
  fieldType: string;
  isVisible: boolean;
  isRequired: boolean;
  options: any | null;
  sortOrder: number;
}

// Default tenant ID for Microns Hub
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const DEFAULT_TENANT_SLUG = 'micronshub';
