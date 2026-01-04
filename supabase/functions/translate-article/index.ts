import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";
const indexNowKey = Deno.env.get("INDEXNOW_KEY") || "";

// Brand name - NEVER translate or alter this
const BRAND_NAME = "Microns Hub";

// Bump this when deploying to confirm the runtime is executing the expected code
const TRANSLATE_ARTICLE_FN_VERSION = "2026-01-04.gemini-2.5-flash.timeout-fix";

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

interface TranslateRequest {
  article_id: string;
  target_languages?: string[];
}

/**
 * Generate translation using Google Gemini 2.5 Flash - ONE PASS per language
 */
async function generateWithGemini(
  prompt: string
): Promise<string> {
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const model = "gemini-2.0-flash-exp";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  const startTime = Date.now();
  console.log(`[Gemini] Starting API request`);

  try {
    // Add timeout to fetch (60 seconds max for Gemini API call)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data: GeminiResponse = await response.json();

    if (data.error) {
      throw new Error(`Gemini API error: ${data.error.message}`);
    }

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error("No response from Gemini API");
    }

    const candidate = data.candidates[0];
    if (!candidate.content?.parts?.[0]?.text) {
      throw new Error("Empty response from Gemini API");
    }

    const textContent = candidate.content.parts[0].text;
    const elapsedTime = Date.now() - startTime;
    console.log(`[Gemini] Completed in ${elapsedTime}ms, finishReason: ${candidate.finishReason || "COMPLETE"}`);

    if (candidate.finishReason === "MAX_TOKENS") {
      console.warn(`[Gemini] ⚠️ Response may be truncated (MAX_TOKENS)`);
    }

    return textContent;
  } catch (error: any) {
    const elapsedTime = Date.now() - startTime;
    if (error.name === 'AbortError') {
      console.error(`[Gemini] Request timeout after ${elapsedTime}ms`);
      throw new Error(`Gemini API request timed out after 60 seconds`);
    }
    console.error(`[Gemini] Error after ${elapsedTime}ms:`, error.message);
    throw error;
  }
}

/**
 * Generate slug from title (URL-friendly format)
 */
function generateSlug(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

/**
 * Build article slug mapping for a specific language
 * Optimized: Batch queries instead of individual queries per slug
 */
async function buildArticleSlugMapping(
  content: string,
  targetLangCode: string
): Promise<Record<string, string>> {
  const slugMapping: Record<string, string> = {};
  const blogLinkPattern = /href="\/en\/blog\/([^"]+)"/g;
  const matches = Array.from(content.matchAll(blogLinkPattern));
  const englishSlugs = [...new Set(matches.map(m => m[1]))];

  if (englishSlugs.length === 0) {
    return slugMapping;
  }

  // Limit to first 20 slugs to avoid timeout (most articles don't have more)
  const slugsToProcess = englishSlugs.slice(0, 20);

  try {
    // Batch query: Get all English articles at once
    const { data: englishArticles } = await supabase
      .from("articles")
      .select("id, translation_id, slug")
      .eq("language", "en")
      .in("slug", slugsToProcess);

    if (!englishArticles || englishArticles.length === 0) {
      return slugMapping;
    }

    // Get all translation_ids
    const translationIds = englishArticles
      .filter(a => a.translation_id)
      .map(a => a.translation_id);

    if (translationIds.length === 0) {
      return slugMapping;
    }

    // Batch query: Get all translated articles at once
    const { data: translatedArticles } = await supabase
      .from("articles")
      .select("slug, translation_id")
      .eq("language", targetLangCode)
      .in("translation_id", translationIds)
      .in("status", ["published", "draft"]);

    if (!translatedArticles) {
      return slugMapping;
    }

    // Build mapping
    const translationMap = new Map(
      translatedArticles.map(t => [t.translation_id, t.slug])
    );

    for (const englishArticle of englishArticles) {
      if (englishArticle.translation_id && translationMap.has(englishArticle.translation_id)) {
        slugMapping[englishArticle.slug] = translationMap.get(englishArticle.translation_id)!;
      }
    }
  } catch (error) {
    console.error(`[SLUG MAPPING] Error building mapping:`, error);
    // Return empty mapping on error - links will use English slugs
  }

  return slugMapping;
}

