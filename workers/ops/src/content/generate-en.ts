// The English master article: port of the deployed generate-daily-article (version 36) for the queue path
// (title_id and queue job given), minus the HTTP handler.
//
//   todaysSilo()             silo of the 5-day rotation for a UTC day (day of year - 1) mod 5
//   fetchSiloNeighbors()     up to 2 of the last 20 published English articles whose title matches exactly one
//                            article_titles row of the same silo (not the current title)
//   rotationIndices()        service link (count of published English articles mod 3) and quote text (mod 5)
//   renderGeneratePrompt()   the frozen prompt content_daily.generate_en@v1 (src/content/prompts/generate_en.v1.md)
//   parseMasterArticle()     the live parser: code fences stripped, JSON object boundaries, key-anchored recovery of
//                            "content" when JSON.parse fails, cleanHtmlContent, 2,000-word guard, H1 removed,
//                            excerpt and meta fields cleaned and clipped (160 / 80 / 160)
//   generateSlug()           lower case, [^a-z0-9]+ -> '-', no leading or trailing '-'
//
// Rules
//   - The model call itself is made by the Workflow step through P5Ports.textLlm.anthropic (one user message,
//     max_tokens 16384, no system prompt, no thinking field).
//   - An article under 2,000 words is never published: parseMasterArticle throws, the step retries, and after the
//     last attempt the queue job is marked failed (the title stays unprocessed).
//   - Error messages name counts and lengths only, never article text.

import type { Db } from '../db/postgrest';
import { BRAND_NAME, generatePromptValues, type GeneratePromptInput, type SiloNeighbor } from './generate-prompt';
import { selectAll } from './paged';
import { renderTemplate } from './template';
import generateTemplate from './prompts/generate_en.v1.md';

export { BRAND_NAME, formatSiloArticlesForPrompt, QUOTE_TEXTS, SERVICE_PAGES, type SiloNeighbor } from './generate-prompt';

export const GENERATE_PROMPT_ID = 'content_daily.generate_en@v1';
export const DEFAULT_GENERATE_MODEL = 'claude-sonnet-5';
export const GENERATE_MAX_TOKENS = 16384;
/** Client timeout of the call and the gateway's own request timeout (cf-aig-request-timeout). */
export const GENERATE_TIMEOUT_MS = 310_000;
export const GENERATE_GATEWAY_TIMEOUT_MS = 300_000;
export const MIN_WORDS = 2000;
export const TARGET_WORDS = 2500;

export const SILO_ROTATION: readonly string[] = Object.freeze([
  'Advanced CNC Machining Strategy',
  'Die Casting & Metal Casting',
  'Sheet Metal & Fabrication',
  'Rapid Tooling & Injection Molding',
  'Material Science & Surface Engineering',
]);

export interface MasterArticle {
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  faqSchema: unknown;
  words: number;
}

/** Silo of the rotation for a UTC day (YYYY-MM-DD): January 1st is index 0. */
export function todaysSilo(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dayOfYear = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
  return SILO_ROTATION[(dayOfYear - 1) % SILO_ROTATION.length];
}

/** Up to 2 neighbours of the same silo for internal links (empty on any read error, as live). */
export async function fetchSiloNeighbors(db: Db, siloCategory: string | null, currentId: string): Promise<SiloNeighbor[]> {
  if (!siloCategory) return [];
  try {
    const recent = await db.select<{ title: string; slug: string; created_at: string }>('articles', {
      columns: 'title,slug,created_at',
      filters: [['language', 'eq', 'en'], ['status', 'eq', 'published']],
      order: [{ column: 'created_at', ascending: false }],
      limit: 20,
    });
    const neighbours: SiloNeighbor[] = [];
    for (const article of recent) {
      if (neighbours.length >= 2) break;
      // .single() in the live function: exactly one matching title row, else no match
      const match = await db.select<{ silo_category: string | null; id: string }>('article_titles', {
        columns: 'silo_category,id',
        filters: [['title', 'eq', article.title], ['silo_category', 'eq', siloCategory]],
        limit: 2,
      });
      if (match.length === 1 && match[0].id !== currentId) neighbours.push({ title: article.title, slug: article.slug });
    }
    return neighbours;
  } catch {
    return [];
  }
}

/** Service and quote-text rotation from the count of published English articles. */
export async function rotationIndices(db: Db): Promise<{ serviceIndex: number; quoteIndex: number; count: number }> {
  const rows = await selectAll(db, 'articles', { columns: 'id', filters: [['language', 'eq', 'en'], ['status', 'eq', 'published']] });
  const count = rows.length;
  return { serviceIndex: count % 3, quoteIndex: count % 5, count };
}

