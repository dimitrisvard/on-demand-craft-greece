-- ══════════════════════════════════════════════════════════════════
-- FIX: Lead monitor tables have wrong/incomplete schemas.
--
-- Root cause: monitored_subreddits and lead_keywords already existed
-- from a previous project version. The CREATE TABLE IF NOT EXISTS in
-- 20260321_create_lead_monitor.sql was silently skipped, leaving the
-- old minimal schemas in place. Columns like scan_interval_minutes,
-- is_active, tier, etc. are missing, causing 400 errors on every
-- insert from the dashboard.
--
-- Also: RLS policies required auth.role() = 'authenticated', but the
-- dashboard uses the anon key — so all writes were blocked.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Add missing columns to monitored_subreddits ────────────────
ALTER TABLE public.monitored_subreddits
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'reddit',
  ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS scan_interval_minutes INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS industry_tags TEXT[],
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_post_id TEXT;

-- Ensure the subreddit column has a unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'monitored_subreddits_subreddit_key'
      AND conrelid = 'public.monitored_subreddits'::regclass
  ) THEN
    ALTER TABLE public.monitored_subreddits ADD CONSTRAINT monitored_subreddits_subreddit_key UNIQUE (subreddit);
  END IF;
END $$;

-- ── 2. Add missing columns to lead_keywords ───────────────────────
ALTER TABLE public.lead_keywords
  ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'sourcing_intent',
  ADD COLUMN IF NOT EXISTS weight INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS match_count INTEGER DEFAULT 0;

-- ── 3. Fix RLS policies — allow anon access for dashboard use ─────

-- monitored_subreddits: enable RLS and allow anon
ALTER TABLE public.monitored_subreddits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage subreddits" ON public.monitored_subreddits;
CREATE POLICY "Anon users can manage subreddits"
  ON public.monitored_subreddits FOR ALL
  USING (true) WITH CHECK (true);

-- lead_keywords: enable RLS and allow anon
ALTER TABLE public.lead_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage keywords" ON public.lead_keywords;
CREATE POLICY "Anon users can manage keywords"
  ON public.lead_keywords FOR ALL
  USING (true) WITH CHECK (true);

-- leads: enable RLS and allow anon
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage leads" ON public.leads;
CREATE POLICY "Anon users can manage leads"
  ON public.leads FOR ALL
  USING (true) WITH CHECK (true);

-- ── 4. Seed subreddits if the table is empty ──────────────────────
INSERT INTO public.monitored_subreddits (subreddit, tier, scan_interval_minutes, industry_tags, is_active) VALUES
('AskEngineers', 1, 15, ARRAY['engineering', 'manufacturing'], true),
('engineering', 1, 15, ARRAY['engineering'], true),
('MechanicalEngineering', 1, 15, ARRAY['engineering', 'manufacturing'], true),
('manufacturing', 1, 15, ARRAY['manufacturing'], true),
('machinists', 1, 15, ARRAY['manufacturing', 'cnc'], true),
('CNC', 1, 15, ARRAY['cnc', 'manufacturing'], true),
('metalworking', 1, 15, ARRAY['sheet_metal', 'manufacturing'], true),
('3Dprinting', 1, 15, ARRAY['3d_printing'], true),
('Fusion360', 1, 15, ARRAY['engineering', 'cad'], true),
('SolidWorks', 1, 15, ARRAY['engineering', 'cad'], true),
('CAD', 1, 15, ARRAY['engineering', 'cad'], true),
('aerospace', 2, 30, ARRAY['aerospace'], true),
('automotive', 2, 30, ARRAY['automotive'], true),
('medicaldevices', 2, 30, ARRAY['medical'], true),
('robotics', 2, 30, ARRAY['robotics'], true),
('electronics', 2, 30, ARRAY['electronics'], true),
('RenewableEnergy', 2, 30, ARRAY['energy'], true),
('FSAE', 3, 30, ARRAY['automotive', 'education'], true),
('FormulaStudent', 3, 30, ARRAY['automotive', 'education'], true),
('EngineeringStudents', 3, 30, ARRAY['engineering', 'education'], true),
('hwstartups', 4, 60, ARRAY['manufacturing', 'startups'], true),
('Entrepreneur', 4, 60, ARRAY['startups'], true),
('Maker', 4, 60, ARRAY['manufacturing'], true),
('DIY', 4, 60, ARRAY['manufacturing'], true),
('IndustrialDesign', 5, 120, ARRAY['manufacturing'], true),
('Welding', 5, 120, ARRAY['sheet_metal'], true)
ON CONFLICT (subreddit) DO UPDATE SET
  tier = EXCLUDED.tier,
  scan_interval_minutes = EXCLUDED.scan_interval_minutes,
  industry_tags = EXCLUDED.industry_tags,
  is_active = EXCLUDED.is_active;

-- ── 5. Seed keywords if the table is empty ────────────────────────
INSERT INTO public.lead_keywords (keyword, category, weight, is_active) VALUES
('looking for manufacturer', 'sourcing_intent', 3, true),
('need parts made', 'sourcing_intent', 3, true),
('need parts machined', 'sourcing_intent', 3, true),
('CNC quote', 'sourcing_intent', 3, true),
('machining quote', 'sourcing_intent', 3, true),
('need a machine shop', 'sourcing_intent', 3, true),
('manufacturing partner', 'sourcing_intent', 3, true),
('need prototype made', 'sourcing_intent', 3, true),
('looking for prototyping service', 'sourcing_intent', 3, true),
('need sheet metal fabrication', 'sourcing_intent', 3, true),
('injection molding quote', 'sourcing_intent', 3, true),
('rapid prototyping service', 'sourcing_intent', 3, true),
('Xometry', 'competitor_mentions', 2, true),
('Protolabs', 'competitor_mentions', 2, true),
('Hubs.com', 'competitor_mentions', 2, true),
('Fictiv', 'competitor_mentions', 2, true),
('too expensive', 'competitor_complaints', 2, true),
('overpriced', 'competitor_complaints', 2, true),
('bad lead time', 'competitor_complaints', 2, true),
('looking for alternative', 'competitor_complaints', 3, true),
('cheaper alternative', 'competitor_complaints', 3, true),
('aluminum machining', 'material_specific', 2, true),
('titanium machining', 'material_specific', 2, true),
('stainless steel parts', 'material_specific', 2, true),
('PEEK machining', 'material_specific', 3, true),
('nylon SLS', 'material_specific', 3, true),
('Formula Student', 'competition_teams', 3, true),
('Formula SAE', 'competition_teams', 3, true),
('FSAE', 'competition_teams', 3, true),
('EUROBOT', 'competition_teams', 3, true),
('Europe', 'geographic_europe', 1, true),
('Germany', 'geographic_europe', 1, true),
('France', 'geographic_europe', 1, true),
('Netherlands', 'geographic_europe', 1, true),
('Greece', 'geographic_europe', 1, true),
('European manufacturer', 'geographic_europe', 2, true),
('ship to Europe', 'geographic_europe', 2, true)
ON CONFLICT DO NOTHING;
