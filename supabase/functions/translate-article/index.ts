import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
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
const SERVICE_SLUG_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    "services": "services",
    "cnc-machining": "cnc-machining",
    "sheet-metal": "sheet-metal",
    "injection-molding": "injection-molding",
  },
  de: {
    "services": "dienstleistungen",
    "cnc-machining": "cnc-bearbeitung",
    "sheet-metal": "blechbearbeitung",
    "injection-molding": "spritzguss",
  },
  fr: {
    "services": "services",
    "cnc-machining": "usinage-cnc",
    "sheet-metal": "tolerie",
    "injection-molding": "moulage-par-injection",
  },
  es: {
    "services": "servicios",
    "cnc-machining": "mecanizado-cnc",
    "sheet-metal": "chapa-metalica",
    "injection-molding": "moldeo-por-inyeccion",
  },
  it: {
    "services": "servizi",
    "cnc-machining": "lavorazione-cnc",
    "sheet-metal": "lavorazione-lamiera",
    "injection-molding": "stampaggio-ad-iniezione",
  },
  nl: {
    "services": "diensten",
    "cnc-machining": "cnc-bewerking",
    "sheet-metal": "plaatbewerking",
    "injection-molding": "spuitgieten",
  },
  pl: {
    "services": "uslugi",
    "cnc-machining": "obrobka-cnc",
    "sheet-metal": "obrobka-blaszek",
    "injection-molding": "formowanie-wtryskowe",
  },
  sv: {
    "services": "tjanster",
    "cnc-machining": "cnc-bearbetning",
    "sheet-metal": "platarbe",
    "injection-molding": "spjutsgjutning",
  },
  da: {
    "services": "tjenester",
    "cnc-machining": "cnc-bearbejdning",
    "sheet-metal": "pladearbejde",
    "injection-molding": "spjutsgodsning",
  },
  fi: {
    "services": "palvelut",
    "cnc-machining": "cnc-koneistus",
    "sheet-metal": "levytyo",
    "injection-molding": "ruiskumuovaus",
  },
  cs: {
    "services": "sluzby",
    "cnc-machining": "cnc-obrabeni",
    "sheet-metal": "obrabeni-plechu",
    "injection-molding": "vstrikovani",
  },
  hu: {
    "services": "szolgaltatasok",
    "cnc-machining": "cnc-megmunkalas",
    "sheet-metal": "lemezfeldolgozas",
    "injection-molding": "frccsnyomas",
  },
  pt: {
    "services": "servicos",
    "cnc-machining": "usinagem-cnc",
    "sheet-metal": "chapa-metalica",
    "injection-molding": "moldagem-por-injecao",
  },
  nb: {
    "services": "tjenester",
    "cnc-machining": "cnc-bearbeiding",
    "sheet-metal": "platarbeid",
    "injection-molding": "sproyetestoping",
  },
};

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
  error?: {
    message: string;
  };
}

interface TranslateRequest {
  article_id: string;
  target_languages?: string[]; // Optional: specific language codes to translate to (e.g., ["de", "fr"])
}

/**
 * Generate article using Gemini with low thinking level for translations
 */
