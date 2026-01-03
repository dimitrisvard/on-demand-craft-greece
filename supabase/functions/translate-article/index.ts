import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";
const indexNowKey = Deno.env.get("INDEXNOW_KEY") || "";

// Brand name - NEVER translate or alter this
const BRAND_NAME = "Microns Hub";

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Supported languages for translation with full names
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

// Service page slug translations for all languages
// Maps: language -> English slug -> translated slug
// These must match the slugs in src/locales/*/translation.json files
const SERVICE_SLUG_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    "services": "services",
    "quote": "quote",
    "cnc-machining": "cnc-machining",
    "sheet-metal": "sheet-metal",
    "injection-molding": "injection-molding",
  },
  de: {
    "services": "dienstleistungen",
    "quote": "angebot",
    "cnc-machining": "cnc-bearbeitung",
    "sheet-metal": "blechbearbeitung",
    "injection-molding": "spritzguss",
  },
  fr: {
    "services": "services",
    "quote": "devis",
    "cnc-machining": "usinage-cnc",
    "sheet-metal": "tolerie",
    "injection-molding": "injection-plastique",
  },
  es: {
    "services": "servicios",
    "quote": "cotizacion",
    "cnc-machining": "mecanizado-cnc",
    "sheet-metal": "chapa-metalica",
    "injection-molding": "moldeo-por-inyeccion",
  },
  it: {
    "services": "servizi",
    "quote": "preventivo",
    "cnc-machining": "lavorazione-cnc",
    "sheet-metal": "lavorazione-lamiera",
    "injection-molding": "stampaggio-iniezione",
  },
  nl: {
    "services": "diensten",
    "quote": "offerte",
    "cnc-machining": "cnc-bewerking",
    "sheet-metal": "plaatbewerking",
    "injection-molding": "spuitgieten",
  },
  pl: {
    "services": "uslugi",
    "quote": "wycena",
    "cnc-machining": "obrobka-cnc",
    "sheet-metal": "obrobka-bluzy",
    "injection-molding": "wtrysk-tworzywa",
  },
  sv: {
    "services": "tjanster",
    "quote": "offert",
    "cnc-machining": "cnc-bearbetning",
    "sheet-metal": "platarbe",
    "injection-molding": "sprutgjutning",
  },
  da: {
    "services": "tjenester",
    "quote": "tilbud",
    "cnc-machining": "cnc-bearbejdning",
    "sheet-metal": "pladearbejde",
    "injection-molding": "sproejtestoebning",
  },
  fi: {
    "services": "palvelut",
    "quote": "tarjous",
    "cnc-machining": "cnc-työstö",
    "sheet-metal": "levytyöstö",
    "injection-molding": "ruiskupuristus",
  },
  cs: {
    "services": "sluzby",
    "quote": "nabidka",
    "cnc-machining": "cnc-obrabeni",
    "sheet-metal": "obrabeni-plechu",
    "injection-molding": "vstrekovani",
  },
  hu: {
    "services": "szolgaltatasok",
    "quote": "ajanlat",
    "cnc-machining": "cnc-megmunkalas",
    "sheet-metal": "lemezfeldolgozas",
    "injection-molding": "frccsnyomas",
  },
  pt: {
    "services": "servicos",
    "quote": "orcamento",
    "cnc-machining": "usinagem-cnc",
    "sheet-metal": "chapa-metalica",
    "injection-molding": "moldagem-injecao",
  },
  nb: {
    "services": "tjenester",
    "quote": "tilbud",
    "cnc-machining": "cnc-bearbeiding",
    "sheet-metal": "platarbeid",
    "injection-molding": "sproyetestoping",
  },
};

interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  error?: {
    type: string;
    message: string;
  };
}

interface TranslateRequest {
  article_id: string;
  target_languages?: string[]; // Optional: specific language codes to translate to (e.g., ["de", "fr"])
}

/**
 * Generate translation using Claude Sonnet (for longer articles that exceed Haiku's token limit)
 * Claude Sonnet supports up to 8192 tokens but has better handling for long content
 */
async function generateWithClaudeSonnet(
  prompt: string,
  thoughtSignature?: string
): Promise<string> {
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const model = "claude-sonnet-4-20250514";
  const url = "https://api.anthropic.com/v1/messages";

  // Add thought signature if provided
  let fullPrompt = prompt;
  if (thoughtSignature) {
    fullPrompt = `${prompt}\n\nPrevious context signature: ${thoughtSignature}`;
  }

  const requestBody = {
    model: model,
    max_tokens: 8192, // Same limit but Sonnet handles long content better
    messages: [
      {
        role: "user",
        content: fullPrompt,
      },
    ],
  };
  
  console.log(`[generateWithClaudeSonnet] Starting Claude Sonnet API request for long article`);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    const elapsedTime = Date.now() - startTime;
    console.log(`[generateWithClaudeSonnet] Claude Sonnet API response received after ${elapsedTime}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[generateWithClaudeSonnet] Claude API error: ${response.status}`, errorText.substring(0, 500));
      throw new Error(`Claude API error: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data: ClaudeResponse = await response.json();

    if (data.error) {
      throw new Error(`Claude API error: ${data.error.message}`);
    }

    if (!data.content || data.content.length === 0) {
      throw new Error("No response from Claude API");
    }

    // Find the text content in the response
    const textContent = data.content.find(c => c.type === "text");
    if (!textContent) {
      throw new Error("No text content in Claude API response");
    }

    const totalTime = Date.now() - startTime;
    console.log(`[generateWithClaudeSonnet] Claude Sonnet API completed in ${totalTime}ms`);
    console.log(`[generateWithClaudeSonnet] Usage: ${data.usage.input_tokens} input, ${data.usage.output_tokens} output tokens`);
    console.log(`[generateWithClaudeSonnet] Stop reason: ${data.stop_reason}`);

    // Check if response was truncated due to max_tokens limit
    if (data.stop_reason === 'max_tokens') {
      console.warn(`[generateWithClaudeSonnet] ⚠️ Response was truncated due to max_tokens limit! Output tokens: ${data.usage.output_tokens}/${requestBody.max_tokens}`);
      throw new Error(`Translation truncated: Response hit max_tokens limit (${data.usage.output_tokens}/${requestBody.max_tokens} tokens used). Article is too long even for Claude Sonnet.`);
    }

    return textContent.text;
  } catch (error: any) {
    const elapsedTime = Date.now() - startTime;
    console.error(`[generateWithClaudeSonnet] Error after ${elapsedTime}ms:`, error.message);
    throw error;
  }
}

/**
 * Generate translation using Claude Haiku (fast, cost-effective for translations)
 * Claude Haiku provides excellent translation quality with better HTML preservation
 */
async function generateWithClaudeHaiku(
  prompt: string,
  thoughtSignature?: string
): Promise<string> {
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const model = "claude-3-5-haiku-20241022";
  const url = "https://api.anthropic.com/v1/messages";

  // Add thought signature if provided
  let fullPrompt = prompt;
  if (thoughtSignature) {
    fullPrompt = `${prompt}\n\nPrevious context signature: ${thoughtSignature}`;
  }

  // Claude Haiku supports up to 8192 output tokens
  // For 2500-word articles, this should be sufficient, but for longer articles (4000+ words),
  // we may hit the limit. We'll use the maximum and detect truncation.
  const requestBody = {
    model: model,
    max_tokens: 8192, // Maximum supported by Claude Haiku
    messages: [
      {
        role: "user",
        content: fullPrompt,
      },
    ],
  };
  
  const estimatedWords = (fullPrompt.match(/\b\w+\b/g) || []).length;
  console.log(`[generateWithClaudeHaiku] Estimated input words: ${estimatedWords}, using max_tokens: 8192`);

  console.log(`[generateWithClaudeHaiku] Starting Claude Haiku API request`);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    const elapsedTime = Date.now() - startTime;
    console.log(`[generateWithClaudeHaiku] Claude Haiku API response received after ${elapsedTime}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[generateWithClaudeHaiku] Claude API error: ${response.status}`, errorText.substring(0, 500));
      throw new Error(`Claude API error: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data: ClaudeResponse = await response.json();

    if (data.error) {
      throw new Error(`Claude API error: ${data.error.message}`);
    }

    if (!data.content || data.content.length === 0) {
      throw new Error("No response from Claude API");
    }

    // Find the text content in the response
    const textContent = data.content.find(c => c.type === "text");
    if (!textContent) {
      throw new Error("No text content in Claude API response");
    }

    const totalTime = Date.now() - startTime;
    console.log(`[generateWithClaudeHaiku] Claude Haiku API completed in ${totalTime}ms`);
    console.log(`[generateWithClaudeHaiku] Usage: ${data.usage.input_tokens} input, ${data.usage.output_tokens} output tokens`);
    console.log(`[generateWithClaudeHaiku] Stop reason: ${data.stop_reason}`);

    // Check if response was truncated due to max_tokens limit
    if (data.stop_reason === 'max_tokens') {
      console.warn(`[generateWithClaudeHaiku] ⚠️ Response was truncated due to max_tokens limit! Output tokens: ${data.usage.output_tokens}/${requestBody.max_tokens}`);
      throw new Error(`Translation truncated: Response hit max_tokens limit (${data.usage.output_tokens}/${requestBody.max_tokens} tokens used). Article may be too long.`);
    }
    
    // Also check if output tokens are very close to max (within 100 tokens) - this suggests truncation
    if (data.usage.output_tokens >= requestBody.max_tokens - 100) {
      console.warn(`[generateWithClaudeHaiku] ⚠️ Output tokens (${data.usage.output_tokens}) very close to max (${requestBody.max_tokens}), likely truncated`);
      throw new Error(`Translation likely truncated: Output tokens (${data.usage.output_tokens}) very close to max (${requestBody.max_tokens}).`);
    }

    return textContent.text;
  } catch (error: any) {
    const elapsedTime = Date.now() - startTime;
    console.error(`[generateWithClaudeHaiku] Error after ${elapsedTime}ms:`, error.message);
    throw error;
  }
}

