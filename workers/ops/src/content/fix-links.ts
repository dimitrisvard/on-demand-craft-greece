// Link fixing of translated articles: port of the deployed fix-article-links (version 15) for the daily full pass
// ({"fix_all": true}), split into one pass per language with paged reads.
//
//   buildSlugMapping()      English slug -> {language: translated slug}, from every English article that has a
//                           translation_id and every translated row of the same group
//   fixLinksInContent()     localised /quote and /services links, blog links rewritten to the language's slug,
//                           spacing around links (outside tables), target="_blank" on internal links
//   fixLinksForLanguage()   one language: pages of 200 rows by id; a row is written only when at least one blog
//                           link changed (the live rule; spacing-only changes are not written)
//
// Rules
//   - The mapping is complete: the reads are paged (the live single request stopped at the PostgREST row cap).
//   - write: false (shadow mode) scans and counts without writing.
//   - Text transforms are copied from the live function and checked against a copy of it (test/oracles/).

import type { Db } from '../db/postgrest';
import { SERVICE_SLUGS } from './languages';
import { forEachPage } from './paged';

export type SlugMapping = Record<string, Record<string, string>>;

export const FIX_LINKS_PAGE_ROWS = 200;

/** Builds the mapping from the English rows and the translated rows (later rows of a language win, as live). */
export function slugMappingOf(
  englishRows: ReadonlyArray<{ slug: string; translation_id: string | null }>,
  translatedRows: ReadonlyArray<{ slug: string; translation_id: string | null; language: string }>,
): SlugMapping {
  const mapping: SlugMapping = {};
  const translationIdToEnglishSlug = new Map<string, string>();
  for (const a of englishRows) if (a.translation_id) translationIdToEnglishSlug.set(a.translation_id, a.slug);
  for (const translated of translatedRows) {
    if (!translated.translation_id) continue;
    const englishSlug = translationIdToEnglishSlug.get(translated.translation_id);
    if (englishSlug) {
      if (!mapping[englishSlug]) mapping[englishSlug] = {};
      mapping[englishSlug][translated.language] = translated.slug;
    }
  }
  return mapping;
}

/** The mapping over every article (paged reads, id order). */
export async function buildSlugMapping(db: Db): Promise<SlugMapping> {
  const english: Array<{ slug: string; translation_id: string | null }> = [];
  await forEachPage<{ id: string; slug: string; translation_id: string | null }>(
    db,
    'articles',
    { columns: 'slug,translation_id', filters: [['language', 'eq', 'en']] },
    (rows) => {
      for (const r of rows) if (r.translation_id) english.push(r);
    },
  );
  const translated: Array<{ slug: string; translation_id: string | null; language: string }> = [];
  await forEachPage<{ id: string; slug: string; translation_id: string | null; language: string }>(
    db,
    'articles',
    { columns: 'slug,translation_id,language' },
    (rows) => {
      for (const r of rows) if (r.language !== 'en' && r.translation_id) translated.push(r);
    },
  );
  return slugMappingOf(english, translated);
}

