// Substitution values of the frozen prompt content_daily.generate_en@v1 (src/content/prompts/generate_en.v1.md),
// as the live generate-daily-article (version 36) computes them. Pure (no prompt-file import), so the T2 tests can
// predict the exact prompt text.

export const BRAND_NAME = 'Microns Hub';

export const SERVICE_PAGES: ReadonlyArray<{ name: string; url: string; anchor: string }> = Object.freeze([
  { name: 'CNC Machining', url: '/en/services/cnc-machining', anchor: 'precision CNC machining services' },
  { name: 'Sheet Metal Fabrication', url: '/en/services/sheet-metal', anchor: 'sheet metal fabrication services' },
  { name: 'Injection Molding', url: '/en/services/injection-molding', anchor: 'injection molding services' },
]);

export const QUOTE_TEXTS: readonly string[] = Object.freeze([
  'Get a quote in 24 hours',
  'Receive a detailed quote within 24 hours',
  'Request a free quote and get pricing in 24 hours',
  'Get your custom quote delivered in 24 hours',
  'Submit your project for a 24-hour quote',
]);

export interface SiloNeighbor {
  title: string;
  slug: string;
}

/** The silo list of the prompt. */
export function formatSiloArticlesForPrompt(neighbors: readonly SiloNeighbor[]): string {
  if (neighbors.length === 0) {
    return 'No related articles available yet. This is the first article in this silo category. Skip silo context links for this article.';
  }
  return neighbors.slice(0, 2).map((n) => `- Title: "${n.title}" (Link: /en/blog/${n.slug})`).join('\n');
}

export interface GeneratePromptInput {
  title: string;
  siloCategory: string | null;
  relatedArticles: string;
  serviceIndex: number;
  quoteIndex: number;
}

/** template expression -> value, for renderTemplate(). */
export function generatePromptValues(i: GeneratePromptInput): Record<string, string> {
  const selectedService = SERVICE_PAGES[i.serviceIndex];
  const selectedQuoteText = QUOTE_TEXTS[i.quoteIndex];
  return {
    BRAND_NAME,
    title: i.title,
    relatedArticles: i.relatedArticles,
    'selectedService.name': selectedService.name,
    'selectedService.name.toLowerCase()': selectedService.name.toLowerCase(),
    'selectedService.url': selectedService.url,
    'selectedService.anchor': selectedService.anchor,
    selectedQuoteText,
    "siloCategory || 'General'": i.siloCategory || 'General',
  };
}
