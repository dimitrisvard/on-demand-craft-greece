import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

/**
 * Worker for translation_queue.
 *
 * Invoked every minute by pg_cron (see
 * supabase/migrations/20260415_schedule_translation_queue.sql).
 *
 * Per invocation this function:
 *   1. Claims ONE (pending/failed) job via get_next_translation_job()
 *   2. Calls translate-article with exactly ONE target language
 *   3. On success  → mark_translation_job_completed
 *      On failure  → mark_translation_job_failed (auto-increments retry_count,
 *                    will be retried on a later cron tick until retry_count=3)
 *
 * Because translate-article is called from a background worker (not the
 * browser), a 150 s idle-timeout on the HTTP call is no longer a user-facing
 * error — it just becomes a retryable failure row.
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  console.log(`[process-translation-queue] invoked at ${new Date().toISOString()}`);

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
    // Atomically claim one job.
    const { data: jobs, error: claimError } = await supabase.rpc("get_next_translation_job");

    if (claimError) {
      console.error("[process-translation-queue] get_next_translation_job failed:", claimError);
      return new Response(
        JSON.stringify({ error: `Failed to claim job: ${claimError.message}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending translation jobs", processed: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const job = jobs[0] as {
      queue_id: string;
      article_id: string;
      translation_id: string;
      target_language: string;
      retry_count: number;
    };

    console.log(
      `[process-translation-queue] claimed job ${job.queue_id} (article=${job.article_id}, lang=${job.target_language}, retry=${job.retry_count})`,
    );

    const translateUrl = `${supabaseUrl}/functions/v1/translate-article`;
    const translateStart = Date.now();

    let translateResponse: Response;
    try {
      translateResponse = await fetch(translateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          article_id: job.article_id,
          target_languages: [job.target_language],
        }),
      });
    } catch (fetchError: any) {
      const msg = `translate-article fetch failed: ${fetchError?.message ?? String(fetchError)}`;
      console.error(`[process-translation-queue] ${msg}`);
      await supabase.rpc("mark_translation_job_failed", {
        p_queue_id: job.queue_id,
        p_error: msg,
      });
      return new Response(
        JSON.stringify({
          success: false,
          queue_id: job.queue_id,
          error: msg,
          will_retry: job.retry_count < 2,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const translateDuration = Date.now() - translateStart;
    let translateResult: any = null;
    try {
      translateResult = await translateResponse.json();
    } catch {
      translateResult = { error: `Non-JSON response (status ${translateResponse.status})` };
    }

    const ok = translateResponse.ok && translateResult?.success === true;

    if (ok) {
      // Resolve the resulting translated article id for bookkeeping.
      // translate-article returns varied shapes (details vs. status field);
      // we best-effort look up the translated article by (translation_id, language).
      let resultArticleId: string | null = translateResult?.master_article_id ?? null;
      if (!resultArticleId) {
        const { data: translatedRow } = await supabase
          .from("articles")
          .select("id")
          .eq("translation_id", job.translation_id)
          .eq("language", job.target_language)
          .maybeSingle();
        resultArticleId = translatedRow?.id ?? null;
      }

      const { error: completeError } = await supabase.rpc(
        "mark_translation_job_completed",
        { p_queue_id: job.queue_id, p_result_article_id: resultArticleId },
      );
      if (completeError) {
        console.error(
          `[process-translation-queue] mark_completed failed for job ${job.queue_id}:`,
          completeError,
        );
      }

      console.log(
        `[process-translation-queue] job ${job.queue_id} completed in ${translateDuration}ms (article=${resultArticleId})`,
      );

      return new Response(
        JSON.stringify({
          success: true,
          queue_id: job.queue_id,
          article_id: resultArticleId,
          language: job.target_language,
          duration_ms: translateDuration,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Prefer the structured overload signal: translate-article returns
    // { gemini_overloaded: true, details: { <lang>: { error: "GEMINI_OVERLOADED" } } }
    // when every fallback model returned 5xx. Preserving this string in
    // error_message lets the BlogEditor UI show a friendly "Gemini overloaded —
    // will retry" pill instead of a generic failure toast.
    const langDetail = translateResult?.details?.[job.target_language];
    const overloaded =
      translateResult?.gemini_overloaded === true ||
      langDetail?.error === "GEMINI_OVERLOADED";

    const errorMsg = overloaded
      ? "GEMINI_OVERLOADED"
      : (translateResult?.error ||
         translateResult?.message ||
         `translate-article returned status ${translateResponse.status}`);

    const { error: failError } = await supabase.rpc("mark_translation_job_failed", {
      p_queue_id: job.queue_id,
      p_error: String(errorMsg).slice(0, 2000),
    });
    if (failError) {
      console.error(
        `[process-translation-queue] mark_failed failed for job ${job.queue_id}:`,
        failError,
      );
    }

    console.warn(
      `[process-translation-queue] job ${job.queue_id} failed after ${translateDuration}ms: ${errorMsg}`,
    );

    return new Response(
      JSON.stringify({
        success: false,
        queue_id: job.queue_id,
        language: job.target_language,
        error: errorMsg,
        duration_ms: translateDuration,
        will_retry: job.retry_count < 2,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error: any) {
    console.error("[process-translation-queue] unhandled error:", error);
    return new Response(
      JSON.stringify({ error: error?.message ?? "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
