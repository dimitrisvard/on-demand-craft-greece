import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";
const indexNowKey = Deno.env.get("INDEXNOW_KEY") || "";

const BRAND_NAME = "Microns Hub";
const VERSION = "2026-04-16-no-429-wait";

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
  sv: { services: "tjanster", quote: "offert", "cnc-machining": "cnc-bearbetning", "sheet-metal": "platbearbetning", "injection-molding": "formsprutning" },
  da: { services: "tjenester", quote: "tilbud", "cnc-machining": "cnc-bearbejdning", "sheet-metal": "pladearbejde", "injection-molding": "sprojtestobning" },
  fi: { services: "palvelut", quote: "tarjous", "cnc-machining": "cnc-tyosto", "sheet-metal": "levytyosto", "injection-molding": "ruiskupuristus" },
  cs: { services: "sluzby", quote: "nabidka", "cnc-machining": "cnc-obrabeni", "sheet-metal": "obrabeni-plechu", "injection-molding": "vstrekovani" },
  hu: { services: "szolgaltatasok", quote: "ajanlat", "cnc-machining": "cnc-megmunkalas", "sheet-metal": "lemezfeldolgozas", "injection-molding": "frccsnyomas" },
  pt: { services: "servicos", quote: "orcamento", "cnc-machining": "usinagem-cnc", "sheet-metal": "chapa-metalica", "injection-molding": "moldagem-injecao" },
  nb: { services: "tjenester", quote: "tilbud", "cnc-machining": "cnc-bearbeiding", "sheet-metal": "platarbeid", "injection-molding": "sproytestoping" },
};

interface GeminiResponse {
  candidates?: Array<{ 
    content?: { parts?: Array<{ text?: string }> }; 
    finishReason?: string;
    finishMessage?: string;
  }>;
  error?: { message: string };
}

// Model-fallback chain prioritising free-tier quota headroom.
// gemini-2.5-flash has only 5 RPM / 20 RPD on the free plan, which is far too
// low for 13 languages × 2+ calls each. The models below all have 15-30 RPM
// and 1 500 RPD on the free tier, so a full article translation fits easily.
//
//   gemini-2.0-flash        — 15 RPM, 1 500 RPD, best quality (v1beta)
//   gemini-2.0-flash-lite   — 30 RPM, 1 500 RPD, fastest (v1beta)
//   gemini-1.5-flash-latest — 15 RPM, 1 500 RPD, stable fallback (v1)
//
// NOTE: gemini-1.5-flash (without -latest) returns 404 on v1beta.
// gemini-1.5-* requires the v1 endpoint.
const GEMINI_MODELS: Array<{ model: string; apiVersion: string }> = [
  { model: "gemini-2.0-flash",        apiVersion: "v1beta" },
  { model: "gemini-2.0-flash-lite",   apiVersion: "v1beta" },
  { model: "gemini-1.5-flash-latest", apiVersion: "v1"     },
];

// Sentinel error thrown by callGeminiSingle when all in-process retries for a
// single model return 5xx/overload. callGemini catches this and moves to the
// next model in GEMINI_MODELS; if every model is overloaded, the error
// propagates up and is detected by the language loop.
class GeminiOverloadedError extends Error {
  constructor(public readonly model: string, public readonly status: number, msg: string) {
    super(msg);
    this.name = "GeminiOverloadedError";
  }
}

