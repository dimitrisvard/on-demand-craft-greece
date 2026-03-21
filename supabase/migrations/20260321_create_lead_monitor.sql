-- ============================================================
-- Lead Monitor System Migration
-- Microns Hub — Reddit/Forum/Social Lead Monitoring System
-- ============================================================

-- Core leads table
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(20) NOT NULL, -- 'reddit', 'hackernews', 'twitter', 'forum'
  source_url TEXT NOT NULL UNIQUE, -- deduplicate by URL
  source_id TEXT, -- platform-specific post ID
  subreddit VARCHAR(100), -- e.g., 'r/AskEngineers', 'Show HN', etc.
  title TEXT NOT NULL,
  body TEXT,
  author VARCHAR(200),
  author_url TEXT,
  upvotes INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,

  -- Scoring
  auto_score VARCHAR(10) DEFAULT 'unscored', -- 'high', 'medium', 'low', 'noise'
  manual_score VARCHAR(10), -- manually overridden score
  matched_keywords TEXT[], -- array of matched keywords
  matched_categories TEXT[], -- ['sourcing_intent', 'competitor_complaints', etc.]

  -- Status workflow
  status VARCHAR(20) DEFAULT 'new', -- 'new', 'reviewed', 'contacted', 'saved', 'dismissed', 'converted'

  -- Response tracking
  suggested_response TEXT,
  response_sent_at TIMESTAMPTZ,
  response_platform VARCHAR(20),

  -- Notes
  notes TEXT,

  -- Timestamps
  post_created_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Industry tags
  industry_tags TEXT[]
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_auto_score ON public.leads(auto_score);
CREATE INDEX IF NOT EXISTS idx_leads_source ON public.leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_discovered ON public.leads(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_keywords ON public.leads USING GIN(matched_keywords);
CREATE INDEX IF NOT EXISTS idx_leads_industry_tags ON public.leads USING GIN(industry_tags);
CREATE INDEX IF NOT EXISTS idx_leads_post_created ON public.leads(post_created_at DESC);

-- Updated_at trigger
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage leads"
  ON public.leads
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- Monitored subreddits configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS public.monitored_subreddits (
  id SERIAL PRIMARY KEY,
  subreddit VARCHAR(100) NOT NULL UNIQUE,
  source VARCHAR(20) DEFAULT 'reddit',
  tier INTEGER DEFAULT 3, -- 1=highest priority, scan most frequently
  scan_interval_minutes INTEGER DEFAULT 30,
  industry_tags TEXT[],
  is_active BOOLEAN DEFAULT true,
  last_scanned_at TIMESTAMPTZ,
  last_post_id TEXT -- for pagination / dedup
);

ALTER TABLE public.monitored_subreddits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage subreddits"
  ON public.monitored_subreddits
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- Keywords configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lead_keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'sourcing_intent', 'competitor_mentions', etc.
  weight INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  match_count INTEGER DEFAULT 0 -- tracks how many times keyword was matched
);

ALTER TABLE public.lead_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage keywords"
  ON public.lead_keywords
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- Notification log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lead_notifications (
  id SERIAL PRIMARY KEY,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL, -- 'telegram', 'email', 'slack'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  message_id TEXT,
  status VARCHAR(20) DEFAULT 'sent'
);

