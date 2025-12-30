import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";

// Brand name - NEVER translate or alter this
const BRAND_NAME = "Microns Hub";

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Silo rotation order (5-day cycle)
const SILO_ROTATION = [
  "Advanced CNC Machining Strategy",
  "Die Casting & Metal Casting",
  "Sheet Metal & Fabrication",
  "Rapid Tooling & Injection Molding",
  "Material Science & Surface Engineering",
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
 * Get the silo category for today based on rotating schedule
 * Uses day of year modulo 5 to rotate through silos in a 5-day cycle
 * 
 * Rotation schedule (based on day of year):
 * - January 1st (day 1) = Advanced CNC Machining Strategy (index 0)
 * - January 2nd (day 2) = Die Casting & Metal Casting (index 1)
 * - January 3rd (day 3) = Sheet Metal & Fabrication (index 2)
 * - January 4th (day 4) = Rapid Tooling & Injection Molding (index 3)
 * - January 5th (day 5) = Material Science & Surface Engineering (index 4)
 * - January 6th (day 6) = Advanced CNC Machining Strategy (index 0) - cycle repeats
 * 
 * Calculation: (dayOfYear - 1) % 5
 * This ensures day 1 maps to index 0, day 2 to index 1, etc.
 */
function getTodaysSilo(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  // Calculate day of year (1-365/366): January 1st = 1, January 2nd = 2, etc.
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  // Convert to 0-based index for array access: day 1 -> index 0, day 2 -> index 1, etc.
  const siloIndex = (dayOfYear - 1) % SILO_ROTATION.length;
  return SILO_ROTATION[siloIndex];
}

/**
 * Fetch related articles from the same silo category for internal linking
 * Returns empty array if no articles exist yet (first article in silo)
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
      // Filter to same silo if we can determine it
      // For now, return all published articles as potential links
      return publishedArticles;
    }

    // Fallback: get other processed titles from the same silo category
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

    // No articles found - this is the first article in the silo
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
    return "No related articles available yet. This is the first article in this silo category. Skip silo context links for this article.";
  }
  return neighbors.map(n => `- Title: "${n.title}" (Link: /en/blog/${n.slug})`).join("\n");
}

/**
 * Generate article using Gemini 3 Pro with specified thinking level
 */
async function generateWithGemini(
  prompt: string,
  thinkingLevel: "high" | "low" = "high"
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
      temperature: thinkingLevel === "high" ? 0.7 : 0.5,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

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
 * Creates ONLY the English version in DRAFT mode
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
  faqSchema: any;
}> {
  const prompt = `Role: Senior Manufacturing Engineer & Technical SEO Specialist (20+ years exp).
Author Persona: Write as the lead engineer for ${BRAND_NAME}. Tone is authoritative, precise, and helpful—never salesy or generic.

Task: Write a definitive, comprehensive technical guide on: "${title}"

---
### CRITICAL SAFEGUARDS (Strict Compliance Required)
1.  **Brand Identity:** Refer to us as "${BRAND_NAME}". Never translate or alter this name.
2.  **No "AI Fluff":** Do NOT start with "In the ever-evolving landscape of manufacturing..." or "In today's fast-paced world...". Start immediately with technical value or a defining engineering problem.
3.  **Accuracy:** Use exact ISO standards (e.g., ISO 2768, ISO 9001) and material grades (e.g., Al 6061-T6, not just "Aluminum").
4.  **Formatting:** Return ONLY valid JSON. No markdown fencing (\`\`\`json) around the response.

---
### EUROPEAN LOCALIZATION (MANDATORY)
**Target Audience: European manufacturers and engineers. Follow these rules strictly:**
1.  **Currency:** Always use Euro (€) for ALL prices. NEVER use Dollar ($). Example: "Starting from €500" not "$500".
2.  **Measurements:** Use METRIC ONLY - centimeters (cm) and millimeters (mm). NEVER use inches or feet. Example: "tolerance of ±0.05 mm" not "±0.002 inches".
3.  **Decimal Notation:** Use comma for decimals in measurements when contextually appropriate (e.g., "2,5 mm" is acceptable, but "2.5 mm" is also fine for technical content).
4.  **Weight:** Use kilograms (kg) and grams (g), NEVER pounds (lb) or ounces (oz).

---
### LINKING STRATEGY (Dynamic Insertion)
You must insert 3 specific types of links naturally into the flow of the text:
1.  **Silo Context Link:** Choose 1-2 relevant articles from this list:
${relatedArticles}
    Link to them using natural anchor text where the concept is mentioned. Use format: <a href="/en/blog/slug-here">anchor text</a>
2.  **Service Page Link:** When mentioning a process (e.g., "CNC Milling"), link to the general service path using: <a href="/en/services">our manufacturing services</a>
3.  **Commercial Intent (Quote):** Near the 60% mark of the article, insert a distinct, persuasive single-sentence paragraph:
    * "For high-precision results, upload your CAD files to the <a href="/en/quote">${BRAND_NAME} instant quote engine</a>."

---
### CONTENT REQUIREMENTS
1.  **Length:** Minimum 1600 words of "meaty" content.
2.  **Silo Category:** This article belongs to the "${siloCategory || 'General'}" content silo.
3.  **Structure:**
    * **H1:** The Title.
    * **Executive Summary:** A "Key Takeaways" bullet list (3-4 points) right after the intro using <ul><li> tags.
    * **Deep Dive (H2/H3):** Detailed process, tolerances, material selection, and cost drivers.
    * **Comparison Tables (MANDATORY):** 
      - ALWAYS create HTML tables (<table>) when comparing materials, processes, properties, specifications, or any data that benefits from side-by-side comparison.
      - Use tables for: material properties (tensile strength, hardness, cost), process comparisons (CNC vs 3D printing), tolerance ranges, pricing tiers, material grades, surface finish options, etc.
      - Format tables with proper HTML structure: <table class="editor-table"><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>
      - Include inline styles for borders and spacing if needed, but primary styling is via CSS classes.
      - Use <th> for header cells.
      - Make tables responsive and readable with proper column alignment.
      - Example: When comparing aluminum 6061-T6 vs 7075-T6, create a table with columns for Property, 6061-T6, 7075-T6, and rows for Yield Strength, Tensile Strength, Hardness, Cost, etc.
    * **Visual Q&A:** A visible H2 section titled "Frequently Asked Questions" at the bottom with 5-7 questions using <h3> for each question.
4.  **FAQ Schema:** Generate Google-compliant JSON-LD for the FAQ section.
5.  **Readability & Spacing:** 
    * Each paragraph should have proper spacing (wrap each in <p> tags).
    * Add a blank line/spacing between paragraphs for visual breathing room.
    * Keep paragraphs concise (3-5 sentences max) for better readability.
    * Use <br><br> between major sections if needed for visual separation.

---
### OUTPUT FORMAT (JSON - No markdown fencing!)
{
  "content": "<div class='blog-post'>...full HTML content with proper tags and spacing...</div>",
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
      excerpt: parsed.excerpt || "",
      metaTitle: parsed.metaTitle || `${title} | ${BRAND_NAME}`,
      metaDescription: parsed.metaDescription || parsed.excerpt || "",
      faqSchema: parsed.faqSchema || null,
    };
  } catch (error) {
    console.error("Failed to parse Gemini response as JSON:", error);
    console.error("Raw response:", response.substring(0, 500));
    return {
      content: response,
      excerpt: response.substring(0, 160) + "...",
      metaTitle: `${title} | ${BRAND_NAME}`,
      metaDescription: response.substring(0, 160),
      faqSchema: null,
    };
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
 * Main handler - Creates ONLY English article in DRAFT mode
 * Rotates through silos daily: Day 1-5 cycle through all 5 silos
 * User must manually trigger translations via the dashboard
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Determine today's silo based on rotation schedule
    const todaysSilo = getTodaysSilo();
    console.log(`Today's scheduled silo: ${todaysSilo}`);

    // 2. Fetch next unprocessed title from today's silo
    let { data: titleRecord, error: titleError } = await supabase
      .from("article_titles")
      .select("*")
      .eq("processed", false)
      .eq("silo_category", todaysSilo)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    // 3. If no title found in today's silo, try any unprocessed title (fallback)
    if (titleError || !titleRecord) {
      console.log(`No unprocessed titles found in ${todaysSilo}, trying any silo...`);
      const { data: fallbackTitle, error: fallbackError } = await supabase
        .from("article_titles")
        .select("*")
        .eq("processed", false)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (fallbackError || !fallbackTitle) {
        return new Response(
          JSON.stringify({ 
            message: "No unprocessed titles found",
            scheduled_silo: todaysSilo
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      titleRecord = fallbackTitle;
      console.log(`Using fallback title from silo: ${titleRecord.silo_category || 'None'}`);
    }

    console.log(`Processing title: ${titleRecord.title}`);
    console.log(`Silo category: ${titleRecord.silo_category || 'None'}`);

    // 4. Fetch silo neighbors for internal linking
    const siloNeighbors = await fetchSiloNeighbors(titleRecord.silo_category, titleRecord.id);
    const relatedArticlesForPrompt = formatSiloArticlesForPrompt(siloNeighbors);
    console.log(`Found ${siloNeighbors.length} silo neighbors for linking`);

    // 5. Generate master article with high thinking
    const masterArticle = await generateMasterArticle(
      titleRecord.title,
      titleRecord.silo_category,
      relatedArticlesForPrompt
    );
    const masterSlug = generateSlug(titleRecord.title);
    const translationId = crypto.randomUUID();

    // 6. Create master article in database - PUBLISHED MODE
    const { data: masterArticleRecord, error: masterError } = await supabase
      .from("articles")
      .insert([
        {
          title: titleRecord.title,
          slug: masterSlug,
          content: masterArticle.content,
          excerpt: masterArticle.excerpt,
          language: "en",
          status: "published", // PUBLISHED MODE - auto-publish for SEO
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

    console.log(`Master article created in PUBLISHED mode: ${masterArticleRecord.id}`);

    // 7. Create generation log
    const summaryData = {
      title: titleRecord.title,
      silo_category: titleRecord.silo_category,
      scheduled_silo: todaysSilo,
      matched_scheduled_silo: titleRecord.silo_category === todaysSilo,
      master_article_id: masterArticleRecord.id,
      status: "published",
      translations_pending: true,
      silo_neighbors_used: siloNeighbors.length,
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

    console.log(`Article generation complete. Ready for review and translation.`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "English article generated in DRAFT mode. Review and click 'Translate' to create translations.",
        scheduled_silo: todaysSilo,
        matched_scheduled_silo: titleRecord.silo_category === todaysSilo,
        title: titleRecord.title,
        silo_category: titleRecord.silo_category,
        master_article_id: masterArticleRecord.id,
        slug: masterSlug,
        status: "published",
        translation_id: translationId,
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
