import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";
const indexNowKey = Deno.env.get("INDEXNOW_KEY") || "";

const BRAND_NAME = "Microns Hub";
const VERSION = "2026-01-04-quote-sanitize-v1";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

const SERVICE_SLUGS: Record<string, Record<string, string>> = {
  de: { services: "dienstleistungen", quote: "angebot", "cnc-machining": "cnc-bearbeitung", "sheet-metal": "blechbearbeitung", "injection-molding": "spritzguss" },
  fr: { services: "services", quote: "devis", "cnc-machining": "usinage-cnc", "sheet-metal": "tolerie", "injection-molding": "injection-plastique" },
  es: { services: "servicios", quote: "cotizacion", "cnc-machining": "mecanizado-cnc", "sheet-metal": "chapa-metalica", "injection-molding": "moldeo-por-inyeccion" },
  it: { services: "servizi", quote: "preventivo", "cnc-machining": "lavorazione-cnc", "sheet-metal": "lavorazione-lamiera", "injection-molding": "stampaggio-iniezione" },
  nl: { services: "diensten", quote: "offerte", "cnc-machining": "cnc-bewerking", "sheet-metal": "plaatbewerking", "injection-molding": "spuitgieten" },
  pl: { services: "uslugi", quote: "wycena", "cnc-machining": "obrobka-cnc", "sheet-metal": "obrobka-bluzy", "injection-molding": "wtrysk-tworzywa" },
  sv: { services: "tjanster", quote: "offert", "cnc-machining": "cnc-bearbetning", "sheet-metal": "platarbe", "injection-molding": "sprutgjutning" },
  da: { services: "tjenester", quote: "tilbud", "cnc-machining": "cnc-bearbejdning", "sheet-metal": "pladearbejde", "injection-molding": "sproejtestoebning" },
  fi: { services: "palvelut", quote: "tarjous", "cnc-machining": "cnc-tyosto", "sheet-metal": "levytyosto", "injection-molding": "ruiskupuristus" },
  cs: { services: "sluzby", quote: "nabidka", "cnc-machining": "cnc-obrabeni", "sheet-metal": "obrabeni-plechu", "injection-molding": "vstrekovani" },
  hu: { services: "szolgaltatasok", quote: "ajanlat", "cnc-machining": "cnc-megmunkalas", "sheet-metal": "lemezfeldolgozas", "injection-molding": "frccsnyomas" },
  pt: { services: "servicos", quote: "orcamento", "cnc-machining": "usinagem-cnc", "sheet-metal": "chapa-metalica", "injection-molding": "moldagem-injecao" },
  nb: { services: "tjenester", quote: "tilbud", "cnc-machining": "cnc-bearbeiding", "sheet-metal": "platarbeid", "injection-molding": "sproyetestoping" },
};

interface GeminiResponse {
  candidates?: Array<{ 
    content?: { parts?: Array<{ text?: string }> }; 
    finishReason?: string;
    finishMessage?: string;
  }>;
  error?: { message: string };
}