ALTER TABLE public.lead_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view notifications"
  ON public.lead_notifications
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- Lead activity log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lead_activity (
  id SERIAL PRIMARY KEY,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL, -- 'status_changed', 'scored', 'note_added', 'response_drafted'
  old_value TEXT,
  new_value TEXT,
  performed_by VARCHAR(50) DEFAULT 'dashboard', -- 'dashboard', 'mcp', 'telegram', 'auto'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view activity"
  ON public.lead_activity
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- Seed: Subreddits
-- ============================================================
INSERT INTO public.monitored_subreddits (subreddit, tier, scan_interval_minutes, industry_tags) VALUES
-- Tier 1: Core Manufacturing & Engineering
('AskEngineers', 1, 15, ARRAY['engineering', 'manufacturing']),
('engineering', 1, 15, ARRAY['engineering']),
('MechanicalEngineering', 1, 15, ARRAY['engineering', 'manufacturing']),
('manufacturing', 1, 15, ARRAY['manufacturing']),
('machinists', 1, 15, ARRAY['manufacturing', 'cnc']),
('CNC', 1, 15, ARRAY['cnc', 'manufacturing']),
('metalworking', 1, 15, ARRAY['sheet_metal', 'manufacturing']),
('3Dprinting', 1, 15, ARRAY['3d_printing']),
('Fusion360', 1, 15, ARRAY['engineering', 'cad']),
('SolidWorks', 1, 15, ARRAY['engineering', 'cad']),
('CAD', 1, 15, ARRAY['engineering', 'cad']),
-- Tier 2: Industry-Specific
('aerospace', 2, 30, ARRAY['aerospace']),
('aviationmaintenance', 2, 30, ARRAY['aerospace']),
('SpaceXLounge', 2, 30, ARRAY['aerospace']),
('rocketry', 2, 30, ARRAY['aerospace']),
('automotive', 2, 30, ARRAY['automotive']),
('CarMods', 2, 30, ARRAY['automotive']),
('EngineBuilding', 2, 30, ARRAY['automotive']),
('medicaldevices', 2, 30, ARRAY['medical']),
('biotech', 2, 30, ARRAY['medical']),
('biomedicalengineering', 2, 30, ARRAY['medical']),
('robotics', 2, 30, ARRAY['robotics']),
('shittyrobots', 2, 30, ARRAY['robotics']),
('arduino', 2, 30, ARRAY['electronics']),
('electronics', 2, 30, ARRAY['electronics']),
('PrintedCircuitBoard', 2, 30, ARRAY['electronics']),
('RenewableEnergy', 2, 30, ARRAY['energy']),
('energy', 2, 30, ARRAY['energy']),
('electricvehicles', 2, 30, ARRAY['energy', 'automotive']),
('MarineEngineering', 2, 30, ARRAY['marine']),
('sailing', 2, 30, ARRAY['marine']),
-- Tier 3: Student & Competition
('FSAE', 3, 30, ARRAY['automotive', 'education']),
('FormulaStudent', 3, 30, ARRAY['automotive', 'education']),
('EngineeringStudents', 3, 30, ARRAY['engineering', 'education']),
('GradSchool', 3, 30, ARRAY['education']),
('labrats', 3, 30, ARRAY['medical', 'education']),
('AcademicPsychology', 3, 30, ARRAY['education']),
-- Tier 4: Hardware Startups & Makers
('hwstartups', 4, 60, ARRAY['manufacturing', 'startups']),
('Entrepreneur', 4, 60, ARRAY['startups']),
('startups', 4, 60, ARRAY['startups']),
('Maker', 4, 60, ARRAY['manufacturing']),
('functionalprint', 4, 60, ARRAY['3d_printing']),
('hobbycnc', 4, 60, ARRAY['cnc']),
('DIY', 4, 60, ARRAY['manufacturing']),
('Inventions', 4, 60, ARRAY['manufacturing', 'startups']),
('3dprintingdms', 4, 60, ARRAY['3d_printing']),
-- Tier 5: General & Overflow
('AskScience', 5, 120, ARRAY['engineering']),
('Futurology', 5, 120, ARRAY['manufacturing']),
('technology', 5, 120, ARRAY['manufacturing']),
('IndustrialDesign', 5, 120, ARRAY['manufacturing']),
('ProductDesign', 5, 120, ARRAY['manufacturing']),
('Welding', 5, 120, ARRAY['sheet_metal']),
('Machineporn', 5, 120, ARRAY['manufacturing'])
ON CONFLICT (subreddit) DO NOTHING;

-- ============================================================
-- Seed: Keywords
-- ============================================================
INSERT INTO public.lead_keywords (keyword, category, weight) VALUES
-- sourcing_intent
('looking for manufacturer', 'sourcing_intent', 3),
('need parts made', 'sourcing_intent', 3),
('need parts machined', 'sourcing_intent', 3),
('where can I get this machined', 'sourcing_intent', 3),
('CNC quote', 'sourcing_intent', 3),
('machining quote', 'sourcing_intent', 3),
('looking for CNC', 'sourcing_intent', 3),
('need a machine shop', 'sourcing_intent', 3),
('manufacturing partner', 'sourcing_intent', 3),
('custom parts supplier', 'sourcing_intent', 3),
('who can machine', 'sourcing_intent', 2),
('anyone know a good shop', 'sourcing_intent', 2),
('recommend a manufacturer', 'sourcing_intent', 2),
('need prototype made', 'sourcing_intent', 3),
('looking for prototyping service', 'sourcing_intent', 3),
('need sheet metal fabrication', 'sourcing_intent', 3),
('injection molding quote', 'sourcing_intent', 3),
('3D printing service', 'sourcing_intent', 2),
('SLS printing service', 'sourcing_intent', 3),
('MJF printing service', 'sourcing_intent', 3),
('metal 3D printing', 'sourcing_intent', 3),
('DMLS service', 'sourcing_intent', 3),
('vacuum casting service', 'sourcing_intent', 3),
('die casting quote', 'sourcing_intent', 3),
('rapid prototyping service', 'sourcing_intent', 3),
('on-demand manufacturing', 'sourcing_intent', 2),
-- competitor_mentions
('Xometry', 'competitor_mentions', 2),
('Protolabs', 'competitor_mentions', 2),
('Hubs.com', 'competitor_mentions', 2),
('Hubs manufacturing', 'competitor_mentions', 2),
('Sculpteo', 'competitor_mentions', 2),
('Fictiv', 'competitor_mentions', 2),
('Weerg', 'competitor_mentions', 2),
('PCBWay CNC', 'competitor_mentions', 2),
('JLCCNC', 'competitor_mentions', 2),
('RapidDirect', 'competitor_mentions', 2),
('Norck', 'competitor_mentions', 2),
('3D Hubs', 'competitor_mentions', 2),
-- competitor_complaints
('too expensive', 'competitor_complaints', 2),
('overpriced', 'competitor_complaints', 2),
('bad lead time', 'competitor_complaints', 2),
('late delivery', 'competitor_complaints', 2),
('quality issues', 'competitor_complaints', 2),
('poor quality', 'competitor_complaints', 2),
('terrible experience', 'competitor_complaints', 2),
('looking for alternative', 'competitor_complaints', 3),
('cheaper alternative', 'competitor_complaints', 3),
('better option', 'competitor_complaints', 2),
('switched from', 'competitor_complaints', 2),
('disappointed with', 'competitor_complaints', 2),
-- material_specific
('aluminum machining', 'material_specific', 2),
('titanium machining', 'material_specific', 2),
('stainless steel parts', 'material_specific', 2),
('brass parts', 'material_specific', 2),
('copper machining', 'material_specific', 2),
('PEEK machining', 'material_specific', 3),
('Delrin machining', 'material_specific', 2),
('Inconel machining', 'material_specific', 3),
('nylon SLS', 'material_specific', 3),
('PA12 printing', 'material_specific', 3),
('7075 aluminum', 'material_specific', 2),
('6061 aluminum', 'material_specific', 2),
('316L stainless', 'material_specific', 2),
-- competition_teams
('Formula Student', 'competition_teams', 3),
('Formula SAE', 'competition_teams', 3),
('FSAE', 'competition_teams', 3),
('Formula Electric', 'competition_teams', 3),
('Baja SAE', 'competition_teams', 2),
('Shell Eco-Marathon', 'competition_teams', 2),
('EUROBOT', 'competition_teams', 3),
('RoboCup', 'competition_teams', 2),
('European Rover Challenge', 'competition_teams', 3),
('CANSAT', 'competition_teams', 2),
('student team sponsor', 'competition_teams', 3),
('competition parts', 'competition_teams', 2),
-- geographic_europe
('Europe', 'geographic_europe', 1),
(' EU ', 'geographic_europe', 1),
('Germany', 'geographic_europe', 1),
('France', 'geographic_europe', 1),
('Netherlands', 'geographic_europe', 1),
('Italy', 'geographic_europe', 1),
('Spain', 'geographic_europe', 1),
('Poland', 'geographic_europe', 1),
('Belgium', 'geographic_europe', 1),
('Austria', 'geographic_europe', 1),
('Sweden', 'geographic_europe', 1),
('Switzerland', 'geographic_europe', 1),
('Greece', 'geographic_europe', 1),
('European manufacturer', 'geographic_europe', 2),
('EU based', 'geographic_europe', 2),
('ship to Europe', 'geographic_europe', 2)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Helper function: increment keyword match count
-- ============================================================
CREATE OR REPLACE FUNCTION increment_keyword_match_count(p_keyword TEXT, p_count INTEGER DEFAULT 1)
RETURNS VOID AS $$
BEGIN
  UPDATE public.lead_keywords
  SET match_count = match_count + p_count
  WHERE keyword = p_keyword AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
