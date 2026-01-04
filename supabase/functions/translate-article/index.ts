import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";
const indexNowKey = Deno.env.get("INDEXNOW_KEY") || "";

const BRAND_NAME = "Microns Hub";
const VERSION = "2026-01-04-article-links-optimized-v1";

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
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  error?: { message: string };
}

async function callGemini(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`;
  
    const response = await fetch(url, {
      method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
    }),
  });

    if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${err.substring(0, 200)}`);
  }

  const data: GeminiResponse = await response.json();
  if (data.error) throw new Error(`Gemini error: ${data.error.message}`);
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error("Empty Gemini response");
  
  return data.candidates[0].content.parts[0].text;
}

function makeSlug(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/(^-|-$)+/g, "");
}

/**
 * Build article slug mapping ONCE at the start for all languages
 * Returns a map: { langCode: { englishSlug: translatedSlug } }
 */
async function buildAllArticleSlugMappings(
  content: string,
  targetLanguages: string[]
): Promise<Record<string, Record<string, string>>> {
  const allMappings: Record<string, Record<string, string>> = {};
  
  // Find all article links: href="/en/blog/slug" or href='/en/blog/slug'
  const articleLinkPattern = /href=["']\/en\/blog\/([^"']+)["']/gi;
  const matches = Array.from(content.matchAll(articleLinkPattern));
  const englishSlugs = [...new Set(matches.map(m => m[1]))];
  
  if (englishSlugs.length === 0) {
    return allMappings;
  }
  
  try {
    // Single batch query: Get all English articles at once
    const { data: englishArticles } = await supabase
      .from("articles")
      .select("slug, translation_id")
      .eq("language", "en")
      .in("slug", englishSlugs);
    
    if (!englishArticles || englishArticles.length === 0) {
      return allMappings;
    }
    
    // Get all translation_ids
    const translationIds = englishArticles
      .filter(a => a.translation_id)
      .map(a => a.translation_id);
    
    if (translationIds.length === 0) {
      return allMappings;
    }
    
    // Single batch query: Get ALL translated articles for ALL target languages at once
    const { data: translatedArticles } = await supabase
      .from("articles")
      .select("slug, translation_id, language")
      .in("translation_id", translationIds)
      .in("language", targetLanguages)
      .in("status", ["published", "draft"]);
    
    if (!translatedArticles) {
      return allMappings;
    }
    
    // Build mapping per language: { langCode: { englishSlug: translatedSlug } }
    for (const langCode of targetLanguages) {
      allMappings[langCode] = {};
      
      // Create map of translation_id -> slug for this language
      const langTranslations = new Map(
        translatedArticles
          .filter(t => t.language === langCode)
          .map(t => [t.translation_id, t.slug])
      );
      
      // Map English slugs to translated slugs
      for (const englishArticle of englishArticles) {
        if (englishArticle.translation_id && langTranslations.has(englishArticle.translation_id)) {
          allMappings[langCode][englishArticle.slug] = langTranslations.get(englishArticle.translation_id)!;
        }
      }
    }
  } catch (error) {
    console.error(`[SLUG MAPPING] Error building mapping:`, error);
    // Return empty mapping on error - links will use English slugs
  }
  
  return allMappings;
}

/**
 * Localize article links using pre-built mapping (no DB queries)
 */
