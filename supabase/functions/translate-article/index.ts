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
      maxOutputTokens: 65536, // Increased for 2500-word articles (gemini-2.0-flash-exp supports up to 65536)
      responseMimeType: "application/json", // Force JSON output format
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
    console.error(`Gemini API error response: ${response.status}`, errorText);
    // Parse error to check for specific issues
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        throw new Error(`Gemini API error ${response.status}: ${errorJson.error.message}`);
      }
    } catch (parseErr) {
      // If can't parse, use raw text
    }
    throw new Error(`Gemini API error: ${response.status} ${errorText.substring(0, 500)}`);
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
### OUTPUT FORMAT (CRITICAL - READ CAREFULLY)
You MUST return ONLY valid JSON. Do NOT include:
- Markdown code fences (triple backticks with json or without)
- Explanatory text before or after the JSON
- Comments or notes
- Any text outside the JSON object

Return ONLY this JSON structure, nothing else:
{
  "title": "<translated article title>",
  "slug": "<translated-url-friendly-slug-based-on-title>",
  "content": "<translated HTML with updated link hrefs>",
  "excerpt": "<translated excerpt - max 160 chars>",
  "metaTitle": "<translated meta title - max 60 chars> | ${BRAND_NAME}",
  "metaDescription": "<translated meta description - max 160 chars>"
}

IMPORTANT: Start your response with { and end with }. Do not add any text before or after the JSON object.`;

  const response = await generateWithGemini(prompt, thoughtSignature);
  
  console.log(`Gemini response received for ${targetLanguage}, length: ${response.length}`);
  console.log(`Response preview (first 2000 chars): ${response.substring(0, 2000)}`);
  console.log(`Response preview (last 1000 chars): ${response.substring(Math.max(0, response.length - 1000))}`);

  try {
    // Multiple strategies to extract JSON from response
    let jsonText = response.trim();
    let parsed: any = null;
    
    // Strategy 1: Remove markdown code fences (multiple patterns)
    jsonText = jsonText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^```json\n/gi, '')
      .replace(/\n```$/gi, '')
      .replace(/^```json\r\n/gi, '')
      .replace(/\r\n```$/gi, '')
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
        console.warn(`Boundary extraction parse failed: ${parseError.message}`);
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
        
        throw new Error(`Could not extract valid JSON from Gemini response. Response length: ${response.length} chars. Opening braces: ${openingBraceCount}, Closing braces: ${closingBraceCount}. Response snippet: ${responseSnippet.substring(0, 1000)}`);
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
    const cncSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["cnc-machining"] || "cnc-machining";
    const sheetMetalSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["sheet-metal"] || "sheet-metal";
    const injectionMoldingSlug = SERVICE_SLUG_TRANSLATIONS[langCode]?.["injection-molding"] || "injection-molding";
    
    // First, fix malformed links where HTML attributes got into the href value
    // Pattern: href="/path%20rel=noopener%20noreferrer%20target=" → href="/path"
    // This handles cases where Gemini incorrectly included attributes in the href
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
    content = content.replace(/href="\/en\/quote"/g, `href="/${langCode}/quote"`);
    content = content.replace(/href="\/en\/services\/cnc-machining"/g, `href="/${langCode}/${servicesSlug}/${cncSlug}"`);
    content = content.replace(/href="\/en\/services\/sheet-metal"/g, `href="/${langCode}/${servicesSlug}/${sheetMetalSlug}"`);
    content = content.replace(/href="\/en\/services\/injection-molding"/g, `href="/${langCode}/${servicesSlug}/${injectionMoldingSlug}"`);
    content = content.replace(/href="\/en\/services"/g, `href="/${langCode}/${servicesSlug}"`);
    content = content.replace(/href="\/en\/blog\//g, `href="/${langCode}/blog/`);
    
    // Ensure proper spacing around <a> tags to prevent text from sticking together
    // Add space before <a> if preceded by non-space character
    content = content.replace(/([^\s>])(<a\s+href)/g, '$1 $2');
    // Add space after </a> if followed by non-space character
    content = content.replace(/(<\/a>)([^\s<])/g, '$1 $2');

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
    // Free tier limit: ~15 RPM, so 8 seconds = ~7.5 RPM (safe margin for 2500-word articles)
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
        // Reduced retries to return faster with actual error message
        const translation = await withRetry(
          () => generateTranslation(
            originalJsonData,
            lang.name,
            lang.code,
            masterArticle.slug, // Pass original slug for reference (will be translated)
            thoughtSignature
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
