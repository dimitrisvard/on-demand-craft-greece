import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";
const indexNowKey = Deno.env.get("INDEXNOW_KEY") || "";

const BRAND_NAME = "Microns Hub";
const VERSION = "2026-01-04-quote-sanitize-v1";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LANGUAGES = [
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "cs", name: "Czech" },
  { code: "hu", name: "Hungarian" },
  { code: "pt", name: "Portuguese" },
  { code: "nb", name: "Norwegian" }
];

const SERVICE_SLUGS: Record<string, Record<string, string>> = {
  de: { services: "dienstleistungen", quote: "angebot", "cnc-machining": "cnc-bearbeitung", "sheet-metal": "blechbearbeitung", "injection-molding": "spritzguss" },
  fr: { services: "services", quote: "devis", "cnc-machining": "usinage-cnc", "sheet-metal": "tolerie", "injection-molding": "injection-plastique" },
  es: { services: "servicios", quote: "cotizacion", "cnc-machining": "mecanizado-cnc", "sheet-metal": "chapa-metalica", "injection-molding": "moldeo-por-inyeccion" },
  it: { services: "servizi", quote: "preventivo", "cnc-machining": "lavorazione-cnc", "sheet-metal": "lavorazione-lamiera", "injection-molding": "stampaggio-iniezione" },
  nl: { services: "diensten", quote: "offerte", "cnc-machining": "cnc-bewerking", "sheet-metal": "plaatbewerking", "injection-molding": "spuitgieten" },
  pl: { services: "uslugi", quote: "wycena", "cnc-machining": "obrobka-cnc", "sheet-metal": "obrobka-bluzy", "injection-molding": "wtrysk-tworzywa" },
  sv: { services: "tjanster", quote: "offert", "cnc-machining": "cnc-bearbetning", "sheet-metal": "platarbe", "injection-molding": "sprutgjutning" },
  da: { services: "tjenester", quote: "tilbud", "cnc-machining": "cnc-bearbejdning", "sheet-metal": "pladearbejde", "injection-molding": "sproejtestoebning" },
  fi: { services: "palvelut", quote: "tarjous", "cnc-machining": "cnc-tyosto", "sheet-metal": "levytyosto", "injection-molding": "ruiskupuristus" },
  cs: { services: "sluzby", quote: "nabidka", "cnc-machining": "cnc-obrabeni", "sheet-metal": "obrabeni-plechu", "injection-molding": "vstrekovani" },
  hu: { services: "szolgaltatasok", quote: "ajanlat", "cnc-machining": "cnc-megmunkalas", "sheet-metal": "lemezfeldolgozas", "injection-molding": "frccsnyomas" },
  pt: { services: "servicos", quote: "orcamento", "cnc-machining": "usinagem-cnc", "sheet-metal": "chapa-metalica", "injection-molding": "moldagem-injecao" },
  nb: { services: "tjenester", quote: "tilbud", "cnc-machining": "cnc-bearbeiding", "sheet-metal": "platarbeid", "injection-molding": "sproyetestoping" },
};

interface GeminiResponse {
  candidates?: Array<{ 
    content?: { parts?: Array<{ text?: string }> }; 
    finishReason?: string;
    finishMessage?: string;
  }>;
  error?: { message: string };
}

