-- ============================================================
-- Funded Startup Scanner Migration
-- Microns Hub — European Hardware Startup Funding Monitor
-- Monitors RSS feeds to find recently funded hardware companies
-- that need manufacturing services.
-- ============================================================

-- Ensure update_updated_at_column function exists (shared trigger)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Main funded startups table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.funded_startups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source info
  source_name TEXT NOT NULL,               -- 'tech.eu', 'eu-startups', etc.
  source_url TEXT NOT NULL UNIQUE,         -- article URL (dedup key)
  article_title TEXT NOT NULL,
  article_excerpt TEXT,
  article_published_at TIMESTAMPTZ,

  -- Company info (extracted from article)
  company_name TEXT,
  company_website TEXT,
  country_code VARCHAR(5),
  city TEXT,

  -- Funding info
  funding_amount_millions DECIMAL,         -- always in millions
  funding_currency VARCHAR(3) DEFAULT 'EUR',
  funding_stage TEXT,                      -- 'pre-seed', 'seed', 'series-a', etc.
  investors TEXT[],                        -- investor names if mentioned

  -- Industry classification
  industry_tags TEXT[],                    -- ['robotics', 'medtech', etc.]
  is_hardware BOOLEAN DEFAULT false,
  hardware_confidence INTEGER DEFAULT 0,   -- 0-100 confidence score

  -- Lead processing
  matched_keywords TEXT[],

  -- Email enrichment
  scraped_emails TEXT[],
  email_scrape_status VARCHAR(20) DEFAULT 'pending',

  -- Outreach tracking
  outreach_status VARCHAR(20) DEFAULT 'new', -- 'new', 'researched', 'contacted', 'responded', 'not_relevant'
  notes TEXT,
  contacted_at TIMESTAMPTZ,

  -- Timestamps
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_funded_startups_hardware ON public.funded_startups(is_hardware);
CREATE INDEX IF NOT EXISTS idx_funded_startups_stage ON public.funded_startups(funding_stage);
CREATE INDEX IF NOT EXISTS idx_funded_startups_country ON public.funded_startups(country_code);
CREATE INDEX IF NOT EXISTS idx_funded_startups_confidence ON public.funded_startups(hardware_confidence DESC);
CREATE INDEX IF NOT EXISTS idx_funded_startups_discovered ON public.funded_startups(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_funded_startups_outreach ON public.funded_startups(outreach_status);
CREATE INDEX IF NOT EXISTS idx_funded_startups_source_name ON public.funded_startups(source_name);
CREATE INDEX IF NOT EXISTS idx_funded_startups_industry ON public.funded_startups USING GIN(industry_tags);
CREATE INDEX IF NOT EXISTS idx_funded_startups_keywords ON public.funded_startups USING GIN(matched_keywords);

-- Updated_at trigger
CREATE TRIGGER update_funded_startups_updated_at
  BEFORE UPDATE ON public.funded_startups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.funded_startups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage funded startups"
  ON public.funded_startups
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- RSS/Atom feed configuration table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.funding_feeds (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL UNIQUE,
  website_url TEXT,
  feed_type VARCHAR(10) DEFAULT 'rss',     -- 'rss', 'atom', 'scrape'
  language VARCHAR(5) DEFAULT 'en',
  priority INTEGER DEFAULT 2,              -- 1=highest, 3=lowest
  focus TEXT,                              -- human-readable description
  is_active BOOLEAN DEFAULT true,
  last_fetched_at TIMESTAMPTZ,
  last_item_date TIMESTAMPTZ,              -- avoid re-processing old items
  last_item_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_error TEXT
);

ALTER TABLE public.funding_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage funding feeds"
  ON public.funding_feeds
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- Scan log table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.funding_scan_logs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  feeds_scanned INTEGER DEFAULT 0,
  articles_found INTEGER DEFAULT 0,
  articles_relevant INTEGER DEFAULT 0,
  startups_hardware INTEGER DEFAULT 0,
  startups_new INTEGER DEFAULT 0,
  errors TEXT[]
);

ALTER TABLE public.funding_scan_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view scan logs"
  ON public.funding_scan_logs
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- Seed: RSS Feed Configurations
-- ============================================================
INSERT INTO public.funding_feeds (name, feed_url, website_url, feed_type, language, priority, focus) VALUES
-- Priority 1: Main European funding news (daily multiple posts)
('Tech.eu',
 'https://tech.eu/feed',
 'https://tech.eu',
 'rss', 'en', 1,
 'European tech ecosystem — funding rounds, exits, startup news'),

('EU-Startups',
 'https://eu-startups.com/feed',
 'https://eu-startups.com',
 'rss', 'en', 1,
 'European startups — funding, interviews, ecosystem news'),

('TechCrunch Europe',
 'https://techcrunch.com/region/europe/feed/',
 'https://techcrunch.com/region/europe/',
 'rss', 'en', 1,
 'European startup funding and product launches'),

-- Priority 2: Regional European funding news
('Silicon Canals',
 'https://siliconcanals.com/feed',
 'https://siliconcanals.com',
 'rss', 'en', 2,
 'Benelux and European tech — strong on NL, BE startups'),

('Sifted',
 'https://sifted.eu/feed',
 'https://sifted.eu',
 'rss', 'en', 2,
 'European startups and tech (FT-backed publication)'),

('Deutsche Startups',
 'https://www.deutsche-startups.de/feed/',
 'https://www.deutsche-startups.de',
 'rss', 'de', 2,
 'German startup ecosystem — funding rounds'),

('ElevateGreece Blog',
 'https://elevategreece.gov.gr/feed/',
 'https://elevategreece.gov.gr',
 'rss', 'en', 2,
 'Greek startup ecosystem — home market'),

-- Priority 3: Additional coverage
('UKTN (UK Tech News)',
 'https://www.uktech.news/feed',
 'https://www.uktech.news',
 'rss', 'en', 3,
 'UK tech startups — relevant for UK hardware companies'),

('Maddyness France',
 'https://www.maddyness.com/feed/',
 'https://www.maddyness.com',
 'rss', 'fr', 3,
 'French startup ecosystem')

ON CONFLICT (feed_url) DO NOTHING;
