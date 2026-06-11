import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Backend for /dashboard/xometry (src/pages/dashboard/XometryQueuePage.tsx).
//
// The xometry_offers table has RLS enabled with NO policies, so the browser's
// anon key can never read it — all reads go through this function with the
// service role key, gated on an admin-level user_roles row. Submit/Skip are
// proxied to the Hetzner review API (xometry-bot/xometry_bot/review_api.py)
// so its bearer token never reaches the browser. That review API is the ONLY
// thing that can send a counteroffer, and only for one explicit code per call.
//
// Secrets (supabase secrets set ...):
//   XOMETRY_REVIEW_API_URL   e.g. https://<hetzner-box>:8077
//   XOMETRY_REVIEW_API_TOKEN must match XB_REVIEW_API_TOKEN on the box

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Same bar as api/_lib/admin-auth.js.
const ADMIN_ROLES = ["admin", "sales_rep", "production_manager", "accountant"];

// Explicit column list — `raw` (the full offer dump) stays server-side.
const OFFER_COLUMNS =
  "code, offer_id, is_urgent, process_type, material, quantity, dimensions, tags, " +
  "tolerance, roughness, finish, threads_present, inspection_needed, excluded_reason, " +
  "part_files, local_files, production_remark, partner_cost, allow_counter_from, " +
  "buyer_price, buyer_quote_id, suggested_price, xo_leadtime, publication_end, " +
  "suggested_leadtime, status, flags, final_price, final_leadtime, submitted_at";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAdmin(req: Request): Promise<Response | { userId: string }> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ detail: "Missing bearer token" }, 401);
  }
  const token = auth.slice(7).trim();

  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return jsonResponse({ detail: "Invalid session" }, 401);
  }

  const { data: roleRow } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!roleRow || !ADMIN_ROLES.includes(roleRow.role)) {
    return jsonResponse({ detail: "Admin role required" }, 403);
  }
  return { userId: userData.user.id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ detail: "POST only" }, 405);
  }

  const gate = await requireAdmin(req);
  if (gate instanceof Response) return gate;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;

  try {
    if (action === "pending") {
      const { data, error } = await serviceClient
        .from("xometry_offers")
        .select(OFFER_COLUMNS)
        .order("publication_end", { ascending: true, nullsFirst: false });
      if (error) {
        return jsonResponse({ detail: `xometry_offers query failed: ${error.message}` }, 500);
      }
      return jsonResponse(data ?? []);
    }

    if (action === "submit" || action === "skip") {
      const base = Deno.env.get("XOMETRY_REVIEW_API_URL");
      const apiToken = Deno.env.get("XOMETRY_REVIEW_API_TOKEN");
      if (!base || !apiToken) {
        return jsonResponse(
          { detail: "XOMETRY_REVIEW_API_URL / XOMETRY_REVIEW_API_TOKEN not configured" },
          500,
        );
      }
      const code = body?.code;
      if (!code || typeof code !== "string") {
        return jsonResponse({ detail: "missing code" }, 422);
      }
      // Null price/leadtime fall back to the row's suggested values server-side;
      // the review API's guard still refuses prices below the counter floor.
      const payload =
        action === "submit"
          ? {
              price: body?.price ?? null,
              leadtime: body?.leadtime ?? null,
              comment: typeof body?.comment === "string" ? body.comment : "",
              accept_review_row: body?.accept_review_row === true,
            }
          : {};
      const upstream = await fetch(
        `${base.replace(/\/$/, "")}/${action}/${encodeURIComponent(code)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiToken}` },
          body: JSON.stringify(payload),
        },
      );
      const upstreamBody = await upstream.json().catch(() => ({}));
      return jsonResponse(upstreamBody, upstream.status);
    }

    return jsonResponse({ detail: "unknown action" }, 404);
  } catch (err) {
    return jsonResponse({ detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});