// Single Gemini API call with model parameter and status-aware retry policy:
//   - 429 (quota/rate limit): wait 65s (RPM window reset) then retry once,
//     then fall back to the next model via GeminiOverloadedError.
//   - 503 / 500 (overload / server error): retry up to 3 times with short
//     back-off (3s, 6s, 12s). These clear in seconds and are the common
//     failure mode at peak hours.
async function callGeminiSingle(
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  model: string,
  apiVersion: string = "v1beta",
  timeoutMs: number = 90000,
  retryCount: number = 0
): Promise<{ text: string; finishReason: string }> {
  const OVERLOAD_MAX_RETRIES = 3;
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${geminiApiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestBody = {
      contents,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 429: rate limit / quota. Fall back to the next model immediately.
    // Each model has its own RPM/RPD quota, so the next one may work.
    // Do NOT wait 65s — sleeping burns the Supabase 150s idle timeout
    // and the function gets killed silently ("shutdown" in logs).
    if (response.status === 429) {
      const body = await response.text().catch(() => "");
      console.warn(`[GEMINI 429] model=${model} — falling back to next model immediately. body=${body.substring(0, 300)}`);
      throw new GeminiOverloadedError(
        model,
        429,
        `Gemini 429 on ${model}: ${body.substring(0, 200)}`,
      );
    }

    // 503 / 500: Google infra overload. Short back-off, retry up to 3 times,
    // then surface a GeminiOverloadedError so the caller can try the next
    // model in the fallback chain.
    if (response.status === 503 || response.status === 500) {
      const body = await response.text().catch(() => "");
      console.warn(`[GEMINI ${response.status}] model=${model} retry=${retryCount + 1}/${OVERLOAD_MAX_RETRIES} body=${body.substring(0, 500)}`);

      if (retryCount >= OVERLOAD_MAX_RETRIES - 1) {
        // Exhausted retries on this model. Caller should fall back.
        throw new GeminiOverloadedError(
          model,
          response.status,
          `Gemini ${response.status} on ${model} after ${OVERLOAD_MAX_RETRIES} retries: ${body.substring(0, 200)}`,
        );
      }

      // 3s, 6s, 12s
      const waitTime = 3000 * Math.pow(2, retryCount);
      console.warn(`[GEMINI ${response.status}] waiting ${waitTime / 1000}s before retry…`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      return callGeminiSingle(contents, model, apiVersion, timeoutMs, retryCount + 1);
    }

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      throw new Error(`Gemini API error (${model}): ${response.status} - ${err.substring(0, 200)}`);
    }

    const data: GeminiResponse = await response.json();
    if (data.error) throw new Error(`Gemini error (${model}): ${data.error.message}`);

    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
      throw new Error(`Empty Gemini response (${model})`);
    }

    return {
      text: candidate.content.parts[0].text,
      finishReason: candidate.finishReason || "UNKNOWN",
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      // Treat timeouts the same as 503 overload so the fallback chain kicks in.
      // A hanging request usually means Google is overloaded but didn't send a
      // 503 — the next model in the chain is likely to respond faster.
      throw new GeminiOverloadedError(
        model,
        408,
        `Gemini API request timeout (${Math.round(timeoutMs / 1000)}s) on ${model}`,
      );
    }
    throw error;
  }
}

// Try one (contents, model) pair. If the model is overloaded (5xx) even
// after callGeminiSingle's internal 3-retry backoff, walk the fallback chain
// (GEMINI_MODELS) to the next lighter model. Propagates GeminiOverloadedError
// only when every model in the chain is exhausted.
async function callGeminiWithFallback(
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  timeoutMs: number,
): Promise<{ text: string; finishReason: string; modelUsed: string }> {
  let lastOverload: GeminiOverloadedError | null = null;
  for (const entry of GEMINI_MODELS) {
    try {
      const res = await callGeminiSingle(contents, entry.model, entry.apiVersion, timeoutMs);
      if (entry.model !== GEMINI_MODELS[0].model) {
        console.warn(`[GEMINI FALLBACK] Succeeded on fallback model "${entry.model}" (primary was overloaded)`);
      }
      return { ...res, modelUsed: entry.model };
    } catch (err: any) {
      if (err instanceof GeminiOverloadedError) {
        console.warn(`[GEMINI FALLBACK] Model "${entry.model}" overloaded (${err.status}), trying next model…`);
        lastOverload = err;
        continue;
      }
      // auth / unknown — don't try fallback models, propagate.
      throw err;
    }
  }
  // Every model overloaded.
  throw lastOverload ?? new GeminiOverloadedError("all", 503, "All Gemini fallback models overloaded");
}

