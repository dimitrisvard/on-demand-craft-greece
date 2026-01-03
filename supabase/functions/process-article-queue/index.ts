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
 * Worker function to process article generation queue
 * This function processes one job at a time from the queue
 * Can be called with longer timeout via pg_net (up to 5 minutes)
 */
serve(async (req) => {
  console.log(`[process-article-queue] Function called at ${new Date().toISOString()}`);
  
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: "Server configuration error: Missing Supabase credentials" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }

  try {
    // Get next job from queue using the database function
    const { data: queueJob, error: queueError } = await supabase
      .rpc('get_next_queue_job');

    if (queueError || !queueJob || queueJob.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: "No pending jobs in queue",
          processed: false 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const job = queueJob[0];
    console.log(`[process-article-queue] Processing job ${job.queue_id} for title: ${job.title}`);

    // Call the generate-daily-article function with the specific title_id
    const generateUrl = `${supabaseUrl}/functions/v1/generate-daily-article`;
    const generateResponse = await fetch(generateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ 
        title_id: job.title_id,
        queue_job_id: job.queue_id 
      }),
    });

    const generateResult = await generateResponse.json();

    if (generateResponse.ok && generateResult.success) {
      // Mark job as completed
      await supabase.rpc('mark_queue_job_completed', {
        queue_job_id: job.queue_id,
        article_id: generateResult.master_article_id
      });

      console.log(`[process-article-queue] Job ${job.queue_id} completed successfully`);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: "Article generated successfully",
          queue_job_id: job.queue_id,
          article_id: generateResult.master_article_id,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    } else {
      // Mark job as failed
      const errorMsg = generateResult.error || "Unknown error";
      await supabase.rpc('mark_queue_job_failed', {
        queue_job_id: job.queue_id,
        error_msg: errorMsg
      });

      console.error(`[process-article-queue] Job ${job.queue_id} failed:`, errorMsg);
      
      return new Response(
        JSON.stringify({
          success: false,
          message: "Article generation failed",
          queue_job_id: job.queue_id,
          error: errorMsg,
          will_retry: job.retry_count < 2, // Will retry if retry_count < 3
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }
  } catch (error: any) {
    console.error("[process-article-queue] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "Unknown error",
        errorType: error.name || "Error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

