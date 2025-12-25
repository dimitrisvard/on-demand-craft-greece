import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
const googleIndexingApiKey = Deno.env.get("GOOGLE_INDEXING_API_KEY");
const googleIndexingClientEmail = Deno.env.get("GOOGLE_INDEXING_CLIENT_EMAIL");
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
  { code: "en", name: "English" },
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

interface SiloNeighbor {
  title: string;
  slug: string;
}

/**
 * Fetch related articles from the same silo category for internal linking
 */
async function fetchSiloNeighbors(siloCategory: string | null, currentId: string): Promise<SiloNeighbor[]> {
  if (!siloCategory) return [];

  try {
    // First try to get published articles from the same silo
    const { data: publishedArticles } = await supabase
      .from("articles")
      .select("title, slug")
      .eq("language", "en")
      .eq("status", "published")
      .limit(5);

    if (publishedArticles && publishedArticles.length > 0) {
      return publishedArticles;
    }

    // Fallback: get other titles from the same silo category
    const { data: siloTitles } = await supabase
      .from("article_titles")
      .select("title")
      .eq("silo_category", siloCategory)
      .eq("processed", true)
      .neq("id", currentId)
      .limit(5);

    if (siloTitles && siloTitles.length > 0) {
      return siloTitles.map(t => ({
        title: t.title,
        slug: t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "")
      }));
    }

    return [];
  } catch (error) {
    console.error("Error fetching silo neighbors:", error);
    return [];
  }
}

/**
 * Format silo neighbors for prompt injection
 */