/**
 * Translate article in ONE PASS with Gemini - optimized for speed
 */
async function translateArticle(
  originalData: {
    title: string;
    content: string;
    excerpt: string;
    metaTitle: string;
    metaDescription: string;
  },
  targetLanguage: string,
  langCode: string,
  articleSlug: string,
  articleSlugMapping?: Record<string, string>
): Promise<{
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
}> {
  const slugMappingNote = articleSlugMapping && Object.keys(articleSlugMapping).length > 0
    ? `\nArticle link mapping (use exact slugs):\n${Object.entries(articleSlugMapping).map(([en, trans]) => `/en/blog/${en} → /${langCode}/blog/${trans}`).join('\n')}`
    : '';

  const prompt = `Translate this manufacturing blog article into ${targetLanguage} (${langCode}).

RULES:
- Keep "${BRAND_NAME}" unchanged
- Preserve ALL HTML tags, attributes, classes, IDs exactly
- Translate ONLY text between tags
- Generate URL-friendly slug from translated title
- Return ONLY valid JSON (no markdown, no extra text)

${slugMappingNote}

Input:
{
  "title": ${JSON.stringify(originalData.title)},
  "content": ${JSON.stringify(originalData.content)},
  "excerpt": ${JSON.stringify(originalData.excerpt)},
  "metaTitle": ${JSON.stringify(originalData.metaTitle)},
  "metaDescription": ${JSON.stringify(originalData.metaDescription)}
}

Return JSON:
{
  "title": "<translated title>",
  "slug": "<url-friendly-slug>",
  "content": "<translated HTML>",
  "excerpt": "<translated excerpt>",
  "metaTitle": "<translated meta title> | ${BRAND_NAME}",
  "metaDescription": "<translated meta description>"
}`;

  const response = await generateWithGemini(prompt);

  // Parse JSON - simple extraction
  let jsonText = response.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  // Find JSON boundaries
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonText = jsonText.substring(firstBrace, lastBrace + 1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    // Try regex extraction as fallback
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error(`Failed to parse JSON from Gemini response`);
    }
  }

  // Validate and fix
  const title = parsed.title || originalData.title;
  const slug = parsed.slug || generateSlug(title);
  let content = parsed.content || originalData.content;
  const excerpt = parsed.excerpt || originalData.excerpt;
  let metaTitle = parsed.metaTitle || `${title} | ${BRAND_NAME}`;
  let metaDescription = parsed.metaDescription || originalData.metaDescription;

  // Ensure brand name in meta title
  if (!metaTitle.includes(BRAND_NAME)) {
    metaTitle = `${metaTitle} | ${BRAND_NAME}`;
  }

  // Truncate meta fields
  if (metaTitle.length > 70) metaTitle = metaTitle.substring(0, 67) + "...";
  if (metaDescription.length > 160) metaDescription = metaDescription.substring(0, 157) + "...";

  // Localize links
  const servicesSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.services || "services";
  const quoteSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.quote || "quote";
  const cncSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["cnc-machining"] || "cnc-machining";
  const sheetMetalSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["sheet-metal"] || "sheet-metal";
  const injectionMoldingSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["injection-molding"] || "injection-molding";

  content = content.replace(/href="\/en\/quote"/g, `href="/${langCode}/${quoteSlug}"`);
  content = content.replace(/href="\/en\/services\/cnc-machining"/g, `href="/${langCode}/${servicesSlug}/${cncSlug}"`);
  content = content.replace(/href="\/en\/services\/sheet-metal"/g, `href="/${langCode}/${servicesSlug}/${sheetMetalSlug}"`);
  content = content.replace(/href="\/en\/services\/injection-molding"/g, `href="/${langCode}/${servicesSlug}/${injectionMoldingSlug}"`);
  content = content.replace(/href="\/en\/services"/g, `href="/${langCode}/${servicesSlug}"`);

  // Replace article links using mapping
  if (articleSlugMapping) {
    for (const [englishSlug, translatedSlug] of Object.entries(articleSlugMapping)) {
      const escaped = englishSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(
        new RegExp(`href="/en/blog/${escaped}"`, 'gi'),
        `href="/${langCode}/blog/${translatedSlug}"`
      );
    }
  } else {
    content = content.replace(/href="\/en\/blog\//g, `href="/${langCode}/blog/`);
  }

  return {
    title,
    slug,
    content,
    excerpt,
    metaTitle,
    metaDescription,
  };
}

/**
 * Submit URLs to IndexNow
 */
async function submitToIndexNow(urls: string[]): Promise<boolean> {
  if (!indexNowKey) return false;

  try {
    const endpoint = "https://www.bing.com/indexnow";
    const host = new URL(urls[0]).hostname;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host,
        key: indexNowKey,
        keyLocation: `https://${host}/indexnow_key.txt`,
        urlList: urls,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("IndexNow submission error:", error);
    return false;
  }
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main handler - Translates an English article to all languages
 */
serve(async (req) => {
  // Handle CORS preflight immediately - must be fast
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  const functionStartTime = Date.now();
  const FUNCTION_TIMEOUT_MS = 120000; // 120 seconds (30s buffer before 150s limit)

  try {
    console.log(`[translate-article] Version: ${TRANSLATE_ARTICLE_FN_VERSION}`);
    const { article_id, target_languages }: TranslateRequest = await req.json();

    if (!article_id) {
      return new Response(
        JSON.stringify({ error: "article_id is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Fetch English article
    const { data: masterArticle, error: fetchError } = await supabase
      .from("articles")
      .select("*")
      .eq("id", article_id)
      .eq("language", "en")
      .single();

    if (fetchError || !masterArticle) {
      return new Response(
        JSON.stringify({ error: "English article not found", details: fetchError?.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    console.log(`Translating: ${masterArticle.title}`);

    // Prepare original data
    const originalData = {
      title: masterArticle.title,
      content: masterArticle.content,
      excerpt: masterArticle.excerpt || "",
      metaTitle: masterArticle.meta_title || masterArticle.title,
      metaDescription: masterArticle.meta_description || "",
    };

    // Filter languages
    const languagesToTranslate = target_languages && target_languages.length > 0
      ? LANGUAGES.filter(l => target_languages.includes(l.code))
      : LANGUAGES;

    console.log(`Translating to ${languagesToTranslate.length} language(s): ${languagesToTranslate.map(l => l.code).join(', ')}`);

    // Translate each language sequentially (one pass per language)
    const translations: Record<string, any> = {};
    const articleUrls: string[] = [`${siteUrl}/en/blog/${masterArticle.slug}`];
    const DELAY_BETWEEN_LANGUAGES = 1000; // 1 second delay (reduced from 3s)

    for (let i = 0; i < languagesToTranslate.length; i++) {
      // Check timeout
      const elapsedTime = Date.now() - functionStartTime;
      if (elapsedTime > FUNCTION_TIMEOUT_MS) {
        console.warn(`⚠️ Timeout approaching (${elapsedTime}ms), stopping`);
        throw new Error(`Translation timeout: exceeded ${FUNCTION_TIMEOUT_MS}ms`);
      }

      const lang = languagesToTranslate[i];
      console.log(`[${i + 1}/${languagesToTranslate.length}] Translating to ${lang.name} (${lang.code})...`);

      try {
        // Check if translation exists
        const { data: existingTranslation } = await supabase
          .from("articles")
          .select("id, title, slug")
          .eq("translation_id", masterArticle.translation_id)
          .eq("language", lang.code)
          .single();

        if (existingTranslation) {
          console.log(`✓ ${lang.code} already exists, skipping`);
          translations[lang.code] = {
            success: true,
            article_id: existingTranslation.id,
            title: existingTranslation.title,
            slug: existingTranslation.slug,
            url: `${siteUrl}/${lang.code}/blog/${existingTranslation.slug}`,
            skipped: true,
          };
          articleUrls.push(`${siteUrl}/${lang.code}/blog/${existingTranslation.slug}`);
          continue;
        }

        // Check timeout before slug mapping
        const elapsedBeforeMapping = Date.now() - functionStartTime;
        if (elapsedBeforeMapping > FUNCTION_TIMEOUT_MS - 30000) {
          throw new Error(`Timeout approaching before translation (${elapsedBeforeMapping}ms)`);
        }

        // Build slug mapping for this language (only if needed) - with timeout protection
        let articleSlugMapping: Record<string, string> = {};
        try {
          const mappingStartTime = Date.now();
          articleSlugMapping = await buildArticleSlugMapping(originalData.content, lang.code);
          const mappingTime = Date.now() - mappingStartTime;
          console.log(`[${lang.code}] Slug mapping completed in ${mappingTime}ms`);
        } catch (mappingError: any) {
          console.warn(`[${lang.code}] Slug mapping failed, continuing without mapping:`, mappingError.message);
          // Continue without mapping - links will use English slugs
        }

        // Check timeout before translation
        const elapsedBeforeTranslation = Date.now() - functionStartTime;
        if (elapsedBeforeTranslation > FUNCTION_TIMEOUT_MS - 30000) {
          throw new Error(`Timeout approaching before translation (${elapsedBeforeTranslation}ms)`);
        }

        // Translate in ONE PASS
        const translationStartTime = Date.now();
        const translation = await translateArticle(
          originalData,
          lang.name,
          lang.code,
          masterArticle.slug,
          articleSlugMapping
        );
        const translationTime = Date.now() - translationStartTime;
        console.log(`[${lang.code}] Translation completed in ${translationTime}ms`);

        // Save to database
        const { data: translatedArticle, error: transError } = await supabase
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
            translation_id: masterArticle.translation_id,
            featured_image: masterArticle.featured_image,
            featured_image_alt: masterArticle.featured_image_alt,
          }])
          .select()
          .single();

        if (transError) {
          // Check for duplicate
          if (transError.code === '23505') {
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
              continue;
            }
          }

          throw transError;
        }

        if (!translatedArticle) {
          throw new Error('Database insertion returned no data');
        }

        translations[lang.code] = {
          success: true,
          article_id: translatedArticle.id,
          title: translation.title,
          slug: translation.slug,
          url: `${siteUrl}/${lang.code}/blog/${translation.slug}`,
        };
        articleUrls.push(`${siteUrl}/${lang.code}/blog/${translation.slug}`);
        console.log(`✓ ${lang.name} translation complete`);

      } catch (error: any) {
        console.error(`✗ ${lang.code} translation failed:`, error.message);
        translations[lang.code] = {
          success: false,
          error: error.message || 'Unknown error',
        };
      }

      // Delay between languages (skip if approaching timeout)
      if (i < languagesToTranslate.length - 1) {
        const elapsedTime = Date.now() - functionStartTime;
        if (elapsedTime < FUNCTION_TIMEOUT_MS - 5000) {
          await delay(DELAY_BETWEEN_LANGUAGES);
        }
      }
    }

    // Update master article status
    if (!target_languages || target_languages.length === 0) {
      await supabase
        .from("articles")
        .update({ status: "published" })
        .eq("id", article_id);
    }

    // Submit to IndexNow
    const indexNowResult = await submitToIndexNow(articleUrls);

    // Update generation log
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

    const successful = Object.values(translations).filter((t: any) => t.success).length;
    const failed = Object.values(translations).filter((t: any) => !t.success);

    console.log(`Translation complete: ${successful}/${languagesToTranslate.length} successful`);

    const responseBody: any = {
      success: successful > 0,
      message: successful > 0
        ? `Article translated to ${successful} language(s)`
        : `All translations failed`,
      master_article_id: article_id,
      slug: masterArticle.slug,
      translations: successful,
      total_languages: languagesToTranslate.length,
      failed_count: failed.length,
      indexing: { indexnow: indexNowResult },
      article_urls: articleUrls,
      details: translations,
    };

    if (successful === 0 && failed.length > 0) {
      responseBody.error = (failed[0] as any)?.error || 'Translation failed';
    }

    return new Response(
      JSON.stringify(responseBody),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: successful > 0 ? 200 : 500,
      }
    );

  } catch (error: any) {
    const elapsedTime = Date.now() - functionStartTime;
    console.error(`Error after ${elapsedTime}ms:`, error);

    const isTimeout = elapsedTime > FUNCTION_TIMEOUT_MS || error.message?.includes('timeout');

    return new Response(
      JSON.stringify({
        error: error.message || "Unknown error",
        isTimeout,
        execution_time_ms: elapsedTime,
        message: isTimeout
          ? `Translation timed out after ${elapsedTime}ms`
          : error.message || "Translation failed"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: isTimeout ? 504 : 500,
      }
    );
  }
});
