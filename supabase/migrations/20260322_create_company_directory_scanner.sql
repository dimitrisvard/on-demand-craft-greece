-- Company Directory Scanner Schema
-- Tables: company_leads, saved_searches, scan_logs

-- Company leads from directory scanning
CREATE TABLE IF NOT EXISTS company_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source info
  source VARCHAR(20) NOT NULL, -- 'europages', 'wlw'
  source_url TEXT NOT NULL,    -- profile URL on the directory
  search_url TEXT,             -- the search URL that found this company
  search_query TEXT,           -- the keyword used
  search_country TEXT,         -- the country filter used

  -- Company info
  company_name TEXT NOT NULL,
  description TEXT,
  country TEXT,
  city TEXT,
  full_address TEXT,

  -- Contact info (from directory)
  website_url TEXT,            -- MOST IMPORTANT — feeds into email scraper
  phone TEXT,
  email TEXT,                  -- from directory profile (if available)
  fax TEXT,

  -- Enrichment info (from email scraper)
  scraped_emails TEXT[],
  email_scrape_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'scraped', 'failed', 'no_emails'
  email_scraped_at TIMESTAMPTZ,

  -- Company details
  employee_count TEXT,         -- e.g., "51-100", "11-50"
  year_established TEXT,
  vat_id TEXT,
  industry_tags TEXT[],
  products_services TEXT[],
  certifications TEXT[],
  contact_persons JSONB,       -- [{name, title, email, phone}]

  -- Outreach tracking
  outreach_status VARCHAR(20) DEFAULT 'new', -- 'new', 'email_found', 'contacted', 'responded', 'converted', 'not_relevant'
  outreach_notes TEXT,
  contacted_at TIMESTAMPTZ,

  -- Dedup & timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(source, source_url)
);

CREATE INDEX IF NOT EXISTS idx_company_leads_source ON company_leads(source);
CREATE INDEX IF NOT EXISTS idx_company_leads_country ON company_leads(country);
CREATE INDEX IF NOT EXISTS idx_company_leads_outreach ON company_leads(outreach_status);
CREATE INDEX IF NOT EXISTS idx_company_leads_email_status ON company_leads(email_scrape_status);
CREATE INDEX IF NOT EXISTS idx_company_leads_search_query ON company_leads(search_query);
CREATE INDEX IF NOT EXISTS idx_company_leads_website ON company_leads(website_url);

-- Updated_at trigger for company_leads
CREATE OR REPLACE FUNCTION update_company_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_company_leads_updated_at
  BEFORE UPDATE ON company_leads
  FOR EACH ROW EXECUTE FUNCTION update_company_leads_updated_at();

-- Saved searches (keyword + country combos to re-run)
CREATE TABLE IF NOT EXISTS saved_searches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,               -- e.g., "German machine builders"
  source VARCHAR(20) NOT NULL,      -- 'europages' or 'wlw'
  search_url TEXT NOT NULL,         -- the full URL to scrape
  keyword TEXT,
  country TEXT,
  company_type TEXT,                -- 'manufacturer', 'wholesaler', etc.
  max_pages INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_run_count INTEGER,           -- how many companies found last time
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scan history log
CREATE TABLE IF NOT EXISTS scan_logs (
  id SERIAL PRIMARY KEY,
  saved_search_id INTEGER REFERENCES saved_searches(id),
  source VARCHAR(20) NOT NULL,
  search_url TEXT NOT NULL,
  pages_scanned INTEGER DEFAULT 0,
  companies_found INTEGER DEFAULT 0,
  companies_new INTEGER DEFAULT 0,  -- newly discovered (not dupes)
  errors TEXT[],
  duration_ms INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Row Level Security
ALTER TABLE company_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage company leads
CREATE POLICY "Authenticated users can manage company_leads"
  ON company_leads FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to manage saved searches
CREATE POLICY "Authenticated users can manage saved_searches"
  ON saved_searches FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to view scan logs
CREATE POLICY "Authenticated users can manage scan_logs"
  ON scan_logs FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