function formatSiloArticlesForPrompt(neighbors: SiloNeighbor[]): string {
  if (neighbors.length === 0) {
    return "No related articles available yet. Skip silo context links for this article.";
  }
  return neighbors.map(n => `- Title: "${n.title}" (Link: /en/blog/${n.slug})`).join("\n");
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
      temperature: thinkingLevel === "high" ? 0.7 : 0.5,
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
 * Generate master article with high thinking level - "Master Engineer" Prompt
 */
async function generateMasterArticle(
  title: string,
  siloCategory: string | null,
  relatedArticles: string
): Promise<{
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  thoughtSignature: string;
  faqSchema: any;
}> {
  const prompt = `Role: Senior Manufacturing Engineer & Technical SEO Specialist (20+ years exp).
Author Persona: Write as the lead engineer for ${BRAND_NAME}. Tone is authoritative, precise, and helpful—never salesy or generic.

Task: Write a definitive, comprehensive technical guide on: "${title}"

---
### 🛡️ CRITICAL SAFEGUARDS (Strict Compliance Required)
1.  **Brand Identity:** Refer to us as "${BRAND_NAME}". Never translate or alter this name.
2.  **No "AI Fluff":** Do NOT start with "In the ever-evolving landscape of manufacturing..." or "In today's fast-paced world...". Start immediately with technical value or a defining engineering problem.
3.  **Accuracy:** Use exact ISO standards (e.g., ISO 2768, ISO 9001) and material grades (e.g., Al 6061-T6, not just "Aluminum").
4.  **Formatting:** Return ONLY valid JSON. No markdown fencing (\`\`\`json) around the response.

---
### 🔗 LINKING STRATEGY (Dynamic Insertion)
You must insert 3 specific types of links naturally into the flow of the text:
1.  **Silo Context Link:** Choose 1-2 relevant articles from this list:
${relatedArticles}
    Link to them using natural anchor text where the concept is mentioned. Use format: <a href="/en/blog/slug-here">anchor text</a>
2.  **Service Page Link:** When mentioning a process (e.g., "CNC Milling"), link to the general service path using: <a href="/en/services">our manufacturing services</a>
3.  **Commercial Intent (Quote):** Near the 60% mark of the article, insert a distinct, persuasive single-sentence paragraph:
    * "For high-precision results, upload your CAD files to the <a href="/en/quote">${BRAND_NAME} instant quote engine</a>."

---
### 📝 CONTENT REQUIREMENTS
1.  **Length:** Minimum 1600 words of "meaty" content.
2.  **Silo Category:** This article belongs to the "${siloCategory || 'General'}" content silo.
3.  **Structure:**
    * **H1:** The Title.
    * **Executive Summary:** A "Key Takeaways" bullet list (3-4 points) right after the intro using <ul><li> tags.
    * **Deep Dive (H2/H3):** Detailed process, tolerances, material selection, and cost drivers.
    * **Comparison Table:** ALWAYS include an HTML table (<table>) comparing materials or processes relevant to the topic.
    * **Visual Q&A:** A visible H2 section titled "Frequently Asked Questions" at the bottom with 5-7 questions using <h3> for each question.
3.  **FAQ Schema:** Generate Google-compliant JSON-LD for the FAQ section.

---
### 📤 OUTPUT FORMAT (JSON - No markdown fencing!)
{
  "content": "<div class='blog-post'>...full HTML content with proper tags...</div>",
  "excerpt": "A 160-character technical summary optimized for CTR.",
  "metaTitle": "SEO Title (Max 60 chars) | ${BRAND_NAME}",
  "metaDescription": "SEO Description (Max 160 chars) with primary keyword.",
  "faqSchema": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Question text here",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Answer text here"
        }
      }
    ]
  }
}`;

  const response = await generateWithGemini(prompt, "high");
  
  // Parse JSON response
  try {
    // Extract JSON from markdown code blocks if present (fallback)
    let jsonText = response;
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || 
                     response.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }
    
    // Try to find JSON object in the response
    const jsonStartIndex = jsonText.indexOf('{');
    const jsonEndIndex = jsonText.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
      jsonText = jsonText.substring(jsonStartIndex, jsonEndIndex + 1);
    }
    
    const parsed = JSON.parse(jsonText);

    // Generate thought signature for context preservation
    const thoughtSignature = `Article about ${title} by ${BRAND_NAME} - Technical manufacturing focus, ${parsed.metaDescription?.substring(0, 100)}`;

    return {
      content: parsed.content || response,
      excerpt: parsed.excerpt || "",
      metaTitle: parsed.metaTitle || `${title} | ${BRAND_NAME}`,
      metaDescription: parsed.metaDescription || parsed.excerpt || "",
      thoughtSignature,
      faqSchema: parsed.faqSchema || null,
    };
  } catch (error) {
    // Fallback if JSON parsing fails
    console.error("Failed to parse Gemini response as JSON:", error);
    console.error("Raw response:", response.substring(0, 500));
    return {
      content: response,
      excerpt: response.substring(0, 160) + "...",
      metaTitle: `${title} | ${BRAND_NAME}`,
      metaDescription: response.substring(0, 160),
      thoughtSignature: `Article about ${title} by ${BRAND_NAME}`,
      faqSchema: null,
    };
  }
}

