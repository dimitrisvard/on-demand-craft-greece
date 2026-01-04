import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
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
    // Get published articles and filter by silo_category by matching with article_titles
    // Step 1: Get all published English articles
    const { data: allPublishedArticles, error: articlesError } = await supabase
      .from("articles")
      .select("title, slug, created_at")
      .eq("language", "en")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(20); // Get more to filter by silo

    if (articlesError || !allPublishedArticles) {
      console.error("Error fetching articles:", articlesError);
      return [];
    }

    // Step 2: Filter by matching titles with article_titles to get silo_category
    const siloNeighbors: SiloNeighbor[] = [];
    for (const article of allPublishedArticles) {
      // Skip if we already have 2 articles (max limit)
      if (siloNeighbors.length >= 2) break;
      
      // Check if this article's title matches an article_titles entry with the same silo
      const { data: titleMatch } = await supabase
        .from("article_titles")
        .select("silo_category, id")
        .eq("title", article.title)
        .eq("silo_category", siloCategory)
        .single();
      
      if (titleMatch && titleMatch.id !== currentId) {
        siloNeighbors.push({ 
          title: article.title, 
          slug: article.slug 
        });
      }
    }

    console.log(`[fetchSiloNeighbors] Found ${siloNeighbors.length} articles in silo "${siloCategory}"`);
    return siloNeighbors;
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
  // Limit to maximum 2 articles and instruct to use only 1-2 links
  const limitedNeighbors = neighbors.slice(0, 2);
  return limitedNeighbors.map(n => `- Title: "${n.title}" (Link: /en/blog/${n.slug})`).join("\n");
}

/**
 * Timeout wrapper for fetch requests
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 140000 // Increased to 140 seconds default
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Generate article using Claude Sonnet 4
 * Claude Sonnet 4 provides excellent writing quality with fast response times
 */
async function generateWithClaude(
  prompt: string,
  thinkingLevel: "high" | "low" = "high"
): Promise<string> {
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const model = "claude-sonnet-4-20250514";
  const url = "https://api.anthropic.com/v1/messages";

  const requestBody = {
    model: model,
    max_tokens: 16384, // Increased for 2500-word articles with HTML formatting (was 8192, causing truncation)
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  };

  console.log(`[generateWithClaude] Starting Claude API request at ${new Date().toISOString()}`);
  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
      },
      140000 // 140 second timeout for Claude API (leaves 10s buffer for database operations)
    );

    const elapsedTime = Date.now() - startTime;
    console.log(`[generateWithClaude] Claude API response received after ${elapsedTime}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[generateWithClaude] Claude API error: ${response.status}`, errorText.substring(0, 500));
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
    console.log(`[generateWithClaude] Claude API completed in ${totalTime}ms`);
    console.log(`[generateWithClaude] Claude API usage: ${data.usage.input_tokens} input, ${data.usage.output_tokens} output tokens`);
    console.log(`[generateWithClaude] Stop reason: ${data.stop_reason}`);

    // Check if response was truncated due to max_tokens limit
    if (data.stop_reason === "max_tokens") {
      console.error(`[generateWithClaude] ERROR: Response was truncated due to max_tokens limit!`);
      console.error(`[generateWithClaude] Output tokens used: ${data.usage.output_tokens}/${requestBody.max_tokens}`);
      throw new Error(`Claude response truncated: hit max_tokens limit (${requestBody.max_tokens}). Response incomplete - article generation failed.`);
    }

    return textContent.text;
  } catch (error: any) {
    const elapsedTime = Date.now() - startTime;
    console.error(`[generateWithClaude] Error after ${elapsedTime}ms:`, error.message);
    throw error;
  }
}

/**
 * Get rotation index for service pages and quote text
 * Rotates through: CNC Machining (0), Sheet Metal (1), Injection Molding (2)
 */
async function getRotationIndex(): Promise<{ serviceIndex: number; quoteIndex: number }> {
  // Count published articles to determine rotation
  const { count } = await supabase
    .from("articles")
    .select("*", { count: "exact", head: true })
    .eq("language", "en")
    .eq("status", "published");
  
  const articleCount = count || 0;
  const serviceIndex = articleCount % 3; // Rotate through 3 services
  const quoteIndex = articleCount % 5; // Rotate through 5 quote variations
  
  return { serviceIndex, quoteIndex };
}

/**
 * Generate master article with high thinking level - "Master Engineer" Prompt
 * Creates ONLY the English version in PUBLISHED mode
 */
