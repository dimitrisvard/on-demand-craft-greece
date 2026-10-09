// @ts-nocheck
// TEST-ONLY ORACLE: copy of the deployed edge function generate-daily-article (version 36), used by test/p5/content/** to
// compare the Worker port with the live code on the same inputs. Never imported by src/.
// The copied regions are the live text unchanged; the edits are:
//   - the imports and the Deno.env reads are replaced by constants; createClient by a settable supabase client
//   - generateWithClaude (the HTTP call) is renamed liveGenerateWithClaude and the name generateWithClaude resolves to a settable test double
//   - the serve() handler is left out
//   - exports added at the end
// Generated from the live source; do not edit by hand.
/* eslint-disable */

const anthropicApiKey = "oracle-test-value";
const anthropicModel = "claude-sonnet-5";
let supabase: any = null;
let generateWithClaude: (prompt: string, level?: string) => Promise<string> = async () => { throw new Error('oracle model not set'); };
export function setOracleSupabase(client: any): void { supabase = client; }
export function setOracleModel(fn: (prompt: string, level?: string) => Promise<string>): void { generateWithClaude = fn; }

// Brand name - NEVER translate or alter this
const BRAND_NAME = "Microns Hub";


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
 * Generate article using Claude Sonnet 5
 * Claude Sonnet 5 provides excellent writing quality with fast response times
 */
