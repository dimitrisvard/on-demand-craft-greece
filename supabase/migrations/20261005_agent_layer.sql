-- ============================================================================
-- Agent layer data model (PLAN.md P4-1, P4-2; AGENTS.md §2.1, §2.3, §2.4, §4-§7)
-- ============================================================================
-- Contract: docs/migration/specs/PHASE4_SPEC.md §4.13 (tables, RPC signatures, amendments AM-1…AM-5).
-- Applied by the owner in the Supabase SQL editor, once, as one transaction (PHASE4_SPEC.md §12 OW-6):
-- first a dry run with the final COMMIT replaced by ROLLBACK, then the unchanged file. No migration
-- runner applies it; the date in the file name is the day the file was built.
-- Tests: supabase/tests/agent_layer (PGlite, Postgres 18.3 and 16.4).
--
-- What it adds (additive only; no existing column, policy or function is changed):
--   * helper      public.has_staff_role()  -- staff = user_roles role in admin, sales_rep,
--                                             production_manager, accountant (tenant roles are not consulted)
--   * tables      agent_runs, feature_flags, pricing_rules, quote_workflows, inbound_emails, cad_jobs,
--                 stock_reservations
--   * columns     rfqs.source, rfqs.inbound_email_id,
--                 rfq_files.source, rfq_files.r2_key, rfq_files.sha256, rfq_files.content_type
--   * functions   service-role-only RPCs for the writes that must be atomic or exactly-once
--                 (create_email_rfq, agent_run_begin, agent_run_claim_approval, feature_flags_*,
--                 stock_hold, stock_commit, stock_release, agent_retention_purge,
--                 create_order_from_quote, agent_staff_for_email)
--   * seed        the 13 canonical feature_flags rows (all off, kv_seed_pending = true)
--
-- Amendments of PHASE4_SPEC.md §4.13, all inside the new objects:
--   AM-1 cad_jobs.backend accepts 'inline'          AM-2 quote_workflows.drafts, quote_workflows.pdf_sha256
--   AM-3 agent_runs.parked_reason (+ index; the approval claim clears it)
--   AM-4 create_order_from_quote()                   AM-5 agent_staff_for_email()
--
-- Access model for every new table:
--   anon: no privilege at all · authenticated: SELECT only, and RLS returns rows only to staff
--   (has_staff_role()) · service_role (microns-ops, microns-mail): the only writer.
--   The agent columns on rfqs / rfq_files are set only by the service role and by SECURITY DEFINER
--   functions; other roles keep the defaults (trigger agent_columns_guard).
--
-- Rollback: the agent layer stays in place on a Phase 4 rollback (PLAN.md §5.4: "the migration is
-- additive, so tables stay"). Full removal, only before agent data matters:
-- supabase/rollback/20261005_agent_layer_down.sql (kept outside migrations/ so no tool runs it).
-- ============================================================================

BEGIN;

-- ---- 0. Preconditions (abort before any change) ------------------------------
DO $$
BEGIN
  IF to_regclass('public.agent_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'agent layer already applied (public.agent_runs exists); aborting';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'default tenant 00000000-0000-0000-0000-000000000001 is missing; aborting';
  END IF;
  IF to_regprocedure('public.update_updated_at_column()') IS NULL
     OR to_regprocedure('public.create_public_rfq(jsonb)') IS NULL
     OR to_regprocedure('public.next_po_number()') IS NULL
     OR to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'expected helper objects are missing (update_updated_at_column, create_public_rfq, next_po_number, user_roles); aborting';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name IN ('rfqs', 'rfq_files')
               AND column_name IN ('source', 'inbound_email_id', 'r2_key', 'sha256', 'content_type')) THEN
    RAISE EXCEPTION 'one of the new rfqs / rfq_files columns already exists; aborting';
  END IF;
END $$;

-- ---- 1. Staff check used by the agent tables -----------------------------------
-- Staff are the four staff roles in public.user_roles. Tenant roles are deliberately not part of this
-- check (AGENTS.md §1.3); public.is_staff() is left unchanged for the existing tables.
CREATE FUNCTION public.has_staff_role()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'sales_rep', 'production_manager', 'accountant')
  );
$$;
REVOKE ALL ON FUNCTION public.has_staff_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_staff_role() TO authenticated, service_role;
COMMENT ON FUNCTION public.has_staff_role() IS
  'True when auth.uid() holds admin, sales_rep, production_manager or accountant in user_roles. Agent tables only.';

-- ---- 2. agent_runs ---------------------------------------------------------------
CREATE TABLE public.agent_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  agent                 text NOT NULL,          -- flag key without 'agent.': rfq_intake, quote, growth.reddit, mcp, flags, eval
  trigger               text NOT NULL,
  idempotency_key       text NOT NULL,
  workflow_name         text,
  workflow_instance_id  text,
  parent_run_id         uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  subject_type          text,                   -- rfq, quote_workflow, order, inbound_email, article, ...
  subject_id            uuid,
  status                text NOT NULL DEFAULT 'running',
  parked_reason         text,                   -- AM-3: why a waiting_human run waits (flag_off, budget, llm_unavailable,
                                                -- or failed = a failure card); NULL for every other run
  prompt_version        text,                   -- <agent>.<step>@v<N>
  llm_calls             integer NOT NULL DEFAULT 0,
  input_tokens          integer NOT NULL DEFAULT 0,
  output_tokens         integer NOT NULL DEFAULT 0,
  cached_input_tokens   integer NOT NULL DEFAULT 0,
  cost_cents            numeric(12,4) NOT NULL DEFAULT 0,   -- USD cents
  approval_token_sha256 text,                   -- hex SHA-256 of the single-use approval token; the token itself is never stored
  human_action          jsonb,                  -- {channel, actor, verb, decided_at}
  output                jsonb,                  -- small summary, no raw e-mail text
  error                 text,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  CONSTRAINT agent_runs_agent_key UNIQUE (agent, idempotency_key),
  CONSTRAINT agent_runs_agent_check CHECK (agent ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$' AND char_length(agent) <= 64),
  CONSTRAINT agent_runs_trigger_check CHECK (trigger IN ('email','cron','queue','workflow','dashboard','telegram','mcp','manual')),
  CONSTRAINT agent_runs_idempotency_key_check CHECK (char_length(idempotency_key) BETWEEN 1 AND 512),
  CONSTRAINT agent_runs_instance_check CHECK (workflow_instance_id IS NULL
    OR (workflow_instance_id ~ '^[a-zA-Z0-9_][a-zA-Z0-9_-]*$' AND char_length(workflow_instance_id) <= 100)),
  CONSTRAINT agent_runs_subject_check CHECK (subject_type IS NULL OR subject_type ~ '^[a-z_]+$'),
  CONSTRAINT agent_runs_status_check CHECK (status IN ('running','waiting_human','succeeded','failed','cancelled','skipped')),
  CONSTRAINT agent_runs_finished_check CHECK ((status IN ('running','waiting_human')) = (finished_at IS NULL)),
  CONSTRAINT agent_runs_parked_reason_check CHECK (parked_reason IS NULL OR parked_reason IN ('flag_off','budget','llm_unavailable','failed')),
  CONSTRAINT agent_runs_parked_status_check CHECK (parked_reason IS NULL OR status = 'waiting_human'),
  CONSTRAINT agent_runs_counts_check CHECK (llm_calls >= 0 AND input_tokens >= 0 AND output_tokens >= 0
    AND cached_input_tokens >= 0 AND cost_cents >= 0),
  CONSTRAINT agent_runs_token_check CHECK (approval_token_sha256 IS NULL
    OR (approval_token_sha256 ~ '^[0-9a-f]{64}$' AND status = 'waiting_human')),
  CONSTRAINT agent_runs_human_action_check CHECK (human_action IS NULL OR jsonb_typeof(human_action) = 'object'),
  CONSTRAINT agent_runs_output_check CHECK (output IS NULL OR pg_column_size(output) <= 65536)
);
CREATE UNIQUE INDEX agent_runs_approval_token_idx ON public.agent_runs (approval_token_sha256)
  WHERE approval_token_sha256 IS NOT NULL;