async function callGemini(prompt: string): Promise<string> {
  // #region agent log
  const geminiStartTime = Date.now();
  fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:62',message:'callGemini entry',data:{promptLength:prompt.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.3, 
          maxOutputTokens: 32768, // Maximum for Gemini 2.0 Flash
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${err.substring(0, 200)}`);
    }

    const data: GeminiResponse = await response.json();
    if (data.error) throw new Error(`Gemini error: ${data.error.message}`);
    
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
      throw new Error("Empty Gemini response");
    }
    
    // Check if response was truncated
    if (candidate.finishReason === "MAX_TOKENS" || candidate.finishReason === "LENGTH") {
      console.warn(`[WARNING] Gemini response may be truncated (finishReason: ${candidate.finishReason})`);
      throw new Error(`Translation truncated: Gemini hit token limit. finishReason: ${candidate.finishReason}`);
    }
    
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      console.warn(`[WARNING] Unexpected finishReason: ${candidate.finishReason}`);
    }
    
    // #region agent log
    const geminiDuration = Date.now() - geminiStartTime;
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:107',message:'callGemini exit',data:{duration:geminiDuration,responseLength:candidate.content.parts[0].text.length,finishReason:candidate.finishReason},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    return candidate.content.parts[0].text;
  } catch (error: any) {
    clearTimeout(timeoutId);
    // #region agent log
    const geminiDuration = Date.now() - geminiStartTime;
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:109',message:'callGemini error',data:{duration:geminiDuration,errorName:error.name,errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    if (error.name === "AbortError") {
      throw new Error("Gemini API request timeout (60s)");
    }
    throw error;
  }
}

function makeSlug(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/(^-|-$)+/g, "");
}

/**
 * Localize links in translated content
 * Note: Article slugs are fixed AFTER all translations by fix-article-links function
 */
function localizeLinks(content: string, langCode: string): string {
  const s = SERVICE_SLUGS[langCode] || {};
  let c = content;
  
  // Handle both single and double quotes, case-insensitive
  // Quote page
  c = c.replace(/href=["']\/en\/quote["']/gi, `href="/${langCode}/${s.quote || "quote"}"`);
  
  // Service pages - specific first (to avoid partial matches)
  c = c.replace(/href=["']\/en\/services\/cnc-machining["']/gi, `href="/${langCode}/${s.services || "services"}/${s["cnc-machining"] || "cnc-machining"}"`);
  c = c.replace(/href=["']\/en\/services\/sheet-metal["']/gi, `href="/${langCode}/${s.services || "services"}/${s["sheet-metal"] || "sheet-metal"}"`);
  c = c.replace(/href=["']\/en\/services\/injection-molding["']/gi, `href="/${langCode}/${s.services || "services"}/${s["injection-molding"] || "injection-molding"}"`);
  
  // General services page (after specific ones)
  c = c.replace(/href=["']\/en\/services["']/gi, `href="/${langCode}/${s.services || "services"}"`);
  
  // Blog links: just replace /en/ prefix with target language
  // The actual slug translation is done by fix-article-links function AFTER all translations
  c = c.replace(/href=["']\/en\/blog\//gi, `href="/${langCode}/blog/`);
  
  return c;
}