/**
 * Generate slug from title (URL-friendly format)
 * Handles accented characters and special characters common in European languages
 */
function generateSlug(title: string): string {
  // Normalize accented characters (é → e, ü → u, etc.)
  const normalized = title
    .normalize("NFD") // Decompose characters (é → e + ´)
    .replace(/[\u0300-\u036f]/g, ""); // Remove diacritical marks
  
  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special characters except spaces and hyphens
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/(^-|-$)+/g, ""); // Remove leading/trailing hyphens
}

/**
 * Extract article slugs from content and build mapping to translated slugs
 * Returns a map: English slug -> Translated slug for the target language
 */
async function buildArticleSlugMapping(
  content: string,
  targetLangCode: string
): Promise<Record<string, string>> {
  const slugMapping: Record<string, string> = {};
  
  // Extract all /en/blog/slug patterns from content
  const blogLinkPattern = /href="\/en\/blog\/([^"]+)"/g;
  const matches = Array.from(content.matchAll(blogLinkPattern));
  const englishSlugs = [...new Set(matches.map(m => m[1]))]; // Remove duplicates
  
  if (englishSlugs.length === 0) {
    console.log(`No article links found in content for language ${targetLangCode}`);
    return slugMapping;
  }
  
  console.log(`[SLUG MAPPING] Found ${englishSlugs.length} article links to translate: ${englishSlugs.join(', ')}`);
  
  // For each English slug, find the article and its translation
  for (const englishSlug of englishSlugs) {
    try {
      // Find the English article by slug
      const { data: englishArticle, error: englishError } = await supabase
        .from("articles")
        .select("id, translation_id, slug, title")
        .eq("language", "en")
        .eq("slug", englishSlug)
        .single();
      
      if (englishError) {
        console.error(`[SLUG MAPPING] Error fetching English article for slug "${englishSlug}":`, englishError);
        continue;
      }
      
      if (!englishArticle || !englishArticle.translation_id) {
        console.warn(`[SLUG MAPPING] English article not found or missing translation_id for slug: ${englishSlug}`);
        continue;
      }
      
      console.log(`[SLUG MAPPING] Found English article: "${englishArticle.title}" (ID: ${englishArticle.id}, translation_id: ${englishArticle.translation_id})`);
      
      // Find the translated article with the same translation_id
      // Check both published and draft articles (translations might be in draft)
      const { data: translatedArticle, error: transError } = await supabase
        .from("articles")
        .select("slug, title, id")
        .eq("translation_id", englishArticle.translation_id)
        .eq("language", targetLangCode)
        .in("status", ["published", "draft"])
        .single();
      
      if (transError) {
        console.warn(`[SLUG MAPPING] Translation not found for slug "${englishSlug}" in language "${targetLangCode}":`, transError.message);
        // Keep English slug if translation doesn't exist yet
        slugMapping[englishSlug] = englishSlug;
        continue;
      }
      
      if (translatedArticle) {
        slugMapping[englishSlug] = translatedArticle.slug;
        console.log(`[SLUG MAPPING] ✓ Mapped: /en/blog/${englishSlug} -> /${targetLangCode}/blog/${translatedArticle.slug} (Article: "${translatedArticle.title}")`);
      } else {
        console.warn(`[SLUG MAPPING] Translation article returned null for slug: ${englishSlug} in language: ${targetLangCode}`);
        slugMapping[englishSlug] = englishSlug;
      }
    } catch (error) {
      console.error(`[SLUG MAPPING] Exception looking up slug "${englishSlug}":`, error);
      // Fallback: keep English slug
      slugMapping[englishSlug] = englishSlug;
    }
  }
  
  console.log(`[SLUG MAPPING] Final mapping for ${targetLangCode}:`, slugMapping);
  return slugMapping;
}

/**
 * Generate translation using "Localization & Link Processor" Prompt
 * - Translates: title, content, excerpt, meta title, meta description, slug
 */