CREATE INDEX agent_runs_agent_started_idx ON public.agent_runs (agent, started_at DESC);
CREATE INDEX agent_runs_subject_idx       ON public.agent_runs (subject_type, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX agent_runs_open_idx          ON public.agent_runs (status, started_at) WHERE status IN ('running','waiting_human');
CREATE INDEX agent_runs_instance_idx      ON public.agent_runs (workflow_instance_id) WHERE workflow_instance_id IS NOT NULL;
CREATE INDEX agent_runs_parent_idx        ON public.agent_runs (parent_run_id);
-- The */10 dispatcher looks up parked runs by reason (AM-3).
CREATE INDEX agent_runs_parked_idx        ON public.agent_runs (status, parked_reason) WHERE parked_reason IS NOT NULL;
COMMENT ON TABLE public.agent_runs IS
  'One row per agent run, cron tick or MCP tool call (AGENTS.md §2.1). Written by microns-ops / microns-mail only.';

-- ---- 3. feature_flags -------------------------------------------------------------
-- Source of truth for the flags mirrored to KV FLAGS (AGENTS.md §2.3; PLAN.md P4-2).
-- rev changes on every change of enabled/value; kv_synced_rev records the rev last written to KV.
CREATE SEQUENCE public.feature_flags_rev_seq AS bigint;

CREATE TABLE public.feature_flags (
  key             text NOT NULL,
  tenant_id       uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  enabled         boolean NOT NULL DEFAULT false,
  value           jsonb   NOT NULL DEFAULT '{}'::jsonb,   -- {mode, min_confidence, prompts, paths, hosts, ...}
  description     text,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rev             bigint NOT NULL DEFAULT 0,             -- set by trigger from feature_flags_rev_seq
  kv_synced_rev   bigint,                                -- NULL: never written to KV
  kv_synced_at    timestamptz,
  kv_seed_pending boolean NOT NULL DEFAULT false,        -- true: waiting for the one-time import from KV
  PRIMARY KEY (key, tenant_id),
  CONSTRAINT feature_flags_key_check CHECK (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$' AND char_length(key) <= 64),
  CONSTRAINT feature_flags_value_check CHECK (jsonb_typeof(value) = 'object' AND pg_column_size(value) <= 8192),
  CONSTRAINT feature_flags_mode_check CHECK (NOT (value ? 'mode') OR COALESCE(value->>'mode' IN ('shadow','assist','auto'), false))
);
COMMENT ON TABLE public.feature_flags IS
  'Feature flags; mirrored to KV FLAGS by the microns-ops flags-sync cron (every minute). Rows are never deleted.';

CREATE FUNCTION public.feature_flags_before_write()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'feature_flags rows are not deleted; set enabled = false instead' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.rev := nextval('public.feature_flags_rev_seq');
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- UPDATE
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'feature_flags key and tenant_id are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.enabled IS DISTINCT FROM OLD.enabled OR NEW.value IS DISTINCT FROM OLD.value THEN
    NEW.rev := nextval('public.feature_flags_rev_seq');
  ELSE
    NEW.rev := OLD.rev;                      -- rev is never set by callers
  END IF;
  IF NEW.enabled IS DISTINCT FROM OLD.enabled OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.description IS DISTINCT FROM OLD.description OR NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    NEW.kv_seed_pending := false;            -- an edit makes the table authoritative; it replaces a pending KV import
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;        -- sync bookkeeping (kv_*) does not count as an edit
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER feature_flags_before_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.feature_flags_before_write();
CREATE TRIGGER feature_flags_no_truncate
  BEFORE TRUNCATE ON public.feature_flags
  FOR EACH STATEMENT EXECUTE FUNCTION public.feature_flags_before_write();

-- KV key: the flag key for the default tenant, 't:<tenant_id>:<key>' for any other tenant (AGENTS.md §2.3).
CREATE FUNCTION public.feature_flags_kv_key(p_key text, p_tenant_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE WHEN p_tenant_id = '00000000-0000-0000-0000-000000000001'::uuid THEN p_key
              ELSE 't:' || p_tenant_id::text || ':' || p_key END;
$$;

-- KV value: {"enabled", "mode" (only when value.mode is set), "value", "updated_at", "rev"}.
-- Readers need only "enabled" (workers/site/src/flags.ts) and "value" (Phase 2 getFlagValue).
CREATE FUNCTION public.feature_flags_kv_value(p_enabled boolean, p_value jsonb, p_updated_at timestamptz, p_rev bigint)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'enabled', p_enabled,
           'value', p_value,
           'updated_at', to_char(p_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'rev', p_rev)
         || CASE WHEN p_value ? 'mode' THEN jsonb_build_object('mode', p_value->'mode') ELSE '{}'::jsonb END;
$$;

-- Rows whose current rev is not yet in KV (rows still waiting for the seed import are excluded).
CREATE FUNCTION public.feature_flags_sync_batch()
RETURNS TABLE(flag_key text, flag_tenant_id uuid, kv_key text, kv_value jsonb, rev bigint)
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT ff.key, ff.tenant_id,
         public.feature_flags_kv_key(ff.key, ff.tenant_id),
         public.feature_flags_kv_value(ff.enabled, ff.value, ff.updated_at, ff.rev),
         ff.rev
  FROM public.feature_flags ff
  WHERE NOT ff.kv_seed_pending
    AND ff.kv_synced_rev IS DISTINCT FROM ff.rev
  ORDER BY ff.tenant_id, ff.key;
$$;

-- Called after a successful KV put of rev p_rev.
--   true   the row still has rev p_rev: kv_synced_rev = p_rev.
--   false  the row changed meanwhile (rev > p_rev). Puts of one key land in any order, so the put of p_rev may have
--          landed after the put of a newer rev that is already marked; the row is therefore marked unsynced
--          (kv_synced_rev = NULL) and the next sync batch writes its current rev.
CREATE FUNCTION public.feature_flags_mark_synced(p_key text, p_tenant_id uuid, p_rev bigint)
RETURNS boolean
LANGUAGE sql VOLATILE SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.feature_flags ff
       SET kv_synced_rev = CASE WHEN ff.rev = p_rev THEN p_rev END,
           kv_synced_at  = CASE WHEN ff.rev = p_rev THEN now() ELSE ff.kv_synced_at END
     WHERE ff.key = p_key AND ff.tenant_id = p_tenant_id AND ff.rev >= p_rev
     RETURNING ff.rev = p_rev AS synced)
  SELECT COALESCE(bool_or(synced), false) FROM u;
$$;

-- One-time seed from the values set by hand in KV during Phases 1-3 (PLAN.md P4-2).
--   p_kv = parsed KV value, or NULL when the KV key is absent.
--   'imported'    KV held {"enabled": <bool>, ...}: enabled/value copied into the row; next sync rewrites KV
--                 in the canonical shape.
--   'absent'      KV key absent: row marked as in sync WITHOUT writing KV, so readers keep their fallback
--                 (var SEO_STRICT_404 / API_FORWARD_TO_VERCEL, or "off" for agent flags) until the row is edited.
--   'invalid'     KV value malformed, or a record the table refuses: row stays pending; the caller reports it.
--                 A record is a flag record when it is an object with a boolean "enabled", an object "value" if
--                 any, a "mode" (top level or in "value") that is one of shadow, assist, auto if any (JSON null is
--                 not a mode), and the merged value passes the table's CHECKs (object of at most 8 KiB).
--   'not_pending' row missing or already seeded: nothing changes.
CREATE FUNCTION public.feature_flags_seed_from_kv(p_key text, p_tenant_id uuid, p_kv jsonb)
RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_row public.feature_flags%ROWTYPE;
  v_kv_value jsonb;
BEGIN
  SELECT * INTO v_row FROM public.feature_flags
   WHERE key = p_key AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR NOT v_row.kv_seed_pending THEN
    RETURN 'not_pending';
  END IF;

  IF p_kv IS NULL THEN
    UPDATE public.feature_flags
       SET kv_seed_pending = false, kv_synced_rev = v_row.rev, kv_synced_at = now()
     WHERE key = p_key AND tenant_id = p_tenant_id;
    RETURN 'absent';
  END IF;

  IF jsonb_typeof(p_kv) <> 'object'
     OR jsonb_typeof(p_kv->'enabled') IS DISTINCT FROM 'boolean'
     OR (p_kv ? 'value' AND jsonb_typeof(p_kv->'value') <> 'object')
     OR (p_kv ? 'mode' AND NOT COALESCE(p_kv->>'mode' IN ('shadow','assist','auto'), false))
     OR (jsonb_typeof(p_kv->'value') IS NOT DISTINCT FROM 'object' AND (p_kv->'value') ? 'mode'
         AND NOT COALESCE((p_kv->'value')->>'mode' IN ('shadow','assist','auto'), false)) THEN
    RETURN 'invalid';
  END IF;

  v_kv_value := COALESCE(p_kv->'value', '{}'::jsonb)
                || CASE WHEN p_kv ? 'mode' THEN jsonb_build_object('mode', p_kv->'mode') ELSE '{}'::jsonb END;
  BEGIN
    UPDATE public.feature_flags
       SET enabled = (p_kv->>'enabled')::boolean,
           value = v_row.value || v_kv_value,     -- KV wins for every key it sets
           kv_seed_pending = false
     WHERE key = p_key AND tenant_id = p_tenant_id;
  EXCEPTION WHEN check_violation THEN
    -- A merged value the table's CHECKs refuse (e.g. over 8 KiB) is a KV value the import refuses, not an error.
    RETURN 'invalid';
  END;
  RETURN 'imported';
END $$;

-- ---- 4. pricing_rules ---------------------------------------------------------------
CREATE TABLE public.pricing_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  process        text NOT NULL,
  rule_key       text NOT NULL,       -- laser_cut_per_m, bend_per_hit, setup_fixed, machine_rate_per_h, margin_pct,
                                      -- min_order_value, kerf_factor, ...
  material_match jsonb,               -- {catalog_material_id?, category?, grade?, thickness_mm_min?, thickness_mm_max?}
  qty_min        integer,
  qty_max        integer,
  value          numeric(12,4) NOT NULL,
  unit           text NOT NULL,       -- EUR/m, EUR/hit, EUR, EUR/h, pct, factor, ...
  currency       text NOT NULL DEFAULT 'EUR',
  version        integer NOT NULL DEFAULT 1,
  valid_from     date NOT NULL DEFAULT current_date,
  valid_to       date,
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,
  updated_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT pricing_rules_process_check CHECK (process IN ('cnc','sheet_metal','finishing','shipping','global')),
  CONSTRAINT pricing_rules_rule_key_check CHECK (rule_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT pricing_rules_match_check CHECK (material_match IS NULL OR jsonb_typeof(material_match) = 'object'),
  CONSTRAINT pricing_rules_qty_check CHECK ((qty_min IS NULL OR qty_min >= 0)
    AND (qty_max IS NULL OR qty_min IS NULL OR qty_max >= qty_min)),
  CONSTRAINT pricing_rules_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT pricing_rules_version_check CHECK (version >= 1),
  CONSTRAINT pricing_rules_validity_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
-- One row per rule, version, material scope and quantity band (NULLs compare equal here).
CREATE UNIQUE INDEX pricing_rules_scope_idx ON public.pricing_rules
  (tenant_id, process, rule_key, version, material_match, qty_min, qty_max) NULLS NOT DISTINCT;
CREATE INDEX pricing_rules_active_idx ON public.pricing_rules (tenant_id, process) WHERE is_active;
COMMENT ON TABLE public.pricing_rules IS
  'Deterministic quote calculator inputs (AGENTS.md §3.2 step price). Edited by staff through microns-ops.';

-- ---- 5. quote_workflows -------------------------------------------------------------
CREATE TABLE public.quote_workflows (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  rfq_id               uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  quote_version        integer NOT NULL DEFAULT 1,
  workflow_instance_id text NOT NULL,                     -- quote-<rfq_id>-v<quote_version>
  status               text NOT NULL DEFAULT 'started',
  current_step         text,
  process              text,
  pricing              jsonb,                             -- {currency, lines[], rules_version, similar[], overrides[]}
  total_amount         numeric(12,2),
  currency             text NOT NULL DEFAULT 'EUR',
  quote_pdf_r2_key     text,
  pdf_sha256           text,                              -- AM-2: SHA-256 hex of the quote PDF stored at quote_pdf_r2_key
  drafts               jsonb,                             -- AM-2: approved texts of this version {subject, body_text, follow_ups, ...}
  outbound_message_ids text[] NOT NULL DEFAULT '{}',
  resend_email_ids     text[] NOT NULL DEFAULT '{}',
  approved_by          text,                              -- 'user:<uuid>' or 'telegram:<chat id>'
  approved_via         text,
  approved_at          timestamptz,
  sent_at              timestamptz,
  follow_ups_sent      smallint NOT NULL DEFAULT 0,
  outcome_reason       text,
  last_event_at        timestamptz,
  error                text,
  CONSTRAINT quote_workflows_version_key UNIQUE (rfq_id, quote_version),
  CONSTRAINT quote_workflows_instance_key UNIQUE (workflow_instance_id),
  CONSTRAINT quote_workflows_version_check CHECK (quote_version >= 1),
  CONSTRAINT quote_workflows_instance_check CHECK (workflow_instance_id = 'quote-' || rfq_id::text || '-v' || quote_version::text),
  CONSTRAINT quote_workflows_status_check CHECK (status IN ('started','cad_pending','pricing','awaiting_approval',
    'approved','sent','follow_up','won','lost','counter_offer','expired','rejected','failed','cancelled')),
  CONSTRAINT quote_workflows_process_check CHECK (process IS NULL OR process IN ('cnc','sheet_metal','mixed','other')),
  CONSTRAINT quote_workflows_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT quote_workflows_pdf_key_check CHECK (quote_pdf_r2_key IS NULL
    OR quote_pdf_r2_key = 'quotes/' || rfq_id::text || '/v' || quote_version::text || '/quote.pdf'),
  CONSTRAINT quote_workflows_pdf_sha256_check CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quote_workflows_drafts_check CHECK (drafts IS NULL
    OR (jsonb_typeof(drafts) = 'object' AND pg_column_size(drafts) <= 65536)),
  CONSTRAINT quote_workflows_approved_by_check CHECK (approved_by IS NULL OR approved_by ~ '^(user:[0-9a-f-]{36}|telegram:-?[0-9]+)$'),
  CONSTRAINT quote_workflows_approved_via_check CHECK (approved_via IS NULL OR approved_via IN ('telegram','dashboard','mcp')),
  CONSTRAINT quote_workflows_follow_ups_check CHECK (follow_ups_sent BETWEEN 0 AND 10),
  CONSTRAINT quote_workflows_pricing_check CHECK (pricing IS NULL OR jsonb_typeof(pricing) = 'object')
);
-- At most one active quote workflow per RFQ; a new version starts after the previous one is final.
CREATE UNIQUE INDEX quote_workflows_one_active_idx ON public.quote_workflows (rfq_id)
  WHERE status NOT IN ('won','lost','expired','rejected','failed','cancelled');
CREATE INDEX quote_workflows_status_idx ON public.quote_workflows (status, updated_at);
CREATE INDEX quote_workflows_msgids_gin ON public.quote_workflows USING gin (outbound_message_ids);
COMMENT ON TABLE public.quote_workflows IS
  'State of the quote Workflow per RFQ and version (AGENTS.md §3.2). outbound_message_ids feed reply attribution (§4).';

-- ---- 6. inbound_emails --------------------------------------------------------------
CREATE TABLE public.inbound_emails (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  message_id         text NOT NULL,           -- RFC 5322 Message-ID as received (or the raw-MIME hash when absent)
  message_id_sha256  text NOT NULL,           -- R2 prefix email/<sha>/
  mailbox            text NOT NULL,
  source             text NOT NULL DEFAULT 'email_routing',
  sender_account_id  uuid REFERENCES public.marketing_sender_accounts(id) ON DELETE SET NULL,
  in_reply_to        text,
  references_ids     text[] NOT NULL DEFAULT '{}',
  from_email         text NOT NULL,
  from_name          text,
  to_email           text,
  subject            text,
  received_at        timestamptz NOT NULL,
  raw_r2_key         text,
  raw_size_bytes     bigint,
  body_excerpt       text,                    -- cleared after 90 days (agent_retention_purge)
  attachments        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{n, r2_key, filename, content_type, size_bytes, sha256, kind}]
  auth_results       jsonb,                   -- SPF / DKIM / DMARC verdicts
  kind               text,
  status             text NOT NULL DEFAULT 'received',
  parsed             jsonb,
  parse_confidence   numeric(4,3),
  classification     jsonb,                   -- {process, confidence}
  rfq_id             uuid REFERENCES public.rfqs(id) ON DELETE SET NULL,
  customer_id        uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  quote_workflow_id  uuid REFERENCES public.quote_workflows(id) ON DELETE SET NULL,
  agent_run_id       uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  error              text,
  CONSTRAINT inbound_emails_message_key UNIQUE (tenant_id, message_id_sha256),
  CONSTRAINT inbound_emails_sha_check CHECK (message_id_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT inbound_emails_mailbox_check CHECK (mailbox IN ('rfq','replies','gmail')),
  CONSTRAINT inbound_emails_source_check CHECK (source IN ('email_routing','gmail_poller')),
  CONSTRAINT inbound_emails_source_mailbox_check CHECK ((source = 'gmail_poller') = (mailbox = 'gmail')),
  CONSTRAINT inbound_emails_gmail_account_check CHECK (source <> 'gmail_poller' OR sender_account_id IS NOT NULL),
  CONSTRAINT inbound_emails_raw_key_check CHECK (raw_r2_key IS NULL OR raw_r2_key = 'email/' || message_id_sha256 || '/raw.eml'),
  CONSTRAINT inbound_emails_excerpt_check CHECK (body_excerpt IS NULL OR char_length(body_excerpt) <= 4000),
  CONSTRAINT inbound_emails_attachments_check CHECK (jsonb_typeof(attachments) = 'array'),
  CONSTRAINT inbound_emails_kind_check CHECK (kind IS NULL OR kind IN ('rfq','techpilot','reply','auto_reply','spam','other')),
  CONSTRAINT inbound_emails_status_check CHECK (status IN ('received','parsed','needs_review','rfq_created',
    'attached','matched','rejected','duplicate','spam','failed')),
  CONSTRAINT inbound_emails_confidence_check CHECK (parse_confidence IS NULL OR parse_confidence BETWEEN 0 AND 1)
);
CREATE INDEX inbound_emails_status_idx     ON public.inbound_emails (tenant_id, status, received_at DESC);
CREATE INDEX inbound_emails_in_reply_idx   ON public.inbound_emails (in_reply_to) WHERE in_reply_to IS NOT NULL;
CREATE INDEX inbound_emails_message_id_idx ON public.inbound_emails (message_id);
CREATE INDEX inbound_emails_rfq_idx        ON public.inbound_emails (rfq_id) WHERE rfq_id IS NOT NULL;
CREATE INDEX inbound_emails_received_idx   ON public.inbound_emails (received_at);
-- Foreign keys with ON DELETE actions get an index so parent deletes and purges do not scan this table.
CREATE INDEX inbound_emails_customer_idx   ON public.inbound_emails (customer_id);
CREATE INDEX inbound_emails_quote_idx      ON public.inbound_emails (quote_workflow_id);
CREATE INDEX inbound_emails_run_idx        ON public.inbound_emails (agent_run_id);
COMMENT ON TABLE public.inbound_emails IS
  'Inbound RFQ and reply e-mails (Email Routing on rfq.micronshub.eu and the Gmail poller; AGENTS.md §3.1, §4).';

-- ---- 7. cad_jobs ----------------------------------------------------------------------
CREATE TABLE public.cad_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  idempotency_key     text NOT NULL,          -- <input_sha256>:<job_type>:<params_sha256>
  job_type            text NOT NULL,
  backend             text,
  rfq_id              uuid REFERENCES public.rfqs(id) ON DELETE CASCADE,
  rfq_file_id         uuid REFERENCES public.rfq_files(id) ON DELETE SET NULL,
  quote_workflow_id   uuid REFERENCES public.quote_workflows(id) ON DELETE SET NULL,
  input_r2_key        text NOT NULL,
  input_sha256        text NOT NULL,
  params              jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_r2_keys      jsonb NOT NULL DEFAULT '[]'::jsonb,
  result              jsonb,
  status              text NOT NULL DEFAULT 'queued',
  attempts            smallint NOT NULL DEFAULT 0,
  requested_by_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  enqueued_at         timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  duration_ms         integer,
  error               text,
  -- One job per (file bytes, type, params) and RFQ; jobs without an RFQ share one key space.
  CONSTRAINT cad_jobs_idem_key UNIQUE NULLS NOT DISTINCT (rfq_id, idempotency_key),
  CONSTRAINT cad_jobs_job_type_check CHECK (job_type IN ('analyse','drawing_pdf','flat_dxf','flat_svg')),
  -- NULL while queued; 'inline' = the in-Worker TypeScript backend (AM-1).
  CONSTRAINT cad_jobs_backend_check CHECK (backend IS NULL OR backend IN ('vps','container','inline','mac_mini')),
  CONSTRAINT cad_jobs_sha_check CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cad_jobs_idem_check CHECK (idempotency_key ~ '^[0-9a-f]{64}:[a-z_]+:[0-9a-f]{64}$'
    AND idempotency_key LIKE input_sha256 || ':' || job_type || ':%'),
  CONSTRAINT cad_jobs_status_check CHECK (status IN ('queued','dispatched','running','succeeded','failed',
    'timed_out','dead_letter','cancelled')),
  CONSTRAINT cad_jobs_attempts_check CHECK (attempts >= 0),
  CONSTRAINT cad_jobs_params_check CHECK (jsonb_typeof(params) = 'object' AND jsonb_typeof(output_r2_keys) = 'array')
);
CREATE INDEX cad_jobs_reuse_idx  ON public.cad_jobs (idempotency_key) WHERE status = 'succeeded';
CREATE INDEX cad_jobs_status_idx ON public.cad_jobs (status, enqueued_at);
CREATE INDEX cad_jobs_rfq_idx    ON public.cad_jobs (rfq_id) WHERE rfq_id IS NOT NULL;
CREATE INDEX cad_jobs_file_idx   ON public.cad_jobs (rfq_file_id);
CREATE INDEX cad_jobs_quote_idx  ON public.cad_jobs (quote_workflow_id);
CREATE INDEX cad_jobs_run_idx    ON public.cad_jobs (requested_by_run_id);
COMMENT ON TABLE public.cad_jobs IS
  'CAD jobs routed by CadRouter (AGENTS.md §5). Outputs live in R2 cad/<job_id>/output/.';

-- ---- 8. stock_reservations ------------------------------------------------------------
CREATE TABLE public.stock_reservations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  order_item_id       uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  order_id            uuid NOT NULL REFERENCES public.orders(id),
  material_id         uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  stock_item_id       uuid REFERENCES public.stock_items(id) ON DELETE RESTRICT,   -- NULL = material-level hold
  area_mm2            numeric(14,2),
  quantity            numeric(12,3),
  status              text NOT NULL DEFAULT 'held',
  release_reason      text,
  expires_at          timestamptz,
  nesting_session_id  uuid REFERENCES public.nesting_sessions(id) ON DELETE RESTRICT,
  reserve_txn_id      uuid REFERENCES public.stock_transactions(id) ON DELETE SET NULL,
  release_txn_id      uuid REFERENCES public.stock_transactions(id) ON DELETE SET NULL,
  released_at         timestamptz,
  held_by             text,                    -- DO name <tenant_id>:<material_id>
  CONSTRAINT stock_reservations_amount_check CHECK ((area_mm2 IS NOT NULL AND area_mm2 > 0)
    OR (quantity IS NOT NULL AND quantity > 0)),
  CONSTRAINT stock_reservations_status_check CHECK (status IN ('held','committed','released')),
  CONSTRAINT stock_reservations_reason_check CHECK ((status = 'released') = (release_reason IS NOT NULL)
    AND (release_reason IS NULL OR release_reason IN ('cancelled','consumed','expired','manual'))),
  CONSTRAINT stock_reservations_held_check CHECK (status <> 'held' OR expires_at IS NOT NULL),
  CONSTRAINT stock_reservations_committed_check CHECK (status <> 'committed'
    OR (expires_at IS NULL AND nesting_session_id IS NOT NULL)),
  CONSTRAINT stock_reservations_released_check CHECK ((status = 'released') = (released_at IS NOT NULL)),
  CONSTRAINT stock_reservations_held_by_check CHECK (held_by IS NULL OR held_by ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$')
);
CREATE UNIQUE INDEX stock_reservations_item_active_idx ON public.stock_reservations (order_item_id, stock_item_id)
  WHERE status IN ('held','committed') AND stock_item_id IS NOT NULL;
CREATE UNIQUE INDEX stock_reservations_material_active_idx ON public.stock_reservations (order_item_id, material_id)
  WHERE status IN ('held','committed') AND stock_item_id IS NULL;
CREATE INDEX stock_reservations_material_idx ON public.stock_reservations (material_id, status);
CREATE INDEX stock_reservations_order_idx    ON public.stock_reservations (order_id);
CREATE INDEX stock_reservations_expiry_idx   ON public.stock_reservations (expires_at) WHERE status = 'held';
CREATE INDEX stock_reservations_stock_idx    ON public.stock_reservations (stock_item_id) WHERE stock_item_id IS NOT NULL;
CREATE INDEX stock_reservations_session_idx  ON public.stock_reservations (nesting_session_id);
COMMENT ON TABLE public.stock_reservations IS
  'Stock holds written by the MaterialStock Durable Object through stock_hold / stock_commit / stock_release (AGENTS.md §6).';

-- ---- 9. New columns on existing tables --------------------------------------------------
ALTER TABLE public.rfqs
  ADD COLUMN source text NOT NULL DEFAULT 'web',
  ADD COLUMN inbound_email_id uuid REFERENCES public.inbound_emails(id) ON DELETE SET NULL,
  ADD CONSTRAINT rfqs_source_check CHECK (source IN ('web','email','techpilot','manual'));
CREATE INDEX rfqs_inbound_email_idx ON public.rfqs (inbound_email_id) WHERE inbound_email_id IS NOT NULL;

ALTER TABLE public.rfq_files
  ADD COLUMN source text NOT NULL DEFAULT 'web',
  ADD COLUMN r2_key text,
  ADD COLUMN sha256 text,
  ADD COLUMN content_type text,
  ADD CONSTRAINT rfq_files_source_check CHECK (source IN ('web','email','techpilot','manual')),
  ADD CONSTRAINT rfq_files_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT rfq_files_r2_key_check CHECK (r2_key IS NULL OR r2_key LIKE 'rfq/' || rfq_id::text || '/%'),
  -- Same bytes once per RFQ. NULL sha256 (all rows written before Phase 4) never conflicts.
  ADD CONSTRAINT rfq_files_rfq_sha256_key UNIQUE (rfq_id, sha256);

-- Agent columns are set only by the service role and by SECURITY DEFINER functions.
-- Other roles keep the defaults; staff may create RFQs and files with source 'manual'.
CREATE FUNCTION public.agent_columns_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.source IS DISTINCT FROM 'web' THEN
      IF NEW.source IS DISTINCT FROM 'manual' OR current_user <> 'authenticated' THEN
        RAISE EXCEPTION '%.source % is set by the agent layer only', TG_TABLE_NAME, NEW.source USING ERRCODE = '42501';
      ELSIF NOT public.has_staff_role() THEN
        RAISE EXCEPTION '%.source manual is for staff only', TG_TABLE_NAME USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'rfqs' THEN
      IF NEW.inbound_email_id IS NOT NULL THEN
        RAISE EXCEPTION 'rfqs.inbound_email_id is set by the agent layer only' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.r2_key IS NOT NULL OR NEW.sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'rfq_files.r2_key and rfq_files.sha256 are set by the agent layer only' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION '%.source is set by the agent layer only', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    IF TG_TABLE_NAME = 'rfqs' THEN
      IF NEW.inbound_email_id IS DISTINCT FROM OLD.inbound_email_id THEN
        RAISE EXCEPTION 'rfqs.inbound_email_id is set by the agent layer only' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.r2_key IS DISTINCT FROM OLD.r2_key OR NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
      RAISE EXCEPTION 'rfq_files.r2_key and rfq_files.sha256 are set by the agent layer only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER rfqs_agent_columns_guard
  BEFORE INSERT OR UPDATE ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.agent_columns_guard();
CREATE TRIGGER rfq_files_agent_columns_guard
  BEFORE INSERT OR UPDATE ON public.rfq_files
  FOR EACH ROW EXECUTE FUNCTION public.agent_columns_guard();

-- ---- 10. Service-role functions ------------------------------------------------------------

-- 10a. Exactly-once RFQ creation for an inbound e-mail (wraps create_public_rfq; AGENTS.md §3.1 step 10).
CREATE FUNCTION public.create_email_rfq(p_inbound_email_id uuid, p_payload jsonb, p_source text)
RETURNS TABLE(rfq_id uuid, rfq_number text, customer_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_rfq  uuid;
  v_num  text;
  v_cust uuid;
BEGIN
  IF p_source NOT IN ('email', 'techpilot') THEN
    RAISE EXCEPTION 'create_email_rfq: source must be email or techpilot, got %', p_source;
  END IF;
  SELECT ie.rfq_id INTO v_rfq FROM public.inbound_emails ie
   WHERE ie.id = p_inbound_email_id FOR UPDATE;          -- serialises Workflow retries for one e-mail
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_email_rfq: inbound e-mail % not found', p_inbound_email_id;
  END IF;
  IF v_rfq IS NULL THEN
    -- create_public_rfq numbers RFQs as max(n) + 1 per day; agent calls are serialised among themselves.
    PERFORM pg_advisory_xact_lock(hashtext('microns:create_email_rfq'));
    SELECT c.id, c.rfq_number, c.customer_id INTO v_rfq, v_num, v_cust
      FROM public.create_public_rfq(p_payload) c;          -- customer match by e-mail, RFQ numbering
    UPDATE public.rfqs r SET source = p_source, inbound_email_id = p_inbound_email_id WHERE r.id = v_rfq;
    UPDATE public.inbound_emails ie
       SET rfq_id = v_rfq, customer_id = v_cust, status = 'rfq_created'
     WHERE ie.id = p_inbound_email_id;
  ELSE
    SELECT r.rfq_number, r.customer_id INTO v_num, v_cust FROM public.rfqs r WHERE r.id = v_rfq;
  END IF;
  RETURN QUERY SELECT v_rfq, v_num, v_cust;
END $$;

-- 10b. Run record: insert once per (agent, idempotency_key), or return the existing run (AGENTS.md §2.1).
CREATE FUNCTION public.agent_run_begin(
  p_agent text, p_trigger text, p_idempotency_key text,
  p_fields jsonb DEFAULT '{}'::jsonb,
  p_tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001')
RETURNS TABLE(run_id uuid, created boolean, run_status text)
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.agent_runs AS ar (tenant_id, agent, trigger, idempotency_key, workflow_name,
                                       workflow_instance_id, parent_run_id, subject_type, subject_id, prompt_version)
  VALUES (p_tenant_id, p_agent, p_trigger, p_idempotency_key,
          p_fields->>'workflow_name', p_fields->>'workflow_instance_id', (p_fields->>'parent_run_id')::uuid,
          p_fields->>'subject_type', (p_fields->>'subject_id')::uuid, p_fields->>'prompt_version')
  ON CONFLICT (agent, idempotency_key) DO NOTHING
  RETURNING ar.id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true, 'running'::text;
  ELSE
    RETURN QUERY SELECT ar.id, false, ar.status FROM public.agent_runs ar
                  WHERE ar.agent = p_agent AND ar.idempotency_key = p_idempotency_key;
  END IF;
END $$;

-- 10c. Single-use approval claim (AGENTS.md §2.4 hop 4). A second claim of the same token returns no row.
-- Only runs that carry a token are claimable; a claimed run resumes as 'running' with parked_reason cleared
-- (a run behind a failure card waits with parked_reason 'failed', AM-3).
CREATE FUNCTION public.agent_run_claim_approval(p_token_sha256 text, p_human_action jsonb)
RETURNS TABLE(run_id uuid, agent text, workflow_name text, workflow_instance_id text, output jsonb)
LANGUAGE sql VOLATILE SET search_path = public
AS $$
  UPDATE public.agent_runs ar
     SET approval_token_sha256 = NULL,
         status = 'running',
         parked_reason = NULL,
         human_action = COALESCE(p_human_action, '{}'::jsonb)
                        || jsonb_build_object('decided_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   WHERE ar.approval_token_sha256 = p_token_sha256
     AND ar.status = 'waiting_human'
  RETURNING ar.id, ar.agent, ar.workflow_name, ar.workflow_instance_id, ar.output;
$$;

-- 10d. Stock holds (AGENTS.md §6). The MaterialStock DO chooses the stock; these functions write holds and
-- the matching stock_transactions rows atomically. reserve / unreserve rows record the held amount as a
-- signed change and do not alter stock_items.remaining_*: availability = remaining - active holds.
CREATE FUNCTION public.stock_hold(
  p_order_item_id uuid, p_material_id uuid, p_holds jsonb, p_expires_at timestamptz, p_held_by text DEFAULT NULL)
RETURNS SETOF public.stock_reservations
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_tenant   uuid;
  v_hold     jsonb;
  v_stock    uuid;
  v_area     numeric;
  v_qty      numeric;
  v_res_id   uuid;
  v_txn_id   uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('microns:stock:' || p_material_id::text));
  IF EXISTS (SELECT 1 FROM public.stock_reservations sr
              WHERE sr.order_item_id = p_order_item_id AND sr.status IN ('held','committed')) THEN
    RETURN QUERY SELECT * FROM public.stock_reservations sr
                  WHERE sr.order_item_id = p_order_item_id AND sr.status IN ('held','committed')
                  ORDER BY sr.created_at, sr.id;
    RETURN;                                    -- idempotent: existing holds are returned unchanged
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'stock_hold: expires_at must be in the future';
  END IF;
  IF jsonb_typeof(p_holds) IS DISTINCT FROM 'array' OR jsonb_array_length(p_holds) = 0 THEN
    RAISE EXCEPTION 'stock_hold: holds must be a non-empty JSON array';
  END IF;
  SELECT oi.order_id, COALESCE(oi.tenant_id, '00000000-0000-0000-0000-000000000001')
    INTO v_order_id, v_tenant
    FROM public.order_items oi WHERE oi.id = p_order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_hold: order item % not found', p_order_item_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials m WHERE m.id = p_material_id) THEN
    RAISE EXCEPTION 'stock_hold: material % not found', p_material_id;
  END IF;

  FOR v_hold IN SELECT * FROM jsonb_array_elements(p_holds) LOOP
    v_stock := NULLIF(v_hold->>'stock_item_id', '')::uuid;
    v_area  := (v_hold->>'area_mm2')::numeric;
    v_qty   := (v_hold->>'quantity')::numeric;
    IF v_stock IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.stock_items si WHERE si.id = v_stock AND si.material_id = p_material_id) THEN
      RAISE EXCEPTION 'stock_hold: stock item % does not belong to material %', v_stock, p_material_id;
    END IF;
    INSERT INTO public.stock_reservations (tenant_id, order_item_id, order_id, material_id, stock_item_id,
                                           area_mm2, quantity, status, expires_at, held_by)
    VALUES (v_tenant, p_order_item_id, v_order_id, p_material_id, v_stock, v_area, v_qty, 'held', p_expires_at, p_held_by)
    RETURNING id INTO v_res_id;
    IF v_stock IS NOT NULL THEN
      INSERT INTO public.stock_transactions (tenant_id, stock_item_id, transaction_type, area_change_mm2,
                                             quantity_change, reference_type, reference_id, notes)
      VALUES (v_tenant, v_stock, 'reserve', -COALESCE(v_area, 0), -COALESCE(v_qty, 0), 'order_item',
              p_order_item_id, 'stock_reservation ' || v_res_id::text)
      RETURNING id INTO v_txn_id;
      UPDATE public.stock_reservations SET reserve_txn_id = v_txn_id WHERE id = v_res_id;
    END IF;
  END LOOP;

  RETURN QUERY SELECT * FROM public.stock_reservations sr
                WHERE sr.order_item_id = p_order_item_id AND sr.status IN ('held','committed')
                ORDER BY sr.created_at, sr.id;
END $$;

CREATE FUNCTION public.stock_commit(p_order_item_id uuid, p_nesting_session_id uuid)
RETURNS SETOF public.stock_reservations
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.stock_reservations sr
              WHERE sr.order_item_id = p_order_item_id AND sr.status = 'committed'
                AND sr.nesting_session_id IS DISTINCT FROM p_nesting_session_id) THEN
    RAISE EXCEPTION 'stock_commit: holds of order item % are committed to another nesting session', p_order_item_id;
  END IF;
  UPDATE public.stock_reservations sr
     SET status = 'committed', expires_at = NULL, nesting_session_id = p_nesting_session_id
   WHERE sr.order_item_id = p_order_item_id AND sr.status = 'held';
  RETURN QUERY SELECT * FROM public.stock_reservations sr
                WHERE sr.order_item_id = p_order_item_id AND sr.status = 'committed'
                ORDER BY sr.created_at, sr.id;
END $$;

CREATE FUNCTION public.stock_release(p_order_item_id uuid, p_reason text)
RETURNS SETOF public.stock_reservations
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
DECLARE
  r        public.stock_reservations%ROWTYPE;
  v_txn_id uuid;
BEGIN
  IF p_reason NOT IN ('cancelled','consumed','expired','manual') THEN
    RAISE EXCEPTION 'stock_release: unknown reason %', p_reason;
  END IF;
  FOR r IN SELECT * FROM public.stock_reservations sr
            WHERE sr.order_item_id = p_order_item_id AND sr.status IN ('held','committed')
            ORDER BY sr.created_at, sr.id FOR UPDATE LOOP
    v_txn_id := NULL;
    IF r.stock_item_id IS NOT NULL THEN
      INSERT INTO public.stock_transactions (tenant_id, stock_item_id, transaction_type, area_change_mm2,
                                             quantity_change, reference_type, reference_id, notes)
      VALUES (r.tenant_id, r.stock_item_id, 'unreserve', COALESCE(r.area_mm2, 0), COALESCE(r.quantity, 0),
              'order_item', p_order_item_id, 'stock_reservation ' || r.id::text || ' ' || p_reason)
      RETURNING id INTO v_txn_id;
    END IF;
    UPDATE public.stock_reservations
       SET status = 'released', release_reason = p_reason, released_at = now(), expires_at = NULL,
           release_txn_id = v_txn_id
     WHERE id = r.id;
    RETURN QUERY SELECT * FROM public.stock_reservations WHERE id = r.id;
  END LOOP;
  RETURN;                                       -- no active holds: no-op
END $$;

-- 10e. Retention (AGENTS.md §2.6): run monthly by the ops digest (by hand before Phase 5).
CREATE FUNCTION public.agent_retention_purge(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
DECLARE
  v_excerpts int; v_emails int; v_outputs int; v_runs int;
BEGIN
  DELETE FROM public.inbound_emails WHERE received_at < p_now - interval '24 months';
  GET DIAGNOSTICS v_emails = ROW_COUNT;
  UPDATE public.inbound_emails SET body_excerpt = NULL
   WHERE body_excerpt IS NOT NULL AND received_at < p_now - interval '90 days';
  GET DIAGNOSTICS v_excerpts = ROW_COUNT;
  DELETE FROM public.agent_runs
   WHERE started_at < p_now - interval '13 months' AND status NOT IN ('running','waiting_human');
  GET DIAGNOSTICS v_runs = ROW_COUNT;
  UPDATE public.agent_runs SET output = NULL
   WHERE output IS NOT NULL AND started_at < p_now - interval '90 days'
     AND status NOT IN ('running','waiting_human');
  GET DIAGNOSTICS v_outputs = ROW_COUNT;
  RETURN jsonb_build_object('excerpts_cleared', v_excerpts, 'emails_deleted', v_emails,
                            'run_outputs_cleared', v_outputs, 'runs_deleted', v_runs);
END $$;

-- 10f. Order from an accepted quote (AM-4; the quote Workflow's "won" path). Same rows as the portal's
-- Accept Quote (src/pages/customer/QuoteDetailPage.tsx:171-178, :396-449), written in one transaction:
--   rfqs.status = 'approved'; orders row (status 'new', total = (sum of parts_details[*].total_price
--   + shipping_cost) * 1.24, currency = rfqs.currency or EUR set explicitly because orders.currency
--   defaults to USD, title = po_number = next_po_number(), from_rfq_number, start now, delivery now + 14 d);
--   one order_items row per part with the portal's fallbacks ('' for texts, 0 for numbers).
-- Idempotent per RFQ: when an order with this rfq_id and from_rfq_number exists (from an earlier call or
-- from the portal), that order is returned with created = false and nothing is written.
CREATE FUNCTION public.create_order_from_quote(p_quote_workflow_id uuid)
RETURNS TABLE(order_id uuid, po_number text, created boolean)
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_rfq_id    uuid;
  v_qw_tenant uuid;
  v_rfq       public.rfqs%ROWTYPE;
  v_rfq_no    text;
  v_parts     jsonb;
  v_subtotal  numeric;
  v_tenant    uuid;
  v_order_id  uuid;
  v_po        text;
BEGIN
  SELECT qw.rfq_id, qw.tenant_id INTO v_rfq_id, v_qw_tenant
    FROM public.quote_workflows qw WHERE qw.id = p_quote_workflow_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order_from_quote: quote workflow % not found', p_quote_workflow_id;
  END IF;
  SELECT r.* INTO v_rfq FROM public.rfqs r WHERE r.id = v_rfq_id FOR UPDATE;   -- serialises calls per RFQ
  v_rfq_no := COALESCE(v_rfq.rfq_number, '');

  SELECT o.id, o.po_number INTO v_order_id, v_po
    FROM public.orders o
   WHERE o.rfq_id = v_rfq_id AND o.from_rfq_number = v_rfq_no
   ORDER BY o.created_at NULLS LAST, o.id
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT v_order_id, v_po, false;
    RETURN;
  END IF;

  v_parts := CASE WHEN jsonb_typeof(v_rfq.parts_details) = 'array' THEN v_rfq.parts_details ELSE '[]'::jsonb END;
  SELECT COALESCE(sum(COALESCE(NULLIF(e.part->>'total_price', '')::numeric, 0)), 0) INTO v_subtotal
    FROM jsonb_array_elements(v_parts) AS e(part);
  v_tenant := COALESCE(v_rfq.tenant_id, v_qw_tenant);

  UPDATE public.rfqs r SET status = 'approved' WHERE r.id = v_rfq_id;
  -- next_po_number() numbers orders as max(n) + 1 per day; agent calls are serialised among themselves.
  PERFORM pg_advisory_xact_lock(hashtext('microns:next_po_number'));
  v_po := public.next_po_number();
  INSERT INTO public.orders AS o (customer_id, rfq_id, status, total_amount, currency, title, po_number,
                                  from_rfq_number, start_date, delivery_date, tenant_id)
  VALUES (v_rfq.customer_id, v_rfq_id, 'new',
          (v_subtotal + COALESCE(v_rfq.shipping_cost, 0)) * 1.24,
          COALESCE(NULLIF(v_rfq.currency, ''), 'EUR'),
          v_po, v_po, v_rfq_no, now(), now() + interval '14 days', v_tenant)
  RETURNING o.id INTO v_order_id;

  INSERT INTO public.order_items (order_id, product_name, description, quantity, unit_price, total_price, tenant_id)
  SELECT v_order_id,
         COALESCE(e.part->>'product_name', ''),
         COALESCE(e.part->>'description', ''),
         COALESCE(NULLIF(e.part->>'quantity', '')::int, 0),
         COALESCE(NULLIF(e.part->>'unit_price', '')::numeric, 0),
         COALESCE(NULLIF(e.part->>'total_price', '')::numeric, 0),
         v_tenant
    FROM jsonb_array_elements(v_parts) WITH ORDINALITY AS e(part, n)
   ORDER BY e.n;

  RETURN QUERY SELECT v_order_id, v_po, true;
END $$;

-- 10g. Staff roles for an e-mail address (AM-5; the remote MCP server maps the verified Access e-mail to a
-- staff principal). Case-insensitive match on auth.users; roles = the four staff roles from user_roles only
-- (tenant roles are not consulted). No row when the address has no staff role. SECURITY DEFINER because it
-- reads auth.users; executable by service_role only.
CREATE FUNCTION public.agent_staff_for_email(p_email text)
RETURNS TABLE(user_id uuid, roles text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.id, array_agg(ur.role::text ORDER BY ur.role::text)
    FROM auth.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
   WHERE lower(u.email) = lower(p_email)
     AND ur.role IN ('admin', 'sales_rep', 'production_manager', 'accountant')
   GROUP BY u.id
   ORDER BY u.id;
$$;

-- Execute rights: service role only (new functions are executable by anon and authenticated by default).
REVOKE ALL ON FUNCTION
  public.feature_flags_before_write(),
  public.feature_flags_kv_key(text, uuid),
  public.feature_flags_kv_value(boolean, jsonb, timestamptz, bigint),
  public.feature_flags_sync_batch(),
  public.feature_flags_mark_synced(text, uuid, bigint),
  public.feature_flags_seed_from_kv(text, uuid, jsonb),
  public.agent_columns_guard(),
  public.create_email_rfq(uuid, jsonb, text),
  public.agent_run_begin(text, text, text, jsonb, uuid),
  public.agent_run_claim_approval(text, jsonb),
  public.stock_hold(uuid, uuid, jsonb, timestamptz, text),
  public.stock_commit(uuid, uuid),
  public.stock_release(uuid, text),
  public.agent_retention_purge(timestamptz),
  public.create_order_from_quote(uuid),
  public.agent_staff_for_email(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.feature_flags_kv_key(text, uuid),
  public.feature_flags_kv_value(boolean, jsonb, timestamptz, bigint),
  public.feature_flags_sync_batch(),
  public.feature_flags_mark_synced(text, uuid, bigint),
  public.feature_flags_seed_from_kv(text, uuid, jsonb),
  public.create_email_rfq(uuid, jsonb, text),
  public.agent_run_begin(text, text, text, jsonb, uuid),
  public.agent_run_claim_approval(text, jsonb),
  public.stock_hold(uuid, uuid, jsonb, timestamptz, text),
  public.stock_commit(uuid, uuid),
  public.stock_release(uuid, text),
  public.agent_retention_purge(timestamptz),
  public.create_order_from_quote(uuid),
  public.agent_staff_for_email(text)
  TO service_role;
COMMENT ON FUNCTION public.create_order_from_quote(uuid) IS
  'Order and items from an accepted quote, as the portal Accept Quote writes them; idempotent per RFQ. Service role only.';
COMMENT ON FUNCTION public.agent_staff_for_email(text) IS
  'user_id and staff roles (user_roles only) for an e-mail address; no row without a staff role. Service role only.';
-- Trigger functions need no EXECUTE grant: the privilege is checked when the trigger is created, not when it fires.

-- ---- 11. RLS, grants and updated_at for the seven tables -----------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_runs','feature_flags','pricing_rules','quote_workflows',
                           'inbound_emails','cad_jobs','stock_reservations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- New tables inherit full privileges for anon and authenticated by default; reset them.
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_staff_role()))',
                   t || '_staff_select', t);
    -- No INSERT, UPDATE or DELETE policy: writes only through microns-ops / microns-mail (service role).
    IF t <> 'feature_flags' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW '
                     'EXECUTE FUNCTION public.update_updated_at_column()', t || '_updated_at', t);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.feature_flags_rev_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.feature_flags_rev_seq TO service_role;

-- ---- 12. Canonical flags (the 13 keys of FlagKey, PHASE4_SPEC.md §4.3; PLAN.md P4-2). All off; kv_seed_pending = true so the first
-- flags-sync run imports any value set by hand in KV FLAGS before it writes anything.
INSERT INTO public.feature_flags (key, enabled, value, description, kv_seed_pending) VALUES
  ('seo.strict_404',        false, '{}', 'Real 404 for unknown SEO paths (SEO_PARITY.md §7); fallback var SEO_STRICT_404', true),
  ('api.forward_to_vercel', false, '{}', 'Phase 2 rollback: forward /api/* to Vercel; value.paths / value.hosts narrow it; fallback var API_FORWARD_TO_VERCEL', true),
  ('agent.rfq_intake',      false, '{"mode":"shadow","min_confidence":0.7,"ack":false}', 'Agent 1: inbound RFQ e-mail (AGENTS.md §3.1)', true),
  ('agent.quote',           false, '{"mode":"assist","follow_up_days":[3,4,7],"campaign_replies":false}', 'Agent 2: quote Workflow and reply detection (AGENTS.md §3.2, §4)', true),
  ('agent.post_order',      false, '{"mode":"assist"}', 'Agent 3: post-order handoff (AGENTS.md §3.3)', true),
  ('agent.growth.reddit',   false, '{}', 'Agent 4: reddit collector tiers 1-3 (Phase 5)', true),
  ('agent.growth.hn',       false, '{}', 'Agent 4: HN collector (Phase 5)', true),
  ('agent.growth.tenders',  false, '{"relevance":false,"llm_cap":20}', 'Agent 4: tender scan (Phase 5)', true),
  ('agent.growth.scrapers', false, '{}', 'Agent 4: Europages / wlw scrapers via Browser Rendering (P4-10)', true),
  ('agent.growth.xometry',  false, '{}', 'Agent 4: Xometry scanner (Phase 5)', true),
  ('agent.content_daily',   false, '{}', 'Agent 5: content-daily Workflow (Phase 5)', true),
  ('agent.ops_digest',      false, '{"ads_upload":false}', 'Agent 6: weekly ops digest (Phase 5); recipient set as data, not in the repository', true),
  ('mcp.remote',            false, '{"writes":false}', 'Agent 7: remote MCP on mcp.micronshub.eu (P4-11)', true);

NOTIFY pgrst, 'reload schema';

COMMIT;
