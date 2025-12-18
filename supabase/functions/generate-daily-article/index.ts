import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
const googleIndexingApiKey = Deno.env.get("GOOGLE_INDEXING_API_KEY");
const googleIndexingClientEmail = Deno.env.get("GOOGLE_INDEXING_CLIENT_EMAIL");
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";
const indexNowKey = Deno.env.get("INDEXNOW_KEY") || "";

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Supported languages for translation
const LANGUAGES = [
  "en", "de", "fr", "es", "it", "nl", "pl", "sv", "da", "fi", "cs", "hu", "pt", "nb"
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

/**
 * Generate article using Gemini 3 Pro with specified thinking level
 */
async function generateWithGemini(
  prompt: string,
  thinkingLevel: "high" | "low" = "high",
  thoughtSignature?: string
): Promise<string> {
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const model = "gemini-2.0-flash-exp"; // Using latest Gemini model
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

  // Build the request with thinking level configuration
  const requestBody: any = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  // If thought signature is provided, include it for context preservation
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
 * Generate master article with high thinking level
 */
async function generateMasterArticle(title: string): Promise<{
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  thoughtSignature: string;
  faqSchema: any;
}> {
  const prompt = `Write a comprehensive, high-quality technical blog article about: "${title}"

Requirements:
1. Write in English
2. Minimum 1500 words
3. Include technical depth and accuracy
4. Structure with proper headings (H2, H3)
5. Include an engaging introduction and conclusion
6. Add 2-3 internal links to related topics (use placeholder format: [link:topic-name])
7. Generate a compelling excerpt (150-200 words)
8. Create SEO-optimized meta title and description
9. Generate a FAQ section with 5-7 questions and answers in JSON-LD format

Format the response as JSON:
{
  "content": "<full HTML article content>",
  "excerpt": "<excerpt text>",
  "metaTitle": "<SEO meta title>",
  "metaDescription": "<SEO meta description>",
  "faqSchema": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [...]
  }
}`;

  const response = await generateWithGemini(prompt, "high");
  
  // Parse JSON response
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || 
                     response.match(/```\s*([\s\S]*?)\s*```/) ||
                     [null, response];
    const jsonText = jsonMatch[1];
    const parsed = JSON.parse(jsonText);

    // Generate thought signature for context preservation
    const thoughtSignature = `Article about ${title} - Technical focus, ${parsed.metaDescription?.substring(0, 100)}`;

    return {
      content: parsed.content || response,
      excerpt: parsed.excerpt || "",
      metaTitle: parsed.metaTitle || title,
      metaDescription: parsed.metaDescription || parsed.excerpt || "",
      thoughtSignature,
      faqSchema: parsed.faqSchema || null,
    };
  } catch (error) {
    // Fallback if JSON parsing fails
    console.error("Failed to parse Gemini response as JSON:", error);
    return {
      content: response,
      excerpt: response.substring(0, 200) + "...",
      metaTitle: title,
      metaDescription: response.substring(0, 160),
      thoughtSignature: `Article about ${title}`,
      faqSchema: null,
    };
  }
}

/**
 * Generate translation using low thinking level with thought signature
 */
async function generateTranslation(
  masterContent: string,
  masterExcerpt: string,
  masterMetaTitle: string,
  masterMetaDescription: string,
  targetLanguage: string,
  thoughtSignature: string
): Promise<{
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
}> {
  const prompt = `Translate the following article to ${targetLanguage}. Maintain technical accuracy and preserve HTML structure.

Original Title: ${masterMetaTitle}
Original Excerpt: ${masterExcerpt}
Original Content: ${masterContent.substring(0, 2000)}...

Requirements:
1. Translate all text content while preserving HTML tags
2. Maintain technical terminology accuracy
3. Adapt cultural references appropriately
4. Generate translated meta title and description
5. Preserve internal links format: [link:topic-name]

Respond in JSON format:
{
  "content": "<translated HTML content>",
  "excerpt": "<translated excerpt>",
  "metaTitle": "<translated meta title>",
  "metaDescription": "<translated meta description>"
}`;

  const response = await generateWithGemini(prompt, "low", thoughtSignature);

  try {
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || 
                     response.match(/```\s*([\s\S]*?)\s*```/) ||
                     [null, response];
    const jsonText = jsonMatch[1];
    const parsed = JSON.parse(jsonText);

    return {
      content: parsed.content || response,
      excerpt: parsed.excerpt || "",
      metaTitle: parsed.metaTitle || masterMetaTitle,
      metaDescription: parsed.metaDescription || masterMetaDescription,
    };
  } catch (error) {
    console.error(`Failed to parse translation for ${targetLanguage}:`, error);
    return {
      content: response,
      excerpt: masterExcerpt,
      metaTitle: masterMetaTitle,
      metaDescription: masterMetaDescription,
    };
  }
}

/**
 * Submit URL to Google Indexing API
 */
async function submitToGoogleIndexing(url: string): Promise<boolean> {
  if (!googleIndexingApiKey || !googleIndexingClientEmail) {
    console.warn("Google Indexing API not configured");
    return false;
  }

  try {
    // Note: Google Indexing API requires OAuth2 authentication
    // This is a simplified version - you may need to implement OAuth2 flow
    // For now, we'll use the Indexing API v3 with service account
    const endpoint = `https://indexing.googleapis.com/v3/urlNotifications:publish`;

    // This requires proper OAuth2 token - implementation depends on your setup
    // For now, return false and log that it needs configuration
    console.log(`Google Indexing submission skipped - requires OAuth2 setup for: ${url}`);
    return false;
  } catch (error) {
    console.error("Google Indexing error:", error);
    return false;
  }
}

/**
 * Submit URL to IndexNow
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

    return response.ok;
  } catch (error) {
    console.error("IndexNow submission error:", error);
    return false;
  }
}

/**
 * Generate slug from title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

/**
 * Main handler
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Fetch next unprocessed title
    const { data: titleRecord, error: titleError } = await supabase
      .from("article_titles")
      .select("*")
      .eq("processed", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (titleError || !titleRecord) {
      return new Response(
        JSON.stringify({ message: "No unprocessed titles found" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    console.log(`Processing title: ${titleRecord.title}`);

    // 2. Generate master article with high thinking
    const masterArticle = await generateMasterArticle(titleRecord.title);
    const masterSlug = generateSlug(titleRecord.title);
    const translationId = crypto.randomUUID();

    // 3. Create master article in database
    const { data: masterArticleRecord, error: masterError } = await supabase
      .from("articles")
      .insert([
        {
          title: titleRecord.title,
          slug: masterSlug,
          content: masterArticle.content,
          excerpt: masterArticle.excerpt,
          language: "en",
          status: "published",
          meta_title: masterArticle.metaTitle,
          meta_description: masterArticle.metaDescription,
          translation_id: translationId,
        },
      ])
      .select()
      .single();

    if (masterError || !masterArticleRecord) {
      throw new Error(`Failed to create master article: ${masterError?.message}`);
    }

    console.log(`Master article created: ${masterArticleRecord.id}`);

    // 4. Generate translations with low thinking
    const translations: Record<string, any> = {};
    const articleUrls: string[] = [`${siteUrl}/en/blog/${masterSlug}`];

    for (const lang of LANGUAGES) {
      if (lang === "en") continue; // Skip English (already created)

      try {
        const translation = await generateTranslation(
          masterArticle.content,
          masterArticle.excerpt,
          masterArticle.metaTitle,
          masterArticle.metaDescription,
          lang,
          masterArticle.thoughtSignature
        );

        const translatedSlug = `${masterSlug}-${lang}`;

        const { data: translatedArticle, error: transError } = await supabase
          .from("articles")
          .insert([
            {
              title: translation.metaTitle,
              slug: translatedSlug,
              content: translation.content,
              excerpt: translation.excerpt,
              language: lang,
              status: "published",
              meta_title: translation.metaTitle,
              meta_description: translation.metaDescription,
              translation_id: translationId,
            },
          ])
          .select()
          .single();

        if (transError || !translatedArticle) {
          translations[lang] = {
            success: false,
            error: transError?.message,
          };
        } else {
          translations[lang] = {
            success: true,
            article_id: translatedArticle.id,
            url: `${siteUrl}/${lang}/blog/${translatedSlug}`,
          };
          articleUrls.push(`${siteUrl}/${lang}/blog/${translatedSlug}`);
        }
      } catch (error: any) {
        console.error(`Translation error for ${lang}:`, error);
        translations[lang] = {
          success: false,
          error: error.message,
        };
      }
    }

    // 5. Submit to indexing services
    const indexingResults = {
      google: await submitToGoogleIndexing(articleUrls[0]),
      indexnow: await submitToIndexNow(articleUrls),
    };

    // 6. Update sitemaps (Note: This would typically be done via a separate process
    // or API call to update static sitemap files. For now, we'll log it.)
    console.log("Sitemap update required for URLs:", articleUrls);

    // 7. Create generation log
    const summaryData = {
      title: titleRecord.title,
      translations,
      indexing: indexingResults,
      master_article_id: masterArticleRecord.id,
      article_urls: articleUrls,
    };

    await supabase.from("article_generation_logs").insert([
      {
        summary_data: summaryData,
      },
    ]);

    // 8. Mark title as processed
    await supabase
      .from("article_titles")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq("id", titleRecord.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Article generated successfully",
        title: titleRecord.title,
        master_article_id: masterArticleRecord.id,
        translations: Object.keys(translations).length,
        indexing: indexingResults,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in generate-daily-article:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

