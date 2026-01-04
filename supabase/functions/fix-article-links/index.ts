import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VERSION = "2026-01-04-v2";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LANGUAGES = ["de", "fr", "es", "it", "nl", "pl", "sv", "da", "fi", "cs", "hu", "pt", "nb"];

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

/**
 * Build a complete slug mapping for all languages at once
 * Returns: { "en-slug": { "de": "de-slug", "fr": "fr-slug", ... } }
 */
async function buildGlobalSlugMapping(): Promise<Record<string, Record<string, string>>> {
  const mapping: Record<string, Record<string, string>> = {};
  
  try {
    // Get all English articles with translation_id
    const { data: englishArticles } = await supabase
      .from("articles")
      .select("slug, translation_id")
      .eq("language", "en")
      .not("translation_id", "is", null);
    
    if (!englishArticles || englishArticles.length === 0) {
      return mapping;
    }
    
    // Get all translation_ids
    const translationIds = englishArticles.map(a => a.translation_id);
    
    // Get all translated articles for all languages at once
    const { data: translatedArticles } = await supabase
      .from("articles")
      .select("slug, translation_id, language")
      .in("translation_id", translationIds)
      .neq("language", "en");
    
    if (!translatedArticles) {
      return mapping;
    }
    
    // Build mapping: englishSlug -> { langCode: translatedSlug }
    const translationIdToEnglishSlug = new Map(
      englishArticles.map(a => [a.translation_id, a.slug])
    );
    
    for (const translated of translatedArticles) {
      const englishSlug = translationIdToEnglishSlug.get(translated.translation_id);
      if (englishSlug) {
        if (!mapping[englishSlug]) {
          mapping[englishSlug] = {};
        }
        mapping[englishSlug][translated.language] = translated.slug;
      }
    }
    
    console.log(`Built global mapping for ${Object.keys(mapping).length} English articles`);
  } catch (error) {
    console.error(`Error building global mapping:`, error);
  }
  
  return mapping;
}

/**
 * Fix links in a single article's content
 * Also ensures links have spaces before and after them
 */