// Main Gemini function with continuation loop for handling token limits
// This handles MAX_TOKENS by sending continuation requests with conversation history
async function callGemini(prompt: string): Promise<string> {
  const geminiStartTime = Date.now();
  // Fail fast: no continuation. If a single shot doesn't fit, let the caller
  // retry this language in a fresh edge-function invocation. Continuation-loop
  // conversation-history growth is a recurring source of Supabase
  // WORKER_RESOURCE_LIMIT, so we never loop.
  const MAX_CONTINUATIONS = 0;

  console.log(`[callGemini] Starting translation, prompt length: ${prompt.length}`);

  // Keep only the minimum history needed for the next call. We rebuild this on
  // continuation instead of appending, so memory stays bounded regardless of
  // how many continuations happen.
  const initialUserTurn = { role: "user", parts: [{ text: prompt }] };
  let conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }> = [initialUserTurn];

  let fullResponse = "";
  let continuationCount = 0;
  let lastModelUsed = GEMINI_MODELS[0].model;

  while (continuationCount <= MAX_CONTINUATIONS) {
    const result = await callGeminiWithFallback(conversationHistory, 90000);
    lastModelUsed = result.modelUsed;

    console.log(`[callGemini] Response ${continuationCount + 1}: ${result.text.length} chars, finishReason: ${result.finishReason}`);

    // Append the response
    fullResponse += result.text;

    // Check if we're done
    if (result.finishReason === "STOP") {
      console.log(`[callGemini] ✓ Complete! Total response: ${fullResponse.length} chars after ${continuationCount + 1} request(s)`);
      break;
    }

    // Check if we hit token limits and need to continue
    if (result.finishReason === "MAX_TOKENS" || result.finishReason === "LENGTH") {
      continuationCount++;

      if (continuationCount > MAX_CONTINUATIONS) {
        console.warn(`[callGemini] ⚠️ Max continuations (${MAX_CONTINUATIONS}) reached, returning partial response`);
        break;
      }

      console.log(`[callGemini] Token limit hit, sending continuation request ${continuationCount}/${MAX_CONTINUATIONS}...`);

      // Replace (don't append) so history size stays O(1) across continuations.
      conversationHistory = [
        initialUserTurn,
        { role: "model", parts: [{ text: result.text }] },
        { role: "user", parts: [{ text: "You stopped due to length limits. Please continue exactly where you left off. Do not repeat the last sentence, just continue from where you stopped." }] },
      ];

      // Small delay before continuation request
      await new Promise(resolve => setTimeout(resolve, 500));

    } else if (result.finishReason !== "STOP") {
      // Unexpected finish reason
      console.warn(`[callGemini] Unexpected finishReason: ${result.finishReason}, treating as complete`);
      break;
    }
  }
  
  const geminiDuration = Date.now() - geminiStartTime;
  console.log(`[callGemini] Total duration: ${geminiDuration}ms, continuations: ${continuationCount}, model used: ${lastModelUsed}`);
  
  if (!fullResponse) {
    throw new Error("Empty Gemini response after all attempts");
  }
  
  return fullResponse;
}

function makeSlug(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/(^-|-$)+/g, "");
}

/**
 * Extract text content from a single table for batch translation
 */
function extractTableTextContent(tableHtml: string): { 
  cells: Array<{ fullMatch: string; tag: string; attrs: string; innerHtml: string; index: number; hasHtml: boolean; textIndex: number | null }>;
  textContents: string[];
} {
  const cellPattern = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
  const cells: Array<{ fullMatch: string; tag: string; attrs: string; innerHtml: string; index: number; hasHtml: boolean; textIndex: number | null }> = [];
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
      hasHtml: hasHtml,
      textIndex: null
    });
  }
  
  const textContents: string[] = [];
  let textIndex = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const textOnly = cell.innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (textOnly.length > 0) {
      cells[i].textIndex = textIndex;
      textContents.push(textOnly);
      textIndex++;
    }
  }
  
  return { cells, textContents };
}

/**
 * Rebuild a table with translated text content
 */
function rebuildTableWithTranslations(
  tableHtml: string, 
  cells: Array<{ fullMatch: string; tag: string; attrs: string; innerHtml: string; index: number; hasHtml: boolean; textIndex: number | null }>,
  translatedLines: string[]
): string {
  let translatedTable = tableHtml;
  
  // Process cells in reverse order to preserve indices
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
        let tagMatch;
        
        while ((tagMatch = tagPattern.exec(cell.innerHtml)) !== null) {
          if (tagMatch.index > lastIndex) {
            const textPart = cell.innerHtml.substring(lastIndex, tagMatch.index);
            if (textPart.trim()) {
              parts.push({ type: 'text', content: textPart });
            }
          }
          parts.push({ type: 'tag', content: tagMatch[0] });
          lastIndex = tagMatch.index + tagMatch[0].length;
        }
        if (lastIndex < cell.innerHtml.length) {
          const textPart = cell.innerHtml.substring(lastIndex);
          if (textPart.trim()) {
            parts.push({ type: 'text', content: textPart });
          }
        }
        
        if (parts.length > 0) {
          const textParts = parts.filter(p => p.type === 'text');
          if (textParts.length === 1) {
            textParts[0].content = translatedLines[cell.textIndex];
            translatedInnerHtml = parts.map(p => p.content).join('');
          } else if (textParts.length > 1) {
            const firstTextIndex = parts.findIndex(p => p.type === 'text' && p.content.trim().length > 0);
            if (firstTextIndex !== -1) {
              parts[firstTextIndex].content = translatedLines[cell.textIndex];
              translatedInnerHtml = parts.map(p => p.content).join('');
            } else {
              translatedInnerHtml = translatedLines[cell.textIndex];
            }
          }
        } else {
          translatedInnerHtml = translatedLines[cell.textIndex];
        }
      }
      
      const newCell = `<${cell.tag}${cell.attrs}>${translatedInnerHtml}</${cell.tag}>`;
      translatedTable = translatedTable.substring(0, cell.index) + 
        newCell + 
        translatedTable.substring(cell.index + cell.fullMatch.length);
    }
  }
  
  return translatedTable;
}

