import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// All supported languages for translation
// Order matters: difficult languages (special characters, complex grammar) are at the end
// so if we run out of time, simpler languages are done first
const ALL_LANGUAGES = [
  { code: "de", name: "German", difficulty: "normal" },
  { code: "fr", name: "French", difficulty: "normal" },
  { code: "es", name: "Spanish", difficulty: "normal" },
  { code: "it", name: "Italian", difficulty: "normal" },
  { code: "nl", name: "Dutch", difficulty: "normal" },
  { code: "pt", name: "Portuguese", difficulty: "normal" },
  { code: "sv", name: "Swedish", difficulty: "normal" },
  { code: "da", name: "Danish", difficulty: "normal" },
  { code: "nb", name: "Norwegian", difficulty: "normal" },
  // Difficult languages with special characters - translate one at a time
  { code: "pl", name: "Polish", difficulty: "hard" },
  { code: "cs", name: "Czech", difficulty: "hard" },
  { code: "hu", name: "Hungarian", difficulty: "hard" },
  { code: "fi", name: "Finnish", difficulty: "hard" },
];

/**
 * Auto-translate articles that were created today and haven't been translated yet
 * 
 * NEW APPROACH (2026-01-06): Translate languages ONE AT A TIME to avoid timeout
 * - Each language translation takes ~10-30 seconds
 * - Edge functions have a 150s limit
 * - By translating one language per call, we avoid timeouts completely
 * - Difficult languages (Hungarian, Czech, Finnish, Polish) are handled separately
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const functionStartTime = Date.now();
  console.log(`[auto-translate-articles] Starting... (version: 2026-01-06-per-language)`);

  try {
    // Find English articles created today that don't have ALL translations yet
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
    
    const todayStartISO = todayStart.toISOString();
    const todayEndISO = todayEnd.toISOString();

    console.log(`Looking for articles created between ${todayStartISO} and ${todayEndISO} (UTC)`);

    // Get English articles created today
    const { data: englishArticles, error: fetchError } = await supabase
      .from("articles")
      .select("id, translation_id, title, created_at")
      .eq("language", "en")
      .eq("status", "published")
      .gte("created_at", todayStartISO)
      .lt("created_at", todayEndISO)
      .order("created_at", { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch articles: ${fetchError.message}`);
    }

    if (!englishArticles || englishArticles.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No English articles found for translation today",
          articles_processed: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    console.log(`Found ${englishArticles.length} English article(s) created today`);

    // For each article, find which languages are missing
    const articlesWithMissingLanguages: Array<{
      articleId: string;
      translationId: string;
      title: string;
      missingLanguages: string[];
    }> = [];

    for (const article of englishArticles) {
      if (!article.translation_id) {
        console.log(`Article ${article.id} has no translation_id, skipping`);
        continue;
      }

      // Get existing translations for this article
      const { data: existingTranslations, error: transError } = await supabase
        .from("articles")
        .select("language")
        .eq("translation_id", article.translation_id)
        .neq("language", "en");

      if (transError) {
        console.error(`Error checking translations for article ${article.id}:`, transError);
        continue;
      }

      const existingLanguages = new Set(existingTranslations?.map(t => t.language) || []);
      const missingLanguages = ALL_LANGUAGES
        .map(l => l.code)
        .filter(code => !existingLanguages.has(code));

      if (missingLanguages.length > 0) {
        console.log(`Article "${article.title}" is missing ${missingLanguages.length} languages: ${missingLanguages.join(", ")}`);
        articlesWithMissingLanguages.push({
          articleId: article.id,
          translationId: article.translation_id,
          title: article.title,
          missingLanguages,
        });
      } else {
        console.log(`Article "${article.title}" already has all translations`);
      }
    }

    if (articlesWithMissingLanguages.length === 0) {
      console.log("All articles already have all translations!");
      return new Response(
        JSON.stringify({
          success: true,
          message: "All articles already have all translations",
          articles_processed: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Process each article and translate missing languages ONE AT A TIME
    const results: Array<{
      article_id: string;
      title: string;
      languages_translated: string[];
      languages_failed: Array<{ code: string; error: string }>;
    }> = [];

    let totalTranslated = 0;
    let totalFailed = 0;

    for (const article of articlesWithMissingLanguages) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Processing article: "${article.title}"`);
      console.log(`Missing ${article.missingLanguages.length} languages: ${article.missingLanguages.join(", ")}`);
      console.log(`${"=".repeat(60)}`);

      const articleResult = {
        article_id: article.articleId,
        title: article.title,
        languages_translated: [] as string[],
        languages_failed: [] as Array<{ code: string; error: string }>,
      };

      // Translate each missing language ONE AT A TIME
      for (let langIndex = 0; langIndex < article.missingLanguages.length; langIndex++) {
        const langCode = article.missingLanguages[langIndex];
        const langInfo = ALL_LANGUAGES.find(l => l.code === langCode);
        const langName = langInfo?.name || langCode;
        const isHardLanguage = langInfo?.difficulty === "hard";

        console.log(`\n[${langIndex + 1}/${article.missingLanguages.length}] Translating to ${langName} (${langCode})${isHardLanguage ? " [HARD]" : ""}...`);

        try {
          const translateUrl = `${supabaseUrl}/functions/v1/translate-article`;
          const translateStartTime = Date.now();

          // Call translate-article with ONLY this single language
          const translateResponse = await fetch(translateUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              article_id: article.articleId,
              target_languages: [langCode], // Only translate this one language
            }),
          });

          const translateResult = await translateResponse.json();
          const translateDuration = Date.now() - translateStartTime;

          if (translateResponse.ok && translateResult.success) {
            console.log(`✓ ${langName} translated successfully in ${translateDuration}ms`);
            articleResult.languages_translated.push(langCode);
            totalTranslated++;
          } else {
            const errorMsg = translateResult.error || translateResult.message || "Translation failed";
            console.error(`✗ ${langName} failed after ${translateDuration}ms: ${errorMsg}`);
            articleResult.languages_failed.push({ code: langCode, error: errorMsg });
            totalFailed++;
          }
        } catch (error: any) {
          console.error(`✗ ${langName} error: ${error.message}`);
          articleResult.languages_failed.push({ code: langCode, error: error.message });
          totalFailed++;
        }

        // Wait between translations to avoid rate limits
        // Longer wait for hard languages and after errors
        if (langIndex < article.missingLanguages.length - 1) {
          const isNextHard = ALL_LANGUAGES.find(l => l.code === article.missingLanguages[langIndex + 1])?.difficulty === "hard";
          const waitTime = isHardLanguage || isNextHard ? 5000 : 3000; // 5s for hard languages, 3s for normal
          console.log(`Waiting ${waitTime / 1000}s before next language...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      results.push(articleResult);

      // Wait between articles if there are more
      if (articlesWithMissingLanguages.indexOf(article) < articlesWithMissingLanguages.length - 1) {
        console.log(`\nWaiting 10s before next article...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    // After all translations complete, fix internal article links
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Fixing internal article links...`);
    console.log(`${"=".repeat(60)}`);
    
    let linkFixResult = { success: false, articles_updated: 0, links_fixed: 0 };
    
    try {
      const fixLinksUrl = `${supabaseUrl}/functions/v1/fix-article-links`;
      const fixLinksResponse = await fetch(fixLinksUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ fix_all: true }),
      });
      
      if (fixLinksResponse.ok) {
        linkFixResult = await fixLinksResponse.json();
        console.log(`✓ Fixed ${linkFixResult.links_fixed} links in ${linkFixResult.articles_updated} articles`);
      } else {
        const err = await fixLinksResponse.text();
        console.error(`✗ Link fixing failed:`, err);
      }
    } catch (error: any) {
      console.error(`✗ Error calling fix-article-links:`, error.message);
    }

    const totalTime = Date.now() - functionStartTime;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`TRANSLATION COMPLETE`);
    console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s`);
    console.log(`Languages translated: ${totalTranslated}`);
    console.log(`Languages failed: ${totalFailed}`);
    console.log(`${"=".repeat(60)}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Translation completed: ${totalTranslated} languages translated, ${totalFailed} failed`,
        articles_processed: articlesWithMissingLanguages.length,
        total_translated: totalTranslated,
        total_failed: totalFailed,
        execution_time_ms: totalTime,
        results,
        link_fix: linkFixResult,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    const totalTime = Date.now() - functionStartTime;
    console.error("Error in auto-translate-articles:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "Unknown error",
        execution_time_ms: totalTime,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