/** The prompt text sent to the model (the frozen template with the live substitutions). */
export function renderGeneratePrompt(i: GeneratePromptInput): string {
  return renderTemplate(generateTemplate, generatePromptValues(i));
}

/** Recovers "content" from JSON that failed to parse: ends at the next known top-level key (live recovery). */
export function recoverContentField(jsonText: string, contentStart: number): { content: string; recoveredBy: string } {
  const tailPattern = /"\s*,\s*"(excerpt|metaTitle|metaDescription|faqSchema)"\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = tailPattern.exec(jsonText)) !== null) {
    if (match.index > contentStart) {
      return { content: jsonText.substring(contentStart, match.index), recoveredBy: `key:${match[1]}` };
    }
  }
  let i = contentStart;
  let inEscape = false;
  while (i < jsonText.length) {
    if (inEscape) {
      inEscape = false;
    } else if (jsonText[i] === '\\') {
      inEscape = true;
    } else if (jsonText[i] === '"') {
      break;
    }
    i++;
  }
  return { content: jsonText.substring(contentStart, i), recoveredBy: 'first-unescaped-quote' };
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/** Words of an HTML text (tags count as separators). */
export function wordCount(content: string): number {
  return content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => w.length > 0).length;
}

export class ArticleRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArticleRejectedError';
  }
}