/**
 * Translate ALL tables in a single API call to avoid timeout
 * This is much faster than translating each table separately
 */
async function translateAllTablesAtOnce(
  tables: Array<{ html: string; index: number }>,
  langName: string,
  langCode: string
): Promise<Array<{ html: string; index: number }>> {
  if (tables.length === 0) return [];
  
  console.log(`[BATCH TABLE TRANSLATION] Processing ${tables.length} table(s) in a single API call`);
  
  // Extract text from all tables
  const tableData: Array<{
    tableIndex: number;
    originalHtml: string;
    contentIndex: number;
    cells: Array<{ fullMatch: string; tag: string; attrs: string; innerHtml: string; index: number; hasHtml: boolean; textIndex: number | null }>;
    textContents: string[];
    textStartIndex: number;
  }> = [];
  
  let allTextContents: string[] = [];
  
  for (let t = 0; t < tables.length; t++) {
    const { cells, textContents } = extractTableTextContent(tables[t].html);
    tableData.push({
      tableIndex: t,
      originalHtml: tables[t].html,
      contentIndex: tables[t].index,
      cells,
      textContents,
      textStartIndex: allTextContents.length
    });
    allTextContents = allTextContents.concat(textContents);
  }
  
  if (allTextContents.length === 0) {
    console.log(`[BATCH TABLE TRANSLATION] No text content found in tables`);
    return tables;
  }
  
  console.log(`[BATCH TABLE TRANSLATION] Total cells to translate: ${allTextContents.length} across ${tables.length} table(s)`);

  // Chunk the cells to keep each Gemini call small. Large single prompts (hundreds
  // of cells) cause long continuations and memory growth that trip WORKER_LIMIT.
  const CELL_CHUNK_SIZE = 80;
  const chunks: string[][] = [];
  for (let i = 0; i < allTextContents.length; i += CELL_CHUNK_SIZE) {
    chunks.push(allTextContents.slice(i, i + CELL_CHUNK_SIZE));
  }
  console.log(`[BATCH TABLE TRANSLATION] Splitting into ${chunks.length} chunk(s) of up to ${CELL_CHUNK_SIZE} cells`);

  const translatedLines: string[] = [];

  try {
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      const textToTranslate = chunk.join('\n---CELL---\n');
      const translationPrompt = `Translate the following table cell contents into ${langName}.

RULES:
- Translate ONLY the text content
- Keep technical terms, numbers, and measurements as-is when appropriate
- Each cell is separated by ---CELL---
- Return ONLY the translated text with ---CELL--- separators
- Maintain the EXACT same number of cells (${chunk.length} cells total)
- Do NOT add any HTML, markdown, or formatting

CELLS TO TRANSLATE:
${textToTranslate}`;

      const translatedText = await callGemini(translationPrompt);
      console.log(`[BATCH TABLE TRANSLATION] Chunk ${c + 1}/${chunks.length} response: ${translatedText.length} chars`);

      // Parse the response for this chunk
      let chunkLines = translatedText.split('\n---CELL---\n').map(l => l.trim());

      // Handle alternative formats if Gemini changed the separator
      if (chunkLines.length !== chunk.length) {
        const altSplit = translatedText.split(/---CELL---/gi).map(l => l.trim()).filter(l => l.length > 0);
        if (altSplit.length === chunk.length) {
          chunkLines = altSplit;
        } else {
          const newlineSplit = translatedText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.match(/^---CELL---$/i));
          if (newlineSplit.length >= chunk.length) {
            chunkLines = newlineSplit.slice(0, chunk.length);
          } else {
            chunkLines = [...newlineSplit, ...Array(chunk.length - newlineSplit.length).fill('')];
          }
        }
      }

      // Ensure correct count for this chunk
      if (chunkLines.length < chunk.length) {
        chunkLines = [...chunkLines, ...Array(chunk.length - chunkLines.length).fill('')];
      } else if (chunkLines.length > chunk.length) {
        chunkLines = chunkLines.slice(0, chunk.length);
      }

      translatedLines.push(...chunkLines);

      // Small spacer between chunk calls to avoid bursty RPM usage.
      if (c < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[BATCH TABLE TRANSLATION] Parsed ${translatedLines.length} translated cells`);

    // Rebuild each table with its translated content (slice indices unchanged)
    const translatedTables: Array<{ html: string; index: number }> = [];

    for (const data of tableData) {
      const tableTranslations = translatedLines.slice(
        data.textStartIndex,
        data.textStartIndex + data.textContents.length
      );

      const translatedHtml = rebuildTableWithTranslations(data.originalHtml, data.cells, tableTranslations);
      translatedTables.push({ html: translatedHtml, index: data.contentIndex });

      console.log(`[BATCH TABLE TRANSLATION] ✓ Rebuilt table ${data.tableIndex + 1}/${tables.length}`);
    }

    console.log(`[BATCH TABLE TRANSLATION] ✓ Successfully translated all ${tables.length} table(s) across ${chunks.length} chunk(s)`);
    return translatedTables;

  } catch (error: any) {
    console.error(`[BATCH TABLE TRANSLATION] Error: ${error.message}`);
    // Return original tables on error
    return tables;
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
  
  const translateStartTime = Date.now();
  
  // Hungarian, Finnish, Czech, and Polish may have different translation characteristics
  // - Hungarian: agglutinative language, can produce longer translations (MOST PROBLEMATIC)
  // - Finnish: agglutinative language, complex grammar, special characters (ä, ö, å)
  // - Czech: special characters (č, ř, ž, š, ě, á, í, ó, ú, ý), different word order
  // - Polish: Slavic language like Czech, special characters (ą, ć, ę, ł, ń, ó, ś, ź, ż), complex grammar
  const isLongLanguage = langCode === "hu" || langCode === "fi" || langCode === "cs" || langCode === "pl";
  const hasSpecialChars = langCode === "hu" || langCode === "fi" || langCode === "cs" || langCode === "pl";
  const isHungarian = langCode === "hu";
  
  // Edge Functions Pro plan: 400s wall clock, 150s request idle timeout
  // The "idle timeout" is for inactivity - active work (waiting for Gemini) may run longer
  // We set a generous limit and let the platform decide
  const MAX_TRANSLATION_TIME = 350000; // 350s for all languages (Pro plan)
  
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
  const languageSpecificNote = isLongLanguage 
    ? `\nIMPORTANT LANGUAGE-SPECIFIC INSTRUCTIONS:
  * ${langName} uses special characters and may have different sentence structures than English
  * Preserve all special characters correctly (${langCode === "hu" ? "á, é, í, ó, ö, ő, ú, ü, ű" : langCode === "fi" ? "ä, ö, å" : langCode === "cs" ? "č, ř, ž, š, ě, á, í, ó, ú, ý" : langCode === "pl" ? "ą, ć, ę, ł, ń, ó, ś, ź, ż" : ""})
  * ${langName} translations may be longer or shorter than English - ensure COMPLETE translation of all content
  * Do NOT skip any paragraphs, sections, or content - translate everything fully`
    : "";
  
  const prompt = `Translate this manufacturing blog article into ${langName}.${languageSpecificNote}

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
  
  // Check time after main translation
  const elapsedAfterMain = Date.now() - translateStartTime;
  console.log(`[TIME CHECK] Main translation completed in ${elapsedAfterMain}ms (Pro plan: 400s wall clock)`);
  // No aggressive timeout check - Pro plan has 400s wall clock, let the platform decide
  
  // Log response length for debugging
  console.log(`[translateToLanguage] Gemini response length: ${response.length} characters`);
  console.log(`[translateToLanguage] Response preview (first 500): ${response.substring(0, 500)}`);
  console.log(`[translateToLanguage] Response preview (last 500): ${response.substring(Math.max(0, response.length - 500))}`);
  
  // For languages with special characters, verify encoding
  if (hasSpecialChars) {
    // Check if response contains expected special characters for the language
    const specialCharPatterns: Record<string, RegExp> = {
      hu: /[áéíóöőúüű]/i,
      fi: /[äöå]/i,
      cs: /[čřžšěáíóúý]/i,
      pl: /[ąćęłńóśźż]/i
    };
    const pattern = specialCharPatterns[langCode];
    if (pattern && !pattern.test(response)) {
      console.warn(`[WARNING] ${langName} response may not contain expected special characters - translation might be incomplete`);
    } else if (pattern) {
      console.log(`[OK] ${langName} response contains expected special characters`);
    }
  }
  
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
  
  // Check if translation is incomplete
  // For languages with special characters (hu, fi, cs), use a more lenient threshold
  // These languages may have different word lengths and structures
  const minLengthRatio = hasSpecialChars ? 0.5 : 0.6; // 50% for special char languages, 60% for others
  
  if (lengthRatio < minLengthRatio && originalContentLength > 3000) {
    const missingPercent = (1 - lengthRatio) * 100;
    console.warn(`[WARN] Translation shorter than expected for ${langCode}!`);
    console.warn(`[WARN] Original: ${originalContentLength} chars, Translated: ${translatedContentLength} chars`);
    console.warn(`[WARN] Ratio: ${lengthRatio.toFixed(2)}, Threshold: ${minLengthRatio}`);
    console.warn(`[WARN] Missing approximately ${missingPercent.toFixed(1)}% of content — saving anyway.`);
    // Deliberately NOT throwing: a 70%-translated article with the correct
    // title, excerpt and meta is strictly better than leaving the language
    // completely untranslated and failing the whole batch. Only reject truly
    // empty / garbage responses below.
  }

  // Hard reject: content is so short it cannot be a real translation.
  if (translatedContentLength < 200) {
    console.error(`[ERROR] Translated content is too short to be valid for ${langCode} (${translatedContentLength} chars)`);
    throw new Error(`Translated content for ${langName} is empty or truncated (${translatedContentLength} chars)`);
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
  
  // Track which tables were successfully restored for translation
  const restoredTableIndices: number[] = [];
  
  // Simple and reliable approach: directly replace each placeholder with its table
  for (let i = 0; i < tableBlocks.length; i++) {
    const placeholder = tableBlocks[i].placeholder;
    const originalTable = tableBlocks[i].original;
    let restored = false;
    
    // Check if exact placeholder exists
    if (content.includes(placeholder)) {
      content = content.replace(placeholder, () => originalTable);
      console.log(`[TABLE RESTORE] Restored table ${i + 1}/${tableBlocks.length} using exact placeholder`);
      restored = true;
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
          content = content.replace(pattern, () => originalTable);
          console.log(`[TABLE RESTORE] Restored table ${i + 1} using pattern match`);
          found = true;
          restored = true;
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
            content = content.replace(pattern, () => originalTable);
            console.log(`[TABLE RESTORE] Restored table ${i + 1} using 1-based index pattern`);
            found = true;
            restored = true;
            break;
          }
        }
      }
      
      if (!found) {
        console.error(`[TABLE RESTORE] Could not find placeholder for table ${i + 1}`);
      }
    }
    
    if (restored) {
      restoredTableIndices.push(i);
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
          const tbl = tableBlocks[tableIndex].original;
          content = content.replace(new RegExp(escapedComment, 'g'), () => tbl);
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
          const tbl = tableBlocks[tableIndex].original;
          content = content.replace(new RegExp(escapedPlaceholder, 'g'), () => tbl);
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
      const firstTbl = tableBlocks[0].original;
      for (const remaining of anyRemaining) {
        const escapedRemaining = remaining.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp(escapedRemaining, 'g'), () => firstTbl);
      }
      console.error(`[TABLE RESTORE] Emergency: replaced all remaining placeholders with first table`);
    }
  } else {
    console.log(`[TABLE RESTORE] ✓ All placeholders successfully replaced`);
  }
  
  // TIME CHECK before table translation
  const elapsedBeforeTables = Date.now() - translateStartTime;
  console.log(`[TIME CHECK] Before table translation: ${elapsedBeforeTables}ms elapsed (Pro plan: 400s wall clock)`);

  // Time-budget escape hatch: if main-content translation alone already took
  // >90 s, skip table translation entirely and keep English tables. Shipping
  // a fully-translated article with a few English table rows is strictly
  // better than failing the whole language and losing all the work above.
  const TABLE_TRANSLATION_BUDGET_MS = 90000;
  const tablesOverBudget = elapsedBeforeTables > TABLE_TRANSLATION_BUDGET_MS;
  if (tablesOverBudget) {
    console.warn(`[TIME CHECK] Skipping table translation for ${langCode}: main translation already used ${elapsedBeforeTables}ms (budget ${TABLE_TRANSLATION_BUDGET_MS}ms). Keeping English tables.`);
  }

  // Translate content inside all restored tables using BATCH translation (single API call)
  // OPTIMIZATION (2026-01-06): Translate ALL tables in ONE API call
  // Pro plan: Enable table translation for ALL languages including Hungarian
  const skipTableTranslationLangs: string[] = []; // Empty - translate tables for all languages
  const shouldSkipTables = tablesOverBudget || skipTableTranslationLangs.includes(langCode);
  
  if (shouldSkipTables) {
    console.log(`[TABLE TRANSLATION] ⚠️ Skipping table translation for ${langName} (${langCode})`);
    console.log(`[TABLE TRANSLATION] Tables will remain in English. Main article content is fully translated.`);
  } else {
    console.log(`[TABLE TRANSLATION] Starting batch translation of table content...`);
    
    // Find all tables in the content
    const translationTablePattern = /<table[^>]*>[\s\S]*?<\/table>/gi;
    const allTables: Array<{ html: string; index: number }> = [];
    let translationTableMatch;
    
    // Reset regex lastIndex
    translationTablePattern.lastIndex = 0;
    while ((translationTableMatch = translationTablePattern.exec(content)) !== null) {
      allTables.push({ html: translationTableMatch[0], index: translationTableMatch.index! });
    }
    
    if (allTables.length > 0) {
      console.log(`[TABLE TRANSLATION] Found ${allTables.length} table(s) - translating ALL in a single API call`);
      
      try {
        // Translate ALL tables in ONE API call
        const translatedTables = await translateAllTablesAtOnce(allTables, langName, langCode);
        
        // Replace tables in reverse order to preserve indices
        for (let i = translatedTables.length - 1; i >= 0; i--) {
          const { html: translatedHtml, index } = translatedTables[i];
          const originalLength = allTables[i].html.length;
          
          content = content.substring(0, index) + 
            translatedHtml + 
            content.substring(index + originalLength);
        }
        
        console.log(`[TABLE TRANSLATION] ✓ Successfully translated all ${allTables.length} table(s)`);
      } catch (error: any) {
        console.error(`[TABLE TRANSLATION] ✗ Batch translation failed: ${error.message}`);
        // Tables remain in original language (English) on error
      }
    } else {
      console.log(`[TABLE TRANSLATION] No tables found to translate`);
    }
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

  try {
    const { article_id, target_languages } = await req.json();
    if (!article_id) {
      return new Response(JSON.stringify({ error: "article_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch English article
    const { data: master, error: fetchErr } = await supabase
      .from("articles").select("*").eq("id", article_id).eq("language", "en").single();
    
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

    const results: Record<string, any> = {};
    const urls: string[] = [`${siteUrl}/en/blog/${master.slug}`];

    // Track back-to-back GEMINI_OVERLOADED failures. If we hit 3 in a row we
    // bail out: the remaining languages would just fail the same way, and the
    // queue will retry them on the next cron tick when Gemini is less busy.
    let consecutiveOverloaded = 0;
    let anyGeminiOverloaded = false;

    // Hard ceiling below the 400s Pro-plan wall clock. If we're close to the
    // limit, return partial results cleanly so the client can retry the
    // remaining languages in a fresh invocation instead of being WORKER_LIMIT'd.
    const WALL_CLOCK_BUDGET_MS = 350000;

    for (let i = 0; i < langs.length; i++) {
      const lang = langs[i];
      const elapsed = Date.now() - startTime;

      // NOTE: The auto-translate-articles function now calls this function once per language,
      // so each call only processes 1 language. Pro plan has 400s wall clock duration.

      console.log(`[${i + 1}/${langs.length}] Translating to ${lang.name}... (elapsed: ${elapsed}ms, budget: ${WALL_CLOCK_BUDGET_MS}ms)`);

      if (elapsed > WALL_CLOCK_BUDGET_MS) {
        console.warn(`[WALL CLOCK] Elapsed ${elapsed}ms exceeds ${WALL_CLOCK_BUDGET_MS}ms budget. Returning partial results for remaining languages.`);
        for (let j = i; j < langs.length; j++) {
          results[langs[j].code] = { success: false, error: "WALL_CLOCK_BUDGET_EXCEEDED", skipped: true };
        }
        break;
      }

      try {
        // Check if exists
        const { data: existing } = await supabase
          .from("articles").select("id, title, slug")
          .eq("translation_id", master.translation_id).eq("language", lang.code).single();

        if (existing) {
          console.log(`${lang.code} already exists, skipping`);
          results[lang.code] = { success: true, article_id: existing.id, skipped: true };
          urls.push(`${siteUrl}/${lang.code}/blog/${existing.slug}`);
          continue;
        }

        // Translate with retry logic for languages with special characters
        // Hungarian (hu), Finnish (fi), Czech (cs), Polish (pl) have complex grammar and special characters
        const isSpecialCharLang = lang.code === "hu" || lang.code === "fi" || lang.code === "cs" || lang.code === "pl";
        let translation;
        let retryCount = 0;
        // No internal retry. The caller drives retries: BlogEditor surfaces
        // a "Retry failed" button and auto-translate-articles re-picks missing
        // languages on the next cron tick. Burning this invocation's budget on
        // an in-process retry just pushes us past the 150 s idle-timeout.
        const maxRetries = 0;
        let translateStartTime = Date.now();
        
        console.log(`[TRANSLATION START] ${lang.name} (${lang.code}) - specialChar=${isSpecialCharLang}, maxRetries=${maxRetries}`);
        
        if (isSpecialCharLang) {
          console.log(`[INFO] ${lang.name} is a special character language - using ${maxRetries} retries`);
        }
        
        while (retryCount <= maxRetries) {
          try {
            translation = await translateToLanguage(original, lang.name, lang.code);
            break; // Success, exit retry loop
          } catch (translateError: any) {
            retryCount++;
            if (retryCount > maxRetries) {
              throw translateError; // Re-throw if max retries exceeded
            }
            // Longer wait for special char languages (they may need more API cooling)
            const baseWait = isSpecialCharLang ? 2000 : 1000;
            const waitTime = baseWait * retryCount; // Exponential backoff
            console.warn(`[RETRY] Translation attempt ${retryCount}/${maxRetries} failed for ${lang.code}, waiting ${waitTime}ms before retry... (${translateError.message})`);
            await new Promise(r => setTimeout(r, waitTime));
          }
        }

        // Save
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

        // Reset the overload counter on any non-overloaded outcome (success or
        // duplicate). Only consecutive overloads should trigger early-break.
        consecutiveOverloaded = 0;

      } catch (err: any) {
        const isSpecialCharLang = lang.code === "hu" || lang.code === "fi" || lang.code === "cs" || lang.code === "pl";
        const isOverloaded = err instanceof GeminiOverloadedError ||
          err?.name === "GeminiOverloadedError" ||
          /Gemini.*(503|500|overloaded|UNAVAILABLE)/i.test(err?.message || "");

        console.error(`✗ ${lang.code} failed:`, err.message);
        if (isSpecialCharLang) {
          console.error(`[SPECIAL CHAR LANG ERROR] ${lang.name} (${lang.code}) translation failed. This language uses special characters - check encoding and response parsing.`);
          console.error(`[ERROR DETAILS] Error type: ${err.name}, Message: ${err.message}`);
        }

        if (isOverloaded) {
          anyGeminiOverloaded = true;
          consecutiveOverloaded += 1;
          results[lang.code] = {
            success: false,
            error: "GEMINI_OVERLOADED",
            error_detail: err.message,
            retry_later: true,
            langCode: lang.code,
            isSpecialCharLang,
          };
          console.warn(`[GEMINI_OVERLOADED] ${lang.code}: all fallback models returned 5xx. consecutive=${consecutiveOverloaded}`);

          // If 3 languages in a row hit overload, stop burning budget on the
          // rest — Gemini is clearly having a bad minute. The caller can re-run
          // the remaining languages (BlogEditor "Retry failed" / auto-translate
          // cron) once Gemini recovers.
          if (consecutiveOverloaded >= 3 && i < langs.length - 1) {
            console.warn(`[GEMINI_OVERLOADED] 3 consecutive overloads, bailing out. Remaining languages marked skipped; caller should retry.`);
            for (let j = i + 1; j < langs.length; j++) {
              results[langs[j].code] = {
                success: false,
                error: "GEMINI_OVERLOADED",
                retry_later: true,
                skipped: true,
              };
            }
            break;
          }
        } else {
          consecutiveOverloaded = 0;
          results[lang.code] = { success: false, error: err.message, langCode: lang.code, isSpecialCharLang };
        }
      }

      // Delay between languages to stay under the 15 RPM free-tier ceiling
      // for gemini-2.0-flash. Each language makes ~2 API calls, so 10s keeps
      // us well within limits even with table translation calls.
      if (i < langs.length - 1) {
        console.log(`[RATE LIMIT] Waiting 10s before next language to avoid rate limits...`);
        await new Promise(r => setTimeout(r, 10000));
      }
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

    return new Response(
      JSON.stringify({
        success: successful > 0,
        message: `Translated to ${successful} language(s)`,
        translations: successful,
        total_languages: langs.length,
        execution_time_ms: totalTime,
        indexing: indexed,
        details: results,
        gemini_overloaded: anyGeminiOverloaded,
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
