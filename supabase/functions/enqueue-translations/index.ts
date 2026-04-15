import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

/**
 * Thin endpoint the BlogEditor UI calls instead of translate-article.
 *
 * Flow:
 *   1. Accept { article_id, target_languages? }
 *   2. Call SQL enqueue_translations(article_id, languages) via service-role client
 *   3. Return { queued, queue_ids } in under 2 s
 *
 * The actual translation work is performed by process-translation-queue,
 * which is invoked every minute by pg_cron. This keeps the browser request
 * fast and decoupled from Supabase's 150 s idle-timeout.
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Default language set matches auto-translate-articles.
const DEFAULT_LANGUAGES = [
  "de", "fr", "es", "it", "nl", "pt", "sv", "da", "nb",
  "pl", "cs", "hu", "fi",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: "Server configuration error: Missing Supabase credentials" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const articleId: string | undefined = body.article_id;
    const requestedLanguages: string[] | undefined = Array.isArray(body.target_languages)
      ? body.target_languages.filter((x: unknown) => typeof x === "string" && x.length > 0)
      : undefined;

    if (!articleId) {
      return new Response(
        JSON.stringify({ error: "article_id is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // Verify the article exists and is English (source language).
    const { data: article, error: articleError } = await supabase
      .from("articles")
      .select("id, language, translation_id")
      .eq("id", articleId)
      .maybeSingle();

    if (articleError) {
      return new Response(
        JSON.stringify({ error: `Failed to load article: ${articleError.message}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }
    if (!article) {
      return new Response(
        JSON.stringify({ error: `Article ${articleId} not found` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 },
      );
    }
    if (!article.translation_id) {
      return new Response(
        JSON.stringify({ error: "Article has no translation_id; cannot enqueue translations" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // Resolve the language list:
    //   - explicit target_languages → use as-is
    //   - otherwise → default set MINUS any language that already has an article
    //     in the same translation group (so "Translate All" is idempotent).
    let languages: string[];
    if (requestedLanguages && requestedLanguages.length > 0) {
      languages = requestedLanguages;
    } else {
      const { data: existing, error: existingError } = await supabase
        .from("articles")
        .select("language")
        .eq("translation_id", article.translation_id)
        .neq("language", "en");

      if (existingError) {
        return new Response(
          JSON.stringify({ error: `Failed to load existing translations: ${existingError.message}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
        );
      }

      const existingLangs = new Set((existing ?? []).map((r) => r.language));
      languages = DEFAULT_LANGUAGES.filter((code) => !existingLangs.has(code));
    }

    if (languages.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          queued: 0,
          queue_ids: [],
          message: "All target languages already translated",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Idempotent insert via SQL helper.
    const { data: enqueueResult, error: enqueueError } = await supabase.rpc(
      "enqueue_translations",
      { p_article_id: articleId, p_languages: languages },
    );

    if (enqueueError) {
      return new Response(
        JSON.stringify({ error: `Failed to enqueue translations: ${enqueueError.message}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    // enqueue_translations RETURNS SETOF UUID → supabase-js returns an array of UUID strings.
    const queueIds: string[] = Array.isArray(enqueueResult) ? enqueueResult : [];

    return new Response(
      JSON.stringify({
        success: true,
        queued: queueIds.length,
        queue_ids: queueIds,
        languages,
        translation_id: article.translation_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error: any) {
    console.error("[enqueue-translations] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message ?? "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
