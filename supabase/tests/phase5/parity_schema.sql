-- Stand-ins for the live tables that scripts/phase5/parity.sql and the ops digest read and that neither
-- supabase/tests/agent_layer/live_min.sql nor the agent-layer migration creates. Columns and types follow the
-- live tables (information_schema, read-only, 2026-10-08); only the columns the queries use plus their keys.
-- Loaded after live_min.sql, the agent-layer migration and mock_cron.sql by scripts.test.mjs.

CREATE TABLE public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text, slug text, content text, excerpt text, language text, status text,
  translation_id uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (slug, language)
);

CREATE TABLE public.article_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text, processed boolean DEFAULT false, processed_at timestamptz, silo_category text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.article_generation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id uuid, status text, error_message text,
  created_at timestamptz DEFAULT now(), started_at timestamptz, completed_at timestamptz, retry_count integer DEFAULT 0
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text, external_id text, title text, source_url text,
  posted_at timestamptz, discovered_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (source, external_id), UNIQUE (source_url)
);

CREATE TABLE public.tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code character varying, tender_reference text, title text,
  discovered_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (country_code, tender_reference)
);

CREATE TABLE public.tender_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text, is_active boolean, last_scan_at timestamptz
);

CREATE TABLE public.monitored_subreddits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subreddit text, tier integer, is_active boolean, last_scanned_at timestamptz, scan_interval_minutes integer,
  source character varying
);

CREATE TABLE public.gsc_monitored_urls (
  id bigserial PRIMARY KEY,
  url text UNIQUE, label text, language text, service_type text, priority smallint,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.marketing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid, subscriber_id uuid, event_type text, metadata jsonb, resend_email_id text,
  created_at timestamptz DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, metadata jsonb, updated_at timestamptz DEFAULT now()
);
