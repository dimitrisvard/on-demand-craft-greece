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

// ─── Shared style options for per-section customization ─────────────────────

export interface SectionStyles {
  bg_color?: string;            // background color override
  bg_gradient?: string;         // e.g. "linear-gradient(135deg, #1a1a2e, #16213e)"
  bg_image?: string;            // background image URL
  bg_overlay_opacity?: number;  // 0-1, darkens bg_image
  text_color?: string;          // 'light' | 'dark' — drives white vs dark text
  padding_y?: string;           // e.g. '80px', '120px'
  max_width?: string;           // container max-width override
}

// ─── 15 Section Types ───────────────────────────────────────────────────────

export type TenantPageSection =
  | HeroSection
  | ServicesSection
  | StatsSection
  | CtaBannerSection
  | TestimonialsSection
  | FaqSection
  | FeaturesGridSection
  | TimelineSection
  | TeamSection
  | GallerySection
  | LogoCloudSection
  | PricingSection
  | VideoSection
  | ContactInfoSection
  | RichTextSection;

// 1. Hero — with layout variants
export interface HeroSection {
  type: 'hero';
  variant?: 'centered' | 'left' | 'split';  // default: 'left'
  headline: string;
  subheadline: string;
  cta_text: string;
  cta_link: string;
  secondary_cta_text?: string;
  secondary_cta_link?: string;
  background_image: string | null;
  badge_text?: string;           // small label above headline, e.g. "ISO 9001 Certified"
  styles?: SectionStyles;
}

// 2. Services grid
export interface ServicesSection {
  type: 'services';
  variant?: 'cards' | 'icons' | 'minimal';  // default: 'cards'
  title: string;
  subtitle?: string;
  columns?: 2 | 3 | 4;            // default: 3
  items: { capability: string; description: string; icon?: string }[];
  styles?: SectionStyles;
}

// 3. Stats / counters
export interface StatsSection {
  type: 'stats';
  variant?: 'simple' | 'cards' | 'bordered';  // default: 'simple'
  title?: string;
  items: { value: string; label: string; suffix?: string }[];
  styles?: SectionStyles;
}

// 4. CTA banner
export interface CtaBannerSection {
  type: 'cta_banner';
  variant?: 'solid' | 'outlined' | 'gradient'; // default: 'solid'
  headline: string;
  subheadline?: string;
  cta_text: string;
  cta_link: string;
  styles?: SectionStyles;
}

// 5. Testimonials
export interface TestimonialsSection {
  type: 'testimonials';
  variant?: 'cards' | 'quotes' | 'single';  // default: 'cards'
  title?: string;
  items: { name: string; company: string; quote: string; avatar?: string; role?: string }[];
  styles?: SectionStyles;
}

// 6. FAQ accordion
export interface FaqSection {
  type: 'faq';
  title?: string;
  subtitle?: string;
  items: { question: string; answer: string }[];
  styles?: SectionStyles;
}

// 7. Features grid — icon + title + description blocks
export interface FeaturesGridSection {
  type: 'features_grid';
  variant?: 'icons_top' | 'icons_left' | 'numbered';
  title: string;
  subtitle?: string;
  columns?: 2 | 3 | 4;
  items: { title: string; description: string; icon?: string }[];
  styles?: SectionStyles;
}

// 8. Timeline / process steps
export interface TimelineSection {
  type: 'timeline';
  variant?: 'vertical' | 'horizontal';
  title: string;
  subtitle?: string;
  items: { step: string; title: string; description: string }[];
  styles?: SectionStyles;
}

// 9. Team members
export interface TeamSection {
  type: 'team';
  title: string;
  subtitle?: string;
  items: { name: string; role: string; bio?: string; image?: string }[];
  styles?: SectionStyles;
}

// 10. Image gallery
export interface GallerySection {
  type: 'gallery';
  variant?: 'grid' | 'masonry';
  title: string;
  subtitle?: string;
  columns?: 2 | 3 | 4;
  items: { image_url: string; caption?: string; alt?: string }[];
  styles?: SectionStyles;
}

// 11. Logo cloud / partner logos
export interface LogoCloudSection {
  type: 'logo_cloud';
  title?: string;
  subtitle?: string;
  items: { name: string; logo_url: string; link?: string }[];
  styles?: SectionStyles;
}

// 12. Pricing table
export interface PricingSection {
  type: 'pricing';
  title: string;
  subtitle?: string;
  items: {
    name: string;
    price: string;
    period?: string;
    description?: string;
    features: string[];
    cta_text: string;
    cta_link: string;
    is_featured?: boolean;
  }[];
  styles?: SectionStyles;
}

// 13. Video embed
export interface VideoSection {
  type: 'video';
  title?: string;
  subtitle?: string;
  video_url: string;           // YouTube or Vimeo embed URL
  poster_image?: string;
  styles?: SectionStyles;
}

// 14. Contact info block (address, phone, email, map)
export interface ContactInfoSection {
  type: 'contact_info';
  title?: string;
  subtitle?: string;
  show_email?: boolean;
  show_phone?: boolean;
  show_address?: boolean;
  custom_fields?: { label: string; value: string }[];
  styles?: SectionStyles;
}

// 15. Rich text / markdown-like content block
export interface RichTextSection {
  type: 'rich_text';
  title?: string;
  content: string;            // plain text with line breaks
  text_align?: 'left' | 'center';
  styles?: SectionStyles;
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