/** The live parser and guards over the model's text answer; throws ArticleRejectedError when it cannot publish. */
export function parseMasterArticle(response: string, title: string): MasterArticle {
  let jsonText = response.trim();
  jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const jsonStartIndex = jsonText.indexOf('{');
  let jsonEndIndex = jsonText.lastIndexOf('}');
  if (jsonStartIndex === -1) throw new ArticleRejectedError('Could not find JSON start boundary');
  if (jsonEndIndex === -1 || jsonEndIndex <= jsonStartIndex) jsonEndIndex = jsonText.length - 1;
  jsonText = jsonText.substring(jsonStartIndex, jsonEndIndex + 1);

  let parsed: { content?: unknown; excerpt?: unknown; metaTitle?: unknown; metaDescription?: unknown; faqSchema?: unknown };
  try {
    parsed = JSON.parse(jsonText);
  } catch (parseError) {
    const contentStartMatch = jsonText.match(/"content"\s*:\s*"/);
    if (contentStartMatch && contentStartMatch.index !== undefined) {
      const contentStart = contentStartMatch.index + contentStartMatch[0].length;
      const { content: rawContent } = recoverContentField(jsonText, contentStart);
      const excerptMatch = jsonText.match(/"excerpt"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      const metaTitleMatch = jsonText.match(/"metaTitle"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      const metaDescMatch = jsonText.match(/"metaDescription"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      parsed = {
        content: unescapeJsonString(rawContent),
        excerpt: excerptMatch ? unescapeJsonString(excerptMatch[1]) : '',
        metaTitle: metaTitleMatch ? unescapeJsonString(metaTitleMatch[1]) : `${title} | ${BRAND_NAME}`,
        metaDescription: metaDescMatch ? unescapeJsonString(metaDescMatch[1]) : '',
        faqSchema: null,
      };
    } else {
      throw new ArticleRejectedError(`Failed to parse article JSON: ${parseError instanceof Error ? parseError.message : 'invalid JSON'}`);
    }
  }

  let content: unknown = parsed.content || '';
  let excerpt = String(parsed.excerpt || '');
  const metaTitle = String(parsed.metaTitle || `${title} | ${BRAND_NAME}`);
  let metaDescription = String(parsed.metaDescription || excerpt || '');
  if (typeof content !== 'string') content = String(content);
  let html = cleanHtmlContent(content as string);

  const words = wordCount(html);
  if (words < MIN_WORDS) {
    const endsMidTag = !!html.match(/<[^>]*$/);
    throw new ArticleRejectedError(
      `Article too short: ${words} words (minimum ${MIN_WORDS}, target ${TARGET_WORDS}). ` +
        (endsMidTag ? 'Content ends mid-HTML tag. ' : 'Content appears cut short. ') +
        'Refusing to publish an incomplete article.',
    );
  }

  html = html.replace(/<h1[^>]*>.*?<\/h1>/gi, '');
  const titleH1Pattern = new RegExp(`<h1[^>]*>\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</h1>\\s*`, 'gi');
  html = html.replace(titleH1Pattern, '');
  html = html.replace(/\s{3,}/g, ' ').replace(/\n{3,}/g, '\n\n');

  excerpt = excerpt.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  metaDescription = metaDescription.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  if (excerpt.includes('"content":') || excerpt.includes('```json')) excerpt = excerpt.substring(0, 160).split('\n')[0].trim();
  if (metaDescription.includes('"content":') || metaDescription.includes('```json')) metaDescription = metaDescription.substring(0, 160).split('\n')[0].trim();

  return {
    content: html,
    excerpt: excerpt.substring(0, 160),
    metaTitle: metaTitle.substring(0, 80),
    metaDescription: metaDescription.substring(0, 160),
    faqSchema: parsed.faqSchema || null,
    words,
  };
}

function inTableCell(string: string, offset: number): boolean {
  const beforeMatch = string.substring(0, offset);
  const lastTd = beforeMatch.lastIndexOf('<td');
  const lastTh = beforeMatch.lastIndexOf('<th');
  const lastTdClose = beforeMatch.lastIndexOf('</td>');
  const lastThClose = beforeMatch.lastIndexOf('</th>');
  return lastTd > lastTdClose || lastTh > lastThClose;
}

function insidePreOrCode(beforeMatch: string): boolean {
  const lastPre = beforeMatch.lastIndexOf('<pre');
  const lastCode = beforeMatch.lastIndexOf('<code');
  const lastPreClose = beforeMatch.lastIndexOf('</pre>');
  const lastCodeClose = beforeMatch.lastIndexOf('</code>');
  return (lastPre > lastPreClose && lastPre !== -1) || (lastCode > lastCodeClose && lastCode !== -1);
}

/** The live HTML clean-up: newline runs, spacing around links (not in table cells), cell and text whitespace. */
export function cleanHtmlContent(input: string): string {
  if (!input) return '';
  let html = input;
  html = html.replace(/\n{3,}/g, '\n\n');
  html = html.replace(/>\s*\n\s*</g, '>\n<');
  html = html.replace(/\s+(<a\s+[^>]*href)/g, ' $1');
  html = html.replace(/(<\/a>)\s+/g, '$1 ');

  html = html.replace(/([^\s>])(<a\s+[^>]*href)/g, (match: string, p1: string, p2: string, offset: number, string: string) => {
    if (p1 === '.' || p1 === ',' || p1 === '!' || p1 === '?' || p1 === ';' || p1 === ':' || p1 === '>' || p1 === '(') return match;
    return inTableCell(string, offset) ? match : `${p1} ${p2}`;
  });
  html = html.replace(/(<\/a>)([^\s<])/g, (match: string, p1: string, p2: string, offset: number, string: string) => {
    if (p2 === '.' || p2 === ',' || p2 === '!' || p2 === '?' || p2 === ';' || p2 === ':' || p2 === '<' || p2 === ')' || p2 === ']') return match;
    return inTableCell(string, offset) ? match : `${p1} ${p2}`;
  });
  html = html.replace(/([a-zA-Z0-9])(<a\s+[^>]*href)/g, (match: string, p1: string, p2: string, offset: number, string: string) =>
    inTableCell(string, offset) ? match : `${p1} ${p2}`,
  );
  html = html.replace(/(<\/a>)([a-zA-Z0-9])/g, (match: string, p1: string, p2: string, offset: number, string: string) =>
    inTableCell(string, offset) ? match : `${p1} ${p2}`,
  );

  html = html.replace(/(<td[^>]*>)\s*\n\s*\n+(<\/td>)/g, '$1 $2');
  html = html.replace(/(<th[^>]*>)\s*\n\s*\n+(<\/th>)/g, '$1 $2');

  // The live code looks up the first occurrence of the matched text in the string being replaced (not the match
  // offset); kept as it is so the output stays identical.
  const beforeTrim = html;
  html = beforeTrim.replace(/(>)([^<]+?)(<)/g, (match: string, open: string, content: string, close: string) => {
    if (insidePreOrCode(beforeTrim.substring(0, beforeTrim.indexOf(match)))) return match;
    const trimmed = content.trim();
    return trimmed ? open + trimmed + close : match;
  });

  const beforeSpaces = html;
  html = beforeSpaces.replace(/([^>])\s{2,}([^<])/g, (match: string, before: string, after: string, offset: number) => {
    if (insidePreOrCode(beforeSpaces.substring(0, offset))) return match;
    return before + ' ' + after;
  });

  return html.trim();
}

/** URL slug of an English title. */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}