async function generateWithGemini(
  prompt: string,
  thoughtSignature?: string
): Promise<string> {
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const model = "gemini-2.0-flash-exp";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

  const requestBody: any = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.5,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 65536, // Increased for 3000-word articles (gemini-2.0-flash-exp supports up to 65536)
    },
  };

  if (thoughtSignature) {
    requestBody.contents[0].parts.push({
      text: `\n\nPrevious context signature: ${thoughtSignature}`,
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

  const data: GeminiResponse = await response.json();

  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message}`);
  }

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error("No response from Gemini API");
  }

  return data.candidates[0].content.parts[0].text;
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
  thoughtSignature: string
): Promise<{
  title: string;
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
}> {
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

#### 6. SMART LINK LOCALIZATION (Crucial)
Rewrite all internal links to match the target language sub-folder structure:
* href="/en/quote" → href="/${langCode}/quote"
* href="/en/services" → href="/${langCode}/[translated-services-slug]"  
* href="/en/services/cnc-machining" → href="/${langCode}/[translated-services-slug]/[translated-cnc-slug]"
* href="/en/services/sheet-metal" → href="/${langCode}/[translated-services-slug]/[translated-sheet-metal-slug]"
* href="/en/services/injection-molding" → href="/${langCode}/[translated-services-slug]/[translated-injection-molding-slug]"
* href="/en/blog/any-slug" → href="/${langCode}/blog/translated-slug" (use translated slugs in links)
* Translate the visible anchor text naturally
* CRITICAL: Links must use proper HTML format: <a href="/${langCode}/path">text</a>
* NEVER include quotes inside the href attribute value - use: href="/path" NOT href=""path""
* Ensure all href values start with "/" and contain no spaces or extra quotes
* IMPORTANT: Service page links must use the correct translated slugs for the target language

---
### OUTPUT FORMAT (JSON - No markdown fencing!)
{
  "title": "<translated article title>",
  "slug": "<translated-url-friendly-slug-based-on-title>",
  "content": "<translated HTML with updated link hrefs>",
  "excerpt": "<translated excerpt - max 160 chars>",
  "metaTitle": "<translated meta title - max 60 chars> | ${BRAND_NAME}",
  "metaDescription": "<translated meta description - max 160 chars>"
}`;

  const response = await generateWithGemini(prompt, thoughtSignature);
  
  console.log(`Gemini response received for ${targetLanguage}, length: ${response.length}`);
  console.log(`Response preview (first 500 chars): ${response.substring(0, 500)}`);

  try {
    // Clean the response: remove markdown code fences if present
    let jsonText = response.trim();
    
    // Remove markdown code fences
    jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    
    // Find the JSON object boundaries
    const jsonStartIndex = jsonText.indexOf('{');
    const jsonEndIndex = jsonText.lastIndexOf('}');
    
    if (jsonStartIndex === -1 || jsonEndIndex === -1 || jsonEndIndex <= jsonStartIndex) {
      console.error(`Invalid JSON structure for ${targetLanguage}. Start: ${jsonStartIndex}, End: ${jsonEndIndex}`);
      console.error(`Response text: ${jsonText.substring(0, 1000)}`);
      throw new Error("Could not find valid JSON boundaries in Gemini response");
    }
    
    jsonText = jsonText.substring(jsonStartIndex, jsonEndIndex + 1);
    
    // Parse JSON (this will automatically handle escaped newlines \n)
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
      console.log(`Successfully parsed JSON for ${targetLanguage}`);
    } catch (parseError: any) {
      console.error(`JSON parse error for ${targetLanguage}:`, parseError.message);
      console.error(`JSON text (first 1000 chars): ${jsonText.substring(0, 1000)}`);
      throw new Error(`Failed to parse JSON: ${parseError.message}`);
    }
    
    // Ensure content is a string and clean it
    if (typeof parsed.content !== 'string') {
      parsed.content = String(parsed.content || '');
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
    
    // Fix malformed links with quotes inside href (e.g., href=""path"" → href="/path")
    content = content.replace(/href="+([^"]+)"+/g, 'href="$1"'); // Remove duplicate quotes
    content = content.replace(/href="([^"]*)"([^"]*)"([^"]*)"/g, 'href="$1$2$3"'); // Fix nested quotes
    
    // Get translated service slugs for the target language
    const servicesSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.services || "services";
    const cncSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["cnc-machining"] || "cnc-machining";
    const sheetMetalSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["sheet-metal"] || "sheet-metal";
    const injectionMoldingSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["injection-molding"] || "injection-molding";
    
    // Ensure all internal links use the correct language code and translated slugs
    content = content
      .replace(/href="\/en\/quote"/g, `href="/${langCode}/quote"`)
      .replace(/href="\/en\/services\/cnc-machining"/g, `href="/${langCode}/${servicesSlug}/${cncSlug}"`)
      .replace(/href="\/en\/services\/sheet-metal"/g, `href="/${langCode}/${servicesSlug}/${sheetMetalSlug}"`)
      .replace(/href="\/en\/services\/injection-molding"/g, `href="/${langCode}/${servicesSlug}/${injectionMoldingSlug}"`)
      .replace(/href="\/en\/services"/g, `href="/${langCode}/${servicesSlug}"`)
      .replace(/href="\/en\/blog\//g, `href="/${langCode}/blog/`);
    
    // Clean up any remaining malformed links (href with quotes in the middle)
    // Pattern: href="/something"something" → href="/somethingsomething"
    content = content.replace(/href="([^"]*)"([^/][^"]*)"/g, (match, p1, p2) => {
      // If there's a quote in the middle of the href value, remove it
      return `href="${p1}${p2.replace(/"/g, '')}"`;
    });

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
 * Gemini API has rate limits, so we add delays between translation requests
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

    // 3. Generate translations with rate limiting protection
    const translations: Record<string, any> = {};
    const articleUrls: string[] = [`${siteUrl}/en/blog/${masterArticle.slug}`];
    
    // Delay between translations to avoid rate limiting
    // Free tier limit: ~15 RPM, so 8 seconds = ~7.5 RPM (safe margin for 3000-word articles)
    // With batch size of 1 from frontend, each call processes 1 language
    const DELAY_BETWEEN_TRANSLATIONS = 8000;

    // Filter languages if target_languages is specified
    const languagesToTranslate = target_languages && target_languages.length > 0
      ? LANGUAGES.filter(l => target_languages.includes(l.code))
      : LANGUAGES;
    
    console.log(`Translating to ${languagesToTranslate.length} language(s): ${languagesToTranslate.map(l => l.code).join(', ')}`);

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
        // Increased delays due to Gemini free tier rate limiting with 3000-word articles
        const translation = await withRetry(
          () => generateTranslation(
            originalJsonData,
            lang.name,
            lang.code,
            masterArticle.slug, // Pass original slug for reference (will be translated)
            thoughtSignature
          ),
          4, // Max 4 retries for better rate limit handling
          8000 // Base delay of 8 seconds for retries (free tier safe)
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
        : `All ${languagesToTranslate.length} translation(s) failed. This may be due to Gemini API rate limiting.`,
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