async function callGemini(prompt: string): Promise<string> {
  // #region agent log
  const geminiStartTime = Date.now();
  fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:62',message:'callGemini entry',data:{promptLength:prompt.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.3, 
          maxOutputTokens: 32768, // Maximum for Gemini 2.0 Flash
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${err.substring(0, 200)}`);
    }

    const data: GeminiResponse = await response.json();
    if (data.error) throw new Error(`Gemini error: ${data.error.message}`);
    
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
      throw new Error("Empty Gemini response");
    }
    
    // Check if response was truncated
    if (candidate.finishReason === "MAX_TOKENS" || candidate.finishReason === "LENGTH") {
      console.warn(`[WARNING] Gemini response may be truncated (finishReason: ${candidate.finishReason})`);
      throw new Error(`Translation truncated: Gemini hit token limit. finishReason: ${candidate.finishReason}`);
    }
    
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      console.warn(`[WARNING] Unexpected finishReason: ${candidate.finishReason}`);
    }
    
    // #region agent log
    const geminiDuration = Date.now() - geminiStartTime;
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:107',message:'callGemini exit',data:{duration:geminiDuration,responseLength:candidate.content.parts[0].text.length,finishReason:candidate.finishReason},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    return candidate.content.parts[0].text;
  } catch (error: any) {
    clearTimeout(timeoutId);
    // #region agent log
    const geminiDuration = Date.now() - geminiStartTime;
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:109',message:'callGemini error',data:{duration:geminiDuration,errorName:error.name,errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    if (error.name === "AbortError") {
      throw new Error("Gemini API request timeout (60s)");
    }
    throw error;
  }
}

function makeSlug(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/(^-|-$)+/g, "");
}

/**
 * Translate text content inside a table while preserving HTML structure
 * This extracts text nodes and translates them, keeping all HTML tags intact
 */
async function translateTableContent(tableHtml: string, langName: string, langCode: string): Promise<string> {
  // Extract all text content from table cells
  const cellPattern = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
  const cells: Array<{ fullMatch: string; tag: string; attrs: string; innerHtml: string; index: number; hasHtml: boolean }> = [];
  let cellMatch;
  
  while ((cellMatch = cellPattern.exec(tableHtml)) !== null) {
    const innerHtml = cellMatch[3];
    const hasHtml = /<[^>]+>/.test(innerHtml);
    cells.push({
      fullMatch: cellMatch[0],
      tag: cellMatch[1],
      attrs: cellMatch[2],
      innerHtml: innerHtml,
      index: cellMatch.index!,
      hasHtml: hasHtml
    });
  }
  
  if (cells.length === 0) {
    return tableHtml; // No cells to translate
  }
  
  // Extract all text content (excluding HTML tags) for translation
  const textContents: string[] = [];
  for (const cell of cells) {
    // Remove HTML tags to get pure text
    const textOnly = cell.innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (textOnly.length > 0) {
      textContents.push(textOnly);
    }
  }
  
  if (textContents.length === 0) {
    return tableHtml; // No text to translate
  }
  
  // Translate all text content at once
  const textToTranslate = textContents.join('\n---CELL---\n');
  const translationPrompt = `Translate ONLY the text content below into ${langName}. 
  
RULES:
- Translate ONLY the text, do NOT add any formatting or structure
- Keep the exact same number of lines
- Each line corresponds to a table cell
- Return ONLY the translated text, one line per cell, in the same order
- Do NOT include any HTML tags or markdown formatting

Text to translate:
${textToTranslate}`;

  try {
    const translatedText = await callGemini(translationPrompt);
    const translatedLines = translatedText.split('\n---CELL---\n').map(l => l.trim());
    
    // Rebuild table with translated text
    let translatedTable = tableHtml;
    let translatedIndex = 0;
    
    // Process cells in reverse order to preserve indices
    for (let i = cells.length - 1; i >= 0; i--) {
      const cell = cells[i];
      const textOnly = cell.innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      
      if (textOnly.length > 0 && translatedIndex < translatedLines.length) {
        let translatedInnerHtml = cell.innerHtml;
        
        if (!cell.hasHtml) {
          // No HTML tags, just text - replace directly
          translatedInnerHtml = translatedLines[translatedIndex];
        } else {
          // Has HTML tags - preserve structure by replacing only text nodes
          // Extract HTML structure and replace text content
          // Simple approach: find the first and last text nodes and replace them
          // This preserves tags like <strong>, <em>, <a>, etc.
          
          // Try to preserve HTML structure by replacing text while keeping tags
          // Split by HTML tags, translate text parts, keep tags
          const parts: Array<{ type: 'text' | 'tag'; content: string }> = [];
          let remaining = cell.innerHtml;
          let tagMatch;
          
          // Parse HTML structure
          const tagPattern = /<[^>]+>/g;
          let lastIndex = 0;
          while ((tagMatch = tagPattern.exec(cell.innerHtml)) !== null) {
            // Add text before tag
            if (tagMatch.index > lastIndex) {
              const textPart = cell.innerHtml.substring(lastIndex, tagMatch.index);
              if (textPart.trim()) {
                parts.push({ type: 'text', content: textPart });
              }
            }
            // Add tag
            parts.push({ type: 'tag', content: tagMatch[0] });
            lastIndex = tagMatch.index + tagMatch[0].length;
          }
          // Add remaining text
          if (lastIndex < cell.innerHtml.length) {
            const textPart = cell.innerHtml.substring(lastIndex);
            if (textPart.trim()) {
              parts.push({ type: 'text', content: textPart });
            }
          }
          
          // If we successfully parsed the structure, replace text parts
          if (parts.length > 0) {
            const textParts = parts.filter(p => p.type === 'text');
            if (textParts.length === 1) {
              // Single text node - replace it
              textParts[0].content = translatedLines[translatedIndex];
              translatedInnerHtml = parts.map(p => p.content).join('');
            } else {
              // Multiple text nodes - replace first significant one
              // This is a simplification - ideally we'd translate all text nodes
              const firstTextIndex = parts.findIndex(p => p.type === 'text' && p.content.trim().length > 0);
              if (firstTextIndex !== -1) {
                parts[firstTextIndex].content = translatedLines[translatedIndex];
                translatedInnerHtml = parts.map(p => p.content).join('');
              } else {
                // Fallback: replace entire content (loses HTML but preserves table structure)
                translatedInnerHtml = translatedLines[translatedIndex];
              }
            }
          } else {
            // Parsing failed - fallback to simple replacement
            translatedInnerHtml = translatedLines[translatedIndex];
          }
        }
        
        const newCell = `<${cell.tag}${cell.attrs}>${translatedInnerHtml}</${cell.tag}>`;
        translatedTable = translatedTable.substring(0, cell.index) + 
          newCell + 
          translatedTable.substring(cell.index + cell.fullMatch.length);
        translatedIndex++;
      }
    }
    
    // Validate the translated table structure
    const tableOpenTags = (translatedTable.match(/<table[^>]*>/gi) || []).length;
    const tableCloseTags = (translatedTable.match(/<\/table>/gi) || []).length;
    
    if (tableOpenTags !== tableCloseTags) {
      console.error(`[TABLE TRANSLATION] WARNING: Translated table has mismatched tags (${tableOpenTags} open, ${tableCloseTags} close)`);
      // Return original if structure is broken
      return tableHtml;
    }
    
    return translatedTable;
  } catch (error: any) {
    console.error(`[TABLE TRANSLATION] Error translating table content: ${error.message}`);
    // Return original table if translation fails
    return tableHtml;
  }
}

/**
 * Localize links in translated content
 * Note: Article slugs are fixed AFTER all translations by fix-article-links function
 */
function localizeLinks(content: string, langCode: string): string {
  const s = SERVICE_SLUGS[langCode] || {};
  let c = content;
  
  // Handle both single and double quotes, case-insensitive
  // Quote page
  c = c.replace(/href=["']\/en\/quote["']/gi, `href="/${langCode}/${s.quote || "quote"}"`);
  
  // Service pages - specific first (to avoid partial matches)
  c = c.replace(/href=["']\/en\/services\/cnc-machining["']/gi, `href="/${langCode}/${s.services || "services"}/${s["cnc-machining"] || "cnc-machining"}"`);
  c = c.replace(/href=["']\/en\/services\/sheet-metal["']/gi, `href="/${langCode}/${s.services || "services"}/${s["sheet-metal"] || "sheet-metal"}"`);
  c = c.replace(/href=["']\/en\/services\/injection-molding["']/gi, `href="/${langCode}/${s.services || "services"}/${s["injection-molding"] || "injection-molding"}"`);
  
  // General services page (after specific ones)
  c = c.replace(/href=["']\/en\/services["']/gi, `href="/${langCode}/${s.services || "services"}"`);
  
  // Blog links: just replace /en/ prefix with target language
  // The actual slug translation is done by fix-article-links function AFTER all translations
  c = c.replace(/href=["']\/en\/blog\//gi, `href="/${langCode}/blog/`);
  
  return c;
}

