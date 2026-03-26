-- Fix leads table schema to match frontend expectations
-- The leads table was missing several columns that the frontend/edge functions expected

ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS auto_score text DEFAULT 'low';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS manual_score text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS suggested_response text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS response_sent_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS response_platform text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS industry_tags text[] DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS matched_categories text[] DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS author_url text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS post_created_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS upvotes integer DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS comments_count integer DEFAULT 0;

-- Migrate existing data from old columns to new columns
UPDATE leads SET source_url = url WHERE source_url IS NULL AND url IS NOT NULL;
UPDATE leads SET source_id = external_id WHERE source_id IS NULL AND external_id IS NOT NULL;
UPDATE leads SET auto_score = lead_score WHERE auto_score = 'low' AND lead_score IS NOT NULL AND lead_score != 'low';
UPDATE leads SET post_created_at = posted_at WHERE post_created_at IS NULL AND posted_at IS NOT NULL;

-- Add unique index on source_url for upsert dedup from reddit-collector
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_source_url_unique ON leads(source_url) WHERE source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_auto_score ON leads(auto_score);
CREATE INDEX IF NOT EXISTS idx_leads_source_id ON leads(source_id);

-- Add anon access policy for company_leads so delete/CRUD works from dashboard
CREATE POLICY IF NOT EXISTS "Anon users can manage company_leads" ON company_leads
  FOR ALL USING (true) WITH CHECK (true);

-- Add anon read policy for tenders
CREATE POLICY IF NOT EXISTS "Anon users can read tenders" ON tenders
  FOR SELECT USING (true);

-- Add anon read policy for funded_startups
CREATE POLICY IF NOT EXISTS "Anon users can read funded_startups" ON funded_startups
  FOR SELECT USING (true);
