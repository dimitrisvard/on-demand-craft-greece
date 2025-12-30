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
 * Auto-update sitemap after translations are complete
 * This function should be called 30-60 minutes after translations complete
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("Auto-updating sitemap...");

    // Call the generate-sitemap Edge Function
    const sitemapUrl = `${supabaseUrl}/functions/v1/generate-sitemap?type=complete`;
    const sitemapResponse = await fetch(sitemapUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
    });

    const sitemapResult = await sitemapResponse.json();

    if (!sitemapResponse.ok) {
      throw new Error(sitemapResult.error || "Sitemap generation failed");
    }

    console.log(`Sitemap updated successfully: ${sitemapResult.stats.urls} URLs`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Sitemap updated successfully",
        stats: sitemapResult.stats,
        publicUrl: sitemapResult.storage?.publicUrls?.sitemap,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in auto-update-sitemap:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

