import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Backend for /dashboard/xometry (src/pages/dashboard/XometryQueuePage.tsx).
//
// The xometry_offers table has RLS enabled with NO policies, so the browser's
// anon key can never read it — all reads go through this function with the
// service role key, gated on an admin-level user_roles row.
//
// Actions (POST body { action, ... }):
//   pending           — list the queue (service role; raw column omitted)
//   skip   { code }   — atomic DB transition to 'skipped' (no external call)
//   submit { code, price, leadtime, comment, accept_review_row }
//                     — places a REAL counteroffer on Xometry, once. Guarded by
//                       the §6C price/lead-time floors, idempotent via an atomic
//                       ready→submitting→submitted claim, and fail-loud: a failed
//                       send parks the row in 'error' and is never auto-retried.
//
// Submit backends, in priority order (see xometry-bot/README.md "Operator setup"):
//   1. Box proxy   — if XOMETRY_REVIEW_API_URL + XOMETRY_REVIEW_API_TOKEN are set,
//                    proxy to the FastAPI review API (Playwright form path). The box
//                    owns its own guard/transition.
//   2. Direct GraphQL (serverless, no box) — if XOMETRY_PARTNER_AUTH_TOKEN +
//                    XOMETRY_COUNTEROFFER_MUTATION are set, this function guards,
//                    claims the row, and POSTs the captured counteroffer mutation to
//                    api.xometry.eu with variables { offerId, value, leadtime, comment }.
//   3. Otherwise   — submit returns 501 (not configured); skip/pending still work.

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

// §6A constants, mirrored from xometry-bot/xometry_bot/config.py.
const MIN_MARGIN = 0.15;
const LEADTIME_BUSINESS_DAYS = 10;

// Xometry partner GraphQL endpoint (config.PARTNER_GRAPHQL_URL).
const PARTNER_GRAPHQL_URL = "https://api.xometry.eu/partners/graphql";

// Statuses a counteroffer may be claimed from. The trusted path only allows
// 'ready'; an operator override (manual price on an unpriced/review row) widens it.
const SUBMIT_FROM_TRUSTED = ["ready"];
const SUBMIT_FROM_OVERRIDE = [
  "new", "priced", "ready", "needs_manual", "needs_review", "error",
];
// Skip may claim any non-terminal, non-transient row.
const SKIP_FROM = [
  "new", "priced", "ready", "needs_manual", "needs_review",
  "excluded_secondary_ops", "error",
];

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

// ── §6A date math (mirror of pricing.add_business_days) ──────────────────────
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function todayIso(): string {
  return toIsoDate(new Date());
}
function addBusinessDays(startIso: string, n: number): string {
  const d = new Date(`${startIso}T00:00:00Z`);
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay(); // 0 Sun .. 6 Sat
    if (wd !== 0 && wd !== 6) remaining -= 1;
  }
  return toIsoDate(d);
}