async function generateMasterArticle(
  title: string,
  siloCategory: string | null,
  relatedArticles: string,
  serviceIndex: number,
  quoteIndex: number
): Promise<{
  content: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  faqSchema: any;
}> {
  // Service page rotation mapping
  const servicePages = [
    { name: "CNC Machining", url: "/en/services/cnc-machining", anchor: "precision CNC machining services" },
    { name: "Sheet Metal Fabrication", url: "/en/services/sheet-metal", anchor: "sheet metal fabrication services" },
    { name: "Injection Molding", url: "/en/services/injection-molding", anchor: "injection molding services" }
  ];
  const selectedService = servicePages[serviceIndex];
  
  // Quote link text variations (rotating)
  const quoteTexts = [
    "Get a quote in 24 hours",
    "Receive a detailed quote within 24 hours",
    "Request a free quote and get pricing in 24 hours",
    "Get your custom quote delivered in 24 hours",
    "Submit your project for a 24-hour quote"
  ];
  const selectedQuoteText = quoteTexts[quoteIndex];
  const prompt = `Role: Senior Manufacturing Engineer & Technical SEO Specialist (20+ years exp).
Author Persona: Write as the lead engineer for ${BRAND_NAME}. Tone is authoritative, precise, and helpful—never salesy or generic.

Task: Write a definitive, comprehensive technical guide on: "${title}"

---
### CRITICAL SAFEGUARDS (Strict Compliance Required)
1.  **Brand Identity:** Refer to us as "${BRAND_NAME}". Never translate or alter this name.
2.  **No "AI Fluff":** Do NOT start with "In the ever-evolving landscape of manufacturing..." or "In today's fast-paced world...". Start immediately with technical value or a defining engineering problem.
3.  **Accuracy:** Use exact ISO standards (e.g., ISO 2768, ISO 9001) and material grades (e.g., Al 6061-T6, not just "Aluminum").
4.  **Formatting:** Return ONLY valid, complete JSON. No markdown fencing (\`\`\`json) around the response. CRITICAL: The JSON must be complete and properly closed with all closing braces. Do not truncate the JSON response.

---
### EUROPEAN LOCALIZATION (MANDATORY)
**Target Audience: European manufacturers and engineers. Follow these rules strictly:**
1.  **Currency:** Always use Euro (€) for ALL prices. NEVER use Dollar ($). Example: "Starting from €500" not "$500".
2.  **Measurements:** Use METRIC ONLY - centimeters (cm) and millimeters (mm). NEVER use inches or feet. Example: "tolerance of ±0.05 mm" not "±0.002 inches".
3.  **Decimal Notation:** Use comma for decimals in measurements when contextually appropriate (e.g., "2,5 mm" is acceptable, but "2.5 mm" is also fine for technical content).
4.  **Weight:** Use kilograms (kg) and grams (g), NEVER pounds (lb) or ounces (oz).

---
### LINKING STRATEGY (Dynamic Insertion)
You must insert 4 specific types of links naturally into the flow of the text:
1.  **Silo Context Link:** Choose ONLY 1-2 relevant articles from this list (use the SAME number each time, do NOT accumulate):
${relatedArticles}
    Link to them using natural anchor text where the concept is mentioned. Use format: <a href="/en/blog/slug-here">anchor text</a> (no extra spaces inside the link tag - spaces will be added automatically)
    CRITICAL: If there are 2 articles in the list, use exactly 1-2 links. Do NOT add more links than articles in the list. Do NOT accumulate links across articles.
2.  **Specific Service Page Link (ROTATION - MANDATORY):** You MUST include ONE link to the ${selectedService.name} service page. Find a natural place in the content where ${selectedService.name.toLowerCase()} or related manufacturing processes are discussed, and insert a natural link: <a href="${selectedService.url}">${selectedService.anchor}</a> (no extra spaces inside the link tag - spaces will be added automatically).
3.  **General Service Page Link:** When mentioning manufacturing processes, link to the general service path using: <a href="/en/services">our manufacturing services</a> (no extra spaces inside the link tag - spaces will be added automatically)
4.  **Commercial Intent (Quote - ROTATING TEXT):** Near the 60% mark of the article, insert a distinct, persuasive single-sentence paragraph with rotating text:
    * Use this exact format: "For high-precision results, <a href="/en/quote">${selectedQuoteText}</a> from ${BRAND_NAME}." (no extra spaces inside the link tag - spaces will be added automatically)
    * CRITICAL: NEVER use the word "instant" or "immediately" in quote sentences. Use phrases like "within 24 hours", "in 24 hours", or "delivered in 24 hours" instead.

---
### CONTENT REQUIREMENTS
1.  **Length:** Minimum 2500 words of comprehensive, detailed technical content. Go deep into each topic with specific examples, use cases, technical specifications, and practical insights. Each section should be substantial (minimum 250-350 words per major section).
2.  **Depth & Detail:** 
    * Provide detailed explanations, not just surface-level information
    * Include specific technical values, ranges, and specifications
    * Explain the "why" behind recommendations, not just the "what"
    * Add practical examples and real-world applications
    * Include nuanced comparisons and trade-offs
3.  **Silo Category:** This article belongs to the "${siloCategory || 'General'}" content silo.
4.  **Structure:**
    * **DO NOT include an H1 title in the content** - the title is already provided and will be displayed separately. Start directly with the introduction paragraph or Executive Summary.
    * **Executive Summary:** A "Key Takeaways" bullet list (3-4 points) right after the intro using <ul><li> tags.
    * **Deep Dive (H2/H3):** Detailed process, tolerances, material selection, and cost drivers.
    * **Comparison Tables (MANDATORY):** 
      - ALWAYS create HTML tables (<table>) when comparing materials, processes, properties, specifications, or any data that benefits from side-by-side comparison.
      - Use tables for: material properties (tensile strength, hardness, cost), process comparisons (CNC vs 3D printing), tolerance ranges, pricing tiers, material grades, surface finish options, etc.
      - Format tables with proper HTML structure: <table class="editor-table"><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>
      - CRITICAL: Tables MUST be properly closed with </table> tag. Each <tr> must be closed with </tr>, each <td> with </td>, each <th> with </th>, <thead> with </thead>, <tbody> with </tbody>.
      - Include inline styles for borders and spacing if needed, but primary styling is via CSS classes.
      - Use <th> for header cells in <thead> section.
      - Use <td> for data cells in <tbody> section.
      - Make tables responsive and readable with proper column alignment.
      - NEVER break table structure - keep all table HTML tags intact and properly nested.
      - Example: When comparing aluminum 6061-T6 vs 7075-T6, create a table with columns for Property, 6061-T6, 7075-T6, and rows for Yield Strength, Tensile Strength, Hardness, Cost, etc.
    * **Visual Q&A:** A visible H2 section titled "Frequently Asked Questions" at the bottom with 5-7 questions using <h3> for each question.
4.  **FAQ Schema:** Generate Google-compliant JSON-LD for the FAQ section.
5.  **Microns Hub Benefits Paragraph (MANDATORY):** Near the 75% mark of the article, insert a dedicated paragraph (2-3 sentences) highlighting the advantages of ordering from ${BRAND_NAME} versus marketplaces. Mention benefits such as superior quality control, competitive pricing, direct manufacturer relationship, personalized service, and technical expertise. Make it natural and contextual to the article content. Example format: "When ordering from ${BRAND_NAME}, you benefit from direct manufacturer relationships that ensure superior quality control and competitive pricing compared to marketplace platforms. Our technical expertise and personalized service approach means every project receives the attention to detail it deserves."
6.  **Readability & Spacing:** 
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

  const response = await generateWithClaude(prompt, "high");
  
  try {
    // Clean the response: remove markdown code fences if present
    let jsonText = response.trim();
    
    // Remove markdown code fences
    jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    
    // Find the JSON object boundaries
    const jsonStartIndex = jsonText.indexOf('{');
    let jsonEndIndex = jsonText.lastIndexOf('}');
    
    if (jsonStartIndex === -1) {
      throw new Error("Could not find JSON start boundary");
    }
    
    // If no closing brace found, try to find the last valid position and attempt to close the JSON
    if (jsonEndIndex === -1 || jsonEndIndex <= jsonStartIndex) {
      console.warn("[generateMasterArticle] No valid closing brace found, attempting to fix truncated JSON");
      // Try to find where the content field ends and close the JSON manually
      const contentMatch = jsonText.match(/"content"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
      if (contentMatch) {
        // Find the position after the content string
        const contentEndPos = jsonText.indexOf('"', contentMatch.index + contentMatch[0].length - 1);
        if (contentEndPos > 0) {
          // Try to close the JSON structure
          jsonText = jsonText.substring(jsonStartIndex, contentEndPos + 1);
          // Add closing braces for any missing structure
          let openBraces = (jsonText.match(/{/g) || []).length;
          let closeBraces = (jsonText.match(/}/g) || []).length;
          while (openBraces > closeBraces) {
            jsonText += '}';
            closeBraces++;
          }
          jsonEndIndex = jsonText.length - 1;
        }
      }
      
      if (jsonEndIndex === -1 || jsonEndIndex <= jsonStartIndex) {
        throw new Error("Could not find or fix JSON boundaries");
      }
    }
    
    jsonText = jsonText.substring(jsonStartIndex, jsonEndIndex + 1);
    
    // Parse JSON (this will automatically handle escaped newlines \n)
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError: any) {
      console.error("[generateMasterArticle] JSON parse error:", parseError.message);
      console.error("[generateMasterArticle] JSON text preview (first 1000 chars):", jsonText.substring(0, 1000));
      console.error("[generateMasterArticle] JSON text preview (last 500 chars):", jsonText.substring(Math.max(0, jsonText.length - 500)));
      
      // Try to extract content using a more robust method for truncated JSON
      // Look for "content": " and try to extract until we find a closing quote (handling escaped quotes)
      const contentStartPattern = /"content"\s*:\s*"/;
      const contentStartMatch = jsonText.match(contentStartPattern);
      
      if (contentStartMatch && contentStartMatch.index !== undefined) {
        console.warn("[generateMasterArticle] Attempting to extract partial content from malformed JSON");
        let contentStart = contentStartMatch.index + contentStartMatch[0].length;
        let contentEnd = contentStart;
        let inEscape = false;
        
        // Find the end of the content string, handling escaped characters
        while (contentEnd < jsonText.length) {
          if (inEscape) {
            inEscape = false;
          } else if (jsonText[contentEnd] === '\\') {
            inEscape = true;
          } else if (jsonText[contentEnd] === '"') {
            // Found the end of the content string
            break;
          }
          contentEnd++;
        }
        
        if (contentEnd < jsonText.length) {
          const extractedContent = jsonText.substring(contentStart, contentEnd);
          // Unescape the content
          const unescapedContent = extractedContent
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
          
          // Try to extract other fields similarly
          const excerptMatch = jsonText.match(/"excerpt"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
          const metaTitleMatch = jsonText.match(/"metaTitle"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
          const metaDescMatch = jsonText.match(/"metaDescription"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
          
          parsed = {
            content: unescapedContent,
            excerpt: excerptMatch ? excerptMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : "",
            metaTitle: metaTitleMatch ? metaTitleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : `${title} | ${BRAND_NAME}`,
            metaDescription: metaDescMatch ? metaDescMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : "",
            faqSchema: null
          };
          console.warn("[generateMasterArticle] Successfully extracted partial content from malformed JSON");
        } else {
          throw new Error(`Failed to parse article JSON: ${parseError.message}. Content extraction also failed.`);
        }
      } else {
        throw new Error(`Failed to parse article JSON: ${parseError.message}`);
      }
    }

    // Extract and validate content
    let content = parsed.content || "";
    let excerpt = parsed.excerpt || "";
    let metaTitle = parsed.metaTitle || `${title} | ${BRAND_NAME}`;
    let metaDescription = parsed.metaDescription || excerpt || "";
    
    // Clean up content: ensure it's a string and doesn't contain the JSON wrapper
    if (typeof content !== 'string') {
      content = String(content);
    }
    
    // ADD HTML CLEANUP: Clean HTML content to remove excessive newlines and fix formatting
    content = cleanHtmlContent(content);
    
    // Validate content meets minimum word count requirement
    const wordCount = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(w => w.length > 0).length;
    const minWords = 2000; // Allow some flexibility (2500 is target, 2000 is minimum)
    const targetWords = 2500;

    if (wordCount < minWords) {
      console.error(`[generateMasterArticle] WARNING: Content is shorter than expected!`);
      console.error(`[generateMasterArticle] Word count: ${wordCount} (minimum: ${minWords}, target: ${targetWords})`);
      console.error(`[generateMasterArticle] Content length: ${content.length} characters`);
      console.error(`[generateMasterArticle] Content ends with: ${content.substring(Math.max(0, content.length - 100))}`);
      
      // Check if content ends mid-tag (indicates truncation)
      const endsMidTag = content.match(/<[^>]*$/);
      if (endsMidTag) {
        console.error(`[generateMasterArticle] ERROR: Content ends mid-HTML tag - truncation detected!`);
        throw new Error(`Article content truncated: Only ${wordCount} words generated (target: ${targetWords}). Content ends mid-HTML tag. This indicates the Claude API response was incomplete.`);
      }
      
      // If content is too short but appears complete, log warning but don't fail
      // This allows monitoring and manual review
      console.warn(`[generateMasterArticle] Content is ${((1 - wordCount/targetWords) * 100).toFixed(1)}% shorter than target but appears complete`);
    } else {
      console.log(`[generateMasterArticle] Content validation passed: ${wordCount} words (target: ${targetWords})`);
    }
    
    // Remove any H1 title tags from content (title is already stored separately)
    // Remove H1 tags at the start, middle, or end of content
    content = content.replace(/<h1[^>]*>.*?<\/h1>/gi, '');
    // Also remove any H1 that might match the article title specifically
    const titleH1Pattern = new RegExp(`<h1[^>]*>\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</h1>\\s*`, 'gi');
    content = content.replace(titleH1Pattern, '');
    // Clean up any double spaces or newlines left after H1 removal
    content = content.replace(/\s{3,}/g, ' ').replace(/\n{3,}/g, '\n\n');
    
    // Clean excerpt and metaDescription: remove any JSON artifacts
    excerpt = excerpt.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    metaDescription = metaDescription.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    
    // Ensure excerpt doesn't contain the full JSON response
    if (excerpt.includes('"content":') || excerpt.includes('```json')) {
      excerpt = excerpt.substring(0, 160).split('\n')[0].trim();
    }
    if (metaDescription.includes('"content":') || metaDescription.includes('```json')) {
      metaDescription = metaDescription.substring(0, 160).split('\n')[0].trim();
    }

    return {
      content: content,
      excerpt: excerpt.substring(0, 160), // Ensure max 160 chars
      metaTitle: metaTitle.substring(0, 80), // Ensure max 80 chars (60 + brand name space)
      metaDescription: metaDescription.substring(0, 160), // Ensure max 160 chars
      faqSchema: parsed.faqSchema || null,
    };
  } catch (error: any) {
    console.error("[generateMasterArticle] Failed to parse Claude response as JSON:", error);
    console.error("[generateMasterArticle] Raw response preview (first 1000 chars):", response.substring(0, 1000));
    console.error("[generateMasterArticle] Raw response preview (last 500 chars):", response.substring(Math.max(0, response.length - 500)));
    throw new Error(`Failed to parse article JSON: ${error.message}`);
  }
}

