// One English article into one language: port of translateToLanguage() of the deployed translate-article
// (version 81), with the model call injected (content/gemini-chain.ts in production).
//
// Steps (live order)
//   1. Tables are replaced by <!--TABLE_n--> placeholders (numbered from the last table) before the main call.
//   2. Main call with the frozen prompt content_daily.translate@v1; the answer is parsed by its delimiters
//      (===TITLE=== ... ===END===) with the live fallbacks; content under 100 characters after the fallbacks, or
//      under 200 characters in the end, throws TranslationRejectedError.
//   3. Meta title gets the brand when missing (<= 70 chars), meta description <= 160 chars; links to /dashboard
//      are removed; /quote and /services links localised; mismatched href quotes repaired.
//   4. Placeholders are restored (exact, then the live tolerant patterns, then the emergency rules).
//   5. Table cells are translated in chunks of 80 (content_daily.translate_table@v1) unless the main call took more
//      than 90 s; any table failure keeps the English tables.
//   6. Broken tables are repaired from the originals.
//
// Rules
//   - The length-ratio check only warns (live: a shorter translation is still saved).
//   - Blog links keep their English slugs here; the daily fix-links pass rewrites them.
//   - Error messages name lengths and the language only, never article text.

import { BRAND_NAME } from './generate-en';
import { SERVICE_SLUGS } from './languages';
import { renderTemplate } from './template';
import translateTemplate from './prompts/translate.v1.md';
import tableTemplate from './prompts/translate_table.v1.md';

export const TRANSLATE_PROMPT_ID = 'content_daily.translate@v1';
export const TRANSLATE_TABLE_PROMPT_ID = 'content_daily.translate_table@v1';
export const CELL_CHUNK_SIZE = 80;
export const TABLE_TRANSLATION_BUDGET_MS = 90_000;

export interface OriginalArticle {
  title: string;
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
}

export interface TranslatedArticle {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  /** null: the article has no tables; true: cells translated; false: English tables kept. */
  tablesTranslated: boolean | null;
}

export interface TranslateDeps {
  /** One model call (the chain); returns the answer text. */
  call(prompt: string, kind: 'main' | 'table'): Promise<string>;
  /** Clock in ms (the 90 s table budget). */
  now(): number;
  /** Pause between table chunks (500 ms live). */
  sleep?(ms: number): Promise<void>;
}

export class TranslationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslationRejectedError';
  }
}

/** URL slug of a translated title (accents removed). */
export function makeSlug(title: string): string {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/(^-|-$)+/g, '');
}