async function translateToLanguage(
  original: { title: string; content: string; excerpt: string; metaTitle: string; metaDescription: string },
  langName: string,
  langCode: string
): Promise<{ title: string; slug: string; content: string; excerpt: string; metaTitle: string; metaDescription: string }> {
  
  // Hungarian and some languages may produce longer translations - ensure we handle them properly
  const isLongLanguage = langCode === "hu" || langCode === "fi" || langCode === "cs";
  
  // Extract and protect tables before translation to prevent Gemini from breaking table structure
  const tableBlocks: Array<{ original: string; placeholder: string; translated: string }> = [];
  const tablePattern = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let tableMatch;
  let contentForTranslation = original.content;
  let tableIndex = 0;
  
  // Collect all table blocks and replace with placeholders
  const tableMatches: Array<{ match: string; index: number }> = [];
  while ((tableMatch = tablePattern.exec(original.content)) !== null) {
    tableMatches.push({ match: tableMatch[0], index: tableMatch.index! });
  }
  
  // Process tables in reverse order to preserve indices when replacing
  // Use HTML comment format to avoid markdown interpretation (double underscores = bold)
  for (let i = tableMatches.length - 1; i >= 0; i--) {
    const { match, index } = tableMatches[i];
    // HTML comment format won't be interpreted as markdown and is preserved by LLMs
    const placeholder = `<!--TABLE_${tableIndex}-->`;
    tableBlocks.unshift({ 
      original: match, 
      placeholder: placeholder,
      translated: "" // Will be filled after translation
    });
    // Replace table with placeholder
    contentForTranslation = contentForTranslation.substring(0, index) + 
      placeholder + 
      contentForTranslation.substring(index + match.length);
    tableIndex++;
  }
  
  console.log(`[TABLE PROTECTION] Extracted ${tableBlocks.length} table(s) for protection`);
  
  // Use delimiter-based format instead of JSON to avoid escaping issues with HTML content
  // JSON escaping of quotes in HTML attributes (href="...") causes parsing failures
  const prompt = `Translate this manufacturing blog article into ${langName}${isLongLanguage ? ". Hungarian translations may be longer than English - ensure complete translation." : ""}.

RULES:
- Keep "${BRAND_NAME}" unchanged
- Preserve ALL HTML tags and attributes exactly (including href, class, etc.)
- IMPORTANT: Translate the TEXT inside <a> tags (anchor text), but keep the href URLs unchanged
- Example: <a href="/en/services">our services</a> becomes <a href="/en/services">[translated text]</a>
- Do NOT translate URLs in href attributes - keep them exactly as they are
- Remove any links to "/dashboard" or "/en/dashboard" - these are internal admin links and should not appear
- Translate all visible text content including link text
- CRITICAL TABLE PRESERVATION: 
  * Table placeholders like <!--TABLE_0--> are HTML comments that MUST remain EXACTLY as written
  * Do NOT modify, translate, remove, or change these HTML comment placeholders in any way
  * These placeholders will be replaced with actual tables after translation

Use this EXACT format with the delimiters shown:

===TITLE===
[translated title here]
===SLUG===
[url-friendly slug in ${langName}, lowercase, hyphens only, no special characters]
===CONTENT===
[translated HTML content here - preserve ALL HTML exactly]
===EXCERPT===
[translated excerpt here]
===META_TITLE===
[translated meta title here] | ${BRAND_NAME}
===META_DESCRIPTION===
[translated meta description here, max 160 characters]
===END===

ARTICLE TO TRANSLATE:

TITLE: ${original.title}

CONTENT:
${contentForTranslation}

EXCERPT: ${original.excerpt}

META TITLE: ${original.metaTitle}

META DESCRIPTION: ${original.metaDescription}`;

  const response = await callGemini(prompt);
  
  // Log response length for debugging
  console.log(`[translateToLanguage] Gemini response length: ${response.length} characters`);
  console.log(`[translateToLanguage] Response preview (first 500): ${response.substring(0, 500)}`);
  console.log(`[translateToLanguage] Response preview (last 500): ${response.substring(Math.max(0, response.length - 500))}`);
  
  // Parse using delimiters (much more robust than JSON for HTML content)
  function extractBetween(text: string, startDelim: string, endDelim: string): string {
    const startIdx = text.indexOf(startDelim);
    if (startIdx === -1) {
      console.warn(`[PARSE] Delimiter "${startDelim}" not found`);
      return "";
    }
    const contentStart = startIdx + startDelim.length;
    const endIdx = text.indexOf(endDelim, contentStart);
    if (endIdx === -1) {
      console.warn(`[PARSE] Delimiter "${endDelim}" not found after "${startDelim}"`);
      // For content, try to extract until the next delimiter or end
      if (startDelim === "===CONTENT===") {
        // Try to find excerpt delimiter as fallback
        const excerptIdx = text.indexOf("===EXCERPT===", contentStart);
        if (excerptIdx !== -1) return text.substring(contentStart, excerptIdx).trim();
      }
      return text.substring(contentStart).trim();
    }
    return text.substring(contentStart, endIdx).trim();
  }
  
  const title = extractBetween(response, "===TITLE===", "===SLUG===") || original.title;
  const slugRaw = extractBetween(response, "===SLUG===", "===CONTENT===");
  const slug = slugRaw ? makeSlug(slugRaw) : makeSlug(title);
  let content = extractBetween(response, "===CONTENT===", "===EXCERPT===");
  
  // Fallback: if content extraction failed, try alternative parsing
  if (!content || content.length < 100) {
    console.warn(`[PARSE] Primary content extraction failed, trying fallback...`);
    // Try to find content between CONTENT and any of the next delimiters
    const contentStart = response.indexOf("===CONTENT===");
    if (contentStart !== -1) {
      const contentStartPos = contentStart + "===CONTENT===".length;
      const excerptStart = response.indexOf("===EXCERPT===", contentStartPos);
      const metaTitleStart = response.indexOf("===META_TITLE===", contentStartPos);
      const metaDescStart = response.indexOf("===META_DESCRIPTION===", contentStartPos);
      const endStart = response.indexOf("===END===", contentStartPos);
      
      // Find the earliest next delimiter
      const nextDelims = [excerptStart, metaTitleStart, metaDescStart, endStart].filter(idx => idx !== -1);
      if (nextDelims.length > 0) {
        const nextDelim = Math.min(...nextDelims);
        content = response.substring(contentStartPos, nextDelim).trim();
        console.log(`[PARSE] Fallback extraction successful: ${content.length} chars`);
      }
    }
    
    // Final fallback: use original if still empty
    if (!content || content.length < 100) {
      console.error(`[PARSE] All content extraction methods failed for ${langCode}`);
      console.error(`[PARSE] Response length: ${response.length}`);
      console.error(`[PARSE] Response contains TITLE: ${response.includes("===TITLE===")}`);
      console.error(`[PARSE] Response contains CONTENT: ${response.includes("===CONTENT===")}`);
      throw new Error(`Failed to extract translated content for ${langCode}. Response may be malformed or truncated.`);
    }
  }
  
  const excerpt = extractBetween(response, "===EXCERPT===", "===META_TITLE===") || original.excerpt;
  let metaTitle = extractBetween(response, "===META_TITLE===", "===META_DESCRIPTION===") || `${title} | ${BRAND_NAME}`;
  let metaDescription = extractBetween(response, "===META_DESCRIPTION===", "===END===") || original.metaDescription;
  
  // Log extraction results
  console.log(`[DELIMITER PARSE] Title length: ${title.length}`);
  console.log(`[DELIMITER PARSE] Slug: ${slug}`);
  console.log(`[DELIMITER PARSE] Content length: ${content.length}`);
  console.log(`[DELIMITER PARSE] Excerpt length: ${excerpt.length}`);
  console.log(`[DELIMITER PARSE] Meta title: ${metaTitle}`);
  console.log(`[DELIMITER PARSE] Meta description length: ${metaDescription.length}`);
  
  // Validate content was extracted
  if (!content || content.length < 100) {
    console.error(`[ERROR] Content extraction failed or content too short`);
    console.error(`[ERROR] Extracted content: ${content.substring(0, 500)}`);
    console.error(`[ERROR] Full response for debugging: ${response.substring(0, 2000)}`);
    throw new Error(`Content extraction failed - delimiter parsing returned empty or very short content`);
  }
  
  // Check for article links in the translated content
  const articleLinks = content.match(/href=["']\/[a-z]{2}\/blog\//gi);
  console.log(`[DELIMITER PARSE] Found ${articleLinks?.length || 0} article link(s) in content`);
  
  // Validate content completeness
  const originalContentLength = original.content.length;
  const translatedContentLength = content.length;
  const lengthRatio = translatedContentLength / originalContentLength;
  
  console.log(`[translateToLanguage] Content length: original=${originalContentLength}, translated=${translatedContentLength}, ratio=${lengthRatio.toFixed(2)}`);
  console.log(`[translateToLanguage] Content starts with: ${content.substring(0, 200)}`);
  console.log(`[translateToLanguage] Content ends with: ${content.substring(Math.max(0, translatedContentLength - 200))}`);
  
  // Check if translation is incomplete (less than 60% is suspicious for most languages)
  if (lengthRatio < 0.6 && originalContentLength > 3000) {
    const missingPercent = (1 - lengthRatio) * 100;
    console.error(`[ERROR] Translation appears incomplete!`);
    console.error(`[ERROR] Original: ${originalContentLength} chars, Translated: ${translatedContentLength} chars`);
    console.error(`[ERROR] Missing approximately ${missingPercent.toFixed(1)}% of content`);
    throw new Error(`Translation incomplete: only ${(lengthRatio * 100).toFixed(1)}% of original content translated`);
  }

  if (!metaTitle.includes(BRAND_NAME)) metaTitle = `${metaTitle} | ${BRAND_NAME}`;
  if (metaTitle.length > 70) metaTitle = metaTitle.substring(0, 67) + "...";
  if (metaDescription.length > 160) metaDescription = metaDescription.substring(0, 157) + "...";
  
  // Remove dashboard links (forbidden internal admin links)
  const dashboardLinkPattern = /<a\s+[^>]*href=["'][^"']*\/dashboard[^"']*["'][^>]*>.*?<\/a>/gi;
  const dashboardLinksRemoved = (content.match(dashboardLinkPattern) || []).length;
  content = content.replace(dashboardLinkPattern, '');
  if (dashboardLinksRemoved > 0) {
    console.log(`[SANITIZE] Removed ${dashboardLinksRemoved} dashboard link(s)`);
  }
  
  // Localize service/quote links (article slugs are fixed later by fix-article-links)
  content = localizeLinks(content, langCode);
  
  // Fix any mismatched quotes in href attributes (Gemini sometimes produces href="...' instead of href="...")
  content = content.replace(/href="([^"']*?)'/g, 'href="$1"');
  content = content.replace(/href='([^"']*?)"/g, "href='$1'");
  console.log(`[SANITIZE] Fixed any mismatched quotes in href attributes`);
  
  // Restore tables using HTML comment placeholders
  // Format: <!--TABLE_0-->, <!--TABLE_1-->, etc.
  console.log(`[TABLE RESTORE] Starting table restoration for ${tableBlocks.length} table(s)`);
  
  // Simple and reliable approach: directly replace each placeholder with its table
  for (let i = 0; i < tableBlocks.length; i++) {
    const placeholder = tableBlocks[i].placeholder;
    const originalTable = tableBlocks[i].original;
    
    // Check if exact placeholder exists
    if (content.includes(placeholder)) {
      content = content.replace(placeholder, originalTable);
      console.log(`[TABLE RESTORE] Restored table ${i + 1}/${tableBlocks.length} using exact placeholder`);
    } else {
      console.warn(`[TABLE RESTORE] Exact placeholder ${placeholder} not found, searching for variations...`);
      
      // Try pattern matching for modified versions
      // Gemini might add spaces or modify the comment slightly
      const patterns = [
        new RegExp(`<!--\\s*TABLE\\s*_?\\s*${i}\\s*-->`, 'gi'),  // With optional spaces
        new RegExp(`<!--\\s*TABLE${i}\\s*-->`, 'gi'),           // Without underscore
        new RegExp(`<!-+\\s*TABLE\\s*_?\\s*${i}\\s*-+>`, 'gi'), // With variable dashes
        new RegExp(`<!--TABLE_${i}-->`, 'gi'),                  // Exact format
      ];
      
      let found = false;
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          content = content.replace(pattern, originalTable);
          console.log(`[TABLE RESTORE] Restored table ${i + 1} using pattern match`);
          found = true;
          break;
        }
      }
      
      if (!found) {
        // Try 1-based indexing (in case Gemini converted 0 to 1)
        const patterns1Based = [
          new RegExp(`<!--\\s*TABLE\\s*_?\\s*${i + 1}\\s*-->`, 'gi'),
          new RegExp(`<!--\\s*TABLE${i + 1}\\s*-->`, 'gi'),
          new RegExp(`<!--TABLE_${i + 1}-->`, 'gi'),
        ];
        
        for (const pattern of patterns1Based) {
          if (pattern.test(content)) {
            content = content.replace(pattern, originalTable);
            console.log(`[TABLE RESTORE] Restored table ${i + 1} using 1-based index pattern`);
            found = true;
            break;
          }
        }
      }
      
      if (!found) {
        console.error(`[TABLE RESTORE] Could not find placeholder for table ${i + 1}, will append at end`);
      }
    }
  }
  
  // Check for any remaining HTML comment table placeholders
  const remainingCommentPattern = /<!--\s*TABLE\s*_?\s*\d+\s*-->/gi;
  let remainingComments = content.match(remainingCommentPattern);
  
  if (remainingComments && remainingComments.length > 0) {
    console.warn(`[TABLE RESTORE] Found ${remainingComments.length} remaining HTML comment placeholder(s)`);
    
    for (const comment of remainingComments) {
      const numberMatch = comment.match(/(\d+)/);
      if (numberMatch) {
        let tableIndex = parseInt(numberMatch[1], 10);
        
        // Handle out of range
        if (tableIndex >= tableBlocks.length) {
          tableIndex = Math.max(0, tableBlocks.length - 1);
        }
        
        if (tableBlocks.length > 0) {
          const escapedComment = comment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          content = content.replace(new RegExp(escapedComment, 'g'), tableBlocks[tableIndex].original);
          console.log(`[TABLE RESTORE] Replaced remaining comment ${comment} with table ${tableIndex + 1}`);
        }
      }
    }
  }
  
  // Also check for old-style placeholders (in case any remain from previous translations)
  const oldStylePattern = /__\s*TABLE\s*[_\s]*PLACEHOLDER\s*[_\s]*\d+\s*__/gi;
  const oldStyleMatches = content.match(oldStylePattern);
  
  if (oldStyleMatches && oldStyleMatches.length > 0) {
    console.warn(`[TABLE RESTORE] Found ${oldStyleMatches.length} old-style placeholder(s) - replacing...`);
    
    for (const oldPlaceholder of oldStyleMatches) {
      const numberMatch = oldPlaceholder.match(/(\d+)/);
      if (numberMatch) {
        let tableIndex = parseInt(numberMatch[1], 10);
        if (tableIndex >= tableBlocks.length) {
          tableIndex = Math.max(0, tableBlocks.length - 1);
        }
        if (tableBlocks.length > 0) {
          const escapedPlaceholder = oldPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          content = content.replace(new RegExp(escapedPlaceholder, 'g'), tableBlocks[tableIndex].original);
          console.log(`[TABLE RESTORE] Replaced old-style placeholder with table ${tableIndex + 1}`);
        }
      }
    }
  }
  
  // Final verification: check if any placeholders remain
  const anyRemainingPattern = /<!--\s*TABLE[^>]*-->|__\s*TABLE[^_]*__/gi;
  const anyRemaining = content.match(anyRemainingPattern);
  
  if (anyRemaining && anyRemaining.length > 0) {
    console.error(`[TABLE RESTORE] CRITICAL: ${anyRemaining.length} placeholder(s) still remain!`);
    console.error(`[TABLE RESTORE] Remaining: ${anyRemaining.join(', ')}`);
    
    // Emergency: replace all remaining with first table
    if (tableBlocks.length > 0) {
      for (const remaining of anyRemaining) {
        const escapedRemaining = remaining.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp(escapedRemaining, 'g'), tableBlocks[0].original);
      }
      console.error(`[TABLE RESTORE] Emergency: replaced all remaining placeholders with first table`);
    }
  } else {
    console.log(`[TABLE RESTORE] ✓ All placeholders successfully replaced`);
  }
  
  // After restoration, check for any broken tables and fix them
  // First, find all table opening tags and their positions
  const tableOpenPattern = /<table[^>]*>/gi;
  const tableClosePattern = /<\/table>/gi;
  const tableOpenMatches: number[] = [];
  const tableCloseMatches: number[] = [];
  
  let match;
  while ((match = tableOpenPattern.exec(content)) !== null) {
    tableOpenMatches.push(match.index);
  }
  while ((match = tableClosePattern.exec(content)) !== null) {
    tableCloseMatches.push(match.index);
  }
  
  // Check for broken tables (tables without proper closing tags)
  const brokenTablesAfterRestore: Array<{ match: string; index: number; tableIndex: number }> = [];
  
  for (let i = 0; i < tableOpenMatches.length; i++) {
    const openIndex = tableOpenMatches[i];
    const nextOpenIndex = i < tableOpenMatches.length - 1 ? tableOpenMatches[i + 1] : content.length;
    
    // Find closing tag between this open and next open (or end)
    const closingTagInRange = tableCloseMatches.find(closeIndex => 
      closeIndex > openIndex && closeIndex < nextOpenIndex
    );
    
    if (!closingTagInRange) {
      // No closing tag found - table is broken
      const tableBlock = content.substring(openIndex, nextOpenIndex);
      brokenTablesAfterRestore.push({ 
        match: tableBlock, 
        index: openIndex,
        tableIndex: i
      });
      console.warn(`[TABLE FIX] Found broken table ${i + 1} at index ${openIndex} after restoration (missing closing tag)`);
    }
  }
  
  // Replace broken tables with originals
  if (brokenTablesAfterRestore.length > 0) {
    console.warn(`[TABLE FIX] Replacing ${brokenTablesAfterRestore.length} broken table(s) with originals...`);
    // Process in reverse order to preserve indices
    for (let i = brokenTablesAfterRestore.length - 1; i >= 0; i--) {
      const brokenTable = brokenTablesAfterRestore[i];
      const originalTableIndex = Math.min(brokenTable.tableIndex, tableBlocks.length - 1);
      const originalTable = tableBlocks[originalTableIndex].original;
      
      // Validate original table before using it
      const origOpenTags = (originalTable.match(/<table[^>]*>/gi) || []).length;
      const origCloseTags = (originalTable.match(/<\/table>/gi) || []).length;
      
      if (origOpenTags === origCloseTags && origOpenTags === 1) {
        content = content.substring(0, brokenTable.index) + 
          originalTable + 
          content.substring(brokenTable.index + brokenTable.match.length);
        console.log(`[TABLE FIX] Replaced broken table ${i + 1} with original table ${originalTableIndex + 1}`);
      } else {
        console.error(`[TABLE FIX] Original table ${originalTableIndex + 1} is also invalid, skipping replacement`);
      }
    }
  }
  
  // Validate table structure after restoration
  const tableCountAfter = (content.match(/<table[^>]*>/gi) || []).length;
  const tableCloseCountAfter = (content.match(/<\/table>/gi) || []).length;

  console.log(`[TABLE VALIDATION] Found ${tableCountAfter} table opening tags and ${tableCloseCountAfter} closing tags`);

  if (tableCountAfter !== tableCloseCountAfter) {
    console.warn(`[TABLE VALIDATION] Mismatch detected! Expected ${tableBlocks.length} tables, found ${tableCountAfter} opening and ${tableCloseCountAfter} closing tags`);
    
    // If we have fewer closing tags, try to restore missing tables from originals
    if (tableCloseCountAfter < tableCountAfter && tableBlocks.length > 0) {
      console.warn(`[TABLE VALIDATION] Missing ${tableCountAfter - tableCloseCountAfter} closing tag(s), attempting to fix...`);
      
      // Find tables without closing tags and replace with originals
      const tableOpenPattern = /<table[^>]*>/gi;
      const tableClosePattern = /<\/table>/gi;
      const openPositions: number[] = [];
      const closePositions: number[] = [];
      
      let match;
      while ((match = tableOpenPattern.exec(content)) !== null) {
        openPositions.push(match.index);
      }
      while ((match = tableClosePattern.exec(content)) !== null) {
        closePositions.push(match.index);
      }
      
      // Find tables without closing tags
      const tablesToFix: Array<{ openIndex: number; tableIndex: number }> = [];
      for (let i = 0; i < openPositions.length; i++) {
        const openIndex = openPositions[i];
        const nextOpenIndex = i < openPositions.length - 1 ? openPositions[i + 1] : content.length;
        
        // Check if there's a closing tag between this open and next open
        const hasClosingTag = closePositions.some(closeIndex => 
          closeIndex > openIndex && closeIndex < nextOpenIndex
        );
        
        if (!hasClosingTag) {
          tablesToFix.push({ openIndex, tableIndex: i });
        }
      }
      
      // Replace broken tables with originals (in reverse order)
      for (let i = tablesToFix.length - 1; i >= 0; i--) {
        const { openIndex, tableIndex } = tablesToFix[i];
        const originalTableIndex = Math.min(tableIndex, tableBlocks.length - 1);
        const originalTable = tableBlocks[originalTableIndex].original;
        
        // Find the end of this broken table (next table or end of content)
        const nextOpenIndex = tableIndex < openPositions.length - 1 ? openPositions[tableIndex + 1] : content.length;
        const brokenTableBlock = content.substring(openIndex, nextOpenIndex);
        
        // Validate original table before using
        const origOpenTags = (originalTable.match(/<table[^>]*>/gi) || []).length;
        const origCloseTags = (originalTable.match(/<\/table>/gi) || []).length;
        
        if (origOpenTags === origCloseTags && origOpenTags === 1) {
          content = content.substring(0, openIndex) + 
            originalTable + 
            content.substring(openIndex + brokenTableBlock.length);
          console.log(`[TABLE VALIDATION] Fixed broken table ${tableIndex + 1} by restoring original table ${originalTableIndex + 1}`);
        }
      }
    } else if (tableCloseCountAfter < tableCountAfter) {
      // Last resort: add missing closing tags at the end
      const missingTags = tableCountAfter - tableCloseCountAfter;
      console.warn(`[TABLE VALIDATION] Adding ${missingTags} missing closing tag(s) at end as fallback`);
      for (let i = 0; i < missingTags; i++) {
        content += '</tbody></table>';
      }
    }
  }
  
  // Final validation: ensure all tables are properly structured
  const finalTableCount = (content.match(/<table[^>]*>/gi) || []).length;
  const finalTableCloseCount = (content.match(/<\/table>/gi) || []).length;
  
  if (finalTableCount === finalTableCloseCount && finalTableCount === tableBlocks.length) {
    console.log(`[TABLE VALIDATION] ✓ All ${finalTableCount} table(s) properly restored and validated`);
  } else if (finalTableCount === finalTableCloseCount) {
    console.warn(`[TABLE VALIDATION] Warning: Table count mismatch - Expected ${tableBlocks.length} tables, found ${finalTableCount}`);
  } else {
    console.error(`[TABLE VALIDATION] ERROR: Table structure still broken - ${finalTableCount} opening tags, ${finalTableCloseCount} closing tags`);
    // Last resort: if structure is still broken, try to restore all tables from originals
    if (tableBlocks.length > 0 && finalTableCount !== tableBlocks.length) {
      console.error(`[TABLE VALIDATION] Attempting emergency restoration of all tables...`);
      // This is a complex operation - for now, just log the error
      // The tables should have been restored earlier, so this shouldn't happen
    }
  }

  return { title, slug, content, excerpt, metaTitle, metaDescription };
}

