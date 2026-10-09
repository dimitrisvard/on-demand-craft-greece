-- ============================================================================
-- Phase 5 flag values per switch-over step (PLAN.md P5-8; PHASE5_SPEC.md §5.6, §10.2)
-- ============================================================================
-- Templates, not a migration: the owner runs ONE block at a time in the Supabase SQL editor, at the moment the
-- runbook (PHASE5_SPEC.md §10.2, scripts/phase5/README.md) names it. Each UPDATE merges keys into
-- feature_flags.value of the default tenant; the KV mirror picks the change up within about a minute
-- (flags-sync), and running Workflows re-read the flag before every side-effecting step.
--
-- What is set where:
--   enabled                 the dashboard switch (or the "enable" / "rollback" lines below)
--   value.mode              shadow | assist | auto (here, or the dashboard)
--   every other value key   only here (the dashboard edits enabled, mode and writes)
--
-- Placeholders: <RECIPIENT> (S7, the digest address; data, never committed). Nothing else needs replacing; the
-- S5 model is the live default and changes only when OW5-5 found another value.
-- The RETURNING lists never print value.recipient.
--
-- Old schedulers are switched with supabase/migrations/*_deactivate_ported_crons.sql (SET microns.p5_step /
-- microns.p5_action first), in the order the runbook gives for each step.

-- ---- S1 HN collector ------------------------------------------------------------------------------------
UPDATE feature_flags SET value = value || '{"mode":"assist"}'::jsonb
WHERE key = 'agent.growth.hn' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value;
-- enable:   UPDATE feature_flags SET enabled = true  WHERE key = 'agent.growth.hn' AND tenant_id = '00000000-0000-0000-0000-000000000001';
-- rollback: UPDATE feature_flags SET enabled = false WHERE key = 'agent.growth.hn' AND tenant_id = '00000000-0000-0000-0000-000000000001';

-- ---- S2 reddit tiers 1-3 --------------------------------------------------------------------------------
UPDATE feature_flags SET value = value || '{"mode":"assist"}'::jsonb
WHERE key = 'agent.growth.reddit' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value;
-- enable:   UPDATE feature_flags SET enabled = true  WHERE key = 'agent.growth.reddit' AND tenant_id = '00000000-0000-0000-0000-000000000001';
-- rollback: UPDATE feature_flags SET enabled = false WHERE key = 'agent.growth.reddit' AND tenant_id = '00000000-0000-0000-0000-000000000001';

-- ---- S3 tenders: (a) with the 24 h canary on two countries (D-13) ------------------------------------------
UPDATE feature_flags SET value = value || '{"mode":"assist","countries":["NL","DE"],"relevance":false,"llm_cap":20}'::jsonb
WHERE key = 'agent.growth.tenders' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value;
-- ---- S3 tenders: (b) after the canary, or instead of (a) when the S3 re-measurement found tenders flowing ----
UPDATE feature_flags SET value = (value - 'countries') || '{"mode":"assist","relevance":false,"llm_cap":20}'::jsonb
WHERE key = 'agent.growth.tenders' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value;
-- enable:   UPDATE feature_flags SET enabled = true  WHERE key = 'agent.growth.tenders' AND tenant_id = '00000000-0000-0000-0000-000000000001';
-- rollback: UPDATE feature_flags SET enabled = false WHERE key = 'agent.growth.tenders' AND tenant_id = '00000000-0000-0000-0000-000000000001';

-- ---- S4 sitemap only: (a) the day before, shadow (compare the R2 copy after 09:05) --------------------------
UPDATE feature_flags SET value = value || '{"mode":"shadow","steps":["sitemap"]}'::jsonb
WHERE key = 'agent.content_daily' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value;
-- ---- S4 sitemap only: (b) after the deactivate file ran with step S4 --------------------------------------
UPDATE feature_flags SET value = value || '{"mode":"assist","steps":["sitemap"]}'::jsonb
WHERE key = 'agent.content_daily' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value;
-- enable:   UPDATE feature_flags SET enabled = true  WHERE key = 'agent.content_daily' AND tenant_id = '00000000-0000-0000-0000-000000000001';
-- rollback: UPDATE feature_flags SET enabled = false WHERE key = 'agent.content_daily' AND tenant_id = '00000000-0000-0000-0000-000000000001';

-- ---- S5 full content chain (the evening of day D, after the deactivate file ran with step S5) -------------
-- model: the live default; replace it only with the value read at OW5-5 (a model id, not a credential).
UPDATE feature_flags SET value = value || '{"mode":"assist","steps":["generate","translate","fix_links","sitemap"],"model":"claude-sonnet-5","backfill_per_language_per_day":5,"shadow_generate":false}'::jsonb
WHERE key = 'agent.content_daily' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value;
-- rollback (before 06:55 UTC): UPDATE feature_flags SET enabled = false WHERE key = 'agent.content_daily' AND tenant_id = '00000000-0000-0000-0000-000000000001';
-- lower the backfill when Gemini answers 429 (R5-2):
--   UPDATE feature_flags SET value = value || '{"backfill_per_language_per_day":2}'::jsonb WHERE key = 'agent.content_daily' AND tenant_id = '00000000-0000-0000-0000-000000000001';

-- ---- S4 and later: accept an intended drop of published articles (sitemap regression guard) ---------------
-- Only after more than 5 % of the articles were unpublished on purpose and that day's sitemap run was blocked (its
-- text alert names this value): <YYYY-MM-DD> = the day of the blocked run. The next sitemap run on or after that
-- day uploads once and becomes the guard's new reference; a later drop is blocked again while the value stays set.
--   UPDATE feature_flags SET value = value || '{"sitemap_accept_drop_on":"<YYYY-MM-DD>"}'::jsonb WHERE key = 'agent.content_daily' AND tenant_id = '00000000-0000-0000-0000-000000000001';

-- ---- S6 marketing route: no flag. Worker vars OUTBOUND_MAIL_PAUSED / OUTBOUND_MAIL_STOPPED (wrangler.jsonc) ----

-- ---- S7 ops digest --------------------------------------------------------------------------------------
UPDATE feature_flags SET value = value || '{"mode":"assist","recipient":"<RECIPIENT>","ads_upload":false,"purge":true}'::jsonb
WHERE key = 'agent.ops_digest' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value - 'recipient' AS value, (value ? 'recipient') AS recipient_set;
-- enable:   UPDATE feature_flags SET enabled = true  WHERE key = 'agent.ops_digest' AND tenant_id = '00000000-0000-0000-0000-000000000001';
-- rollback: UPDATE feature_flags SET enabled = false WHERE key = 'agent.ops_digest' AND tenant_id = '00000000-0000-0000-0000-000000000001';

-- ---- S8 Xometry: (a) one shadow day (first proof that the partner API accepts Worker egress, R5-14) --------
UPDATE feature_flags SET value = value || '{"mode":"shadow","borderline_exclude":[],"notify_new":false,"token_reminder_hours":24}'::jsonb
WHERE key = 'agent.growth.xometry' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value;
-- ---- S8 Xometry: (b) the next day; then set the repository variable XOMETRY_SCAN_SCHEDULE = off ------------
UPDATE feature_flags SET value = value || '{"mode":"assist"}'::jsonb
WHERE key = 'agent.growth.xometry' AND tenant_id = '00000000-0000-0000-0000-000000000001'
RETURNING key, enabled, rev, value;
-- enable:   UPDATE feature_flags SET enabled = true  WHERE key = 'agent.growth.xometry' AND tenant_id = '00000000-0000-0000-0000-000000000001';
-- rollback: UPDATE feature_flags SET enabled = false WHERE key = 'agent.growth.xometry' AND tenant_id = '00000000-0000-0000-0000-000000000001';

-- ---- S9 CAD container: no flag. Supabase secret UNFOLD_SERVICE_URL, then the var CAD_BACKEND_DEFAULT ---------

-- ---- Check (read-only): the Phase 5 flags as the KV mirror will see them --------------------------------
SELECT key, enabled, value->>'mode' AS mode, value - 'recipient' AS value, (value ? 'recipient') AS recipient_set,
       rev, kv_synced_rev, kv_synced_at
FROM feature_flags
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND key IN ('agent.growth.hn', 'agent.growth.reddit', 'agent.growth.tenders', 'agent.content_daily',
              'agent.ops_digest', 'agent.growth.xometry')
ORDER BY key;