/** /quote and /services links of the English master in the language; blog links get the language prefix. */
export function localizeLinks(content: string, langCode: string): string {
  const s = SERVICE_SLUGS[langCode] || {};
  let c = content;
  c = c.replace(/href=["']\/en\/quote["']/gi, `href="/${langCode}/${s.quote || 'quote'}"`);
  c = c.replace(/href=["']\/en\/services\/cnc-machining["']/gi, `href="/${langCode}/${s.services || 'services'}/${s['cnc-machining'] || 'cnc-machining'}"`);
  c = c.replace(/href=["']\/en\/services\/sheet-metal["']/gi, `href="/${langCode}/${s.services || 'services'}/${s['sheet-metal'] || 'sheet-metal'}"`);
  c = c.replace(/href=["']\/en\/services\/injection-molding["']/gi, `href="/${langCode}/${s.services || 'services'}/${s['injection-molding'] || 'injection-molding'}"`);
  c = c.replace(/href=["']\/en\/services["']/gi, `href="/${langCode}/${s.services || 'services'}"`);
  c = c.replace(/href=["']\/en\/blog\//gi, `href="/${langCode}/blog/`);
  return c;
}

/** The language-specific block of the prompt (hu, fi, cs, pl), empty for every other language. */
export function languageSpecificNote(langName: string, langCode: string): string {
  const isLongLanguage = langCode === 'hu' || langCode === 'fi' || langCode === 'cs' || langCode === 'pl';
  if (!isLongLanguage) return '';
  const chars = langCode === 'hu'
    ? 'á, é, í, ó, ö, ő, ú, ü, ű'
    : langCode === 'fi'
      ? 'ä, ö, å'
      : langCode === 'cs'
        ? 'č, ř, ž, š, ě, á, í, ó, ú, ý'
        : langCode === 'pl'
          ? 'ą, ć, ę, ł, ń, ó, ś, ź, ż'
          : '';
  return `\nIMPORTANT LANGUAGE-SPECIFIC INSTRUCTIONS:
  * ${langName} uses special characters and may have different sentence structures than English
  * Preserve all special characters correctly (${chars})
  * ${langName} translations may be longer or shorter than English - ensure COMPLETE translation of all content
  * Do NOT skip any paragraphs, sections, or content - translate everything fully`;
}

/** The main prompt (frozen template content_daily.translate@v1). */
export function renderTranslatePrompt(original: OriginalArticle, contentForTranslation: string, langName: string, langCode: string): string {
  return renderTemplate(translateTemplate, {
    langName,
    languageSpecificNote: languageSpecificNote(langName, langCode),
    BRAND_NAME,
    'original.title': original.title,
    contentForTranslation,
    'original.excerpt': original.excerpt,
    'original.metaTitle': original.metaTitle,
    'original.metaDescription': original.metaDescription,
  });
}

/** One table chunk prompt (frozen template content_daily.translate_table@v1). */
export function renderTablePrompt(langName: string, chunk: readonly string[]): string {
  return renderTemplate(tableTemplate, {
    langName,
    'chunk.length': String(chunk.length),
    textToTranslate: chunk.join('\n---CELL---\n'),
  });
}

type Cell = { fullMatch: string; tag: string; attrs: string; innerHtml: string; index: number; hasHtml: boolean; textIndex: number | null };

function extractTableTextContent(tableHtml: string): { cells: Cell[]; textContents: string[] } {
  const cellPattern = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
  const cells: Cell[] = [];
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellPattern.exec(tableHtml)) !== null) {
    const innerHtml = cellMatch[3];
    cells.push({ fullMatch: cellMatch[0], tag: cellMatch[1], attrs: cellMatch[2], innerHtml, index: cellMatch.index, hasHtml: /<[^>]+>/.test(innerHtml), textIndex: null });
  }
  const textContents: string[] = [];
  let textIndex = 0;
  for (let i = 0; i < cells.length; i++) {
    const textOnly = cells[i].innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (textOnly.length > 0) {
      cells[i].textIndex = textIndex;
      textContents.push(textOnly);
      textIndex++;
    }
  }
  return { cells, textContents };
}

function rebuildTableWithTranslations(tableHtml: string, cells: readonly Cell[], translatedLines: readonly string[]): string {
  let translatedTable = tableHtml;
  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i];
    if (cell.textIndex !== null && cell.textIndex < translatedLines.length) {
      let translatedInnerHtml = cell.innerHtml;
      if (!cell.hasHtml) {
        translatedInnerHtml = translatedLines[cell.textIndex];
      } else {
        const parts: Array<{ type: 'text' | 'tag'; content: string }> = [];
        const tagPattern = /<[^>]+>/g;
        let lastIndex = 0;
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = tagPattern.exec(cell.innerHtml)) !== null) {
          if (tagMatch.index > lastIndex) {
            const textPart = cell.innerHtml.substring(lastIndex, tagMatch.index);
            if (textPart.trim()) parts.push({ type: 'text', content: textPart });
          }
          parts.push({ type: 'tag', content: tagMatch[0] });
          lastIndex = tagMatch.index + tagMatch[0].length;
        }
        if (lastIndex < cell.innerHtml.length) {
          const textPart = cell.innerHtml.substring(lastIndex);
          if (textPart.trim()) parts.push({ type: 'text', content: textPart });
        }
        if (parts.length > 0) {
          const textParts = parts.filter((p) => p.type === 'text');
          if (textParts.length === 1) {
            textParts[0].content = translatedLines[cell.textIndex];
            translatedInnerHtml = parts.map((p) => p.content).join('');
          } else if (textParts.length > 1) {
            const firstTextIndex = parts.findIndex((p) => p.type === 'text' && p.content.trim().length > 0);
            if (firstTextIndex !== -1) {
              parts[firstTextIndex].content = translatedLines[cell.textIndex];
              translatedInnerHtml = parts.map((p) => p.content).join('');
            } else {
              translatedInnerHtml = translatedLines[cell.textIndex];
            }
          }
        } else {
          translatedInnerHtml = translatedLines[cell.textIndex];
        }
      }
      const newCell = `<${cell.tag}${cell.attrs}>${translatedInnerHtml}</${cell.tag}>`;
      translatedTable = translatedTable.substring(0, cell.index) + newCell + translatedTable.substring(cell.index + cell.fullMatch.length);
    }
  }
  return translatedTable;
}

/** Translates the cells of every table in chunks of 80; any failure returns the tables unchanged (ok: false). */
async function translateAllTablesAtOnce(
  tables: ReadonlyArray<{ html: string; index: number }>,
  langName: string,
  deps: TranslateDeps,
): Promise<{ tables: Array<{ html: string; index: number }>; ok: boolean }> {
  if (tables.length === 0) return { tables: [], ok: true };
  const tableData: Array<{ originalHtml: string; contentIndex: number; cells: Cell[]; textContents: string[]; textStartIndex: number }> = [];
  let allTextContents: string[] = [];
  for (const t of tables) {
    const { cells, textContents } = extractTableTextContent(t.html);
    tableData.push({ originalHtml: t.html, contentIndex: t.index, cells, textContents, textStartIndex: allTextContents.length });
    allTextContents = allTextContents.concat(textContents);
  }
  if (allTextContents.length === 0) return { tables: [...tables], ok: true };

  const chunks: string[][] = [];
  for (let i = 0; i < allTextContents.length; i += CELL_CHUNK_SIZE) chunks.push(allTextContents.slice(i, i + CELL_CHUNK_SIZE));
  const translatedLines: string[] = [];
  try {
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      const translatedText = await deps.call(renderTablePrompt(langName, chunk), 'table');
      let chunkLines = translatedText.split('\n---CELL---\n').map((l) => l.trim());
      if (chunkLines.length !== chunk.length) {
        const altSplit = translatedText.split(/---CELL---/gi).map((l) => l.trim()).filter((l) => l.length > 0);
        if (altSplit.length === chunk.length) {
          chunkLines = altSplit;
        } else {
          const newlineSplit = translatedText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.match(/^---CELL---$/i));
          chunkLines = newlineSplit.length >= chunk.length ? newlineSplit.slice(0, chunk.length) : [...newlineSplit, ...Array<string>(chunk.length - newlineSplit.length).fill('')];
        }
      }
      if (chunkLines.length < chunk.length) chunkLines = [...chunkLines, ...Array<string>(chunk.length - chunkLines.length).fill('')];
      else if (chunkLines.length > chunk.length) chunkLines = chunkLines.slice(0, chunk.length);
      translatedLines.push(...chunkLines);
      if (c < chunks.length - 1 && deps.sleep) await deps.sleep(500);
    }
    const translatedTables: Array<{ html: string; index: number }> = [];
    for (const data of tableData) {
      const tableTranslations = translatedLines.slice(data.textStartIndex, data.textStartIndex + data.textContents.length);
      translatedTables.push({ html: rebuildTableWithTranslations(data.originalHtml, data.cells, tableTranslations), index: data.contentIndex });
    }
    return { tables: translatedTables, ok: true };
  } catch {
    return { tables: [...tables], ok: false };
  }
}

function extractBetween(text: string, startDelim: string, endDelim: string): string {
  const startIdx = text.indexOf(startDelim);
  if (startIdx === -1) return '';
  const contentStart = startIdx + startDelim.length;
  const endIdx = text.indexOf(endDelim, contentStart);
  if (endIdx === -1) {
    if (startDelim === '===CONTENT===') {
      const excerptIdx = text.indexOf('===EXCERPT===', contentStart);
      if (excerptIdx !== -1) return text.substring(contentStart, excerptIdx).trim();
    }
    return text.substring(contentStart).trim();
  }
  return text.substring(contentStart, endIdx).trim();
}

/** The live translateToLanguage(); throws TranslationRejectedError for an unusable answer. */
export async function translateToLanguage(original: OriginalArticle, langName: string, langCode: string, deps: TranslateDeps): Promise<TranslatedArticle> {
  const translateStartTime = deps.now();
  const hasSpecialChars = langCode === 'hu' || langCode === 'fi' || langCode === 'cs' || langCode === 'pl';

  // 1. table placeholders
  const tableBlocks: Array<{ original: string; placeholder: string }> = [];
  const tablePattern = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  let contentForTranslation = original.content;
  let tableIndex = 0;
  const tableMatches: Array<{ match: string; index: number }> = [];
  while ((tableMatch = tablePattern.exec(original.content)) !== null) tableMatches.push({ match: tableMatch[0], index: tableMatch.index });
  for (let i = tableMatches.length - 1; i >= 0; i--) {
    const { match, index } = tableMatches[i];
    const placeholder = `<!--TABLE_${tableIndex}-->`;
    tableBlocks.unshift({ original: match, placeholder });
    contentForTranslation = contentForTranslation.substring(0, index) + placeholder + contentForTranslation.substring(index + match.length);
    tableIndex++;
  }

  // 2. main call and delimiter parse
  const response = await deps.call(renderTranslatePrompt(original, contentForTranslation, langName, langCode), 'main');
  const elapsedAfterMain = deps.now() - translateStartTime;

  const title = extractBetween(response, '===TITLE===', '===SLUG===') || original.title;
  const slugRaw = extractBetween(response, '===SLUG===', '===CONTENT===');
  const slug = slugRaw ? makeSlug(slugRaw) : makeSlug(title);
  let content = extractBetween(response, '===CONTENT===', '===EXCERPT===');
  if (!content || content.length < 100) {
    const contentStart = response.indexOf('===CONTENT===');
    if (contentStart !== -1) {
      const contentStartPos = contentStart + '===CONTENT==='.length;
      const nextDelims = [
        response.indexOf('===EXCERPT===', contentStartPos),
        response.indexOf('===META_TITLE===', contentStartPos),
        response.indexOf('===META_DESCRIPTION===', contentStartPos),
        response.indexOf('===END===', contentStartPos),
      ].filter((idx) => idx !== -1);
      if (nextDelims.length > 0) content = response.substring(contentStartPos, Math.min(...nextDelims)).trim();
    }
    if (!content || content.length < 100) {
      throw new TranslationRejectedError(`Failed to extract translated content for ${langCode}. Response may be malformed or truncated.`);
    }
  }
  const excerpt = extractBetween(response, '===EXCERPT===', '===META_TITLE===') || original.excerpt;
  let metaTitle = extractBetween(response, '===META_TITLE===', '===META_DESCRIPTION===') || `${title} | ${BRAND_NAME}`;
  let metaDescription = extractBetween(response, '===META_DESCRIPTION===', '===END===') || original.metaDescription;

  // length-ratio check warns only; a near-empty answer is rejected
  const minLengthRatio = hasSpecialChars ? 0.5 : 0.6;
  if (content.length / original.content.length < minLengthRatio && original.content.length > 3000) {
    console.warn(`[microns-ops] translation shorter than expected language=${langCode} original=${original.content.length} translated=${content.length}`);
  }
  if (content.length < 200) {
    throw new TranslationRejectedError(`Translated content for ${langName} is empty or truncated (${content.length} chars)`);
  }

  // 3. meta fields and links
  if (!metaTitle.includes(BRAND_NAME)) metaTitle = `${metaTitle} | ${BRAND_NAME}`;
  if (metaTitle.length > 70) metaTitle = metaTitle.substring(0, 67) + '...';
  if (metaDescription.length > 160) metaDescription = metaDescription.substring(0, 157) + '...';
  content = content.replace(/<a\s+[^>]*href=["'][^"']*\/dashboard[^"']*["'][^>]*>.*?<\/a>/gi, '');
  content = localizeLinks(content, langCode);
  content = content.replace(/href="([^"']*?)'/g, 'href="$1"');
  content = content.replace(/href='([^"']*?)"/g, "href='$1'");

  // 4. restore the tables
  for (let i = 0; i < tableBlocks.length; i++) {
    const placeholder = tableBlocks[i].placeholder;
    const originalTable = tableBlocks[i].original;
    if (content.includes(placeholder)) {
      content = content.replace(placeholder, () => originalTable);
      continue;
    }
    const patterns = [
      new RegExp(`<!--\\s*TABLE\\s*_?\\s*${i}\\s*-->`, 'gi'),
      new RegExp(`<!--\\s*TABLE${i}\\s*-->`, 'gi'),
      new RegExp(`<!-+\\s*TABLE\\s*_?\\s*${i}\\s*-+>`, 'gi'),
      new RegExp(`<!--TABLE_${i}-->`, 'gi'),
    ];
    let found = false;
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        content = content.replace(pattern, () => originalTable);
        found = true;
        break;
      }
    }
    if (!found) {
      const patterns1Based = [
        new RegExp(`<!--\\s*TABLE\\s*_?\\s*${i + 1}\\s*-->`, 'gi'),
        new RegExp(`<!--\\s*TABLE${i + 1}\\s*-->`, 'gi'),
        new RegExp(`<!--TABLE_${i + 1}-->`, 'gi'),
      ];
      for (const pattern of patterns1Based) {
        if (pattern.test(content)) {
          content = content.replace(pattern, () => originalTable);
          break;
        }
      }
    }
  }
  const remainingComments = content.match(/<!--\s*TABLE\s*_?\s*\d+\s*-->/gi);
  if (remainingComments && remainingComments.length > 0) {
    for (const comment of remainingComments) {
      const numberMatch = comment.match(/(\d+)/);
      if (numberMatch) {
        let idx = parseInt(numberMatch[1], 10);
        if (idx >= tableBlocks.length) idx = Math.max(0, tableBlocks.length - 1);
        if (tableBlocks.length > 0) {
          const escapedComment = comment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const tbl = tableBlocks[idx].original;
          content = content.replace(new RegExp(escapedComment, 'g'), () => tbl);
        }
      }
    }
  }
  const oldStyleMatches = content.match(/__\s*TABLE\s*[_\s]*PLACEHOLDER\s*[_\s]*\d+\s*__/gi);
  if (oldStyleMatches && oldStyleMatches.length > 0) {
    for (const oldPlaceholder of oldStyleMatches) {
      const numberMatch = oldPlaceholder.match(/(\d+)/);
      if (numberMatch) {
        let idx = parseInt(numberMatch[1], 10);
        if (idx >= tableBlocks.length) idx = Math.max(0, tableBlocks.length - 1);
        if (tableBlocks.length > 0) {
          const escapedPlaceholder = oldPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const tbl = tableBlocks[idx].original;
          content = content.replace(new RegExp(escapedPlaceholder, 'g'), () => tbl);
        }
      }
    }
  }
  const anyRemaining = content.match(/<!--\s*TABLE[^>]*-->|__\s*TABLE[^_]*__/gi);
  if (anyRemaining && anyRemaining.length > 0 && tableBlocks.length > 0) {
    const firstTbl = tableBlocks[0].original;
    for (const remaining of anyRemaining) {
      const escapedRemaining = remaining.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(new RegExp(escapedRemaining, 'g'), () => firstTbl);
    }
  }

  // 5. table cells (skipped when the main call used the 90 s budget)
  let tablesTranslated: boolean | null = tableBlocks.length > 0 ? false : null;
  const elapsedBeforeTables = Math.max(elapsedAfterMain, deps.now() - translateStartTime);
  if (elapsedBeforeTables <= TABLE_TRANSLATION_BUDGET_MS) {
    const translationTablePattern = /<table[^>]*>[\s\S]*?<\/table>/gi;
    const allTables: Array<{ html: string; index: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = translationTablePattern.exec(content)) !== null) allTables.push({ html: m[0], index: m.index });
    if (allTables.length > 0) {
      const translated = await translateAllTablesAtOnce(allTables, langName, deps);
      for (let i = translated.tables.length - 1; i >= 0; i--) {
        const { html: translatedHtml, index } = translated.tables[i];
        const originalLength = allTables[i].html.length;
        content = content.substring(0, index) + translatedHtml + content.substring(index + originalLength);
      }
      tablesTranslated = translated.ok;
    }
  }

  // 6. broken tables -> originals
  content = repairBrokenTables(content, tableBlocks);

  return { title, slug, content, excerpt, metaTitle, metaDescription, tablesTranslated };
}

function positions(content: string, pattern: RegExp): number[] {
  const out: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) out.push(match.index);
  return out;
}

function isSingleTable(html: string): boolean {
  const open = (html.match(/<table[^>]*>/gi) || []).length;
  const close = (html.match(/<\/table>/gi) || []).length;
  return open === close && open === 1;
}

/** The live repair passes: a table without a closing tag before the next table is replaced by its original. */
function repairBrokenTables(input: string, tableBlocks: ReadonlyArray<{ original: string }>): string {
  let content = input;
  const tableOpenMatches = positions(content, /<table[^>]*>/gi);
  const tableCloseMatches = positions(content, /<\/table>/gi);
  const broken: Array<{ match: string; index: number; tableIndex: number }> = [];
  for (let i = 0; i < tableOpenMatches.length; i++) {
    const openIndex = tableOpenMatches[i];
    const nextOpenIndex = i < tableOpenMatches.length - 1 ? tableOpenMatches[i + 1] : content.length;
    const closingTagInRange = tableCloseMatches.find((closeIndex) => closeIndex > openIndex && closeIndex < nextOpenIndex);
    if (!closingTagInRange) broken.push({ match: content.substring(openIndex, nextOpenIndex), index: openIndex, tableIndex: i });
  }
  for (let i = broken.length - 1; i >= 0; i--) {
    const b = broken[i];
    const originalTable = tableBlocks[Math.min(b.tableIndex, tableBlocks.length - 1)]?.original;
    if (originalTable !== undefined && isSingleTable(originalTable)) {
      content = content.substring(0, b.index) + originalTable + content.substring(b.index + b.match.length);
    }
  }

  const tableCountAfter = (content.match(/<table[^>]*>/gi) || []).length;
  const tableCloseCountAfter = (content.match(/<\/table>/gi) || []).length;
  if (tableCountAfter !== tableCloseCountAfter) {
    if (tableCloseCountAfter < tableCountAfter && tableBlocks.length > 0) {
      const openPositions = positions(content, /<table[^>]*>/gi);
      const closePositions = positions(content, /<\/table>/gi);
      const tablesToFix: Array<{ openIndex: number; tableIndex: number }> = [];
      for (let i = 0; i < openPositions.length; i++) {
        const openIndex = openPositions[i];
        const nextOpenIndex = i < openPositions.length - 1 ? openPositions[i + 1] : content.length;
        if (!closePositions.some((closeIndex) => closeIndex > openIndex && closeIndex < nextOpenIndex)) tablesToFix.push({ openIndex, tableIndex: i });
      }
      for (let i = tablesToFix.length - 1; i >= 0; i--) {
        const { openIndex, tableIndex } = tablesToFix[i];
        const originalTable = tableBlocks[Math.min(tableIndex, tableBlocks.length - 1)].original;
        const nextOpenIndex = tableIndex < openPositions.length - 1 ? openPositions[tableIndex + 1] : content.length;
        const brokenTableBlock = content.substring(openIndex, nextOpenIndex);
        if (isSingleTable(originalTable)) {
          content = content.substring(0, openIndex) + originalTable + content.substring(openIndex + brokenTableBlock.length);
        }
      }
    } else if (tableCloseCountAfter < tableCountAfter) {
      for (let i = 0; i < tableCountAfter - tableCloseCountAfter; i++) content += '</tbody></table>';
    }
  }
  return content;
}