function fixLinksInContent(
  content: string,
  targetLang: string,
  slugMapping: Record<string, Record<string, string>>
): { content: string; linksFixed: number } {
  let fixedContent = content;
  let linksFixed = 0;
  
  // Fix service/quote links first
  const s = SERVICE_SLUGS[targetLang] || {};
  
  // Quote page
  fixedContent = fixedContent.replace(/href=["']\/en\/quote["']/gi, `href="/${targetLang}/${s.quote || "quote"}"`);
  
  // Service pages
  fixedContent = fixedContent.replace(/href=["']\/en\/services\/cnc-machining["']/gi, `href="/${targetLang}/${s.services || "services"}/${s["cnc-machining"] || "cnc-machining"}"`);
  fixedContent = fixedContent.replace(/href=["']\/en\/services\/sheet-metal["']/gi, `href="/${targetLang}/${s.services || "services"}/${s["sheet-metal"] || "sheet-metal"}"`);
  fixedContent = fixedContent.replace(/href=["']\/en\/services\/injection-molding["']/gi, `href="/${targetLang}/${s.services || "services"}/${s["injection-molding"] || "injection-molding"}"`);
  fixedContent = fixedContent.replace(/href=["']\/en\/services["']/gi, `href="/${targetLang}/${s.services || "services"}"`);
  
  // Fix article links - find all blog links
  // Enhanced pattern matches:
  // - /en/blog/slug and /{lang}/blog/slug with English slug
  // - Handles trailing slashes, query parameters, and fragments
  // - More robust quote matching (handles both single and double quotes)
  // Pattern breakdown:
  //   href=["'] - matches href=" or href='
  //   (\/[a-z]{2}\/blog\/([^"'\s?#]+)) - captures full path and slug (stops at quote, space, ?, #)
  //   ([?#][^"']*)? - optionally captures query params or fragments
  //   ["'] - matches closing quote
  const blogLinkPattern = /href=["'](\/[a-z]{2}\/blog\/([^"'\s?#]+)([?#][^"']*)?)["']/gi;
  
  let match;
  const replacements: Array<{ original: string; replacement: string; needsSpaceBefore: boolean; needsSpaceAfter: boolean }> = [];
  
  // First pass: collect all replacements
  while ((match = blogLinkPattern.exec(content)) !== null) {
    const fullPath = match[1]; // Full path including query/fragment if present
    const slugPart = match[2]; // Just the slug part (without trailing slash, query, fragment)
    const queryOrFragment = match[3] || ""; // Query params or fragment (e.g., ?param=value or #section)
    
    // Normalize slug: remove trailing slash for lookup
    const normalizedSlug = slugPart.replace(/\/$/, "");
    
    // Check if this English slug has a translation for the target language
    if (slugMapping[normalizedSlug] && slugMapping[normalizedSlug][targetLang]) {
      const translatedSlug = slugMapping[normalizedSlug][targetLang];
      const newPath = `/${targetLang}/blog/${translatedSlug}${queryOrFragment}`;
      
      if (fullPath !== newPath) {
        // Preserve the original quote style (single or double) from the match
        // match[0] is the full match like: href="/de/blog/slug" or href='/de/blog/slug'
        const matchStr = match[0];
        const quoteChar = matchStr.charAt(5) === "'" ? "'" : '"'; // Position 5 is right after "href="
        replacements.push({
          original: match[0],
          replacement: `href=${quoteChar}${newPath}${quoteChar}`
        });
        linksFixed++;
      }
    }
  }
  
  // Apply replacements
  for (const { original, replacement } of replacements) {
    fixedContent = fixedContent.replace(original, replacement);
  }
  
  // Second pass: Add spaces before and after links (but not inside table cells)
  // Pattern: match <a> tags and their content, then check context
  const linkWithSpacingPattern = /(<a\s+[^>]*href=["'][^"']*["'][^>]*>.*?<\/a>)/gi;
  const linkMatches: Array<{ match: string; index: number }> = [];
  let linkMatch;
  
  // Collect all link matches with their positions
  while ((linkMatch = linkWithSpacingPattern.exec(fixedContent)) !== null) {
    linkMatches.push({ match: linkMatch[0], index: linkMatch.index! });
  }
  
  // Process matches in reverse order to preserve indices
  for (let i = linkMatches.length - 1; i >= 0; i--) {
    const { match, index } = linkMatches[i];
    
    // Check if we're inside a table cell - if so, don't modify spacing
    const beforeMatch = fixedContent.substring(0, index);
    const lastTdOpen = beforeMatch.lastIndexOf('<td');
    const lastThOpen = beforeMatch.lastIndexOf('<th');
    const lastTdClose = beforeMatch.lastIndexOf('</td>');
    const lastThClose = beforeMatch.lastIndexOf('</th>');
    const inTableCell = (lastTdOpen > lastTdClose || lastThOpen > lastThClose);
    
    if (inTableCell) {
      continue; // Don't modify spacing inside table cells
    }
    
    // Check character before the link
    const charBefore = index > 0 ? fixedContent[index - 1] : '';
    const needsSpaceBefore = charBefore !== ' ' && 
      charBefore !== '' && 
      charBefore !== '\n' && 
      charBefore !== '<' &&
      charBefore !== '(' &&
      charBefore !== '[' &&
      !/[.,!?;:]/.test(charBefore);
    
    // Check character after the link
    const afterIndex = index + match.length;
    const charAfter = afterIndex < fixedContent.length ? fixedContent[afterIndex] : '';
    const needsSpaceAfter = charAfter !== ' ' &&
      charAfter !== '' &&
      charAfter !== '\n' &&
      charAfter !== '>' &&
      charAfter !== ')' &&
      charAfter !== ']' &&
      charAfter !== ',' &&
      charAfter !== '.' &&
      charAfter !== '!' &&
      charAfter !== '?' &&
      charAfter !== ';' &&
      charAfter !== ':';
    
    // Build replacement
    let replacement = match;
    if (needsSpaceBefore) replacement = ' ' + replacement;
    if (needsSpaceAfter) replacement = replacement + ' ';
    
    // Apply replacement
    fixedContent = fixedContent.substring(0, index) + replacement + fixedContent.substring(afterIndex);
  }
  
  return { content: fixedContent, linksFixed };
}

/**
 * Preserve table HTML structure when updating content
 */
function preserveTables(content: string): string {
  // Check if content has tables
  const tableCount = (content.match(/<table[^>]*>/gi) || []).length;
  if (tableCount === 0) return content;
  
  // Ensure all tables are properly closed
  const tableCloseCount = (content.match(/<\/table>/gi) || []).length;
  if (tableCount > tableCloseCount) {
    // Add missing closing tags
    for (let i = 0; i < tableCount - tableCloseCount; i++) {
      content += '</tbody></table>';
    }
  }
  
  // Ensure table structure integrity - check for broken tags
  // This regex finds unclosed table elements
  const brokenTablePattern = /<table[^>]*>[\s\S]*?(?=<table|$)/gi;
  let fixedContent = content;
  let match;
  
  while ((match = brokenTablePattern.exec(content)) !== null) {
    const tableBlock = match[0];
    const hasThead = /<thead[^>]*>/i.test(tableBlock);
    const hasTbody = /<tbody[^>]*>/i.test(tableBlock);
    const hasTheadClose = /<\/thead>/i.test(tableBlock);
    const hasTbodyClose = /<\/tbody>/i.test(tableBlock);
    
    // If table has opening tags but missing closing tags, preserve structure
    // Don't modify if structure looks intact
    if ((hasThead && !hasTheadClose) || (hasTbody && !hasTbodyClose)) {
      // Table structure might be broken, but we'll preserve what we have
      // The fixLinksInContent shouldn't break tables, so we just ensure closing tags exist
    }
  }
  
  return fixedContent;
}

/**
 * Fix links in articles for a specific translation_id (all languages of one article group)
 */
async function fixLinksForTranslationId(
  translationId: string,
  slugMapping: Record<string, Record<string, string>>
): Promise<{ articlesUpdated: number; linksFixed: number }> {
  let articlesUpdated = 0;
  let totalLinksFixed = 0;
  
  // Get all translated articles for this translation_id (including English for completeness)
  const { data: articles } = await supabase
    .from("articles")
    .select("id, content, language, slug")
    .eq("translation_id", translationId);
  
  if (!articles || articles.length === 0) {
    return { articlesUpdated, linksFixed: totalLinksFixed };
  }
  
  for (const article of articles) {
    // Preserve table structure before fixing links
    let contentWithTables = preserveTables(article.content);
    
    const { content: fixedContent, linksFixed } = fixLinksInContent(
      contentWithTables,
      article.language,
      slugMapping
    );
    
    // Preserve table structure after fixing links
    const finalContent = preserveTables(fixedContent);
    
    // Always update if links were fixed, or if we're ensuring table preservation
    if (linksFixed > 0 || finalContent !== article.content) {
      // Update the article
      const { error } = await supabase
        .from("articles")
        .update({ content: finalContent })
        .eq("id", article.id);
      
      if (!error) {
        articlesUpdated++;
        totalLinksFixed += linksFixed;
        console.log(`Fixed ${linksFixed} links in ${article.language} article (${article.slug})`);
      } else {
        console.error(`Failed to update article ${article.id}:`, error);
      }
    }
  }
  
  return { articlesUpdated, linksFixed: totalLinksFixed };
}

/**
 * Fix links in all translated articles
 */
async function fixAllArticleLinks(
  slugMapping: Record<string, Record<string, string>>
): Promise<{ articlesUpdated: number; linksFixed: number }> {
  let articlesUpdated = 0;
  let totalLinksFixed = 0;
  
  // Get all translated articles (non-English)
  const { data: articles, error } = await supabase
    .from("articles")
    .select("id, content, language, slug")
    .neq("language", "en");
  
  if (error || !articles) {
    console.error("Error fetching articles:", error);
    return { articlesUpdated, linksFixed: totalLinksFixed };
  }
  
  console.log(`Processing ${articles.length} translated articles...`);
  
  for (const article of articles) {
    const { content: fixedContent, linksFixed } = fixLinksInContent(
      article.content,
      article.language,
      slugMapping
    );
    
    if (linksFixed > 0) {
      const { error: updateError } = await supabase
        .from("articles")
        .update({ content: fixedContent })
        .eq("id", article.id);
      
      if (!updateError) {
        articlesUpdated++;
        totalLinksFixed += linksFixed;
        console.log(`Fixed ${linksFixed} links in ${article.language}/${article.slug}`);
      } else {
        console.error(`Failed to update ${article.id}:`, updateError);
      }
    }
  }
  
  return { articlesUpdated, linksFixed: totalLinksFixed };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log(`[fix-article-links] Version: ${VERSION}`);

  try {
    const body = await req.json().catch(() => ({}));
    const { translation_id, fix_all } = body;

    // Build global slug mapping (one query for all)
    console.log("Building global slug mapping...");
    const slugMapping = await buildGlobalSlugMapping();
    const mappingTime = Date.now() - startTime;
    console.log(`Mapping built in ${mappingTime}ms`);

    let result;

    if (fix_all === true) {
      // Fix all translated articles
      console.log("Fixing all translated articles...");
      result = await fixAllArticleLinks(slugMapping);
    } else if (translation_id) {
      // Fix articles for a specific translation_id
      console.log(`Fixing articles for translation_id: ${translation_id}`);
      result = await fixLinksForTranslationId(translation_id, slugMapping);
    } else {
      return new Response(
        JSON.stringify({ error: "Provide translation_id or fix_all=true" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalTime = Date.now() - startTime;
    console.log(`Done: ${result.articlesUpdated} articles updated, ${result.linksFixed} links fixed in ${totalTime}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        articles_updated: result.articlesUpdated,
        links_fixed: result.linksFixed,
        execution_time_ms: totalTime,
        version: VERSION,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