async function submitIndexNow(urls: string[]): Promise<boolean> {
  if (!indexNowKey) return false;
  try {
    const host = new URL(urls[0]).hostname;
    const res = await fetch("https://www.bing.com/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, key: indexNowKey, keyLocation: `https://${host}/indexnow_key.txt`, urlList: urls }),
    });
    return res.ok;
  } catch { return false; }
}

serve(async (req) => {
  // CORS preflight - return immediately
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log(`[translate-article] Version: ${VERSION}`);
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:299',message:'Function entry',data:{version:VERSION},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
  // #endregion

  try {
    const { article_id, target_languages } = await req.json();
    if (!article_id) {
      return new Response(JSON.stringify({ error: "article_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch English article
    // #region agent log
    const dbFetchStartTime = Date.now();
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:309',message:'DB fetch start',data:{article_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    const { data: master, error: fetchErr } = await supabase
      .from("articles").select("*").eq("id", article_id).eq("language", "en").single();
    // #region agent log
    const dbFetchDuration = Date.now() - dbFetchStartTime;
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:310',message:'DB fetch complete',data:{duration:dbFetchDuration,contentLength:master?.content?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    
    if (fetchErr || !master) {
      return new Response(JSON.stringify({ error: "English article not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Translating: ${master.title}`);

    const original = {
      title: master.title,
      content: master.content,
      excerpt: master.excerpt || "",
      metaTitle: master.meta_title || master.title,
      metaDescription: master.meta_description || "",
    };

    const langs = target_languages?.length > 0
      ? LANGUAGES.filter(l => target_languages.includes(l.code))
      : LANGUAGES;
    
    console.log(`Languages: ${langs.map(l => l.code).join(", ")}`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:330',message:'Languages determined',data:{totalLanguages:langs.length,languageCodes:langs.map(l=>l.code)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion

    const results: Record<string, any> = {};
    const urls: string[] = [`${siteUrl}/en/blog/${master.slug}`];

    for (let i = 0; i < langs.length; i++) {
      const lang = langs[i];
      const elapsed = Date.now() - startTime;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:337',message:'Language loop iteration',data:{iteration:i+1,total:langs.length,langCode:lang.code,elapsed},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
      
      // Stop if approaching timeout (100s limit, leave 50s buffer)
      if (elapsed > 100000) {
        console.warn(`Timeout approaching at ${elapsed}ms, stopping`);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:340',message:'Timeout check triggered',data:{elapsed,iteration:i+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
        break;
      }

      console.log(`[${i + 1}/${langs.length}] Translating to ${lang.name}...`);

      try {
        // Check if exists
        // #region agent log
        const checkStartTime = Date.now();
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:349',message:'Check existing translation start',data:{langCode:lang.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        const { data: existing } = await supabase
          .from("articles").select("id, title, slug")
          .eq("translation_id", master.translation_id).eq("language", lang.code).single();
        // #region agent log
        const checkDuration = Date.now() - checkStartTime;
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:350',message:'Check existing translation complete',data:{duration:checkDuration,exists:!!existing},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion

        if (existing) {
          console.log(`${lang.code} already exists, skipping`);
          results[lang.code] = { success: true, article_id: existing.id, skipped: true };
          urls.push(`${siteUrl}/${lang.code}/blog/${existing.slug}`);
          continue;
        }

        // Translate
        // #region agent log
        const translateStartTime = Date.now();
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:361',message:'translateToLanguage start',data:{langCode:lang.code,contentLength:original.content.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        const translation = await translateToLanguage(original, lang.name, lang.code);
        // #region agent log
        const translateDuration = Date.now() - translateStartTime;
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:361',message:'translateToLanguage complete',data:{duration:translateDuration,translatedLength:translation.content.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion

        // Save
        // #region agent log
        const saveStartTime = Date.now();
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:364',message:'DB save start',data:{langCode:lang.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        const { data: saved, error: saveErr } = await supabase
          .from("articles")
          .insert([{
            title: translation.title,
            slug: translation.slug,
              content: translation.content,
              excerpt: translation.excerpt,
              language: lang.code,
              status: "published",
            meta_title: translation.metaTitle,
            meta_description: translation.metaDescription,
            translation_id: master.translation_id,
            featured_image: master.featured_image,
            featured_image_alt: master.featured_image_alt,
          }])
          .select().single();
        // #region agent log
        const saveDuration = Date.now() - saveStartTime;
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:379',message:'DB save complete',data:{duration:saveDuration,success:!saveErr},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion

        if (saveErr) {
          if (saveErr.code === "23505") {
            results[lang.code] = { success: true, skipped: true, note: "duplicate" };
        } else {
            throw saveErr;
          }
        } else if (saved) {
          results[lang.code] = { success: true, article_id: saved.id, title: translation.title };
          urls.push(`${siteUrl}/${lang.code}/blog/${translation.slug}`);
          console.log(`✓ ${lang.name} complete`);
        }

      } catch (err: any) {
        console.error(`✗ ${lang.code} failed:`, err.message);
        results[lang.code] = { success: false, error: err.message };
      }

      // Small delay between languages
      if (i < langs.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    // Update master status
    if (!target_languages?.length) {
      await supabase.from("articles").update({ status: "published" }).eq("id", article_id);
    }

    // IndexNow
    const indexed = await submitIndexNow(urls);

    const successful = Object.values(results).filter((r: any) => r.success).length;
    const totalTime = Date.now() - startTime;
    console.log(`Done: ${successful}/${langs.length} in ${totalTime}ms`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:412',message:'Function complete',data:{totalTime,successful,totalLanguages:langs.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

    return new Response(
      JSON.stringify({
        success: successful > 0,
        message: `Translated to ${successful} language(s)`,
        translations: successful,
        total_languages: langs.length,
        execution_time_ms: totalTime,
        indexing: indexed,
        details: results,
      }),
      { status: successful > 0 ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error", execution_time_ms: Date.now() - startTime }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
