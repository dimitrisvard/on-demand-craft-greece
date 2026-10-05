-- ============================================================================
-- Full removal of the agent layer: supabase/migrations/20261005_agent_layer.sql
-- ============================================================================
-- Only before any agent data matters: PLAN.md §5.4 keeps the tables on a normal Phase 4 rollback (the
-- migration is additive). Drops the new columns on rfqs / rfq_files and every new object, including the
-- amendment objects of PHASE4_SPEC.md §4.13 (AM-1…AM-3 live inside the dropped tables; AM-4 and AM-5 are
-- the functions create_order_from_quote and agent_staff_for_email). Kept outside supabase/migrations/ so
-- that no migration tool runs it. Tested: supabase/tests/agent_layer ("removal script restores the
-- pre-migration schema").
-- ============================================================================
BEGIN;
DROP TRIGGER IF EXISTS rfqs_agent_columns_guard ON public.rfqs;
DROP TRIGGER IF EXISTS rfq_files_agent_columns_guard ON public.rfq_files;
ALTER TABLE public.rfq_files
  DROP CONSTRAINT IF EXISTS rfq_files_rfq_sha256_key,
  DROP COLUMN IF EXISTS content_type,
  DROP COLUMN IF EXISTS sha256,
  DROP COLUMN IF EXISTS r2_key,
  DROP COLUMN IF EXISTS source;
ALTER TABLE public.rfqs
  DROP COLUMN IF EXISTS inbound_email_id,
  DROP COLUMN IF EXISTS source;
DROP FUNCTION IF EXISTS public.agent_staff_for_email(text);
DROP FUNCTION IF EXISTS public.create_order_from_quote(uuid);
DROP FUNCTION IF EXISTS public.agent_retention_purge(timestamptz);
DROP FUNCTION IF EXISTS public.stock_release(uuid, text);
DROP FUNCTION IF EXISTS public.stock_commit(uuid, uuid);
DROP FUNCTION IF EXISTS public.stock_hold(uuid, uuid, jsonb, timestamptz, text);
DROP FUNCTION IF EXISTS public.agent_run_claim_approval(text, jsonb);
DROP FUNCTION IF EXISTS public.agent_run_begin(text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.create_email_rfq(uuid, jsonb, text);
DROP TABLE IF EXISTS public.stock_reservations;
DROP TABLE IF EXISTS public.cad_jobs;
DROP TABLE IF EXISTS public.inbound_emails;
DROP TABLE IF EXISTS public.quote_workflows;
DROP TABLE IF EXISTS public.pricing_rules;
DROP FUNCTION IF EXISTS public.feature_flags_seed_from_kv(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.feature_flags_mark_synced(text, uuid, bigint);
DROP FUNCTION IF EXISTS public.feature_flags_sync_batch();
DROP FUNCTION IF EXISTS public.feature_flags_kv_value(boolean, jsonb, timestamptz, bigint);
DROP FUNCTION IF EXISTS public.feature_flags_kv_key(text, uuid);
DROP TABLE IF EXISTS public.feature_flags;
DROP FUNCTION IF EXISTS public.feature_flags_before_write();
DROP SEQUENCE IF EXISTS public.feature_flags_rev_seq;
DROP TABLE IF EXISTS public.agent_runs;
DROP FUNCTION IF EXISTS public.agent_columns_guard();
DROP FUNCTION IF EXISTS public.has_staff_role();
NOTIFY pgrst, 'reload schema';
COMMIT;