/**
 * Generate translation using low thinking level - "Localization & Link Processor" Prompt
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
### 🛡️ TRANSLATION & LOCALIZATION RULES
1.  **Brand Safety:** NEVER translate "${BRAND_NAME}". Keep it exactly as "${BRAND_NAME}".
2.  **Technical Terminology:** Use industry-standard terms for ${targetLanguage} (e.g., English "Stainless Steel" -> German "Edelstahl", NOT "Rostfreier Stahl" if "Edelstahl" is the industry norm).
3.  **HTML Structure:** Preserve ALL HTML tags, classes, and IDs exactly. Only translate the text *between* the tags.

### 🔗 SMART LINK LOCALIZATION (Crucial)
You must rewrite all internal links to match the target language sub-folder structure:
* **Quote Page:** Convert href="/en/quote" ➡ href="/${langCode}/quote"
* **Service Page:** Convert href="/en/services" ➡ href="/${langCode}/services"
* **Blog Links:** Convert href="/en/blog/article-slug" ➡ href="/${langCode}/blog/article-slug" (Preserve the slug)
* **Anchor Text:** Translate the visible anchor text naturally to ${targetLanguage}.

### 📤 OUTPUT FORMAT (JSON - No markdown fencing!)
Return the exact same JSON structure as the input, but with localized content:
{
  "content": "<translated HTML with updated hrefs>",
  "excerpt": "<translated excerpt>",
  "metaTitle": "<translated meta title>",
  "metaDescription": "<translated meta description>"
}`;

  const response = await generateWithGemini(prompt, "low", thoughtSignature);

  try {
    // Extract JSON from response
    let jsonText = response;
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || 
                     response.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }
    
    // Try to find JSON object in the response
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
    console.error("Raw response:", response.substring(0, 500));
    
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
    const endpoint = `https://indexing.googleapis.com/v3/urlNotifications:publish`;

    // This requires proper OAuth2 token - implementation depends on your setup
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

    console.log(`IndexNow submission status: ${response.status} for ${urls.length} URLs`);
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
    console.log(`Silo category: ${titleRecord.silo_category || 'None'}`);

    // 2. Fetch silo neighbors for internal linking
    const siloNeighbors = await fetchSiloNeighbors(titleRecord.silo_category, titleRecord.id);
    const relatedArticlesForPrompt = formatSiloArticlesForPrompt(siloNeighbors);
    console.log(`Found ${siloNeighbors.length} silo neighbors for linking`);

    // 3. Generate master article with high thinking
    const masterArticle = await generateMasterArticle(
      titleRecord.title,
      titleRecord.silo_category,
      relatedArticlesForPrompt
    );
    const masterSlug = generateSlug(titleRecord.title);
    const translationId = crypto.randomUUID();

    // 4. Create master article in database
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

    // 5. Generate translations with low thinking
    const translations: Record<string, any> = {};
    const articleUrls: string[] = [`${siteUrl}/en/blog/${masterSlug}`];

    // Prepare original data for translation
    const originalJsonData = {
      content: masterArticle.content,
      excerpt: masterArticle.excerpt,
      metaTitle: masterArticle.metaTitle,
      metaDescription: masterArticle.metaDescription,
    };

    for (const lang of LANGUAGES) {
      if (lang.code === "en") continue; // Skip English (already created)

      try {
        console.log(`Translating to ${lang.name} (${lang.code})...`);
        
        const translation = await generateTranslation(
          originalJsonData,
          lang.name,
          lang.code,
          masterArticle.thoughtSignature
        );

        // Use same slug for all languages (SEO best practice)
        const translatedSlug = masterSlug;

        const { data: translatedArticle, error: transError } = await supabase
          .from("articles")
          .insert([
            {
              title: translation.metaTitle.replace(` | ${BRAND_NAME}`, ''),
              slug: translatedSlug,
              content: translation.content,
              excerpt: translation.excerpt,
              language: lang.code,
              status: "published",
              meta_title: translation.metaTitle,
              meta_description: translation.metaDescription,
              translation_id: translationId,
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

    // 6. Submit to indexing services
    const indexingResults = {
      google: await submitToGoogleIndexing(articleUrls[0]),
      indexnow: await submitToIndexNow(articleUrls),
    };

    // 7. Log sitemap update requirement
    console.log("Sitemap update required for URLs:", articleUrls);

    // 8. Create generation log
    const summaryData = {
      title: titleRecord.title,
      silo_category: titleRecord.silo_category,
      translations,
      indexing: indexingResults,
      master_article_id: masterArticleRecord.id,
      article_urls: articleUrls,
      silo_neighbors_used: siloNeighbors.length,
    };

    await supabase.from("article_generation_logs").insert([
      {
        summary_data: summaryData,
      },
    ]);

    // 9. Mark title as processed
    await supabase
      .from("article_titles")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq("id", titleRecord.id);

    const successfulTranslations = Object.values(translations).filter((t: any) => t.success).length;
    console.log(`Article generation complete. ${successfulTranslations}/${LANGUAGES.length - 1} translations successful.`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Article generated successfully",
        title: titleRecord.title,
        silo_category: titleRecord.silo_category,
        master_article_id: masterArticleRecord.id,
        translations: successfulTranslations,
        total_languages: LANGUAGES.length,
        indexing: indexingResults,
        silo_neighbors_used: siloNeighbors.length,
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