async function translateToLanguage(
  original: { title: string; content: string; excerpt: string; metaTitle: string; metaDescription: string },
  langName: string,
  langCode: string
): Promise<{ title: string; slug: string; content: string; excerpt: string; metaTitle: string; metaDescription: string }> {
  
  // Use delimiter-based format instead of JSON to avoid escaping issues with HTML content
  // JSON escaping of quotes in HTML attributes (href="...") causes parsing failures
  const prompt = `Translate this manufacturing blog article into ${langName}.

RULES:
- Keep "${BRAND_NAME}" unchanged
- Preserve ALL HTML tags and attributes exactly (including href, class, etc.)
- Do NOT modify any URLs or links - keep them exactly as they are
- Translate only the visible text content

Use this EXACT format with the delimiters shown:

===TITLE===
[translated title here]
===SLUG===
[url-friendly slug in ${langName}, lowercase, hyphens only, no special characters]
===CONTENT===
[translated HTML content here - preserve ALL HTML exactly]
===EXCERPT===
[translated excerpt here]
===META_TITLE===
[translated meta title here] | ${BRAND_NAME}
===META_DESCRIPTION===
[translated meta description here, max 160 characters]
===END===

ARTICLE TO TRANSLATE:

TITLE: ${original.title}

CONTENT:
${original.content}

EXCERPT: ${original.excerpt}

META TITLE: ${original.metaTitle}

META DESCRIPTION: ${original.metaDescription}`;

  const response = await callGemini(prompt);
  
  // Log response length for debugging
  console.log(`[translateToLanguage] Gemini response length: ${response.length} characters`);
  console.log(`[translateToLanguage] Response preview (first 500): ${response.substring(0, 500)}`);
  console.log(`[translateToLanguage] Response preview (last 500): ${response.substring(Math.max(0, response.length - 500))}`);
  
  // Parse using delimiters (much more robust than JSON for HTML content)
  function extractBetween(text: string, startDelim: string, endDelim: string): string {
    const startIdx = text.indexOf(startDelim);
    if (startIdx === -1) return "";
    const contentStart = startIdx + startDelim.length;
    const endIdx = text.indexOf(endDelim, contentStart);
    if (endIdx === -1) return text.substring(contentStart).trim();
    return text.substring(contentStart, endIdx).trim();
  }
  
  const title = extractBetween(response, "===TITLE===", "===SLUG===") || original.title;
  const slugRaw = extractBetween(response, "===SLUG===", "===CONTENT===");
  const slug = slugRaw ? makeSlug(slugRaw) : makeSlug(title);
  let content = extractBetween(response, "===CONTENT===", "===EXCERPT===") || original.content;
  const excerpt = extractBetween(response, "===EXCERPT===", "===META_TITLE===") || original.excerpt;
  let metaTitle = extractBetween(response, "===META_TITLE===", "===META_DESCRIPTION===") || `${title} | ${BRAND_NAME}`;
  let metaDescription = extractBetween(response, "===META_DESCRIPTION===", "===END===") || original.metaDescription;
  
  // Log extraction results
  console.log(`[DELIMITER PARSE] Title length: ${title.length}`);
  console.log(`[DELIMITER PARSE] Slug: ${slug}`);
  console.log(`[DELIMITER PARSE] Content length: ${content.length}`);
  console.log(`[DELIMITER PARSE] Excerpt length: ${excerpt.length}`);
  console.log(`[DELIMITER PARSE] Meta title: ${metaTitle}`);
  console.log(`[DELIMITER PARSE] Meta description length: ${metaDescription.length}`);
  
  // Validate content was extracted
  if (!content || content.length < 100) {
    console.error(`[ERROR] Content extraction failed or content too short`);
    console.error(`[ERROR] Extracted content: ${content.substring(0, 500)}`);
    console.error(`[ERROR] Full response for debugging: ${response.substring(0, 2000)}`);
    throw new Error(`Content extraction failed - delimiter parsing returned empty or very short content`);
  }
  
  // Check for article links in the translated content
  const articleLinks = content.match(/href=["']\/[a-z]{2}\/blog\//gi);
  console.log(`[DELIMITER PARSE] Found ${articleLinks?.length || 0} article link(s) in content`);
  
  // Validate content completeness
  const originalContentLength = original.content.length;
  const translatedContentLength = content.length;
  const lengthRatio = translatedContentLength / originalContentLength;
  
  console.log(`[translateToLanguage] Content length: original=${originalContentLength}, translated=${translatedContentLength}, ratio=${lengthRatio.toFixed(2)}`);
  console.log(`[translateToLanguage] Content starts with: ${content.substring(0, 200)}`);
  console.log(`[translateToLanguage] Content ends with: ${content.substring(Math.max(0, translatedContentLength - 200))}`);
  
  // Check if translation is incomplete (less than 60% is suspicious for most languages)
  if (lengthRatio < 0.6 && originalContentLength > 3000) {
    const missingPercent = (1 - lengthRatio) * 100;
    console.error(`[ERROR] Translation appears incomplete!`);
    console.error(`[ERROR] Original: ${originalContentLength} chars, Translated: ${translatedContentLength} chars`);
    console.error(`[ERROR] Missing approximately ${missingPercent.toFixed(1)}% of content`);
    throw new Error(`Translation incomplete: only ${(lengthRatio * 100).toFixed(1)}% of original content translated`);
  }

  if (!metaTitle.includes(BRAND_NAME)) metaTitle = `${metaTitle} | ${BRAND_NAME}`;
  if (metaTitle.length > 70) metaTitle = metaTitle.substring(0, 67) + "...";
  if (metaDescription.length > 160) metaDescription = metaDescription.substring(0, 157) + "...";
  
  // Localize service/quote links (article slugs are fixed later by fix-article-links)
  content = localizeLinks(content, langCode);
  
  // Fix any mismatched quotes in href attributes (Gemini sometimes produces href="...' instead of href="...")
  content = content.replace(/href="([^"']*?)'/g, 'href="$1"');
  content = content.replace(/href='([^"']*?)"/g, "href='$1'");
  console.log(`[SANITIZE] Fixed any mismatched quotes in href attributes`);

  return { title, slug, content, excerpt, metaTitle, metaDescription };
}

async function submitIndexNow(urls: string[]): Promise<boolean> {
  if (!indexNowKey) return false;
  try {
    const host = new URL(urls[0]).hostname;
    const res = await fetch("https://www.bing.com/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, key: indexNowKey, keyLocation: `https://${host}/indexnow_key.txt`, urlList: urls }),
    });
    return res.ok;
  } catch { return false; }
}