/** Adds target="_blank" to internal links (blog posts, services, quote pages) outside tables. */
export function addTargetBlankToInternalLinks(content: string): string {
  const tableBlocks: Array<{ content: string; placeholder: string }> = [];
  const tablePattern = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  const tableMatches: Array<{ match: string; index: number }> = [];
  while ((tableMatch = tablePattern.exec(content)) !== null) {
    tableMatches.push({ match: tableMatch[0], index: tableMatch.index });
  }
  let contentWithoutTables = content;
  for (let i = tableMatches.length - 1; i >= 0; i--) {
    const { match, index } = tableMatches[i];
    const placeholder = `__TABLE_BLOCK_TARGET_${i}__`;
    tableBlocks.unshift({ content: match, placeholder });
    contentWithoutTables = contentWithoutTables.substring(0, index) + placeholder + contentWithoutTables.substring(index + match.length);
  }

  const linkTagPattern = /<a\s+[^>]*>/gi;
  let modifiedContent = contentWithoutTables;
  const matches: Array<{ fullMatch: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = linkTagPattern.exec(contentWithoutTables)) !== null) {
    matches.push({ fullMatch: match[0], index: match.index });
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    const { fullMatch, index } = matches[i];
    const hasInternalHref = /href=["']\/[a-z]{2}\/(?:blog\/|services\/|quote(?:"|'))/i.test(fullMatch);
    if (!hasInternalHref) continue;
    if (/target\s*=/i.test(fullMatch)) continue;
    const replacement = fullMatch.replace(/>$/, ' target="_blank">');
    modifiedContent = modifiedContent.substring(0, index) + replacement + modifiedContent.substring(index + fullMatch.length);
  }

  for (const tableBlock of tableBlocks) {
    modifiedContent = modifiedContent.replace(tableBlock.placeholder, () => tableBlock.content);
  }
  return modifiedContent;
}

