import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type Capability     = { label: string; detail: string };
export type Application    = { name: string; description: string };
export type Material       = { material: string; grade: string; properties: string; uses: string };
export type Tolerance      = { spec: string; value: string; notes?: string };
export type ProcessStep    = { step: number; title: string; description: string };
export type LeadTime       = { tier: string; quantity_range: string; working_days: string };
export type FAQItem        = { question: string; answer: string };
export type Differentiator = { title: string; description: string };
export type CrossLink      = { slug: string; label: string; description: string };
export type InternalLink   = { url: string; anchor_text: string; context: string };
export type SchemaOffer    = { priceCurrency: string; price: number; priceValidUntil: string };

export type ServicePageContent = {
  slug: string;
  language: string;
  localized_slug: string | null;
  title: string;
  meta_description: string;
  h1: string;
  tagline: string;
  lead_paragraph: string;
  capabilities: Capability[];
  applications: Application[];
  materials: Material[];
  tolerances: Tolerance[];
  process_steps: ProcessStep[];
  lead_times: LeadTime[];
  faq: FAQItem[];
  differentiators: Differentiator[];
  cross_links: CrossLink[];
  internal_links: InternalLink[];
  schema_offer: SchemaOffer | null;
  status: string;
};

export type HreflangAlternate = {
  language: string;
  localized_slug: string | null;
};

// service_pages isn't yet in the generated Database type. Cast the table name
// so TS doesn't complain; a future types regen will make this strict again.
const servicePagesTable = () => (supabase.from as any)('service_pages');

export async function getServicePage(
  slug: string,
  lang: string,
): Promise<ServicePageContent | null> {
  const primary = await servicePagesTable()
    .select('*')
    .eq('slug', slug)
    .eq('language', lang)
    .eq('status', 'published')
    .maybeSingle();

  if (primary.data) return primary.data as ServicePageContent;

  if (lang !== 'en') {
    const fallback = await servicePagesTable()
      .select('*')
      .eq('slug', slug)
      .eq('language', 'en')
      .eq('status', 'published')
      .maybeSingle();
    if (fallback.data) return fallback.data as ServicePageContent;
  }

  return null;
}

export async function listServicePages(lang: string): Promise<ServicePageContent[]> {
  const { data } = await servicePagesTable()
    .select('*')
    .eq('language', lang)
    .eq('status', 'published')
    .neq('slug', 'index')
    .order('slug');

  const rows = (data ?? []) as ServicePageContent[];

  // Backfill missing non-EN rows with EN content so every service renders.
  if (lang === 'en') return rows;

  const haveSlugs = new Set(rows.map((r) => r.slug));
  const { data: enData } = await servicePagesTable()
    .select('*')
    .eq('language', 'en')
    .eq('status', 'published')
    .neq('slug', 'index')
    .order('slug');

  const enRows = (enData ?? []) as ServicePageContent[];
  const fallbacks = enRows.filter((r) => !haveSlugs.has(r.slug));
  return [...rows, ...fallbacks].sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function getHreflangAlternates(slug: string): Promise<HreflangAlternate[]> {
  const { data } = await servicePagesTable()
    .select('language, localized_slug')
    .eq('slug', slug)
    .eq('status', 'published');

  return (data ?? []) as HreflangAlternate[];
}

export function useServicePage(slug: string, lang: string) {
  return useQuery({
    queryKey: ['service-page', slug, lang],
    queryFn: () => getServicePage(slug, lang),
    staleTime: 5 * 60 * 1000,
  });
}

export function useServicePageList(lang: string) {
  return useQuery({
    queryKey: ['service-page-list', lang],
    queryFn: () => listServicePages(lang),
    staleTime: 5 * 60 * 1000,
  });
}

export function useHreflangAlternates(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['service-page-hreflang', slug],
    queryFn: () => getHreflangAlternates(slug),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}