async function liveGenerateWithClaude(
  prompt: string,
  thinkingLevel: "high" | "low" = "high"
): Promise<string> {
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const model = anthropicModel;
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

  console.log(`[generateWithClaude] Using model: ${model}`);
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
 * Recover the "content" field from a JSON response that failed JSON.parse.
 *
 * The model occasionally emits a raw, unescaped double quote inside the HTML it puts
 * in the "content" string, which invalidates the whole JSON document. The previous
 * recovery scanned forward from the start of the content string to the FIRST
 * unescaped double quote and treated that as the end of the field - so a stray quote
 * one third of the way through the article silently cut the rest off, publishing
 * 880-1449 word stubs of what were complete 2500-word responses.
 *
 * Instead, anchor the END of the content on the next top-level JSON key that always
 * follows it ("excerpt", or one of the other known keys). Everything between is the
 * article, stray quotes included.
 */
function recoverContentField(jsonText: string, contentStart: number): { content: string; recoveredBy: string } {
  const tailPattern = /"\s*,\s*"(excerpt|metaTitle|metaDescription|faqSchema)"\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = tailPattern.exec(jsonText)) !== null) {
    if (match.index > contentStart) {
      return { content: jsonText.substring(contentStart, match.index), recoveredBy: `key:${match[1]}` };
    }
  }

  // No following key found (response really is cut off). Fall back to scanning for the
  // first unescaped quote; the caller's length guard will reject it if it is too short.
  let i = contentStart;
  let inEscape = false;
  while (i < jsonText.length) {
    if (inEscape) {
      inEscape = false;
    } else if (jsonText[i] === '\\') {
      inEscape = true;
    } else if (jsonText[i] === '"') {
      break;
    }
    i++;
  }
  return { content: jsonText.substring(contentStart, i), recoveredBy: 'first-unescaped-quote' };
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
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
5.  **JSON STRING ESCAPING (CRITICAL - read carefully):** The HTML you write goes inside a JSON string value. EVERY double quote character inside that HTML MUST be escaped as \\" - for example write <table class=\\"editor-table\\"> and <a href=\\"/en/quote\\">, NOT <table class="editor-table">. A single unescaped double quote anywhere in the content invalidates the entire response and the article is discarded. If you are unsure, prefer single quotes for HTML attributes (e.g. <table class='editor-table'>), which need no escaping at all.

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
    Link to them using natural anchor text where the concept is mentioned. Use format: <a href='/en/blog/slug-here'>anchor text</a> (no extra spaces inside the link tag - spaces will be added automatically)
    CRITICAL: If there are 2 articles in the list, use exactly 1-2 links. Do NOT add more links than articles in the list. Do NOT accumulate links across articles.
2.  **Specific Service Page Link (ROTATION - MANDATORY):** You MUST include ONE link to the ${selectedService.name} service page. Find a natural place in the content where ${selectedService.name.toLowerCase()} or related manufacturing processes are discussed, and insert a natural link: <a href='${selectedService.url}'>${selectedService.anchor}</a> (no extra spaces inside the link tag - spaces will be added automatically).
3.  **General Service Page Link:** When mentioning manufacturing processes, link to the general service path using: <a href='/en/services'>our manufacturing services</a> (no extra spaces inside the link tag - spaces will be added automatically)
4.  **Commercial Intent (Quote - ROTATING TEXT):** Near the 60% mark of the article, insert a distinct, persuasive single-sentence paragraph with rotating text:
    * Use this exact format: "For high-precision results, <a href='/en/quote'>${selectedQuoteText}</a> from ${BRAND_NAME}." (no extra spaces inside the link tag - spaces will be added automatically)
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
      - Format tables with proper HTML structure: <table class='editor-table'><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>
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
    
    if (jsonEndIndex === -1 || jsonEndIndex <= jsonStartIndex) {
      jsonEndIndex = jsonText.length - 1;
    }
    
    jsonText = jsonText.substring(jsonStartIndex, jsonEndIndex + 1);
    
    // Parse JSON (this will automatically handle escaped newlines \n)
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError: any) {
      console.error("[generateMasterArticle] JSON parse error:", parseError.message);
      console.error("[generateMasterArticle] JSON text preview (last 500 chars):", jsonText.substring(Math.max(0, jsonText.length - 500)));
      
      const contentStartMatch = jsonText.match(/"content"\s*:\s*"/);
      
      if (contentStartMatch && contentStartMatch.index !== undefined) {
        console.warn("[generateMasterArticle] Recovering content from malformed JSON");
        const contentStart = contentStartMatch.index + contentStartMatch[0].length;
        const { content: rawContent, recoveredBy } = recoverContentField(jsonText, contentStart);
        console.warn(`[generateMasterArticle] Content recovered by ${recoveredBy}, ${rawContent.length} raw chars`);
        
        const excerptMatch = jsonText.match(/"excerpt"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        const metaTitleMatch = jsonText.match(/"metaTitle"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        const metaDescMatch = jsonText.match(/"metaDescription"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        
        parsed = {
          content: unescapeJsonString(rawContent),
          excerpt: excerptMatch ? unescapeJsonString(excerptMatch[1]) : "",
          metaTitle: metaTitleMatch ? unescapeJsonString(metaTitleMatch[1]) : `${title} | ${BRAND_NAME}`,
          metaDescription: metaDescMatch ? unescapeJsonString(metaDescMatch[1]) : "",
          faqSchema: null
        };
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
      // FAIL HARD on any under-length article.
      //
      // Previously this only threw when the content ended mid-HTML-tag and otherwise
      // published with a warning. Real truncations frequently land mid-SENTENCE but
      // just after a closed tag, which slipped through and published a stub article.
      // Publishing an incomplete page is worse than skipping a day: the queue job is
      // marked failed and retried instead, and the title stays unprocessed.
      const endsMidTag = !!content.match(/<[^>]*$/);
      console.error(`[generateMasterArticle] ERROR: Article is under the minimum length - refusing to publish.`);
      console.error(`[generateMasterArticle] Word count: ${wordCount} (minimum: ${minWords}, target: ${targetWords})`);
      console.error(`[generateMasterArticle] Content length: ${content.length} characters`);
      console.error(`[generateMasterArticle] Ends mid-HTML-tag: ${endsMidTag}`);
      console.error(`[generateMasterArticle] Content ends with: ${content.substring(Math.max(0, content.length - 160))}`);
      throw new Error(
        `Article too short: ${wordCount} words (minimum ${minWords}, target ${targetWords}). ` +
        (endsMidTag ? 'Content ends mid-HTML tag. ' : 'Content appears cut short. ') +
        `Refusing to publish an incomplete article.`
      );
    }

    console.log(`[generateMasterArticle] Content validation passed: ${wordCount} words (target: ${targetWords})`);
    
    // Remove any H1 title tags from content (title is already stored separately)
    content = content.replace(/<h1[^>]*>.*?<\/h1>/gi, '');
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
    console.error("[generateMasterArticle] Failed to produce a valid article:", error.message);
    console.error("[generateMasterArticle] Raw response preview (first 600 chars):", response.substring(0, 600));
    throw error;
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

export { getTodaysSilo, fetchSiloNeighbors, formatSiloArticlesForPrompt, getRotationIndex, recoverContentField, generateMasterArticle, cleanHtmlContent, generateSlug, SILO_ROTATION, BRAND_NAME };
