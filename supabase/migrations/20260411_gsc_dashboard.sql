-- ============================================================================
-- Google Search Console Dashboard + MCP Integration
-- ============================================================================
-- Adds four tables:
--   * gsc_config            — single-row credentials store (no new Vercel env)
--   * gsc_indexing_log      — audit + daily quota tracker for Indexing API
--   * gsc_inspection_cache  — cache of URL Inspection API results
--   * gsc_monitored_urls    — admin-curated watchlist of important URLs
--
-- Credentials: only the Supabase service role can read `gsc_config`. Both the
-- Vercel handlers and the MCP server authenticate with SUPABASE_SERVICE_KEY
-- (already present in the environment) and use it to read Google credentials.
-- No new Vercel environment variables are added.
-- ============================================================================

-- ---- gsc_config: single-row credentials store -------------------------------
CREATE TABLE IF NOT EXISTS public.gsc_config (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  client_id       TEXT NOT NULL,
  client_secret   TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  service_account JSONB NOT NULL,
  site_url        TEXT NOT NULL DEFAULT 'sc-domain:micronshub.eu',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gsc_config ENABLE ROW LEVEL SECURITY;
-- No policies => only service_role bypass can read/write. Intentional.

COMMENT ON TABLE public.gsc_config IS
  'Google Search Console credentials. Only service_role can access. Insert one row with id=1.';

-- ---- gsc_indexing_log: audit + daily quota ---------------------------------
CREATE TABLE IF NOT EXISTS public.gsc_indexing_log (
  id             BIGSERIAL PRIMARY KEY,
  url            TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('URL_UPDATED', 'URL_DELETED')),
  status         TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped_quota')),
  error_message  TEXT,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gsc_indexing_log_submitted_at
  ON public.gsc_indexing_log(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_indexing_log_url
  ON public.gsc_indexing_log(url);

ALTER TABLE public.gsc_indexing_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read indexing log" ON public.gsc_indexing_log;
CREATE POLICY "Admins read indexing log"
  ON public.gsc_indexing_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'sales_rep', 'production_manager', 'accountant')
  ));

-- ---- gsc_inspection_cache: URL Inspection API results ---------------------
CREATE TABLE IF NOT EXISTS public.gsc_inspection_cache (
  url                TEXT PRIMARY KEY,
  indexing_state     TEXT,
  coverage_state     TEXT,
  page_fetch_state   TEXT,
  robots_txt_state   TEXT,
  crawled_as         TEXT,
  last_crawl_time    TIMESTAMPTZ,
  referring_urls     TEXT[],
  canonical_user     TEXT,
  canonical_google   TEXT,
  mobile_usability   TEXT,
  rich_results       JSONB,
  raw_result         JSONB,
  inspected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gsc_inspection_cache_inspected_at
  ON public.gsc_inspection_cache(inspected_at DESC);

ALTER TABLE public.gsc_inspection_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read inspection cache" ON public.gsc_inspection_cache;
CREATE POLICY "Admins read inspection cache"
  ON public.gsc_inspection_cache FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'sales_rep', 'production_manager', 'accountant')
  ));

-- ---- gsc_monitored_urls: admin watchlist ----------------------------------
CREATE TABLE IF NOT EXISTS public.gsc_monitored_urls (
  id            BIGSERIAL PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  label         TEXT,
  language      TEXT,
  service_type  TEXT,
  priority      SMALLINT NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gsc_monitored_urls_language
  ON public.gsc_monitored_urls(language);
CREATE INDEX IF NOT EXISTS idx_gsc_monitored_urls_service_type
  ON public.gsc_monitored_urls(service_type);

ALTER TABLE public.gsc_monitored_urls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read monitored urls" ON public.gsc_monitored_urls;
CREATE POLICY "Admins read monitored urls"
  ON public.gsc_monitored_urls FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'sales_rep', 'production_manager', 'accountant')
  ));

DROP POLICY IF EXISTS "Admins write monitored urls" ON public.gsc_monitored_urls;
CREATE POLICY "Admins write monitored urls"
  ON public.gsc_monitored_urls FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'sales_rep', 'production_manager', 'accountant')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'sales_rep', 'production_manager', 'accountant')
  ));
