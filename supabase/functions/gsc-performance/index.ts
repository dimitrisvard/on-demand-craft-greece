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
    const body = await req.json().catch(() => ({}));
    const {
      startDate = new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0],
      endDate = new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0],
      dimensions = ["page"],
      rowLimit = 1000,
      urlFilter = "/blog/",
      language,
    } = body;

    // Get credentials from Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: config, error: cfgErr } = await supabase
      .from("gsc_config")
      .select("*")
      .eq("id", 1)
      .single();

    if (cfgErr || !config) {
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

    // Build dimension filters
    const dimensionFilterGroups: any[] = [];
    const filters: any[] = [];
    if (urlFilter) {
      filters.push({
        dimension: "page",
        operator: "contains",
        expression: urlFilter,
      });
    }
    if (language) {
      filters.push({
        dimension: "page",
        operator: "contains",
        expression: `/${language}/`,
      });
    }
    if (filters.length > 0) {
      dimensionFilterGroups.push({ filters });
    }

    // Call GSC Search Analytics API
    const siteUrl = encodeURIComponent(config.site_url);
    const gscRes = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions,
          rowLimit,
          dimensionFilterGroups,
        }),
      }
    );

    const gscData = await gscRes.json();

    if (!gscRes.ok) {
      return new Response(JSON.stringify({ error: "GSC API error", details: gscData }), {
        status: gscRes.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Enrich with monitored URL data
    const rows = gscData.rows || [];
    const summary = {
      totalClicks: rows.reduce((s: number, r: any) => s + (r.clicks || 0), 0),
      totalImpressions: rows.reduce((s: number, r: any) => s + (r.impressions || 0), 0),
      avgCtr: rows.length > 0
        ? rows.reduce((s: number, r: any) => s + (r.ctr || 0), 0) / rows.length
        : 0,
      avgPosition: rows.length > 0
        ? rows.reduce((s: number, r: any) => s + (r.position || 0), 0) / rows.length
        : 0,
      pageCount: rows.length,
    };

    return new Response(
      JSON.stringify({
        period: { startDate, endDate },
        summary,
        rows: rows.slice(0, 50),
        totalRows: rows.length,
      }),
      {
        headers: { "Content-Type": "application/json", Connection: "keep-alive" },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