/**
 * Clean and normalize HTML content
 * - Removes excessive newlines and whitespace
 * - Fixes table structures
 * - Normalizes spacing between HTML tags
 */
function cleanHtmlContent(html: string): string {
  if (!html) return "";
  
  // Remove excessive newlines (more than 2 consecutive)
  html = html.replace(/\n{3,}/g, '\n\n');
  
  // Normalize whitespace between HTML tags (but preserve intentional spacing)
  // Replace newlines between closing and opening tags with single newline
  html = html.replace(/>\s*\n\s*</g, '>\n<');
  
  // Normalize link spacing - ensure single space before <a> and after </a>
  // First, normalize any existing spaces (remove multiple spaces, keep single)
  html = html.replace(/\s+(<a\s+[^>]*href)/g, ' $1'); // Normalize multiple spaces before <a> to single space
  html = html.replace(/(<\/a>)\s+/g, '$1 '); // Normalize multiple spaces after </a> to single space
  
  // Then, add space before <a> only if missing (and not in table cells or after punctuation)
  html = html.replace(/([^\s>])(<a\s+[^>]*href)/g, (match, p1, p2, offset, string) => {
    // Check if we're inside a table cell - if so, don't add space
    const beforeMatch = string.substring(0, offset);
    const lastTd = beforeMatch.lastIndexOf('<td');
    const lastTh = beforeMatch.lastIndexOf('<th');
    const lastTdClose = beforeMatch.lastIndexOf('</td>');
    const lastThClose = beforeMatch.lastIndexOf('</th>');
    const inTableCell = (lastTd > lastTdClose || lastTh > lastThClose);
    
    // Don't add space if previous char is punctuation or opening tag
    if (p1 === '.' || p1 === ',' || p1 === '!' || p1 === '?' || p1 === ';' || p1 === ':' || p1 === '>' || p1 === '(') {
      return match;
    }
    
    return inTableCell ? match : `${p1} ${p2}`;
  });
  
  // Add space after </a> only if missing (and not in table cells or before punctuation)
  html = html.replace(/(<\/a>)([^\s<])/g, (match, p1, p2, offset, string) => {
    // Check if we're inside a table cell - if so, don't add space
    const beforeMatch = string.substring(0, offset);
    const lastTd = beforeMatch.lastIndexOf('<td');
    const lastTh = beforeMatch.lastIndexOf('<th');
    const lastTdClose = beforeMatch.lastIndexOf('</td>');
    const lastThClose = beforeMatch.lastIndexOf('</th>');
    const inTableCell = (lastTd > lastTdClose || lastTh > lastThClose);
    
    // Don't add space if next char is punctuation or closing tag
    if (p2 === '.' || p2 === ',' || p2 === '!' || p2 === '?' || p2 === ';' || p2 === ':' || p2 === '<' || p2 === ')' || p2 === ']') {
      return match;
    }
    
    return inTableCell ? match : `${p1} ${p2}`;
  });
  
  // Final pass: ensure links have proper spacing (more aggressive)
  // Fix cases where links might be directly adjacent to text without spaces
  html = html.replace(/([a-zA-Z0-9])(<a\s+[^>]*href)/g, (match, p1, p2, offset, string) => {
    const beforeMatch = string.substring(0, offset);
    const lastTd = beforeMatch.lastIndexOf('<td');
    const lastTh = beforeMatch.lastIndexOf('<th');
    const lastTdClose = beforeMatch.lastIndexOf('</td>');
    const lastThClose = beforeMatch.lastIndexOf('</th>');
    const inTableCell = (lastTd > lastTdClose || lastTh > lastThClose);
    return inTableCell ? match : `${p1} ${p2}`;
  });
  
  html = html.replace(/(<\/a>)([a-zA-Z0-9])/g, (match, p1, p2, offset, string) => {
    const beforeMatch = string.substring(0, offset);
    const lastTd = beforeMatch.lastIndexOf('<td');
    const lastTh = beforeMatch.lastIndexOf('<th');
    const lastTdClose = beforeMatch.lastIndexOf('</td>');
    const lastThClose = beforeMatch.lastIndexOf('</th>');
    const inTableCell = (lastTd > lastTdClose || lastTh > lastThClose);
    return inTableCell ? match : `${p1} ${p2}`;
  });
  
  // Clean up table cells - remove excessive whitespace in table cells
  // Pattern: empty cells with just whitespace/newlines
  html = html.replace(/(<td[^>]*>)\s*\n\s*\n+(<\/td>)/g, '$1 $2');
  html = html.replace(/(<th[^>]*>)\s*\n\s*\n+(<\/th>)/g, '$1 $2');
  
  // Remove leading/trailing whitespace from content inside tags (but preserve pre/code)
  html = html.replace(/(>)([^<]+?)(<)/g, (match, open, content, close) => {
    // Check if we're inside a pre or code tag by looking backwards
    const beforeMatch = html.substring(0, html.indexOf(match));
    const lastPre = beforeMatch.lastIndexOf('<pre');
    const lastCode = beforeMatch.lastIndexOf('<code');
    const lastPreClose = beforeMatch.lastIndexOf('</pre>');
    const lastCodeClose = beforeMatch.lastIndexOf('</code>');
    
    const insidePre = lastPre > lastPreClose && lastPre !== -1;
    const insideCode = lastCode > lastCodeClose && lastCode !== -1;
    
    if (insidePre || insideCode) return match;
    
    // Trim content but preserve single newlines
    const trimmed = content.trim();
    return trimmed ? open + trimmed + close : match;
  });
  
  // Fix multiple consecutive spaces in text (but preserve in pre/code)
  html = html.replace(/([^>])\s{2,}([^<])/g, (match, before, after, offset) => {
    const beforeMatch = html.substring(0, offset);
    const lastPre = beforeMatch.lastIndexOf('<pre');
    const lastCode = beforeMatch.lastIndexOf('<code');
    const lastPreClose = beforeMatch.lastIndexOf('</pre>');
    const lastCodeClose = beforeMatch.lastIndexOf('</code>');
    
    const insidePre = lastPre > lastPreClose && lastPre !== -1;
    const insideCode = lastCode > lastCodeClose && lastCode !== -1;
    
    if (insidePre || insideCode) return match;
    return before + ' ' + after;
  });
  
  // Remove newlines at the very start/end
  html = html.trim();
  
  return html;
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
 * Main handler - Creates ONLY English article in PUBLISHED mode
 * Rotates through silos daily: Day 1-5 cycle through all 5 silos
 * Auto-translation will occur 2 hours after article creation via cron job
 */
serve(async (req) => {
  // Log immediately when function is called
  console.log(`[generate-daily-article] Function called at ${new Date().toISOString()}`);
  console.log(`[generate-daily-article] Method: ${req.method}`);
  
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Validate environment variables early
  console.log(`[generate-daily-article] Checking environment variables...`);
  console.log(`[generate-daily-article] SUPABASE_URL: ${supabaseUrl ? 'SET' : 'MISSING'}`);
  console.log(`[generate-daily-article] SUPABASE_SERVICE_ROLE_KEY: ${supabaseServiceKey ? 'SET' : 'MISSING'}`);
  console.log(`[generate-daily-article] ANTHROPIC_API_KEY: ${anthropicApiKey ? 'SET' : 'MISSING'}`);
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[generate-daily-article] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response(
      JSON.stringify({ error: "Server configuration error: Missing Supabase credentials" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }

  if (!anthropicApiKey) {
    console.error("[generate-daily-article] Missing ANTHROPIC_API_KEY");
    return new Response(
      JSON.stringify({ error: "Server configuration error: ANTHROPIC_API_KEY not configured" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }

  console.log(`[generate-daily-article] Environment variables validated, starting processing...`);
  const functionStartTime = Date.now();

  // Parse request body once
  let requestBody: any = {};
  try {
    requestBody = await req.json();
  } catch (e) {
    // Body might be empty or not JSON - that's okay for normal flow
    requestBody = {};
  }

  try {
    // Check if called from queue worker (has title_id in body)
    let titleRecord: any = null;
    let queueJobId: string | null = null;
    let todaysSilo = getTodaysSilo();
    let rotationSilo = "";
    
    if (requestBody.title_id) {
      // Called from queue worker
      console.log(`[generate-daily-article] Called from queue worker with title_id: ${requestBody.title_id}`);
      queueJobId = requestBody.queue_job_id || null;
      
      const { data: titleData, error: titleDataError } = await supabase
        .from("article_titles")
        .select("*")
        .eq("id", requestBody.title_id)
        .single();
      
      if (titleDataError || !titleData) {
        throw new Error(`Title not found: ${requestBody.title_id}`);
      }
      
      if (titleData.processed) {
        throw new Error(`Title already processed: ${requestBody.title_id}`);
      }
      
      titleRecord = titleData;
      console.log(`[generate-daily-article] Processing queued title: ${titleRecord.title}`);
    }

    // If not from queue, use normal title selection logic
    if (!titleRecord) {
      // 1. Determine today's silo based on rotation schedule
      todaysSilo = getTodaysSilo();
      console.log(`[generate-daily-article] Today's scheduled silo: ${todaysSilo}`);

      // 2. Count articles created today to rotate through silos for manual creation
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStart = today.toISOString();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const todayEnd = tomorrow.toISOString();
      
      const { count: articlesTodayCount } = await supabase
        .from("articles")
        .select("*", { count: "exact", head: true })
        .eq("language", "en")
        .eq("status", "published")
        .gte("created_at", todayStart)
        .lt("created_at", todayEnd);
      
      const articlesToday = articlesTodayCount || 0;
      // Rotate through silos based on articles created today (for manual creation)
      const rotationIndex = articlesToday % SILO_ROTATION.length;
      rotationSilo = SILO_ROTATION[rotationIndex];
      console.log(`Articles created today: ${articlesToday}, rotation silo: ${rotationSilo}`);

      // 3. Try to fetch from rotation silo first (for manual creation variety), then today's silo, then any
      let { data: titleData, error: titleError } = await supabase
        .from("article_titles")
        .select("*")
        .eq("processed", false)
        .eq("silo_category", rotationSilo)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      // 4. If no title found in rotation silo, try today's scheduled silo
      if (titleError || !titleData) {
        console.log(`No unprocessed titles found in ${rotationSilo}, trying today's silo ${todaysSilo}...`);
        const { data: todaysSiloTitle, error: todaysSiloError } = await supabase
          .from("article_titles")
          .select("*")
          .eq("processed", false)
          .eq("silo_category", todaysSilo)
          .order("created_at", { ascending: true })
          .limit(1)
          .single();
        
        if (!todaysSiloError && todaysSiloTitle) {
          titleData = todaysSiloTitle;
          console.log(`Using title from today's scheduled silo: ${todaysSilo}`);
        }
      }

      // 5. If still no title found, try any unprocessed title (fallback)
      if (titleError || !titleData) {
        console.log(`No unprocessed titles found in rotation or scheduled silos, trying any silo...`);
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
              scheduled_silo: todaysSilo,
              rotation_silo: rotationSilo
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            }
          );
        }

        titleData = fallbackTitle;
        console.log(`Using fallback title from silo: ${titleData.silo_category || 'None'}`);
      }
      
      titleRecord = titleData;
    }

    console.log(`Processing title: ${titleRecord.title}`);
    console.log(`Silo category: ${titleRecord.silo_category || 'None'}`);

    // 6. Fetch silo neighbors for internal linking
    const siloNeighbors = await fetchSiloNeighbors(titleRecord.silo_category, titleRecord.id);
    const relatedArticlesForPrompt = formatSiloArticlesForPrompt(siloNeighbors);
    console.log(`Found ${siloNeighbors.length} silo neighbors for linking`);

    // 7. Get rotation indices for service pages and quote text
    const { serviceIndex, quoteIndex } = await getRotationIndex();
    const serviceNames = ["CNC Machining", "Sheet Metal Fabrication", "Injection Molding"];
    console.log(`Service rotation: ${serviceNames[serviceIndex]} (index ${serviceIndex})`);
    console.log(`Quote text rotation: index ${quoteIndex}`);

    // 8. Generate master article with high thinking
    console.log(`[generate-daily-article] Starting article generation at ${new Date().toISOString()}`);
    const generationStartTime = Date.now();
    
    const masterArticle = await generateMasterArticle(
      titleRecord.title,
      titleRecord.silo_category,
      relatedArticlesForPrompt,
      serviceIndex,
      quoteIndex
    );
    
    const generationTime = Date.now() - generationStartTime;
    console.log(`[generate-daily-article] Article generation completed in ${generationTime}ms`);
    
    // Check if we're approaching timeout - if so, save immediately
    const elapsedTime = Date.now() - functionStartTime;
    if (elapsedTime > 140000) {
      console.warn(`[generate-daily-article] Approaching timeout (${elapsedTime}ms), saving article immediately`);
    }
    
    const masterSlug = generateSlug(titleRecord.title);
    const translationId = crypto.randomUUID();

    // 9. Create master article in database - PUBLISHED MODE (do this ASAP to avoid timeout)
    console.log(`[generate-daily-article] Saving article to database...`);
    const saveStartTime = Date.now();
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

    const saveTime = Date.now() - saveStartTime;
    console.log(`[generate-daily-article] Database save completed in ${saveTime}ms`);
    
    if (masterError || !masterArticleRecord) {
      // If called from queue, mark as failed
      if (queueJobId) {
        await supabase.rpc('mark_queue_job_failed', {
          queue_job_id: queueJobId,
          error_msg: `Failed to create master article: ${masterError?.message}`
        });
      }
      throw new Error(`Failed to create master article: ${masterError?.message}`);
    }

    console.log(`[generate-daily-article] Master article created in PUBLISHED mode: ${masterArticleRecord.id}`);

    // 10. Create generation log
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

    // 11. Mark title as processed and update queue if applicable
    await supabase
      .from("article_titles")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq("id", titleRecord.id);
    
    // If called from queue, mark queue job as completed
    if (queueJobId) {
      await supabase.rpc('mark_queue_job_completed', {
        queue_job_id: queueJobId,
        article_id: masterArticleRecord.id
      });
      console.log(`[generate-daily-article] Queue job ${queueJobId} marked as completed`);
    }

    const totalFunctionTime = Date.now() - functionStartTime;
    console.log(`[generate-daily-article] Article generation complete. Total function time: ${totalFunctionTime}ms`);
    console.log(`[generate-daily-article] Ready for review and translation.`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "English article generated and published. Auto-translation will occur in 2 hours.",
        scheduled_silo: todaysSilo,
        matched_scheduled_silo: titleRecord.silo_category === todaysSilo,
        title: titleRecord.title,
        silo_category: titleRecord.silo_category,
        master_article_id: masterArticleRecord.id,
        slug: masterSlug,
        status: "published",
        translation_id: translationId,
        silo_neighbors_used: siloNeighbors.length,
        execution_time_ms: totalFunctionTime,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    const totalFunctionTime = Date.now() - functionStartTime;
    console.error(`[generate-daily-article] Error after ${totalFunctionTime}ms:`, error);
    console.error("[generate-daily-article] Error stack:", error.stack);
    console.error("[generate-daily-article] Error message:", error.message);
    console.error("[generate-daily-article] Error name:", error.name);
    
    // If called from queue, mark queue job as failed
    // Note: The worker function will handle marking as failed since it has the queue_job_id
    
    // Check if it's a timeout error
    const isTimeout = error.message?.includes('timeout') || error.message?.includes('AbortError') || totalFunctionTime > 140000;
    
    return new Response(
      JSON.stringify({ 
        error: error.message || "Unknown error",
        errorType: error.name || "Error",
        isTimeout: isTimeout,
        execution_time_ms: totalFunctionTime,
        stack: error.stack,
        queue_job_id: requestBody.queue_job_id || null // Include for worker to handle
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: isTimeout ? 504 : 500, // 504 Gateway Timeout for timeout errors
      }
    );
  }
});
