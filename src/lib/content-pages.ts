import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { FAQItem } from '@/lib/service-pages';

// Section discriminated union — mirrors middleware/renderers/contentPage.ts so
// the same row drives both SSR and the React render.
export type ProseSection = {
  type: 'prose';
  h2: string;
  paragraphs: string[];
};

export type ListSectionItem = { term?: string; description: string };
export type ListSection = {
  type: 'list';
  h2: string;
  intro?: string;
  items: ListSectionItem[];
};

export type TableSection = {
  type: 'table';
  h2: string;
  intro?: string;
  columns: string[];
  rows: string[][];
};

export type GridSectionCard = {
  title: string;
  description: string;
  meta?: string;
};
export type GridSection = {
  type: 'grid' | 'cards';
  h2: string;
  intro?: string;
  cards: GridSectionCard[];
};

export type CtaSection = {
  type: 'cta';
  h2: string;
  body: string;
  button_label: string;
  button_href: string;
};

export type ContentSection =
  | ProseSection
  | ListSection
  | TableSection
  | GridSection
  | CtaSection;

export type ContentCrossLink = { label: string; href: string };
export type ContentInternalLink = { label: string; href: string };

export type ContentPageContent = {
  slug: string;
  language: string;
  localized_slug: string | null;
  title: string;
  meta_description: string;
  h1: string;
  tagline: string | null;
  lead_paragraph: string;
  sections: ContentSection[];
  faq: FAQItem[];
  cross_links: ContentCrossLink[];
  internal_links: ContentInternalLink[];
  schema_type: string | null;
  structured_data: Record<string, unknown> | null;
  status: string;
};

// content_pages is not in the generated Database types yet.
const contentPagesTable = () => (supabase.from as any)('content_pages');

function normalizeFaq(raw: unknown): FAQItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f: { q?: string; a?: string; question?: string; answer?: string }) => ({
      question: f.question ?? f.q ?? '',
      answer: f.answer ?? f.a ?? '',
    }))
    .filter((f) => f.question && f.answer);
}

function normalizeRow(data: Record<string, unknown> | null): ContentPageContent | null {
  if (!data) return null;
  return {
    ...(data as ContentPageContent),
    sections: Array.isArray(data.sections) ? (data.sections as ContentSection[]) : [],
    faq: normalizeFaq(data.faq),
    cross_links: Array.isArray(data.cross_links) ? (data.cross_links as ContentCrossLink[]) : [],
    internal_links: Array.isArray(data.internal_links)
      ? (data.internal_links as ContentInternalLink[])
      : [],
  };
}

export async function getContentPage(
  slug: string,
  lang: string,
): Promise<ContentPageContent | null> {
  const primary = await contentPagesTable()
    .select('*')
    .eq('slug', slug)
    .eq('language', lang)
    .eq('status', 'published')
    .maybeSingle();

  if (primary.data) return normalizeRow(primary.data);

  if (lang !== 'en') {
    const fallback = await contentPagesTable()
      .select('*')
      .eq('slug', slug)
      .eq('language', 'en')
      .eq('status', 'published')
      .maybeSingle();
    if (fallback.data) return normalizeRow(fallback.data);
  }

  return null;
}

export function useContentPage(slug: string, lang: string) {
  return useQuery({
    queryKey: ['content-page', slug, lang],
    queryFn: () => getContentPage(slug, lang),
    staleTime: 5 * 60 * 1000,
  });
}
