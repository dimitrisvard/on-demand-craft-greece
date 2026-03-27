import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://www.micronshub.eu";

const BATCH_SIZE = 5;       // connectors per parallel batch
const PER_SCAN_TIMEOUT = 25000; // ms per connector scan (increased for slow portals)

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Find connectors that need scanning (last_scan_at is the column written by tender-scan.js)
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // 6h ago

  const [{ data: nullRows }, { data: staleRows }] = await Promise.all([
    supabase
      .from("tender_connectors")
      .select("id, country_code, country_name, portal_name")
      .eq("is_active", true)
      .is("last_scan_at", null),
    supabase
      .from("tender_connectors")
      .select("id, country_code, country_name, portal_name")
      .eq("is_active", true)
      .lt("last_scan_at", cutoff),
  ]);

  const seen = new Set<string>();
  const connectors = [...(nullRows ?? []), ...(staleRows ?? [])].filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  if (connectors.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, scanned: 0, newTenders: 0, errors: 0, message: "All connectors up to date" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[tender-collector] ${connectors.length} connectors need scanning`);

  // Scan in parallel batches
  let totalNew = 0;
  let totalErrors = 0;
  const errorDetails: string[] = [];

  for (let i = 0; i < connectors.length; i += BATCH_SIZE) {
    const batch = connectors.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (connector) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_SCAN_TIMEOUT);
        try {
          // Send country_code (not connectorId) — this is what tender-scan.js expects
          const resp = await fetch(`${SITE_URL}/api/tender-scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ country_code: connector.country_code }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            throw new Error(`HTTP ${resp.status} for ${connector.country_code}: ${body.slice(0, 100)}`);
          }
          const data = await resp.json();
          console.log(`[tender-collector] ${connector.country_code}: ${data.tenders_new ?? 0} new, ${data.tenders_found ?? 0} found`);
          return { connector, data };
        } catch (err) {
          clearTimeout(timer);
          throw new Error(`${connector.country_code}: ${(err as Error).message}`);
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        totalNew += result.value.data?.tenders_new ?? 0;
      } else {
        totalErrors++;
        const msg = result.reason?.message ?? "unknown";
        errorDetails.push(msg);
        console.error(`[tender-collector] Scan error: ${msg}`);
      }
    }

    // Small delay between batches to avoid hammering the API
    if (i + BATCH_SIZE < connectors.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      scanned: connectors.length,
      newTenders: totalNew,
      errors: totalErrors,
      errorDetails: errorDetails.slice(0, 10),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