async function generateTranslation(
  originalJsonData: {
    title: string;
    content: string;
    excerpt: string;
    metaTitle: string;
    metaDescription: string;
  },
  targetLanguage: string,
  langCode: string,
  articleSlug: string,
  thoughtSignature: string,
  articleSlugMapping?: Record<string, string>
): Promise<{
  title: string;
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
}> {
  // Build article slug mapping section for prompt
  const slugMappingSection = articleSlugMapping && Object.keys(articleSlugMapping).length > 0
    ? `\n**ARTICLE SLUG MAPPING (CRITICAL - Use these exact slugs from database):**
${Object.entries(articleSlugMapping).map(([enSlug, translatedSlug]) => `* English: "/en/blog/${enSlug}" → Use: "/${langCode}/blog/${translatedSlug}"`).join('\n')}

**IMPORTANT:** When you see href="/en/blog/[english-slug]" in the content, you MUST replace it with href="/${langCode}/blog/[mapped-slug]" using the mapping above. DO NOT translate the slug yourself - use the exact slug from the mapping.`
    : '';

  const prompt = `Role: Native Technical Translator & ISO Standard Specialist.
Task: Translate the following manufacturing blog data into ${targetLanguage}.

Input Data:
{
  "title": ${JSON.stringify(originalJsonData.title)},
  "content": ${JSON.stringify(originalJsonData.content)},
  "excerpt": ${JSON.stringify(originalJsonData.excerpt)},
  "metaTitle": ${JSON.stringify(originalJsonData.metaTitle)},
  "metaDescription": ${JSON.stringify(originalJsonData.metaDescription)}
}
${slugMappingSection}

---
### CRITICAL TRANSLATION RULES

#### 1. BRAND SAFETY
NEVER translate "${BRAND_NAME}". Keep it exactly as "${BRAND_NAME}" in all fields.

#### 2. URL SLUG TRANSLATION
Translate the article URL slug based on the translated title. 
- Current English slug: "${articleSlug}"
- Generate a new slug from the translated title that is:
  * URL-friendly (lowercase, hyphens instead of spaces, no special characters)
  * SEO-optimized for ${targetLanguage}
  * Reflects the translated title meaning
  * Example: "cnc-machining-guide" (English) → "guide-usinage-cnc" (French)

#### 3. META TITLE TRANSLATION
Translate the metaTitle to ${targetLanguage} but:
- Keep "${BRAND_NAME}" unchanged
- Keep it under 60 characters
- Maintain SEO keywords in the target language
Example: "CNC Machining Guide | ${BRAND_NAME}" → "Guide d'usinage CNC | ${BRAND_NAME}" (French)

#### 4. META DESCRIPTION TRANSLATION
Translate the metaDescription to ${targetLanguage} but:
- Keep it under 160 characters
- Make it compelling and include a call-to-action
- Use industry-standard technical terms

#### 5. CONTENT TRANSLATION
- Use industry-standard terms for ${targetLanguage} (e.g., "Stainless Steel" → German "Edelstahl")
- Preserve ALL HTML tags, classes, and IDs exactly
- Only translate the text *between* the tags
- **CRITICAL - TABLE PRESERVATION:** 
  * Preserve ALL table HTML structure exactly: <table>, <thead>, <tbody>, <tr>, <th>, <td> tags must remain intact
  * Translate ONLY the text content inside <th> and <td> cells
  * DO NOT break table structure - keep all opening and closing tags properly nested
  * Maintain table class="editor-table" attribute
  * Ensure proper spacing: add spaces before <a> tags and after </a> tags OUTSIDE of table cells, but preserve spacing inside table cells as needed
  * Example: Translate "Yield Strength" in <th>Yield Strength</th> to target language, but keep the <th> tags

#### 6. SMART LINK LOCALIZATION (Crucial)
${articleSlugMapping && Object.keys(articleSlugMapping).length > 0 ? `
**CRITICAL - ARTICLE LINK MAPPING:**
The article slug mapping was provided above. For ALL article links (href="/en/blog/..."), you MUST use the exact translated slugs from that mapping. DO NOT translate article slugs yourself - they must match the database exactly.

Example: If mapping shows "/en/blog/cnc-guide" → "/${langCode}/blog/fuehrung-cnc", then replace href="/en/blog/cnc-guide" with href="/${langCode}/blog/fuehrung-cnc" exactly as shown.
` : ''}
Rewrite all internal links to match the target language sub-folder structure:
* href="/en/quote" → href="/${langCode}/[translated-quote-slug]"
* href="/en/services" → href="/${langCode}/[translated-services-slug]"  
* href="/en/services/cnc-machining" → href="/${langCode}/[translated-services-slug]/[translated-cnc-slug]"
* href="/en/services/sheet-metal" → href="/${langCode}/[translated-services-slug]/[translated-sheet-metal-slug]"
* href="/en/services/injection-molding" → href="/${langCode}/[translated-services-slug]/[translated-injection-molding-slug]"
${articleSlugMapping && Object.keys(articleSlugMapping).length > 0 ? `
* href="/en/blog/[english-slug]" → href="/${langCode}/blog/[mapped-slug-from-above]" (USE EXACT MAPPING - do not translate)
` : `
* href="/en/blog/any-slug" → href="/${langCode}/blog/translated-slug" (translate the slug if no mapping provided)
`}
* Translate the visible anchor text naturally
* CRITICAL: Links must use proper HTML format: <a href="/${langCode}/path">text</a>
* NEVER include quotes inside the href attribute value - use: href="/path" NOT href=""path""
* Ensure all href values start with "/" and contain no spaces or extra quotes
* IMPORTANT: For article links, ALWAYS use the exact slugs from the mapping provided above - they must match the database exactly

---
### OUTPUT FORMAT (CRITICAL - READ CAREFULLY)
You MUST return ONLY valid JSON. Do NOT include:
- Markdown code fences (triple backticks with json or without)
- Explanatory text before or after the JSON
- Comments or notes
- Any text outside the JSON object
- Placeholder text like "[Rest of the content translated...]" - you MUST translate the ENTIRE content completely

**CRITICAL - COMPLETE TRANSLATION REQUIRED:**
- You MUST translate the ENTIRE content field completely - do NOT leave any part untranslated
- Do NOT use placeholder text or notes like "[Rest of the content translated following the original HTML structure exactly, with all tables, headers, and links preserved]"
- If you run out of tokens, the system will detect this and handle it - but you must translate everything you can within the token limit
- The content field must contain the FULL translated HTML content, not a partial translation

Return ONLY this JSON structure, nothing else:
{
  "title": "<translated article title>",
  "slug": "<translated-url-friendly-slug-based-on-title>",
  "content": "<COMPLETE translated HTML with updated link hrefs - translate EVERYTHING, no placeholders>",
  "excerpt": "<translated excerpt - max 160 chars>",
  "metaTitle": "<translated meta title - max 60 chars> | ${BRAND_NAME}",
  "metaDescription": "<translated meta description - max 160 chars>"
}

IMPORTANT: Start your response with { and end with }. Do not add any text before or after the JSON object.`;

  // Estimate article length to decide which model to use
  // Count actual words by removing HTML tags first, then counting words
  const textWithoutHtml = originalJsonData.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const actualWords = textWithoutHtml.split(/\s+/).filter(w => w.length > 0).length;
  const originalContentLength = originalJsonData.content.length;
  
  // Use Sonnet for articles longer than 2500 words OR content longer than 15000 chars
  // This is more conservative to ensure complete translations
  const useSonnet = actualWords > 2500 || originalContentLength > 15000;
  
  console.log(`[generateTranslation] Article stats: ${actualWords} words, ${originalContentLength} chars. Using ${useSonnet ? 'Sonnet' : 'Haiku'}`);
  
  let response: string;
  try {
    if (useSonnet) {
      console.log(`[generateTranslation] Article is long (${actualWords} words), using Claude Sonnet instead of Haiku`);
      response = await generateWithClaudeSonnet(prompt, thoughtSignature);
    } else {
      response = await generateWithClaudeHaiku(prompt, thoughtSignature);
    }
  } catch (error: any) {
    // If translation was truncated, incomplete, or hit token limits, try with Sonnet as fallback
    const shouldRetryWithSonnet = !useSonnet && (
      error.message?.includes('truncated') || 
      error.message?.includes('max_tokens') ||
      error.message?.includes('incomplete') ||
      error.message?.includes('suspiciously short')
    );
    
    if (shouldRetryWithSonnet) {
      console.warn(`[generateTranslation] Claude Haiku failed for ${targetLanguage} (${error.message}), retrying with Claude Sonnet...`);
      try {
        response = await generateWithClaudeSonnet(prompt, thoughtSignature);
        console.log(`[generateTranslation] Successfully translated with Claude Sonnet after Haiku failed`);
      } catch (sonnetError: any) {
        console.error(`[generateTranslation] Claude Sonnet also failed: ${sonnetError.message}`);
        throw new Error(`Article too long for translation (${actualWords} words, ${originalContentLength} chars). Both Claude Haiku and Sonnet failed. Original error: ${error.message}`);
      }
    } else {
      throw error;
    }
  }
  
  console.log(`[generateTranslation] Response received for ${targetLanguage}, length: ${response.length}`);
  console.log(`[generateTranslation] Response preview (first 500 chars): ${response.substring(0, 500)}`);
  console.log(`[generateTranslation] Response preview (last 500 chars): ${response.substring(Math.max(0, response.length - 500))}`);
  
  // CRITICAL: Check raw response length BEFORE parsing - if it's suspiciously short, fail immediately
  const originalContentLength = originalJsonData.content.length;
  const rawResponseLength = response.length;
  const rawResponseRatio = rawResponseLength / originalContentLength;
  
  console.log(`[generateTranslation] Raw response length check: original=${originalContentLength}, raw_response=${rawResponseLength}, ratio=${rawResponseRatio.toFixed(3)}`);
  
  // If raw response is less than 40% of original, it's definitely incomplete (even accounting for JSON structure)
  if (rawResponseRatio < 0.4 && originalContentLength > 10000) {
    console.error(`[generateTranslation] ⚠️ Raw response is suspiciously short (${rawResponseLength} vs ${originalContentLength} chars, ratio: ${rawResponseRatio.toFixed(3)})`);
    throw new Error(`Translation incomplete: Raw response is only ${rawResponseLength} characters (${Math.round(rawResponseRatio * 100)}%) of original ${originalContentLength} characters. This suggests the translation was severely truncated.`);
  }
  
  // Check if response contains placeholder text indicating incomplete translation
  if (response.includes('[Rest of the content') || response.includes('following the original HTML structure exactly')) {
    console.error(`[generateTranslation] ⚠️ Response contains placeholder text - translation was incomplete!`);
    throw new Error(`Translation incomplete: Response contains placeholder text indicating the translation was cut off. Article may be too long (${actualWords} words). Original content length: ${originalContentLength} characters.`);
  }

  try {
    // Claude Haiku should return clean JSON, but we'll handle edge cases
    let jsonText = response.trim();
    let parsed: any = null;
    
    // Strategy 1: Remove markdown code fences if present (Claude usually doesn't add them, but just in case)
    jsonText = jsonText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    
    // Strategy 2: Find JSON object boundaries (handle nested objects) - improved brace counting
    let jsonStartIndex = jsonText.indexOf('{');
    let jsonEndIndex = -1;
    
    if (jsonStartIndex !== -1) {
      // Find matching closing brace by counting braces (handles nested objects and arrays)
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      
      for (let i = jsonStartIndex; i < jsonText.length; i++) {
        const char = jsonText[i];
        
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        
        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === '{') braceCount++;
          if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              jsonEndIndex = i;
              break;
            }
          }
        }
      }
    }
    
    // Strategy 3: If we found valid boundaries, extract JSON
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1 && jsonEndIndex > jsonStartIndex) {
      jsonText = jsonText.substring(jsonStartIndex, jsonEndIndex + 1);
      
      try {
        parsed = JSON.parse(jsonText);
        console.log(`✓ Successfully parsed JSON for ${targetLanguage} using boundary extraction`);
      } catch (parseError: any) {
        console.warn(`[generateTranslation] Boundary extraction parse failed: ${parseError.message}`);
        parsed = null;
      }
    }
    
    // Strategy 4: If parsing failed, try to find JSON using regex (more aggressive)
    if (!parsed) {
      console.log(`Trying regex-based JSON extraction for ${targetLanguage}...`);
      // Try to match the largest JSON object
      const jsonMatches = response.match(/\{[\s\S]*\}/g);
      if (jsonMatches && jsonMatches.length > 0) {
        // Try the largest match first
        const sortedMatches = jsonMatches.sort((a, b) => b.length - a.length);
        for (const match of sortedMatches) {
          try {
            parsed = JSON.parse(match);
            console.log(`✓ Successfully parsed JSON for ${targetLanguage} using regex extraction`);
            break;
          } catch (parseError: any) {
            // Try next match
          }
        }
      }
    }
    
    // Strategy 5: Try to fix common JSON issues and parse
    if (!parsed) {
      console.log(`Trying to fix and parse JSON for ${targetLanguage}...`);
      try {
        // Remove trailing commas before closing braces/brackets
        let fixedJson = jsonText.replace(/,(\s*[}\]])/g, '$1');
        // Remove comments (though JSON shouldn't have them)
        fixedJson = fixedJson.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        // Try to fix unescaped control characters
        fixedJson = fixedJson.replace(/[\x00-\x1F\x7F]/g, '');
        parsed = JSON.parse(fixedJson);
        console.log(`✓ Successfully parsed JSON for ${targetLanguage} after fixing`);
      } catch (parseError: any) {
        console.warn(`Fixed JSON parse failed: ${parseError.message}`);
        // Try to get the position of the error and fix it
        const errorMatch = parseError.message.match(/position (\d+)/);
        if (errorMatch) {
          const errorPos = parseInt(errorMatch[1]);
          console.warn(`JSON parse error at position ${errorPos}`);
          console.warn(`Context around error: ${jsonText.substring(Math.max(0, errorPos - 100), errorPos + 100)}`);
        }
      }
    }
    
    // Strategy 5b: Try to extract JSON by finding the largest valid JSON substring
    if (!parsed) {
      console.log(`Trying to find largest valid JSON substring for ${targetLanguage}...`);
      try {
        // Start from the first { and try progressively smaller substrings
        const firstBrace = jsonText.indexOf('{');
        if (firstBrace !== -1) {
          for (let endPos = jsonText.length; endPos > firstBrace + 100; endPos -= 100) {
            try {
              const candidate = jsonText.substring(firstBrace, endPos);
              parsed = JSON.parse(candidate);
              console.log(`✓ Successfully parsed JSON for ${targetLanguage} using substring (length: ${endPos - firstBrace})`);
              break;
            } catch (e) {
              // Try next position
            }
          }
        }
      } catch (substrError: any) {
        console.warn(`Substring extraction failed: ${substrError.message}`);
      }
    }
    
    // Strategy 6: Handle truncated JSON responses (missing closing brace OR truncated field values)
    const hasOpeningBrace = response.includes('{');
    const hasClosingBrace = response.includes('}');
    const openingBraceCount = (response.match(/\{/g) || []).length;
    const closingBraceCount = (response.match(/\}/g) || []).length;
    
    // Check if JSON parsing failed even though braces match (indicates truncated field value)
    let jsonParseFailed = false;
    if (hasOpeningBrace && hasClosingBrace && openingBraceCount === closingBraceCount && !parsed) {
      try {
        JSON.parse(jsonText);
      } catch (e) {
        jsonParseFailed = true; // Braces match but JSON is invalid - likely truncated field
      }
    }
    
    // Run extraction if: missing closing brace OR braces match but JSON is invalid
    if (!parsed && ((hasOpeningBrace && !hasClosingBrace && openingBraceCount > closingBraceCount) || jsonParseFailed)) {
      console.warn(`⚠️ Response appears truncated for ${targetLanguage} (${openingBraceCount} opening braces, ${closingBraceCount} closing braces)`);
      console.warn(`Attempting to extract partial data and complete JSON structure...`);
      
      try {
        // Try to extract fields from truncated JSON using regex
        const extractFieldFromTruncated = (fieldName: string): string | null => {
          // Try to find the field value, handling escaped quotes
          const fieldPattern = new RegExp(`"${fieldName}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g');
          let match = fieldPattern.exec(response);
          if (match && match[1]) {
            return match[1]
              .replace(/\\"/g, '"')
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '\r')
              .replace(/\\t/g, '\t')
              .replace(/\\\\/g, '\\');
          }
          
          // For content field, try a more lenient approach (might be very long and truncated)
          if (fieldName === 'content') {
            const contentKey = '"content"';
            const contentStart = response.indexOf(contentKey);
            if (contentStart !== -1) {
              // Find the colon after "content"
              const colonIndex = response.indexOf(':', contentStart + contentKey.length);
              if (colonIndex !== -1) {
                // Skip whitespace after colon
                let quoteStart = colonIndex + 1;
                while (quoteStart < response.length && /\s/.test(response[quoteStart])) {
                  quoteStart++;
                }
                // If we found an opening quote, extract the content
                if (response[quoteStart] === '"') {
                  // Try to find the closing quote, handling escaped quotes
                  let quoteEnd = quoteStart + 1;
                  let escaped = false;
                  let foundClosingQuote = false;
                  
                  while (quoteEnd < response.length) {
                    if (response[quoteEnd] === '\\' && !escaped) {
                      escaped = true;
                      quoteEnd++;
                      continue;
                    }
                    if (response[quoteEnd] === '"' && !escaped) {
                      foundClosingQuote = true;
                      break;
                    }
                    escaped = false;
                    quoteEnd++;
                  }
                  
                  // Extract content (either complete or truncated)
                  const contentValue = response.substring(quoteStart + 1, foundClosingQuote ? quoteEnd : response.length);
                  
                  // Unescape the content (handles Polish characters and special chars)
                  let content = contentValue
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, '\n')
                    .replace(/\\r/g, '\r')
                    .replace(/\\t/g, '\t')
                    .replace(/\\\\/g, '\\')
                    .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16))); // Handle Unicode escapes
                  
                  if (!foundClosingQuote) {
                    console.warn(`⚠️ Content field appears truncated (no closing quote found)`);
                  }
                  
                  return content;
                }
              }
            }
          }
          return null;
        };
        
        const extractedTitle = extractFieldFromTruncated('title');
        const extractedSlug = extractFieldFromTruncated('slug');
        const extractedContent = extractFieldFromTruncated('content');
        const extractedExcerpt = extractFieldFromTruncated('excerpt');
        const extractedMetaTitle = extractFieldFromTruncated('metaTitle');
        const extractedMetaDesc = extractFieldFromTruncated('metaDescription');
        
        // If we got at least title and some content, use it (even if truncated)
        if (extractedTitle && extractedContent) {
          parsed = {
            title: extractedTitle,
            slug: extractedSlug || generateSlug(extractedTitle),
            content: extractedContent, // Use truncated content - better than nothing
            excerpt: extractedExcerpt || originalJsonData.excerpt,
            metaTitle: extractedMetaTitle || `${extractedTitle} | ${BRAND_NAME}`,
            metaDescription: extractedMetaDesc || originalJsonData.metaDescription,
          };
          console.log(`✓ Successfully extracted partial data from truncated response for ${targetLanguage}`);
          console.warn(`⚠️ Content may be incomplete (response was truncated at ${response.length} chars)`);
        }
      } catch (truncatedError: any) {
        console.warn(`Truncated response extraction failed: ${truncatedError.message}`);
      }
    }
    
    // Strategy 7: Last resort - try parsing the entire cleaned response
    if (!parsed) {
      console.log(`Trying direct parse of cleaned response for ${targetLanguage}...`);
      try {
        parsed = JSON.parse(jsonText);
        console.log(`✓ Successfully parsed JSON for ${targetLanguage} using direct parse`);
      } catch (parseError: any) {
        console.error(`❌ All JSON extraction strategies failed for ${targetLanguage}`);
        console.error(`Response length: ${response.length}`);
        console.error(`Response first 5000 chars: ${response.substring(0, 5000)}`);
        console.error(`Response last 5000 chars: ${response.substring(Math.max(0, response.length - 5000))}`);
        console.error(`Cleaned text first 5000 chars: ${jsonText.substring(0, 5000)}`);
        console.error(`Cleaned text last 5000 chars: ${jsonText.substring(Math.max(0, jsonText.length - 5000))}`);
        
        // Log detailed response for manual inspection (truncated to avoid log limits)
        console.error(`=== RESPONSE ANALYSIS FOR ${targetLanguage} ===`);
        console.error(`Response length: ${response.length}`);
        console.error(`First 500 chars: ${response.substring(0, 500)}`);
        console.error(`Last 500 chars: ${response.substring(Math.max(0, response.length - 500))}`);
        console.error(`Has opening brace: ${response.includes('{')}`);
        console.error(`Has closing brace: ${response.includes('}')}`);
        console.error(`Brace count: ${openingBraceCount} opening, ${closingBraceCount} closing`);
        
        // Try to find where the JSON might be
        const firstBrace = response.indexOf('{');
        const lastBrace = response.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          console.error(`First brace at position: ${firstBrace}`);
          console.error(`Last brace at position: ${lastBrace}`);
          console.error(`Text before first brace: ${response.substring(0, Math.min(200, firstBrace))}`);
          console.error(`Text after last brace: ${response.substring(lastBrace + 1, Math.min(lastBrace + 201, response.length))}`);
        }
        console.error(`=== END RESPONSE ANALYSIS ===`);
        
        // Save raw response to help debug - try to extract partial data
        const partialMatch = response.match(/"title"\s*:\s*"([^"]+)"/);
        if (partialMatch) {
          console.warn(`Found partial title in response: ${partialMatch[1]}`);
        }
        
        // Include response snippet in error for debugging
        const responseSnippet = response.length > 1000 
          ? `${response.substring(0, 500)}... [${response.length - 1000} chars omitted] ...${response.substring(response.length - 500)}`
          : response;
        
        throw new Error(`Could not extract valid JSON from Claude Haiku response. Response length: ${response.length} chars. Opening braces: ${openingBraceCount}, Closing braces: ${closingBraceCount}. Response snippet: ${responseSnippet.substring(0, 1000)}`);
      }
    }
    
    // Strategy 8: If still no luck, try to extract fields individually (handles other edge cases)
    if (!parsed) {
      console.log(`Trying individual field extraction for ${targetLanguage}...`);
      try {
        // Extract each field by finding the key and then the value
        const extractField = (fieldName: string): string | null => {
          const fieldIndex = response.indexOf(`"${fieldName}"`);
          if (fieldIndex === -1) return null;
          
          const colonIndex = response.indexOf(':', fieldIndex);
          if (colonIndex === -1) return null;
          
          // Skip whitespace after colon
          let valueStart = colonIndex + 1;
          while (valueStart < response.length && /\s/.test(response[valueStart])) {
            valueStart++;
          }
          
          // If value starts with quote, extract string value
          if (response[valueStart] === '"') {
            let valueEnd = valueStart + 1;
            let escaped = false;
            while (valueEnd < response.length) {
              if (response[valueEnd] === '\\' && !escaped) {
                escaped = true;
                valueEnd++;
                continue;
              }
              if (response[valueEnd] === '"' && !escaped) {
                const rawValue = response.substring(valueStart + 1, valueEnd);
                // Unescape common sequences and Unicode (for Polish characters)
                return rawValue
                  .replace(/\\"/g, '"')
                  .replace(/\\n/g, '\n')
                  .replace(/\\r/g, '\r')
                  .replace(/\\t/g, '\t')
                  .replace(/\\\\/g, '\\')
                  .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
              }
              escaped = false;
              valueEnd++;
            }
            // If we reached the end without finding closing quote, the response is truncated
            // Return what we have (especially important for long content fields)
            if (valueEnd >= response.length) {
              const rawValue = response.substring(valueStart + 1);
              return rawValue
                .replace(/\\"/g, '"')
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\t/g, '\t')
                .replace(/\\\\/g, '\\')
                .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16))); // Handle Unicode escapes (Polish chars)
            }
          }
          return null;
        };
        
        const extractedTitle = extractField('title');
        const extractedSlug = extractField('slug');
        const extractedContent = extractField('content');
        const extractedExcerpt = extractField('excerpt');
        const extractedMetaTitle = extractField('metaTitle');
        const extractedMetaDesc = extractField('metaDescription');
        
        if (extractedTitle || extractedContent) {
          parsed = {
            title: extractedTitle || originalJsonData.title,
            slug: extractedSlug || (extractedTitle ? generateSlug(extractedTitle) : articleSlug),
            content: extractedContent || originalJsonData.content,
            excerpt: extractedExcerpt || originalJsonData.excerpt,
            metaTitle: extractedMetaTitle || originalJsonData.metaTitle,
            metaDescription: extractedMetaDesc || originalJsonData.metaDescription,
          };
          console.log(`✓ Successfully extracted fields individually for ${targetLanguage}`);
        }
      } catch (extractError: any) {
        console.warn(`Individual field extraction failed: ${extractError.message}`);
      }
    }
    
    if (!parsed) {
      throw new Error("All JSON extraction strategies failed");
    }
    
    // Ensure content is a string and clean it
    if (typeof parsed.content !== 'string') {
      parsed.content = String(parsed.content || '');
    }
    
    // Validate content completeness - check if content is suspiciously short
    // Note: originalContentLength was already defined above, but we'll use it again for clarity
    const translatedContentLength = parsed.content.length;
    const lengthRatio = translatedContentLength / originalContentLength;
    
    console.log(`[generateTranslation] Parsed content length check: original=${originalContentLength}, translated=${translatedContentLength}, ratio=${lengthRatio.toFixed(3)}`);
    
    // More aggressive validation: if translated content is less than 50% of original, it's incomplete
    // For articles > 5000 chars, require at least 50% length
    // For articles > 15000 chars, require at least 60% length (longer articles need more complete translation)
    const minRatio = originalContentLength > 15000 ? 0.6 : (originalContentLength > 5000 ? 0.5 : 0.4);
    
    if (lengthRatio < minRatio && originalContentLength > 5000) {
      console.error(`[generateTranslation] ⚠️ Translated content is suspiciously short (${translatedContentLength} vs ${originalContentLength} chars, ratio: ${lengthRatio.toFixed(3)}, required: ${minRatio})`);
      throw new Error(`Translation appears incomplete: translated content is only ${translatedContentLength} characters (${Math.round(lengthRatio * 100)}%) of original ${originalContentLength} characters. Minimum required: ${Math.round(minRatio * 100)}%. This suggests the translation was truncated.`);
    }
    
    // Clean excerpt and metaDescription: remove any JSON artifacts
    if (parsed.excerpt) {
      parsed.excerpt = String(parsed.excerpt).replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    }
    if (parsed.metaDescription) {
      parsed.metaDescription = String(parsed.metaDescription).replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    }

    // Validate and fix meta lengths
    let metaTitle = parsed.metaTitle || originalJsonData.metaTitle;
    let metaDescription = parsed.metaDescription || originalJsonData.metaDescription;
    
    // Ensure brand name is present in meta title
    if (!metaTitle.includes(BRAND_NAME)) {
      metaTitle = `${metaTitle} | ${BRAND_NAME}`;
    }
    
    // Truncate if too long
    if (metaTitle.length > 70) {
      metaTitle = metaTitle.substring(0, 67) + "...";
    }
    if (metaDescription.length > 160) {
      metaDescription = metaDescription.substring(0, 157) + "...";
    }

    // Ensure links are properly localized and fix any malformed links
    let content = parsed.content || originalJsonData.content;
    
    // Get translated service slugs for the target language
    const servicesSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.services || "services";
    const quoteSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.quote || "quote";
    const cncSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["cnc-machining"] || "cnc-machining";
    const sheetMetalSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["sheet-metal"] || "sheet-metal";
    const injectionMoldingSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["injection-molding"] || "injection-molding";
    
    // First, fix malformed links where HTML attributes got into the href value
    // Pattern: href="/path%20rel=noopener%20noreferrer%20target=" → href="/path"
    // This handles cases where AI incorrectly included attributes in the href
    content = content.replace(/href="([^"]*?)(?:\s*%20)?(?:rel|target|noreferrer|noopener)[^"]*"/gi, (match) => {
      // Extract just the URL part (before any attributes)
      const urlMatch = match.match(/href="([^"\s%]+)/);
      if (urlMatch && urlMatch[1]) {
        return `href="${urlMatch[1]}"`;
      }
      return match;
    });
    
    // Fix malformed links with quotes inside href (e.g., href=""path"" → href="/path")
    content = content.replace(/href="+([^"]+)"+/g, 'href="$1"');
    
    // Now replace English paths with translated paths
    // Use a more robust regex that handles various formats
    content = content.replace(/href="\/en\/quote"/g, `href="/${langCode}/${quoteSlug}"`);
    content = content.replace(/href="\/en\/services\/cnc-machining"/g, `href="/${langCode}/${servicesSlug}/${cncSlug}"`);
    content = content.replace(/href="\/en\/services\/sheet-metal"/g, `href="/${langCode}/${servicesSlug}/${sheetMetalSlug}"`);
    content = content.replace(/href="\/en\/services\/injection-molding"/g, `href="/${langCode}/${servicesSlug}/${injectionMoldingSlug}"`);
    content = content.replace(/href="\/en\/services"/g, `href="/${langCode}/${servicesSlug}"`);
    
    // CRITICAL: Replace article links using actual database slugs, not AI-generated ones
    if (articleSlugMapping && Object.keys(articleSlugMapping).length > 0) {
      console.log(`[LINK REPLACEMENT] Starting link replacement for ${langCode} with mapping:`, articleSlugMapping);
      
      // First, replace /en/blog/english-slug patterns (from original content)
      for (const [englishSlug, translatedSlug] of Object.entries(articleSlugMapping)) {
        // Escape special regex characters in slugs
        const escapedEnglishSlug = englishSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedTranslatedSlug = translatedSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Pattern 1: Replace /en/blog/english-slug with /lang/blog/translated-slug
        const pattern1 = new RegExp(`href="/en/blog/${escapedEnglishSlug}"`, 'gi');
        const matches1 = content.match(pattern1);
        if (matches1) {
          content = content.replace(pattern1, `href="/${langCode}/blog/${translatedSlug}"`);
          console.log(`[LINK REPLACEMENT] Pattern 1: Replaced ${matches1.length} occurrence(s) of /en/blog/${englishSlug} -> /${langCode}/blog/${translatedSlug}`);
        }
        
        // Pattern 2: Replace /lang/blog/english-slug (if AI didn't translate the slug) with /lang/blog/translated-slug
        const pattern2 = new RegExp(`href="/${langCode}/blog/${escapedEnglishSlug}"`, 'gi');
        const matches2 = content.match(pattern2);
        if (matches2) {
          content = content.replace(pattern2, `href="/${langCode}/blog/${translatedSlug}"`);
          console.log(`[LINK REPLACEMENT] Pattern 2: Replaced ${matches2.length} occurrence(s) of /${langCode}/blog/${englishSlug} -> /${langCode}/blog/${translatedSlug}`);
        }
        
        // Pattern 3: Replace any /lang/blog/wrong-slug that should be /lang/blog/correct-slug
        // This handles cases where AI generated a slug that doesn't match the database
        // We check if the slug in the link is NOT the correct translated slug
        const pattern3 = new RegExp(`href="/${langCode}/blog/([^"]+)"`, 'g');
        const allMatches = Array.from(content.matchAll(pattern3));
        for (const match of allMatches) {
          const slugInLink = match[1];
          // If this slug doesn't match the correct translated slug, but we know what it should be
          if (slugInLink !== translatedSlug && slugInLink !== englishSlug) {
            // Check if this slug exists in database and has the same translation_id as our English article
            // This is a more complex check - we'll do it in the second pass below
          }
        }
      }
      
      // Second pass: Find any /lang/blog/slug links and verify they're correct
      // This handles cases where AI translated the slug but it doesn't match the database
      const blogLinkPattern = new RegExp(`href="/${langCode}/blog/([^"]+)"`, 'g');
      const allBlogLinks = Array.from(content.matchAll(blogLinkPattern));
      
      console.log(`[LINK REPLACEMENT] Second pass: Found ${allBlogLinks.length} blog links in translated content`);
      
      for (const match of allBlogLinks) {
        const slugInLink = match[1];
        const fullMatch = match[0];
        
        // Check if this slug matches any of our known translated slugs
        const isKnownSlug = Object.values(articleSlugMapping).includes(slugInLink);
        
        if (isKnownSlug) {
          console.log(`[LINK REPLACEMENT] ✓ Link with slug "${slugInLink}" is correct (in mapping)`);
          continue; // This slug is correct, skip
        }
        
        // If the slug doesn't match any known translated slug, it might be AI-generated and wrong
        console.log(`[LINK REPLACEMENT] ⚠️ Found potentially incorrect slug in link: "${slugInLink}"`);
        
        // Try to find this slug in the database and get its translation_id
        // Then check if that translation_id matches any English article we're linking to
        try {
          const { data: articleWithSlug, error: slugLookupError } = await supabase
            .from("articles")
            .select("translation_id, slug, language, title")
            .eq("language", langCode)
            .eq("slug", slugInLink)
            .single();
          
          if (slugLookupError || !articleWithSlug) {
            // This slug doesn't exist in database - it's definitely wrong
            console.warn(`[LINK REPLACEMENT] Slug "${slugInLink}" does not exist in database for language ${langCode}`);
            
            // Try to find which English article this might correspond to
            // We'll look for English articles that have translations with similar slugs
            // This is a best-effort fix
            for (const [englishSlug, correctTranslatedSlug] of Object.entries(articleSlugMapping)) {
              // If the incorrect slug is similar to the correct one, or if we can't find it,
              // replace it with the correct one
              if (slugInLink !== correctTranslatedSlug && slugInLink !== englishSlug) {
                // Check if this might be the right article by looking at the English slug
                // This is a heuristic - if the slug is completely different, we can't be sure
                // For now, we'll be conservative and only fix if we're very confident
                console.log(`[LINK REPLACEMENT] Could not verify slug "${slugInLink}" - keeping as is (might be a different article)`);
              }
            }
            continue;
          }
          
          // Found the article with this slug
          if (articleWithSlug.translation_id) {
            // Find the English article with this translation_id
            const { data: englishArticle, error: englishError } = await supabase
              .from("articles")
              .select("slug, title")
              .eq("translation_id", articleWithSlug.translation_id)
              .eq("language", "en")
              .single();
            
            if (englishError || !englishArticle) {
              console.warn(`[LINK REPLACEMENT] Could not find English article for translation_id ${articleWithSlug.translation_id}`);
              continue;
            }
            
            // If this English article is in our mapping, check if the slug is correct
            if (articleSlugMapping[englishArticle.slug]) {
              const correctSlug = articleSlugMapping[englishArticle.slug];
              if (correctSlug !== slugInLink) {
                console.log(`[LINK REPLACEMENT] ✓ Fixing incorrect slug: "${slugInLink}" -> "${correctSlug}" (English: "${englishArticle.title}")`);
                const escapedSlugInLink = slugInLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                content = content.replace(
                  new RegExp(`href="/${langCode}/blog/${escapedSlugInLink}"`, 'g'),
                  `href="/${langCode}/blog/${correctSlug}"`
                );
              } else {
                console.log(`[LINK REPLACEMENT] ✓ Slug "${slugInLink}" is correct (matches database)`);
              }
            } else {
              console.log(`[LINK REPLACEMENT] English article "${englishArticle.slug}" not in mapping - might be a different article`);
            }
          }
        } catch (lookupError: any) {
          // If lookup fails, log but continue
          console.warn(`[LINK REPLACEMENT] Exception verifying slug "${slugInLink}":`, lookupError.message);
        }
      }
      
      console.log(`[LINK REPLACEMENT] Completed link replacement for ${langCode}`);
    } else {
      // Fallback: if no mapping provided, just change language prefix (old behavior)
      // But this may result in incorrect slugs
      content = content.replace(/href="\/en\/blog\//g, `href="/${langCode}/blog/`);
    }
    
    // Ensure proper spacing around <a> tags to prevent text from sticking together
    // But don't add spaces inside table cells - only outside tables
    content = content.replace(/([^\s>])(<a\s+href)/g, (match, p1, p2, offset, string) => {
      // Check if we're inside a table cell - if so, don't add space
      const beforeMatch = string.substring(0, offset);
      const lastTd = beforeMatch.lastIndexOf('<td');
      const lastTh = beforeMatch.lastIndexOf('<th');
      const lastTdClose = beforeMatch.lastIndexOf('</td>');
      const lastThClose = beforeMatch.lastIndexOf('</th>');
      const inTableCell = (lastTd > lastTdClose || lastTh > lastThClose);
      // Also check if we're inside other tags that shouldn't have spaces
      const lastP = beforeMatch.lastIndexOf('<p');
      const lastPClose = beforeMatch.lastIndexOf('</p>');
      const inParagraph = (lastP > lastPClose && lastP !== -1);
      return (inTableCell || inParagraph) ? match : `${p1} ${p2}`;
    });
    content = content.replace(/(<\/a>)([^\s<])/g, (match, p1, p2, offset, string) => {
      // Check if we're inside a table cell - if so, don't add space
      const beforeMatch = string.substring(0, offset);
      const lastTd = beforeMatch.lastIndexOf('<td');
      const lastTh = beforeMatch.lastIndexOf('<th');
      const lastTdClose = beforeMatch.lastIndexOf('</td>');
      const lastThClose = beforeMatch.lastIndexOf('</th>');
      const inTableCell = (lastTd > lastTdClose || lastTh > lastThClose);
      // Also check if we're inside other tags that shouldn't have spaces
      const lastP = beforeMatch.lastIndexOf('<p');
      const lastPClose = beforeMatch.lastIndexOf('</p>');
      const inParagraph = (lastP > lastPClose && lastP !== -1);
      // Don't add space if next char is punctuation or closing tag
      if (p2 === '.' || p2 === ',' || p2 === '!' || p2 === '?' || p2 === ';' || p2 === ':' || p2 === '<') {
        return match;
      }
      return (inTableCell || inParagraph) ? match : `${p1} ${p2}`;
    });
    
    // Fix broken table structures - ensure all table tags are properly closed
    // Fix unclosed table tags
    content = content.replace(/<table([^>]*)>/gi, '<table$1>');
    content = content.replace(/<\/table>/gi, '</table>');
    // Ensure proper table structure
    content = content.replace(/<table([^>]*)>(?!\s*<thead|\s*<tbody)/gi, '<table$1><tbody>');
    content = content.replace(/(<\/tr>)(?!\s*<\/tbody>|\s*<tr|\s*<\/table>)/gi, '$1');
    // Fix tables missing closing tags
    const tableCount = (content.match(/<table/gi) || []).length;
    const tableCloseCount = (content.match(/<\/table>/gi) || []).length;
    if (tableCount > tableCloseCount) {
      // Add missing closing table tags at the end of content
      for (let i = 0; i < tableCount - tableCloseCount; i++) {
        content += '</tbody></table>';
      }
    }

    // Generate slug from translated title if not provided
    let translatedSlug = parsed.slug;
    if (!translatedSlug && parsed.title) {
      translatedSlug = generateSlug(parsed.title);
    } else if (!translatedSlug) {
      // Fallback to English slug if translation fails
      translatedSlug = articleSlug;
    }

    return {
      title: parsed.title || originalJsonData.title,
      slug: translatedSlug,
      content: content,
      excerpt: parsed.excerpt || originalJsonData.excerpt,
      metaTitle: metaTitle,
      metaDescription: metaDescription,
    };
  } catch (error) {
    console.error(`Failed to parse translation for ${targetLanguage}:`, error);
    console.error(`This translation will NOT be saved - throwing error to prevent English content being stored.`);
    
    // DO NOT use fallback - throw error instead to prevent saving English content
    // The retry logic or manual re-translation will handle this
    throw new Error(`Translation parsing failed for ${targetLanguage}: ${error.message}. The response may have been truncated.`);
  }
}

/**
 * Submit URLs to IndexNow
 */
async function submitToIndexNow(urls: string[]): Promise<boolean> {
  if (!indexNowKey) {
    console.warn("IndexNow key not configured");
    return false;
  }

  try {
    const endpoint = "https://www.bing.com/indexnow";
    const host = new URL(urls[0]).hostname;

    const body = {
      host: host,
      key: indexNowKey,
      keyLocation: `https://${host}/indexnow_key.txt`,
      urlList: urls,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    console.log(`IndexNow submission status: ${response.status} for ${urls.length} URLs`);
    return response.ok;
  } catch (error) {
    console.error("IndexNow submission error:", error);
    return false;
  }
}

