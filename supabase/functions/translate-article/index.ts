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
      maxOutputTokens: 8192,
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
 * Generate translation using "Localization & Link Processor" Prompt
 * - Translates: title, content, excerpt, meta title, meta description
 * - KEEPS UNCHANGED: URL slug (always English for SEO consistency)
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

#### 2. URL SLUGS - DO NOT TRANSLATE
The article URL slug is "${articleSlug}" and must NEVER be translated or changed.
This slug will remain the same across all language versions for SEO consistency.
Only update the language prefix in links (e.g., /en/blog/${articleSlug} → /${langCode}/blog/${articleSlug})

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
* href="/en/services" → href="/${langCode}/services"  
* href="/en/blog/any-slug" → href="/${langCode}/blog/any-slug" (KEEP THE SLUG UNCHANGED!)
* Translate the visible anchor text naturally

---
### OUTPUT FORMAT (JSON - No markdown fencing!)
{
  "title": "<translated article title>",
  "content": "<translated HTML with updated link hrefs>",
  "excerpt": "<translated excerpt - max 160 chars>",
  "metaTitle": "<translated meta title - max 60 chars> | ${BRAND_NAME}",
  "metaDescription": "<translated meta description - max 160 chars>"
}`;

  const response = await generateWithGemini(prompt, thoughtSignature);

  try {
    let jsonText = response;
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || 
                     response.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }
    
    const jsonStartIndex = jsonText.indexOf('{');
    const jsonEndIndex = jsonText.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
      jsonText = jsonText.substring(jsonStartIndex, jsonEndIndex + 1);
    }
    
    const parsed = JSON.parse(jsonText);

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

    // Ensure links are properly localized (fallback regex replacement)
    let content = parsed.content || originalJsonData.content;
    content = content
      .replace(/href="\/en\/quote"/g, `href="/${langCode}/quote"`)
      .replace(/href="\/en\/services"/g, `href="/${langCode}/services"`)
      .replace(/href="\/en\/blog\//g, `href="/${langCode}/blog/`);

    return {
      title: parsed.title || originalJsonData.title,
      content: content,
      excerpt: parsed.excerpt || originalJsonData.excerpt,
      metaTitle: metaTitle,
      metaDescription: metaDescription,
    };
  } catch (error) {
    console.error(`Failed to parse translation for ${targetLanguage}:`, error);
    
    // Fallback: return original with basic link replacement
    let fallbackContent = originalJsonData.content
      .replace(/href="\/en\/quote"/g, `href="/${langCode}/quote"`)
      .replace(/href="\/en\/services"/g, `href="/${langCode}/services"`)
      .replace(/href="\/en\/blog\//g, `href="/${langCode}/blog/`);
    
    return {
      title: originalJsonData.title,
      content: fallbackContent,
      excerpt: originalJsonData.excerpt,
      metaTitle: originalJsonData.metaTitle,
      metaDescription: originalJsonData.metaDescription,
    };
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
    console.log(`Article slug (will remain unchanged): ${masterArticle.slug}`);

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
    // Free tier limit: ~15 RPM, so 5 seconds = ~12 RPM (safe margin)
    // Batches of 3 languages keep total time under 60s Edge Function timeout
    const DELAY_BETWEEN_TRANSLATIONS = 5000;

    // Filter languages if target_languages is specified
    const languagesToTranslate = target_languages && target_languages.length > 0
      ? LANGUAGES.filter(l => target_languages.includes(l.code))
      : LANGUAGES;
    
    console.log(`Translating to ${languagesToTranslate.length} language(s): ${languagesToTranslate.map(l => l.code).join(', ')}`);

    for (let i = 0; i < languagesToTranslate.length; i++) {
      const lang = languagesToTranslate[i];
      
      try {
        console.log(`Translating to ${lang.name} (${lang.code})... [${i + 1}/${languagesToTranslate.length}]`);
        
        // Use retry wrapper to handle rate limits with exponential backoff
        const translation = await withRetry(
          () => generateTranslation(
            originalJsonData,
            lang.name,
            lang.code,
            masterArticle.slug, // Pass slug for reference (it stays unchanged)
            thoughtSignature
          ),
          3, // Max 3 retries
          5000 // Base delay of 5 seconds for retries (free tier safe)
        );

        // URL slug ALWAYS stays the same as English version (SEO best practice)
        const translatedSlug = masterArticle.slug;

        const { data: translatedArticle, error: transError } = await supabase
          .from("articles")
          .insert([
            {
              title: translation.title, // Translated title
              slug: translatedSlug, // SAME slug as English
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

        if (transError || !translatedArticle) {
          console.error(`Translation insert error for ${lang.code}:`, transError);
          translations[lang.code] = {
            success: false,
            error: transError?.message,
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
          console.log(`✓ ${lang.name} translation complete`);
        }
      } catch (error: any) {
        console.error(`Translation error for ${lang.code}:`, error);
        translations[lang.code] = {
          success: false,
          error: error.message,
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
    console.log(`Translation complete. ${successfulTranslations}/${languagesToTranslate.length} translations successful.`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Article translated to ${successfulTranslations} language(s)${!target_languages || target_languages.length === 0 ? ' and published' : ''}`,
        master_article_id: article_id,
        slug: masterArticle.slug, // Same slug for all languages
        translations: successfulTranslations,
        total_languages: languagesToTranslate.length,
        indexing: { indexnow: indexNowResult },
        article_urls: articleUrls,
        details: translations,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
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
