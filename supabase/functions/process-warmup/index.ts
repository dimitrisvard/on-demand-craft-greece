// Email warmup scheduler
// Run daily via cron to increment warmup limits for accounts with warmup_enabled = true.
// Also resets daily send counters for all accounts.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const today = new Date().toISOString().split("T")[0];

    // Fetch all sender accounts
    const { data: accounts, error } = await supabase
      .from("marketing_sender_accounts")
      .select("*");

    if (error) throw error;
    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ message: "No sender accounts found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let warmedUp = 0;
    let resetCount = 0;

    for (const account of accounts) {
      const updates: Record<string, any> = {};
      const lastReset = account.last_reset_date;

      // Reset daily counter if last reset was before today
      if (!lastReset || lastReset < today) {
        updates.emails_sent_today = 0;
        updates.last_reset_date = today;
        resetCount++;
      }

      // Increment warmup limit if warmup is enabled
      if (account.warmup_enabled) {
        const newLimit = Math.min(
          (account.warmup_current_limit || 10) + (account.warmup_daily_increment || 5),
          account.daily_limit
        );

        if (newLimit !== account.warmup_current_limit) {
          updates.warmup_current_limit = newLimit;
          console.log(
            `Warmup: ${account.email} limit increased to ${newLimit}/${account.daily_limit}`
          );
          warmedUp++;
        }

        // Auto-disable warmup once it reaches the daily limit
        if (newLimit >= account.daily_limit) {
          updates.warmup_enabled = false;
          console.log(`Warmup complete for ${account.email} — reached daily limit ${account.daily_limit}`);
        }
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from("marketing_sender_accounts")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("id", account.id);
      }
    }

    return new Response(
      JSON.stringify({
        message: "Warmup processing complete",
        accounts_processed: accounts.length,
        warmed_up: warmedUp,
        counters_reset: resetCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