serve(async (req) => {
  // CORS preflight - return immediately
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log(`[translate-article] Version: ${VERSION}`);
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:299',message:'Function entry',data:{version:VERSION},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
  // #endregion

  try {
    const { article_id, target_languages } = await req.json();
    if (!article_id) {
      return new Response(JSON.stringify({ error: "article_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch English article
    // #region agent log
    const dbFetchStartTime = Date.now();
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:309',message:'DB fetch start',data:{article_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    const { data: master, error: fetchErr } = await supabase
      .from("articles").select("*").eq("id", article_id).eq("language", "en").single();
    // #region agent log
    const dbFetchDuration = Date.now() - dbFetchStartTime;
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:310',message:'DB fetch complete',data:{duration:dbFetchDuration,contentLength:master?.content?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    
    if (fetchErr || !master) {
      return new Response(JSON.stringify({ error: "English article not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Translating: ${master.title}`);

    const original = {
      title: master.title,
      content: master.content,
      excerpt: master.excerpt || "",
      metaTitle: master.meta_title || master.title,
      metaDescription: master.meta_description || "",
    };

    const langs = target_languages?.length > 0
      ? LANGUAGES.filter(l => target_languages.includes(l.code))
      : LANGUAGES;
    
    console.log(`Languages: ${langs.map(l => l.code).join(", ")}`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:330',message:'Languages determined',data:{totalLanguages:langs.length,languageCodes:langs.map(l=>l.code)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion

    const results: Record<string, any> = {};
    const urls: string[] = [`${siteUrl}/en/blog/${master.slug}`];

    for (let i = 0; i < langs.length; i++) {
      const lang = langs[i];
      const elapsed = Date.now() - startTime;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:337',message:'Language loop iteration',data:{iteration:i+1,total:langs.length,langCode:lang.code,elapsed},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
      
      // Stop if approaching timeout (100s limit, leave 50s buffer)
      if (elapsed > 100000) {
        console.warn(`Timeout approaching at ${elapsed}ms, stopping`);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:340',message:'Timeout check triggered',data:{elapsed,iteration:i+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
        break;
      }

      console.log(`[${i + 1}/${langs.length}] Translating to ${lang.name}...`);

      try {
        // Check if exists
        // #region agent log
        const checkStartTime = Date.now();
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:349',message:'Check existing translation start',data:{langCode:lang.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        const { data: existing } = await supabase
          .from("articles").select("id, title, slug")
          .eq("translation_id", master.translation_id).eq("language", lang.code).single();
        // #region agent log
        const checkDuration = Date.now() - checkStartTime;
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:350',message:'Check existing translation complete',data:{duration:checkDuration,exists:!!existing},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion

        if (existing) {
          console.log(`${lang.code} already exists, skipping`);
          results[lang.code] = { success: true, article_id: existing.id, skipped: true };
          urls.push(`${siteUrl}/${lang.code}/blog/${existing.slug}`);
          continue;
        }

        // Translate
        // #region agent log
        const translateStartTime = Date.now();
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:361',message:'translateToLanguage start',data:{langCode:lang.code,contentLength:original.content.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        const translation = await translateToLanguage(original, lang.name, lang.code);
        // #region agent log
        const translateDuration = Date.now() - translateStartTime;
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:361',message:'translateToLanguage complete',data:{duration:translateDuration,translatedLength:translation.content.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion

        // Save
        // #region agent log
        const saveStartTime = Date.now();
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:364',message:'DB save start',data:{langCode:lang.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        const { data: saved, error: saveErr } = await supabase
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
            translation_id: master.translation_id,
            featured_image: master.featured_image,
            featured_image_alt: master.featured_image_alt,
          }])
          .select().single();
        // #region agent log
        const saveDuration = Date.now() - saveStartTime;
        fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:379',message:'DB save complete',data:{duration:saveDuration,success:!saveErr},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion

        if (saveErr) {
          if (saveErr.code === "23505") {
            results[lang.code] = { success: true, skipped: true, note: "duplicate" };
        } else {
            throw saveErr;
          }
        } else if (saved) {
          results[lang.code] = { success: true, article_id: saved.id, title: translation.title };
          urls.push(`${siteUrl}/${lang.code}/blog/${translation.slug}`);
          console.log(`✓ ${lang.name} complete`);
        }

      } catch (err: any) {
        console.error(`✗ ${lang.code} failed:`, err.message);
        results[lang.code] = { success: false, error: err.message };
      }

      // Small delay between languages
      if (i < langs.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    // Update master status
    if (!target_languages?.length) {
      await supabase.from("articles").update({ status: "published" }).eq("id", article_id);
    }

    // IndexNow
    const indexed = await submitIndexNow(urls);

    const successful = Object.values(results).filter((r: any) => r.success).length;
    const totalTime = Date.now() - startTime;
    console.log(`Done: ${successful}/${langs.length} in ${totalTime}ms`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9c4eca37-9600-4254-b27a-e5567336f36b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'translate-article/index.ts:412',message:'Function complete',data:{totalTime,successful,totalLanguages:langs.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

    return new Response(
      JSON.stringify({
        success: successful > 0,
        message: `Translated to ${successful} language(s)`,
        translations: successful,
        total_languages: langs.length,
        execution_time_ms: totalTime,
        indexing: indexed,
        details: results,
      }),
      { status: successful > 0 ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error", execution_time_ms: Date.now() - startTime }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
