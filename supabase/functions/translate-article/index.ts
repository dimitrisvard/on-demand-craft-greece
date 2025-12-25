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
 */
async function generateTranslation(
  originalJsonData: {
    content: string;
    excerpt: string;
    metaTitle: string;
    metaDescription: string;
  },
  targetLanguage: string,
  langCode: string,
  thoughtSignature: string
): Promise<{
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
}> {
  const prompt = `Role: Native Technical Translator & ISO Standard Specialist.
Task: Translate the following manufacturing blog data into ${targetLanguage}.

Input Data:
{
  "content": ${JSON.stringify(originalJsonData.content)},
  "excerpt": ${JSON.stringify(originalJsonData.excerpt)},
  "metaTitle": ${JSON.stringify(originalJsonData.metaTitle)},
  "metaDescription": ${JSON.stringify(originalJsonData.metaDescription)}
}

---
### TRANSLATION & LOCALIZATION RULES
1.  **Brand Safety:** NEVER translate "${BRAND_NAME}". Keep it exactly as "${BRAND_NAME}".
2.  **Technical Terminology:** Use industry-standard terms for ${targetLanguage} (e.g., English "Stainless Steel" -> German "Edelstahl", NOT "Rostfreier Stahl" if "Edelstahl" is the industry norm).
3.  **HTML Structure:** Preserve ALL HTML tags, classes, and IDs exactly. Only translate the text *between* the tags.

### SMART LINK LOCALIZATION (Crucial)
You must rewrite all internal links to match the target language sub-folder structure:
* **Quote Page:** Convert href="/en/quote" to href="/${langCode}/quote"
* **Service Page:** Convert href="/en/services" to href="/${langCode}/services"
* **Blog Links:** Convert href="/en/blog/article-slug" to href="/${langCode}/blog/article-slug" (Preserve the slug)
* **Anchor Text:** Translate the visible anchor text naturally to ${targetLanguage}.

### OUTPUT FORMAT (JSON - No markdown fencing!)
Return the exact same JSON structure as the input, but with localized content:
{
  "content": "<translated HTML with updated hrefs>",
  "excerpt": "<translated excerpt>",
  "metaTitle": "<translated meta title>",
  "metaDescription": "<translated meta description>"
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

    return {
      content: parsed.content || response,
      excerpt: parsed.excerpt || originalJsonData.excerpt,
      metaTitle: parsed.metaTitle || originalJsonData.metaTitle,
      metaDescription: parsed.metaDescription || originalJsonData.metaDescription,
    };
  } catch (error) {
    console.error(`Failed to parse translation for ${targetLanguage}:`, error);
    
    // Fallback: return original with basic link replacement
    let fallbackContent = originalJsonData.content
      .replace(/href="\/en\//g, `href="/${langCode}/`);
    
    return {
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

/**
 * Main handler - Translates an English article to all languages
 * Expects: { article_id: "uuid" }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { article_id }: TranslateRequest = await req.json();

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

    // 2. Prepare original data for translation
    const originalJsonData = {
      content: masterArticle.content,
      excerpt: masterArticle.excerpt || "",
      metaTitle: masterArticle.meta_title || masterArticle.title,
      metaDescription: masterArticle.meta_description || "",
    };

    const thoughtSignature = `Article about ${masterArticle.title} by ${BRAND_NAME} - Technical manufacturing focus`;

    // 3. Generate translations
    const translations: Record<string, any> = {};
    const articleUrls: string[] = [`${siteUrl}/en/blog/${masterArticle.slug}`];

    for (const lang of LANGUAGES) {
      try {
        console.log(`Translating to ${lang.name} (${lang.code})...`);
        
        const translation = await generateTranslation(
          originalJsonData,
          lang.name,
          lang.code,
          thoughtSignature
        );

        // Use same slug for all languages
        const translatedSlug = masterArticle.slug;

        const { data: translatedArticle, error: transError } = await supabase
          .from("articles")
          .insert([
            {
              title: translation.metaTitle.replace(` | ${BRAND_NAME}`, ''),
              slug: translatedSlug,
              content: translation.content,
              excerpt: translation.excerpt,
              language: lang.code,
              status: "published", // Translations are published immediately
              meta_title: translation.metaTitle,
              meta_description: translation.metaDescription,
              translation_id: masterArticle.translation_id,
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
            url: `${siteUrl}/${lang.code}/blog/${translatedSlug}`,
          };
          articleUrls.push(`${siteUrl}/${lang.code}/blog/${translatedSlug}`);
        }
      } catch (error: any) {
        console.error(`Translation error for ${lang.code}:`, error);
        translations[lang.code] = {
          success: false,
          error: error.message,
        };
      }
    }

    // 4. Update master article status to published
    await supabase
      .from("articles")
      .update({ status: "published" })
      .eq("id", article_id);

    // 5. Submit to IndexNow
    const indexNowResult = await submitToIndexNow(articleUrls);

    // 6. Update generation log
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
    console.log(`Translation complete. ${successfulTranslations}/${LANGUAGES.length} translations successful.`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Article translated to ${successfulTranslations} languages and published`,
        master_article_id: article_id,
        translations: successfulTranslations,
        total_languages: LANGUAGES.length,
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