// §6C guard: reasons a submit must be refused. Empty array = OK to send.
// Mirror of pricing.submit_guard (your_cost falls back to Xometry's partner cost).
function submitGuard(
  finalPrice: number,
  finalLeadtimeIso: string,
  allowCounterFrom: number | null,
  yourCost: number | null,
): string[] {
  const reasons: string[] = [];
  if (allowCounterFrom != null && finalPrice < allowCounterFrom) {
    reasons.push(
      `price ${finalPrice.toFixed(2)} is below Xometry's counteroffer floor ` +
        `${allowCounterFrom.toFixed(2)} (allowCounterofferFrom)`,
    );
  }
  if (yourCost != null && finalPrice < yourCost * (1 + MIN_MARGIN)) {
    reasons.push(
      `price ${finalPrice.toFixed(2)} is below cost floor ` +
        `${(yourCost * (1 + MIN_MARGIN)).toFixed(2)} (cost ${yourCost.toFixed(2)} + ${
          (MIN_MARGIN * 100).toFixed(0)
        }%)`,
    );
  }
  const floor = addBusinessDays(todayIso(), LEADTIME_BUSINESS_DAYS);
  if (finalLeadtimeIso < floor) {
    reasons.push(
      `lead time ${finalLeadtimeIso} is earlier than ${floor} ` +
        `(today + ${LEADTIME_BUSINESS_DAYS} business days)`,
    );
  }
  return reasons;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Submit backend resolution ────────────────────────────────────────────────
function boxConfigured(): boolean {
  return !!(Deno.env.get("XOMETRY_REVIEW_API_URL") && Deno.env.get("XOMETRY_REVIEW_API_TOKEN"));
}
function directConfigured(): boolean {
  return !!(
    Deno.env.get("XOMETRY_PARTNER_AUTH_TOKEN") && Deno.env.get("XOMETRY_COUNTEROFFER_MUTATION")
  );
}

async function proxyToBox(action: string, code: string, payload: unknown): Promise<Response> {
  const base = Deno.env.get("XOMETRY_REVIEW_API_URL")!;
  const apiToken = Deno.env.get("XOMETRY_REVIEW_API_TOKEN")!;
  const upstream = await fetch(
    `${base.replace(/\/$/, "")}/${action}/${encodeURIComponent(code)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiToken}` },
      body: JSON.stringify(payload ?? {}),
    },
  );
  const body = await upstream.json().catch(() => ({}));
  return jsonResponse(body, upstream.status);
}

