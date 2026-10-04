import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://www.micronshub.eu";
const CF_ACCESS_CLIENT_ID = Deno.env.get("CF_ACCESS_CLIENT_ID");
const CF_ACCESS_CLIENT_SECRET = Deno.env.get("CF_ACCESS_CLIENT_SECRET");
// The Access service token goes only to a host behind a Cloudflare Access application (the preview host, the
// machine API host); www.micronshub.eu, micronshub.eu and *.vercel.app have none and never receive it.
const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return "";
  }
})();
const SITE_HAS_ACCESS_APP = SITE_HOST !== "" && SITE_HOST !== "micronshub.eu" && SITE_HOST !== "www.micronshub.eu" &&
  SITE_HOST !== "vercel.app" && !SITE_HOST.endsWith(".vercel.app");
const ACCESS_TOKEN_SET = Boolean(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET);
const HAS_ACCESS_TOKEN = ACCESS_TOKEN_SET && SITE_HAS_ACCESS_APP;
const SCAN_HEADERS: Record<string, string> = HAS_ACCESS_TOKEN
  ? { "Content-Type": "application/json", "CF-Access-Client-Id": CF_ACCESS_CLIENT_ID!, "CF-Access-Client-Secret": CF_ACCESS_CLIENT_SECRET! }
  : { "Content-Type": "application/json" };

const BATCH_SIZE = 5;
const PER_SCAN_TIMEOUT = 25000;

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

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
  if (ACCESS_TOKEN_SET && !HAS_ACCESS_TOKEN) {
    console.log(`[tender-collector] Access headers not sent to ${SITE_HOST || "SITE_URL"}: not a machine API host`);
  }

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
            headers: SCAN_HEADERS,
            body: JSON.stringify({ country_code: connector.country_code }),
            signal: controller.signal,
            redirect: HAS_ACCESS_TOKEN ? "manual" : "follow",
          });
          clearTimeout(timer);
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            throw new Error(`HTTP ${resp.status} for ${connector.country_code}: ${body.slice(0, 100)}`);
          }
          const data = await resp.json();
          if (data.queued) {
            console.log(`[tender-collector] ${connector.country_code}: queued, run_id ${data.run_id ?? "unknown"}`);
          } else {
            console.log(`[tender-collector] ${connector.country_code}: ${data.tenders_new ?? 0} new, ${data.tenders_found ?? 0} found`);
          }
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
