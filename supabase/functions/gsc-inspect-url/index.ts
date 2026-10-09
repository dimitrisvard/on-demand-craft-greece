import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function getAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json();
    const { urls } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return new Response(
        JSON.stringify({ error: "Provide an array of urls to inspect" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Limit to 50 per call (rate limits)
    const batch = urls.slice(0, 50);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: config } = await supabase
      .from("gsc_config")
      .select("*")
      .eq("id", 1)
      .single();

    if (!config) {
      return new Response(JSON.stringify({ error: "GSC config not found" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const accessToken = await getAccessToken(
      config.refresh_token,
      config.client_id,
      config.client_secret
    );

    const results: any[] = [];
    for (const url of batch) {
      try {
        const res = await fetch(
          "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              inspectionUrl: url,
              siteUrl: config.site_url,
            }),
          }
        );
        const data = await res.json();
        const ir = data.inspectionResult || {};
        results.push({
          url,
          verdict: ir.indexStatusResult?.verdict || "UNKNOWN",
          coverageState: ir.indexStatusResult?.coverageState || "UNKNOWN",
          robotsTxtState: ir.indexStatusResult?.robotsTxtState || "UNKNOWN",
          lastCrawlTime: ir.indexStatusResult?.lastCrawlTime || null,
          crawledAs: ir.indexStatusResult?.crawledAs || "UNKNOWN",
          pageFetchState: ir.indexStatusResult?.pageFetchState || "UNKNOWN",
          mobileUsability: ir.mobileUsabilityResult?.verdict || "UNKNOWN",
        });
      } catch (err) {
        results.push({ url, error: String(err) });
      }
    }

    const indexed = results.filter((r) => r.verdict === "PASS").length;
    const notIndexed = results.filter((r) => r.verdict !== "PASS" && !r.error).length;

    return new Response(
      JSON.stringify({
        inspected: results.length,
        indexed,
        notIndexed,
        results,
      }),
      { headers: { "Content-Type": "application/json", Connection: "keep-alive" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