// Sitemap regeneration removed - user must manually trigger via dashboard button

/**
 * Delay helper to avoid API rate limiting
 * Claude Haiku API has rate limits, so we add delays between translation requests
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff for API calls
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a rate limit error (429)
      if (error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
        const waitTime = baseDelay * Math.pow(2, attempt); // Exponential backoff
        console.log(`Rate limited. Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}...`);
        await delay(waitTime);
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Main handler - Translates an English article to all languages
 * Expects: { article_id: "uuid" }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { article_id, target_languages }: TranslateRequest = await req.json();

    if (!article_id) {
      return new Response(
        JSON.stringify({ error: "article_id is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // 1. Fetch the English master article
    const { data: masterArticle, error: fetchError } = await supabase
      .from("articles")
      .select("*")
      .eq("id", article_id)
      .eq("language", "en")
      .single();

    if (fetchError || !masterArticle) {
      return new Response(
        JSON.stringify({ error: "English article not found", details: fetchError?.message }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    console.log(`Translating article: ${masterArticle.title}`);
    console.log(`Original English slug: ${masterArticle.slug}`);

    // 2. Prepare original data for translation
    const originalJsonData = {
      title: masterArticle.title,
      content: masterArticle.content,
      excerpt: masterArticle.excerpt || "",
      metaTitle: masterArticle.meta_title || masterArticle.title,
      metaDescription: masterArticle.meta_description || "",
    };

    const thoughtSignature = `Article about ${masterArticle.title} by ${BRAND_NAME} - Technical manufacturing focus`;

    // 3. Filter languages if target_languages is specified
    const languagesToTranslate = target_languages && target_languages.length > 0
      ? LANGUAGES.filter(l => target_languages.includes(l.code))
      : LANGUAGES;
    
    console.log(`Translating to ${languagesToTranslate.length} language(s): ${languagesToTranslate.map(l => l.code).join(', ')}`);

    // 4. Build article slug mapping BEFORE translation (for all target languages)
    // This ensures we have the correct translated slugs for article links
    const articleSlugMappings: Record<string, Record<string, string>> = {};
    for (const lang of languagesToTranslate) {
      const mapping = await buildArticleSlugMapping(masterArticle.content, lang.code);
      articleSlugMappings[lang.code] = mapping;
      console.log(`Built slug mapping for ${lang.code}: ${Object.keys(mapping).length} articles`);
    }

    // 5. Generate translations with rate limiting protection
    const translations: Record<string, any> = {};
    const articleUrls: string[] = [`${siteUrl}/en/blog/${masterArticle.slug}`];
    
    // Delay between translations to avoid rate limiting
    // Claude Haiku has higher rate limits, so we can use shorter delays
    // 3 seconds should be safe for Claude Haiku API
    const DELAY_BETWEEN_TRANSLATIONS = 3000;

    for (let i = 0; i < languagesToTranslate.length; i++) {
      const lang = languagesToTranslate[i];
      
      try {
        console.log(`Translating to ${lang.name} (${lang.code})... [${i + 1}/${languagesToTranslate.length}]`);
        
        // Check if translation already exists
        const { data: existingTranslation } = await supabase
          .from("articles")
          .select("id, title, slug")
          .eq("translation_id", masterArticle.translation_id)
          .eq("language", lang.code)
          .single();
        
        if (existingTranslation) {
          console.log(`Translation for ${lang.code} already exists, skipping...`);
          translations[lang.code] = {
            success: true,
            article_id: existingTranslation.id,
            title: existingTranslation.title,
            slug: existingTranslation.slug,
            url: `${siteUrl}/${lang.code}/blog/${existingTranslation.slug}`,
            skipped: true,
          };
          articleUrls.push(`${siteUrl}/${lang.code}/blog/${existingTranslation.slug}`);
          continue; // Skip to next language
        }
        
        // Use retry wrapper to handle rate limits with exponential backoff
        // Reduced retries to return faster with actual error message
        // Pass the article slug mapping for this language to ensure correct links
        const translation = await withRetry(
          () => generateTranslation(
            originalJsonData,
            lang.name,
            lang.code,
            masterArticle.slug, // Pass original slug for reference (will be translated)
            thoughtSignature,
            articleSlugMappings[lang.code] // Pass the slug mapping for this language
          ),
          2, // Max 2 retries to return faster with error
          5000 // Base delay of 5 seconds for retries
        );

        // Validate translation result
        if (!translation || !translation.title || !translation.content) {
          throw new Error(`Invalid translation response: missing required fields`);
        }

        // Use translated slug from the translation result
        const translatedSlug = translation.slug || generateSlug(translation.title);
        
        console.log(`Inserting translation for ${lang.code} with slug: ${translatedSlug}`);

        const { data: translatedArticle, error: transError } = await supabase
          .from("articles")
          .insert([
            {
              title: translation.title, // Translated title
              slug: translatedSlug, // Translated slug
              content: translation.content,
              excerpt: translation.excerpt,
              language: lang.code,
              status: "published",
              meta_title: translation.metaTitle, // Translated meta title
              meta_description: translation.metaDescription, // Translated meta description
              translation_id: masterArticle.translation_id,
              // Copy featured image from master article (same S3 URL, no duplication)
              featured_image: masterArticle.featured_image,
              featured_image_alt: masterArticle.featured_image_alt,
            },
          ])
          .select()
          .single();

        if (transError) {
          console.error(`Translation insert error for ${lang.code}:`, transError);
          console.error(`Error details:`, JSON.stringify(transError, null, 2));
          
          // Check if it's a duplicate key error (translation already exists)
          if (transError.code === '23505' || transError.message?.includes('duplicate') || transError.message?.includes('unique')) {
            console.log(`Translation for ${lang.code} already exists (duplicate key), fetching existing...`);
            const { data: existing } = await supabase
              .from("articles")
              .select("id, title, slug")
              .eq("translation_id", masterArticle.translation_id)
              .eq("language", lang.code)
              .single();
            
            if (existing) {
              translations[lang.code] = {
                success: true,
                article_id: existing.id,
                title: existing.title,
                slug: existing.slug,
                url: `${siteUrl}/${lang.code}/blog/${existing.slug}`,
                skipped: true,
              };
              articleUrls.push(`${siteUrl}/${lang.code}/blog/${existing.slug}`);
              console.log(`✓ ${lang.name} translation found (already existed)`);
              continue;
            }
          }
          
          translations[lang.code] = {
            success: false,
            error: transError.message || 'Database insertion failed',
            errorCode: transError.code,
          };
        } else if (!translatedArticle) {
          console.error(`Translation insert returned no data for ${lang.code}`);
          translations[lang.code] = {
            success: false,
            error: 'Database insertion returned no data',
          };
        } else {
          translations[lang.code] = {
            success: true,
            article_id: translatedArticle.id,
            title: translation.title,
            metaTitle: translation.metaTitle,
            slug: translatedSlug,
            url: `${siteUrl}/${lang.code}/blog/${translatedSlug}`,
          };
          articleUrls.push(`${siteUrl}/${lang.code}/blog/${translatedSlug}`);
          console.log(`✓ ${lang.name} translation complete and saved`);
        }
      } catch (error: any) {
        console.error(`Translation error for ${lang.code}:`, error);
        console.error(`Error stack:`, error.stack);
        translations[lang.code] = {
          success: false,
          error: error.message || 'Unknown error occurred',
          errorType: error.name || 'Error',
        };
      }
      
      // Add delay between translations to avoid hitting rate limits
      // Skip delay after the last translation
      if (i < languagesToTranslate.length - 1) {
        console.log(`Waiting ${DELAY_BETWEEN_TRANSLATIONS}ms before next translation...`);
        await delay(DELAY_BETWEEN_TRANSLATIONS);
      }
    }

    // 4. Update master article status to published (only if translating all languages)
    if (!target_languages || target_languages.length === 0) {
      await supabase
        .from("articles")
        .update({ status: "published" })
        .eq("id", article_id);
    }

    // 5. Submit to IndexNow
    const indexNowResult = await submitToIndexNow(articleUrls);

    // 6. Update generation log (sitemap is NOT auto-regenerated - user must click button)
    const { data: existingLog } = await supabase
      .from("article_generation_logs")
      .select("*")
      .contains("summary_data", { master_article_id: article_id })
      .single();

    if (existingLog) {
      const updatedSummary = {
        ...existingLog.summary_data,
        translations,
        translations_pending: false,
        indexing: { indexnow: indexNowResult },
        article_urls: articleUrls,
        translated_at: new Date().toISOString(),
      };

      await supabase
        .from("article_generation_logs")
        .update({ summary_data: updatedSummary })
        .eq("id", existingLog.id);
    }

    const successfulTranslations = Object.values(translations).filter((t: any) => t.success).length;
    const failedTranslations = Object.values(translations).filter((t: any) => !t.success);
    
    console.log(`Translation complete. ${successfulTranslations}/${languagesToTranslate.length} translations successful.`);
    if (failedTranslations.length > 0) {
      console.error(`Failed translations:`, failedTranslations.map((t: any) => ({
        language: Object.keys(translations).find(key => translations[key] === t),
        error: t.error
      })));
    }

    // If single language translation and it failed, return error status
    if (target_languages && target_languages.length === 1 && failedTranslations.length > 0) {
      const failedLang = failedTranslations[0] as any;
    return new Response(
      JSON.stringify({
          success: false,
          error: failedLang.error || 'Translation failed',
          errorType: failedLang.errorType,
          errorCode: failedLang.errorCode,
          message: `Failed to translate to ${target_languages[0]}: ${failedLang.error || 'Unknown error'}`,
          master_article_id: article_id,
          details: translations,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Build response with error details if any translations failed
    const responseBody: any = {
      success: successfulTranslations > 0,
      message: successfulTranslations > 0 
        ? `Article translated to ${successfulTranslations} language(s)${!target_languages || target_languages.length === 0 ? ' and published' : ''}`
        : `All ${languagesToTranslate.length} translation(s) failed. This may be due to Claude API rate limiting.`,
        master_article_id: article_id,
        slug: masterArticle.slug, // Original English slug
        translations: successfulTranslations,
        total_languages: languagesToTranslate.length,
      failed_count: failedTranslations.length,
        indexing: { indexnow: indexNowResult },
        article_urls: articleUrls,
        details: translations,
    };

    // Add error field for failed responses
    if (successfulTranslations === 0) {
      const firstFailure = failedTranslations[0] as any;
      responseBody.error = firstFailure?.error || 'Translation failed. Please wait a few minutes and try again.';
    }

    return new Response(
      JSON.stringify(responseBody),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: successfulTranslations > 0 ? 200 : 500,
      }
    );
  } catch (error: any) {
    console.error("Error in translate-article:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
