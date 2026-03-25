-- ══════════════════════════════════════════════════════════════════
-- FIX: Drop old tables with wrong schemas and recreate correctly.
--
-- Root cause: old project had different table schemas. When the new
-- migrations (20260322_create_*.sql) ran, they used CREATE TABLE IF
-- NOT EXISTS so the old tables were silently skipped. The API and
-- frontend code was written against the NEW schema, causing 400/500
-- errors on every query that referenced the new column names.
--
-- All three tables had 0 rows — safe to drop and recreate.
-- tender_connectors (26 rows), funding_feeds (10 rows), and all
-- other tables are NOT touched — they already have correct schemas.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Drop old tables ────────────────────────────────────────────
DROP TABLE IF EXISTS public.funded_startups CASCADE;
DROP TABLE IF EXISTS public.company_leads CASCADE;
DROP TABLE IF EXISTS public.tenders CASCADE;

-- ══════════════════════════════════════════════════════════════════
-- 2. FUNDED_STARTUPS — correct schema
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE public.funded_startups (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  source_name          TEXT         NOT NULL,
  source_url           TEXT         NOT NULL UNIQUE,
  article_title        TEXT         NOT NULL,
  article_excerpt      TEXT,
  article_published_at TIMESTAMPTZ,

  company_name         TEXT,
  company_website      TEXT,
  country_code         VARCHAR(5),
  city                 TEXT,

  funding_amount_millions DECIMAL,
  funding_currency     VARCHAR(3)   DEFAULT 'EUR',
  funding_stage        TEXT,
  investors            TEXT[],

  industry_tags        TEXT[],
  is_hardware          BOOLEAN      DEFAULT false,
  hardware_confidence  INTEGER      DEFAULT 0,

  matched_keywords     TEXT[],

  scraped_emails       TEXT[],
  email_scrape_status  VARCHAR(20)  DEFAULT 'pending',

  outreach_status      VARCHAR(20)  DEFAULT 'new',
  notes                TEXT,
  contacted_at         TIMESTAMPTZ,

  discovered_at        TIMESTAMPTZ  DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_funded_startups_hardware    ON public.funded_startups(is_hardware);
CREATE INDEX idx_funded_startups_stage       ON public.funded_startups(funding_stage);
CREATE INDEX idx_funded_startups_country     ON public.funded_startups(country_code);
CREATE INDEX idx_funded_startups_confidence  ON public.funded_startups(hardware_confidence DESC);
CREATE INDEX idx_funded_startups_discovered  ON public.funded_startups(discovered_at DESC);
CREATE INDEX idx_funded_startups_outreach    ON public.funded_startups(outreach_status);
CREATE INDEX idx_funded_startups_source_name ON public.funded_startups(source_name);
CREATE INDEX idx_funded_startups_industry    ON public.funded_startups USING GIN(industry_tags);
CREATE INDEX idx_funded_startups_keywords    ON public.funded_startups USING GIN(matched_keywords);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_funded_startups_updated_at
  BEFORE UPDATE ON public.funded_startups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.funded_startups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage funded startups"
  ON public.funded_startups FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ══════════════════════════════════════════════════════════════════
-- 3. COMPANY_LEADS — correct schema
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE public.company_leads (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  source              VARCHAR(20)  NOT NULL,
  source_url          TEXT         NOT NULL,
  search_url          TEXT,
  search_query        TEXT,
  search_country      TEXT,

  company_name        TEXT         NOT NULL,
  description         TEXT,
  country             TEXT,
  city                TEXT,
  full_address        TEXT,

  website_url         TEXT,
  phone               TEXT,
  email               TEXT,
  fax                 TEXT,

  scraped_emails      TEXT[],
  email_scrape_status VARCHAR(20)  DEFAULT 'pending',
  email_scraped_at    TIMESTAMPTZ,

  employee_count      TEXT,
  year_established    TEXT,
  vat_id              TEXT,
  industry_tags       TEXT[],
  products_services   TEXT[],
  certifications      TEXT[],
  contact_persons     JSONB,

  outreach_status     VARCHAR(20)  DEFAULT 'new',
  outreach_notes      TEXT,
  contacted_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ  DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  DEFAULT NOW(),

  UNIQUE(source, source_url)
);

CREATE INDEX idx_company_leads_source       ON public.company_leads(source);
CREATE INDEX idx_company_leads_country      ON public.company_leads(country);
CREATE INDEX idx_company_leads_outreach     ON public.company_leads(outreach_status);
CREATE INDEX idx_company_leads_email_status ON public.company_leads(email_scrape_status);
CREATE INDEX idx_company_leads_search_query ON public.company_leads(search_query);
CREATE INDEX idx_company_leads_website      ON public.company_leads(website_url);

CREATE OR REPLACE FUNCTION update_company_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_company_leads_updated_at
  BEFORE UPDATE ON public.company_leads
  FOR EACH ROW EXECUTE FUNCTION update_company_leads_updated_at();

ALTER TABLE public.company_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage company_leads"
  ON public.company_leads FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════
-- 4. TENDERS — correct schema
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE public.tenders (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  country_code             VARCHAR(2)   NOT NULL,
  country_name             TEXT         NOT NULL,
  portal_name              TEXT         NOT NULL,
  portal_url               TEXT,
  tender_reference         TEXT,

  title                    TEXT         NOT NULL,
  description              TEXT,
  buyer_name               TEXT,
  buyer_type               TEXT,

  cpv_codes                TEXT[],
  cpv_descriptions         TEXT[],
  nature_of_contract       TEXT,

  estimated_value_eur      DECIMAL,
  estimated_value_original DECIMAL,
  currency                 VARCHAR(3)   DEFAULT 'EUR',

  publication_date         DATE,
  submission_deadline      TIMESTAMPTZ,

  place_of_performance     TEXT,
  nuts_code                TEXT,
  latitude                 DECIMAL,
  longitude                DECIMAL,

  procedure_type           TEXT,

  relevance_score          INTEGER      DEFAULT 0,
  matched_keywords         TEXT[],
  matched_cpv              TEXT[],
  is_relevant              BOOLEAN      DEFAULT false,

  status                   VARCHAR(20)  DEFAULT 'new',
  notes                    TEXT,

  original_language        VARCHAR(5),
  raw_data                 JSONB,
  discovered_at            TIMESTAMPTZ  DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  DEFAULT NOW(),

  UNIQUE(country_code, tender_reference)
);

CREATE INDEX idx_tenders_country    ON public.tenders(country_code);
CREATE INDEX idx_tenders_deadline   ON public.tenders(submission_deadline);
CREATE INDEX idx_tenders_relevant   ON public.tenders(is_relevant);
CREATE INDEX idx_tenders_status     ON public.tenders(status);
CREATE INDEX idx_tenders_score      ON public.tenders(relevance_score DESC);
CREATE INDEX idx_tenders_cpv        ON public.tenders USING GIN(cpv_codes);
CREATE INDEX idx_tenders_value      ON public.tenders(estimated_value_eur);
CREATE INDEX idx_tenders_discovered ON public.tenders(discovered_at DESC);
CREATE INDEX idx_tenders_keywords   ON public.tenders USING GIN(matched_keywords);

CREATE OR REPLACE FUNCTION update_tenders_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenders_updated_at_trigger ON public.tenders;
CREATE TRIGGER tenders_updated_at_trigger
  BEFORE UPDATE ON public.tenders
  FOR EACH ROW EXECUTE FUNCTION update_tenders_updated_at();

ALTER TABLE public.tenders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage tenders"
  ON public.tenders FOR ALL
  USING (auth.role() = 'authenticated');