function localizeArticleLinks(
  content: string,
  langCode: string,
  slugMapping: Record<string, string>
): string {
  let c = content;
  
  // Replace each article link with the correct translated slug
  for (const [englishSlug, translatedSlug] of Object.entries(slugMapping)) {
    // Escape special regex characters in slug
    const escaped = englishSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Replace both single and double quotes, case-insensitive
    c = c.replace(
      new RegExp(`href=["']/en/blog/${escaped}["']`, 'gi'),
      `href="/${langCode}/blog/${translatedSlug}"`
    );
  }
  
  // For any remaining /en/blog/ links that weren't found in database,
  // just replace the language prefix (fallback)
  c = c.replace(/href=["']\/en\/blog\//gi, `href="/${langCode}/blog/`);
  
  return c;
}

/**
 * Localize service/quote links (non-article links)
 */
function localizeServiceLinks(content: string, langCode: string): string {
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
  
  return c;
}

async function translateToLanguage(
  original: { title: string; content: string; excerpt: string; metaTitle: string; metaDescription: string },
  langName: string,
  langCode: string,
  articleSlugMapping?: Record<string, string>
): Promise<{ title: string; slug: string; content: string; excerpt: string; metaTitle: string; metaDescription: string }> {
  const prompt = `Translate this manufacturing blog article into ${langName}.

RULES:
- Keep "${BRAND_NAME}" unchanged
- Preserve ALL HTML tags exactly
- Return ONLY valid JSON

Input:
${JSON.stringify(original)}

Return JSON:
{"title":"...","slug":"...","content":"...","excerpt":"...","metaTitle":"... | ${BRAND_NAME}","metaDescription":"..."}`;

  const response = await callGemini(prompt);
  
  let json = response.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const first = json.indexOf("{");
  const last = json.lastIndexOf("}");
  if (first !== -1 && last > first) json = json.substring(first, last + 1);
  
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error("Failed to parse Gemini JSON");
  }

  const title = parsed.title || original.title;
  const slug = parsed.slug || makeSlug(title);
  let content = parsed.content || original.content;
  const excerpt = parsed.excerpt || original.excerpt;
  let metaTitle = parsed.metaTitle || `${title} | ${BRAND_NAME}`;
  let metaDescription = parsed.metaDescription || original.metaDescription;

  if (!metaTitle.includes(BRAND_NAME)) metaTitle = `${metaTitle} | ${BRAND_NAME}`;
  if (metaTitle.length > 70) metaTitle = metaTitle.substring(0, 67) + "...";
  if (metaDescription.length > 160) metaDescription = metaDescription.substring(0, 157) + "...";
  
  // Localize links: first service/quote links, then article links with pre-built mapping
  content = localizeServiceLinks(content, langCode);
  content = localizeArticleLinks(content, langCode, articleSlugMapping || {});

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

  try {
    const { article_id, target_languages } = await req.json();
    if (!article_id) {
      return new Response(JSON.stringify({ error: "article_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch English article
    const { data: master, error: fetchErr } = await supabase
      .from("articles").select("*").eq("id", article_id).eq("language", "en").single();
    
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

    // Build article slug mappings ONCE for all languages (efficient batch query)
    const langCodes = langs.map(l => l.code);
    const articleSlugMappings = await buildAllArticleSlugMappings(original.content, langCodes);
    console.log(`Built slug mappings for ${Object.keys(articleSlugMappings).length} language(s)`);

    const results: Record<string, any> = {};
    const urls: string[] = [`${siteUrl}/en/blog/${master.slug}`];

    for (let i = 0; i < langs.length; i++) {
      const lang = langs[i];
      const elapsed = Date.now() - startTime;
      
      // Stop if approaching timeout (100s limit, leave 50s buffer)
      if (elapsed > 100000) {
        console.warn(`Timeout approaching at ${elapsed}ms, stopping`);
        break;
      }

      console.log(`[${i + 1}/${langs.length}] Translating to ${lang.name}...`);

      try {
        // Check if exists
        const { data: existing } = await supabase
          .from("articles").select("id, title, slug")
          .eq("translation_id", master.translation_id).eq("language", lang.code).single();

        if (existing) {
          console.log(`${lang.code} already exists, skipping`);
          results[lang.code] = { success: true, article_id: existing.id, skipped: true };
          urls.push(`${siteUrl}/${lang.code}/blog/${existing.slug}`);
          continue;
        }

        // Translate (pass pre-built slug mapping for this language)
        const translation = await translateToLanguage(
          original, 
          lang.name, 
          lang.code,
          articleSlugMappings[lang.code] || {}
        );

        // Save
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
