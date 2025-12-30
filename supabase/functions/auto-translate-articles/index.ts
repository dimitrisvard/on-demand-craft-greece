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

/**
 * Auto-translate articles that were created today and haven't been translated yet
 * This function should be called 1-2 hours after daily article creation
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Find English articles created today that don't have translations yet
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.toISOString();
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayEnd = tomorrow.toISOString();

    console.log(`Looking for articles created between ${todayStart} and ${todayEnd}`);

    // Get English articles created today
    const { data: englishArticles, error: fetchError } = await supabase
      .from("articles")
      .select("id, translation_id, created_at")
      .eq("language", "en")
      .eq("status", "published")
      .gte("created_at", todayStart)
      .lt("created_at", todayEnd)
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

    // Check which articles already have translations
    const articlesToTranslate: string[] = [];
    
    for (const article of englishArticles) {
      if (!article.translation_id) continue;

      // Check if translations exist
      const { data: translations, error: transError } = await supabase
        .from("articles")
        .select("id")
        .eq("translation_id", article.translation_id)
        .neq("language", "en");

      if (transError) {
        console.error(`Error checking translations for article ${article.id}:`, transError);
        continue;
      }

      // If no translations exist, add to queue
      if (!translations || translations.length === 0) {
        articlesToTranslate.push(article.id);
      }
    }

    if (articlesToTranslate.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "All articles already have translations",
          articles_processed: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    console.log(`Found ${articlesToTranslate.length} article(s) needing translation`);

    // Translate each article (process sequentially to avoid rate limits)
    const results: Array<{ article_id: string; success: boolean; error?: string }> = [];

    for (const articleId of articlesToTranslate) {
      try {
        console.log(`Translating article ${articleId}...`);

        // Call the translate-article Edge Function
        const translateUrl = `${supabaseUrl}/functions/v1/translate-article`;
        const translateResponse = await fetch(translateUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ article_id: articleId }),
        });

        const translateResult = await translateResponse.json();

        if (translateResponse.ok) {
          results.push({ article_id: articleId, success: true });
          console.log(`✓ Article ${articleId} translated successfully`);
        } else {
          results.push({
            article_id: articleId,
            success: false,
            error: translateResult.error || "Translation failed",
          });
          console.error(`✗ Article ${articleId} translation failed:`, translateResult.error);
        }

        // Wait 10 seconds between translations to avoid rate limits
        if (articlesToTranslate.indexOf(articleId) < articlesToTranslate.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
      } catch (error: any) {
        console.error(`Error translating article ${articleId}:`, error);
        results.push({
          article_id: articleId,
          success: false,
          error: error.message,
        });
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Translation process completed: ${successful} successful, ${failed} failed`,
        articles_processed: articlesToTranslate.length,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in auto-translate-articles:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

