import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';

export interface ContentPageSection {
  type: 'prose' | 'list' | 'table' | 'grid' | 'cards' | 'cta';
  h2?: string;
  intro?: string;
  paragraphs?: string[];
  items?: { term?: string; description: string }[];
  columns?: string[];
  rows?: string[][];
  cards?: {
    title: string;
    description: string;
    meta?: string;
    image_url?: string;
    image_alt?: string;
    href?: string;
  }[];
  body?: string;
  button_label?: string;
  button_href?: string;
  image_url?: string;
  image_alt?: string;
}

export interface ContentFAQItem {
  q: string;
  a: string;
}

export interface ContentLink {
  label: string;
  href: string;
}

export interface ContentPageRow {
  slug: string;
  language: string;
  title: string;
  meta_description: string;
  h1: string;
  tagline?: string | null;
  lead_paragraph: string;
  sections: ContentPageSection[];
  faq: ContentFAQItem[];
  cross_links: ContentLink[];
  internal_links: ContentLink[];
  schema_type?: string | null;
  structured_data?: Record<string, unknown> | null;
}

function normalizeFaq(raw: unknown): ContentFAQItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f: { q?: string; a?: string; question?: string; answer?: string }) => ({
      q: f.q ?? f.question ?? '',
      a: f.a ?? f.answer ?? '',
    }))
    .filter((f) => f.q && f.a);
}

function normalize(data: Record<string, unknown> | null): ContentPageRow | null {
  if (!data) return null;
  return {
    ...(data as ContentPageRow),
    sections: Array.isArray(data.sections)
      ? (data.sections as ContentPageSection[])
      : [],
    faq: normalizeFaq(data.faq),
    cross_links: Array.isArray(data.cross_links)
      ? (data.cross_links as ContentLink[])
      : [],
    internal_links: Array.isArray(data.internal_links)
      ? (data.internal_links as ContentLink[])
      : [],
  };
}

export function useContentPage(slug: string) {
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'en').split('-')[0];
  return useQuery({
    queryKey: ['content_pages', slug, lang],
    queryFn: async (): Promise<ContentPageRow | null> => {
      const primary = await (supabase.from as any)('content_pages')
        .select('*')
        .eq('slug', slug)
        .eq('language', lang)
        .eq('status', 'published')
        .maybeSingle();
      if (primary.data) return normalize(primary.data);

      if (lang !== 'en') {
        const fallback = await (supabase.from as any)('content_pages')
          .select('*')
          .eq('slug', slug)
          .eq('language', 'en')
          .eq('status', 'published')
          .maybeSingle();
        if (fallback.data) return normalize(fallback.data);
      }

      return null;
    },
    staleTime: 5 * 60 * 1000,
  });
}
