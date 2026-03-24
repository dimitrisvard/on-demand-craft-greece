import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://www.micronshub.eu";

const BATCH_SIZE = 5;      // connectors per parallel batch
const PER_SCAN_TIMEOUT = 8000; // ms per connector scan

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ---- find connectors that need scanning ----
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // 6h ago

  const [{ data: nullRows }, { data: staleRows }] = await Promise.all([
    supabase
      .from("tender_connectors")
      .select("id, country_code, country_name, portal_name, portal_url, connector_type, config")
      .eq("is_active", true)
      .is("last_scanned_at", null),
    supabase
      .from("tender_connectors")
      .select("id, country_code, country_name, portal_name, portal_url, connector_type, config")
      .eq("is_active", true)
      .lt("last_scanned_at", cutoff),
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

  // ---- scan in parallel batches ----
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
          const resp = await fetch(`${SITE_URL}/api/tender-scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connectorId: connector.id }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} for ${connector.country_code}`);
          }
          const data = await resp.json();
          return { connector, data };
        } catch (err) {
          clearTimeout(timer);
          throw new Error(`${connector.country_code}: ${(err as Error).message}`);
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        totalNew += result.value.data?.newTenders ?? 0;
      } else {
        totalErrors++;
        errorDetails.push(result.reason?.message ?? "unknown");
      }
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