/** Fixes the links of one article's content for its language; linksFixed counts the changed blog links. */
export function fixLinksInContent(content: string, targetLang: string, slugMapping: SlugMapping): { content: string; linksFixed: number } {
  let fixedContent = content;
  let linksFixed = 0;
  const s = SERVICE_SLUGS[targetLang] || {};

  fixedContent = fixedContent.replace(/href=["']\/en\/quote["']/gi, `href="/${targetLang}/${s.quote || 'quote'}"`);
  fixedContent = fixedContent.replace(/href=["']\/en\/services\/cnc-machining["']/gi, `href="/${targetLang}/${s.services || 'services'}/${s['cnc-machining'] || 'cnc-machining'}"`);
  fixedContent = fixedContent.replace(/href=["']\/en\/services\/sheet-metal["']/gi, `href="/${targetLang}/${s.services || 'services'}/${s['sheet-metal'] || 'sheet-metal'}"`);
  fixedContent = fixedContent.replace(/href=["']\/en\/services\/injection-molding["']/gi, `href="/${targetLang}/${s.services || 'services'}/${s['injection-molding'] || 'injection-molding'}"`);
  fixedContent = fixedContent.replace(/href=["']\/en\/services["']/gi, `href="/${targetLang}/${s.services || 'services'}"`);

  // Blog links: /<xx>/blog/<slug> with an optional query or fragment; the slug is looked up as an English slug.
  const blogLinkPattern = /href=["'](\/[a-z]{2}\/blog\/([^"'\s?#]+)([?#][^"']*)?)["']/gi;
  let match: RegExpExecArray | null;
  const replacements: Array<{ original: string; replacement: string }> = [];
  while ((match = blogLinkPattern.exec(content)) !== null) {
    const fullPath = match[1];
    const slugPart = match[2];
    const queryOrFragment = match[3] || '';
    const normalizedSlug = slugPart.replace(/\/$/, '');
    if (slugMapping[normalizedSlug] && slugMapping[normalizedSlug][targetLang]) {
      const translatedSlug = slugMapping[normalizedSlug][targetLang];
      const newPath = `/${targetLang}/blog/${translatedSlug}${queryOrFragment}`;
      if (fullPath !== newPath) {
        const matchStr = match[0];
        const quoteChar = matchStr.charAt(5) === "'" ? "'" : '"';
        replacements.push({ original: match[0], replacement: `href=${quoteChar}${newPath}${quoteChar}` });
        linksFixed++;
      }
    }
  }
  for (const { original, replacement } of replacements) {
    fixedContent = fixedContent.replace(original, replacement);
  }

  // Spacing around links, tables protected by placeholders.
  const tableBlocks: Array<{ content: string; placeholder: string }> = [];
  const tablePattern = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  const tableMatches: Array<{ match: string; index: number }> = [];
  while ((tableMatch = tablePattern.exec(fixedContent)) !== null) {
    tableMatches.push({ match: tableMatch[0], index: tableMatch.index });
  }
  for (let i = tableMatches.length - 1; i >= 0; i--) {
    const { match: m, index } = tableMatches[i];
    const placeholder = `__TABLE_BLOCK_${i}__`;
    tableBlocks.unshift({ content: m, placeholder });
    fixedContent = fixedContent.substring(0, index) + placeholder + fixedContent.substring(index + m.length);
  }

  const linkWithSpacingPattern = /(<a\s+[^>]*href=["'][^"']*["'][^>]*>.*?<\/a>)/gi;
  const linkMatches: Array<{ match: string; index: number }> = [];
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkWithSpacingPattern.exec(fixedContent)) !== null) {
    linkMatches.push({ match: linkMatch[0], index: linkMatch.index });
  }
  for (let i = linkMatches.length - 1; i >= 0; i--) {
    const { match: m, index } = linkMatches[i];
    let isInTablePlaceholder = false;
    for (const tableBlock of tableBlocks) {
      const placeholderIndex = fixedContent.indexOf(tableBlock.placeholder);
      if (placeholderIndex !== -1 && index >= placeholderIndex && index < placeholderIndex + tableBlock.placeholder.length) {
        isInTablePlaceholder = true;
        break;
      }
    }
    if (isInTablePlaceholder) continue;

    const charBefore = index > 0 ? fixedContent[index - 1] : '';
    const needsSpaceBefore = charBefore !== ' ' && charBefore !== '' && charBefore !== '\n' && charBefore !== '<' && charBefore !== '(' && charBefore !== '[' && !/[.,!?;:]/.test(charBefore);
    const afterIndex = index + m.length;
    const charAfter = afterIndex < fixedContent.length ? fixedContent[afterIndex] : '';
    const needsSpaceAfter = charAfter !== ' ' && charAfter !== '' && charAfter !== '\n' && charAfter !== '>' && charAfter !== ')' && charAfter !== ']' && charAfter !== ',' && charAfter !== '.' && charAfter !== '!' && charAfter !== '?' && charAfter !== ';' && charAfter !== ':';

    let replacement = m;
    if (needsSpaceBefore) replacement = ' ' + replacement;
    if (needsSpaceAfter) replacement = replacement + ' ';
    fixedContent = fixedContent.substring(0, index) + replacement + fixedContent.substring(afterIndex);
  }

  for (const tableBlock of tableBlocks) {
    fixedContent = fixedContent.replace(tableBlock.placeholder, () => tableBlock.content);
  }

  fixedContent = addTargetBlankToInternalLinks(fixedContent);
  return { content: fixedContent, linksFixed };
}

export interface FixLinksResult {
  scanned: number;
  /** Rows whose blog links changed. */
  changed: number;
  /** Rows written (0 in shadow mode). */
  updated: number;
  /** Blog links changed. */
  links: number;
}

/** One language's pass: pages of 200 rows by id; rows whose blog links changed are written unless write is false. */
export async function fixLinksForLanguage(db: Db, lang: string, mapping: SlugMapping, o: { write: boolean; pageSize?: number }): Promise<FixLinksResult> {
  const result: FixLinksResult = { scanned: 0, changed: 0, updated: 0, links: 0 };
  await forEachPage<{ id: string; content: string | null; language: string; slug: string }>(
    db,
    'articles',
    { columns: 'content,language,slug', filters: [['language', 'eq', lang]], pageSize: o.pageSize ?? FIX_LINKS_PAGE_ROWS },
    async (rows) => {
      for (const article of rows) {
        result.scanned++;
        const { content: fixedContent, linksFixed } = fixLinksInContent(article.content ?? '', article.language, mapping);
        if (linksFixed > 0) {
          result.changed++;
          result.links += linksFixed;
          if (o.write) {
            await db.update('articles', { content: fixedContent }, { filters: [['id', 'eq', article.id]] });
            result.updated++;
          }
        }
      }
    },
  );
  return result;
}