// Direct counteroffer over the partner GraphQL API. Throws on any non-success so
// the caller parks the row in 'error' — a partial send must never look like a win.
async function sendCounterofferGraphQL(
  offerId: string,
  value: number,
  leadtimeIso: string,
  comment: string,
): Promise<void> {
  const token = Deno.env.get("XOMETRY_PARTNER_AUTH_TOKEN")!;
  const cookie = Deno.env.get("XOMETRY_PARTNER_COOKIE");
  const mutation = Deno.env.get("XOMETRY_COUNTEROFFER_MUTATION")!;
  const operationName = Deno.env.get("XOMETRY_COUNTEROFFER_OPERATION_NAME") ?? "SubmitCounteroffer";

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
  if (cookie) headers.cookie = cookie;

  const res = await fetch(PARTNER_GRAPHQL_URL, {
    method: "POST",
    headers,
    // Variable contract — the captured mutation MUST declare exactly these:
    //   $offerId: ID/String, $value: Float, $leadtime: Date/String, $comment: String
    body: JSON.stringify({
      operationName,
      query: mutation,
      variables: { offerId, value, leadtime: leadtimeIso, comment },
    }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `partner API returned ${res.status} — XOMETRY_PARTNER_AUTH_TOKEN expired/invalid ` +
        `(re-capture localStorage authToken on partner.xometry.eu)`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`partner API HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const payload = await res.json().catch(() => ({}));
  if (payload?.errors) {
    throw new Error(`counteroffer mutation errors: ${JSON.stringify(payload.errors).slice(0, 800)}`);
  }
}

async function directSubmit(
  row: Record<string, unknown>,
  code: string,
  finalPrice: number,
  finalLeadtimeIso: string,
  comment: string,
  acceptReviewRow: boolean,
): Promise<Response> {
  const allowed = acceptReviewRow ? SUBMIT_FROM_OVERRIDE : SUBMIT_FROM_TRUSTED;
  // Atomic claim: a single UPDATE that only matches a still-claimable row, so a
  // double-click can never submit twice (the 2nd sees 'submitting' and misses).
  const { data: claimed, error: claimErr } = await serviceClient
    .from("xometry_offers")
    .update({ status: "submitting", updated_at: new Date().toISOString() })
    .eq("code", code)
    .in("status", allowed)
    .select("code");
  if (claimErr) return jsonResponse({ detail: `claim failed: ${claimErr.message}` }, 500);
  if (!claimed || claimed.length === 0) {
    return jsonResponse(
      {
        detail:
          `row not submittable from status '${row.status}' (allowed: ${allowed.join(", ")}; ` +
          `submitted rows stay submitted)`,
      },
      409,
    );
  }

  try {
    await sendCounterofferGraphQL(String(row.offer_id), finalPrice, finalLeadtimeIso, comment);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const flags = [...((row.flags as string[]) ?? []), `submit_failed:${msg}`.slice(0, 200)];
    await serviceClient
      .from("xometry_offers")
      .update({ status: "error", flags, updated_at: new Date().toISOString() })
      .eq("code", code);
    return jsonResponse({ detail: msg }, 502);
  }

  await serviceClient
    .from("xometry_offers")
    .update({
      status: "submitted",
      final_price: finalPrice,
      final_leadtime: finalLeadtimeIso,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("code", code);
  return jsonResponse({
    code,
    status: "submitted",
    final_price: finalPrice,
    final_leadtime: finalLeadtimeIso,
  });
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
    // ── pending: list the queue ────────────────────────────────────────────
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

    const code = typeof body?.code === "string" ? body.code : null;

    // ── skip: pure DB transition, no external call ──────────────────────────
    if (action === "skip") {
      if (!code) return jsonResponse({ detail: "missing code" }, 422);
      const { data, error } = await serviceClient
        .from("xometry_offers")
        .update({ status: "skipped", updated_at: new Date().toISOString() })
        .eq("code", code)
        .in("status", SKIP_FROM)
        .select("code");
      if (error) return jsonResponse({ detail: error.message }, 500);
      if (!data || data.length === 0) {
        return jsonResponse({ detail: "row not found or already terminal" }, 409);
      }
      return jsonResponse({ code, status: "skipped" });
    }

    // ── submit: the only money-moving action ────────────────────────────────
    if (action === "submit") {
      if (!code) return jsonResponse({ detail: "missing code" }, 422);

      // Box path owns its own guard/transition — proxy verbatim.
      if (boxConfigured()) {
        return await proxyToBox("submit", code, {
          price: body?.price ?? null,
          leadtime: body?.leadtime ?? null,
          comment: typeof body?.comment === "string" ? body.comment : "",
          accept_review_row: body?.accept_review_row === true,
        });
      }
      if (!directConfigured()) {
        return jsonResponse(
          {
            detail:
              "submit backend not configured — set XOMETRY_PARTNER_AUTH_TOKEN + " +
              "XOMETRY_COUNTEROFFER_MUTATION (direct GraphQL) or XOMETRY_REVIEW_API_URL + " +
              "XOMETRY_REVIEW_API_TOKEN (review-API box). See xometry-bot/README.md.",
          },
          501,
        );
      }

      const { data: row, error: getErr } = await serviceClient
        .from("xometry_offers")
        .select("*")
        .eq("code", code)
        .maybeSingle();
      if (getErr) return jsonResponse({ detail: getErr.message }, 500);
      if (!row) return jsonResponse({ detail: `unknown offer ${code}` }, 404);

      const finalPrice = num(body?.price) ?? num(row.suggested_price);
      const finalLeadtime =
        (typeof body?.leadtime === "string" && body.leadtime) ||
        (typeof row.suggested_leadtime === "string" && row.suggested_leadtime) ||
        null;
      if (finalPrice == null || !finalLeadtime) {
        return jsonResponse(
          {
            detail:
              "no price/lead time available — row was never priced; pass both explicitly",
          },
          422,
        );
      }

      const yourCost = num(row.partner_cost);
      const reasons = submitGuard(finalPrice, finalLeadtime, num(row.allow_counter_from), yourCost);
      if (reasons.length) {
        return jsonResponse({ detail: { blocked: reasons } }, 409);
      }

      return await directSubmit(
        row,
        code,
        finalPrice,
        finalLeadtime,
        typeof body?.comment === "string" ? body.comment : "",
        body?.accept_review_row === true,
      );
    }

    return jsonResponse({ detail: "unknown action" }, 404);
  } catch (err) {
    return jsonResponse({ detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});
