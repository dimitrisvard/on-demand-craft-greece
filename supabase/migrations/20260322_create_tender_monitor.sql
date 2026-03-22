-- ─────────────────────────────────────────────────────────────
-- NATIONAL TENDER MONITOR — Database Schema
-- Microns Hub procurement monitoring across 26 EU/EEA countries
-- ─────────────────────────────────────────────────────────────

-- Main tenders table
CREATE TABLE IF NOT EXISTS tenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identification
  country_code VARCHAR(2) NOT NULL,
  country_name TEXT NOT NULL,
  portal_name TEXT NOT NULL,
  portal_url TEXT,
  tender_reference TEXT,

  -- Tender content
  title TEXT NOT NULL,
  description TEXT,
  buyer_name TEXT,
  buyer_type TEXT,

  -- Classification
  cpv_codes TEXT[],
  cpv_descriptions TEXT[],
  nature_of_contract TEXT,

  -- Financials
  estimated_value_eur DECIMAL,
  estimated_value_original DECIMAL,
  currency VARCHAR(3) DEFAULT 'EUR',

  -- Dates
  publication_date DATE,
  submission_deadline TIMESTAMPTZ,

  -- Location
  place_of_performance TEXT,
  nuts_code TEXT,
  latitude DECIMAL,
  longitude DECIMAL,

  -- Procedure
  procedure_type TEXT,

  -- Relevance scoring
  relevance_score INTEGER DEFAULT 0,
  matched_keywords TEXT[],
  matched_cpv TEXT[],
  is_relevant BOOLEAN DEFAULT false,

  -- Status tracking
  status VARCHAR(20) DEFAULT 'new',
  notes TEXT,

  -- Language
  original_language VARCHAR(5),

  -- Metadata
  raw_data JSONB,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(country_code, tender_reference)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenders_country ON tenders(country_code);
CREATE INDEX IF NOT EXISTS idx_tenders_deadline ON tenders(submission_deadline);
CREATE INDEX IF NOT EXISTS idx_tenders_relevant ON tenders(is_relevant);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
CREATE INDEX IF NOT EXISTS idx_tenders_score ON tenders(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_tenders_cpv ON tenders USING GIN(cpv_codes);
CREATE INDEX IF NOT EXISTS idx_tenders_value ON tenders(estimated_value_eur);
CREATE INDEX IF NOT EXISTS idx_tenders_discovered ON tenders(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenders_keywords ON tenders USING GIN(matched_keywords);

-- Country connector configuration
CREATE TABLE IF NOT EXISTS tender_connectors (
  id SERIAL PRIMARY KEY,
  country_code VARCHAR(2) NOT NULL UNIQUE,
  country_name TEXT NOT NULL,
  portal_name TEXT NOT NULL,
  portal_base_url TEXT NOT NULL,
  access_method VARCHAR(20) NOT NULL,
  scan_frequency_hours INTEGER DEFAULT 24,
  is_active BOOLEAN DEFAULT true,
  requires_auth BOOLEAN DEFAULT false,
  auth_config JSONB,
  last_scan_at TIMESTAMPTZ,
  last_scan_count INTEGER,
  last_error TEXT,
  notes TEXT,
  map_lat DECIMAL NOT NULL,
  map_lng DECIMAL NOT NULL
);

-- Scan history
CREATE TABLE IF NOT EXISTS tender_scan_logs (
  id SERIAL PRIMARY KEY,
  country_code VARCHAR(2) NOT NULL,
  tenders_found INTEGER DEFAULT 0,
  tenders_new INTEGER DEFAULT 0,
  tenders_relevant INTEGER DEFAULT 0,
  errors TEXT[],
  duration_ms INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- auto-updated timestamp trigger
CREATE OR REPLACE FUNCTION update_tenders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenders_updated_at_trigger ON tenders;
CREATE TRIGGER tenders_updated_at_trigger
  BEFORE UPDATE ON tenders
  FOR EACH ROW EXECUTE FUNCTION update_tenders_updated_at();

-- RLS
ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_scan_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage tenders"
  ON tenders FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can read connector config"
  ON tender_connectors FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can read scan logs"
  ON tender_scan_logs FOR SELECT USING (auth.role() = 'authenticated');

-- Seed connector config (26 countries)
INSERT INTO tender_connectors (country_code, country_name, portal_name, portal_base_url, access_method, scan_frequency_hours, map_lat, map_lng, notes) VALUES
  ('NL', 'Netherlands',   'TenderNed',                    'https://www.tenderned.nl',               'api',       12, 52.3676,  4.9041,  'OCDS API available'),
  ('IE', 'Ireland',       'eTenders',                     'https://etenders.gov.ie',                'rss',       12, 53.3498, -6.2603,  'English language, RSS feeds'),
  ('FR', 'France',        'BOAMP',                        'https://www.boamp.fr',                   'open_data', 12, 48.8566,  2.3522,  'Open data on data.gouv.fr'),
  ('DE', 'Germany',       'e-Vergabe / service.bund.de',  'https://www.evergabe-online.de',         'scrape',    12, 52.5200, 13.4050,  'Largest EU market, multiple portals'),
  ('IT', 'Italy',         'ANAC / Servizio Contratti',    'https://dati.anticorruzione.it',         'api',       24, 41.9028, 12.4964,  'ANAC open data, OCDS'),
  ('ES', 'Spain',         'Plataforma de Contratación',   'https://contrataciondelestado.es',       'rss',       12, 40.4168, -3.7038,  'RSS feeds available'),
  ('PL', 'Poland',        'BZP',                          'https://bzp.uzp.gov.pl',                 'open_data', 24, 52.2297, 21.0122,  'Massive volume, open data exports'),
  ('BE', 'Belgium',       'e-Procurement',                'https://eten.publicprocurement.be',      'scrape',    24, 50.8503,  4.3517,  'Three linguistic communities'),
  ('SE', 'Sweden',        'Kommers Annons',               'https://www.kommersannons.se',           'scrape',    24, 59.3293, 18.0686,  NULL),
  ('AT', 'Austria',       'Auftrag.at',                   'https://www.auftrag.at',                 'rss',       24, 48.2082, 16.3738,  'RSS feeds, same German keywords as DE'),
  ('DK', 'Denmark',       'Udbud.dk',                     'https://www.udbud.dk',                   'scrape',    24, 55.6761, 12.5683,  NULL),
  ('FI', 'Finland',       'Hilma',                        'https://www.hilma.fi',                   'api',       24, 60.1699, 24.9384,  'Well-digitized portal'),
  ('PT', 'Portugal',      'BASE',                         'https://www.base.gov.pt',                'api',       24, 38.7223, -9.1393,  'Open data API, English interface'),
  ('RO', 'Romania',       'SEAP/SICAP',                   'https://www.e-licitatie.ro',             'api',       24, 44.4268, 26.1025,  'API available'),
  ('EE', 'Estonia',       'Riigihangete register',        'https://riigihanked.riik.ee',            'api',       24, 59.4370, 24.7536,  'Well-digitized, API'),
  ('NO', 'Norway',        'Doffin',                       'https://www.doffin.no',                  'rss',       24, 59.9139, 10.7522,  'EEA member, English partially'),
  ('CZ', 'Czechia',       'Věstník veřejných zakázek',    'https://www.portal-vz.cz',              'open_data', 24, 50.0755, 14.4378,  NULL),
  ('HU', 'Hungary',       'Közbeszerzési Hatóság',        'https://www.kozbeszerzes.hu',            'scrape',    24, 47.4979, 19.0402,  'English interface available'),
  ('HR', 'Croatia',       'EOJN',                         'https://eojn.nn.hr',                     'scrape',    24, 45.8150, 15.9819,  NULL),
  ('SK', 'Slovakia',      'ÚVO',                          'https://www.uvo.gov.sk',                 'open_data', 24, 48.1486, 17.1077,  NULL),
  ('SI', 'Slovenia',      'e-JN',                         'https://www.ejn.gov.si',                 'scrape',    24, 46.0569, 14.5058,  'English interface available'),
  ('BG', 'Bulgaria',      'AOP',                          'https://www.aop.bg',                     'scrape',    24, 42.6977, 23.3219,  'English available'),
  ('LT', 'Lithuania',     'CVP IS',                       'https://cvpp.eviesiejipirkimai.lt',      'scrape',    24, 54.6872, 25.2797,  NULL),
  ('LV', 'Latvia',        'IUB / EIS',                    'https://iub.gov.lv',                     'scrape',    24, 56.9496, 24.1052,  NULL),
  ('CY', 'Cyprus',        'eProcurement',                 'https://eprocurement.gov.cy',            'scrape',    24, 35.1856, 33.3823,  'Greek/English'),
  ('LU', 'Luxembourg',    'Marchés Publics',              'https://marches.public.lu',              'scrape',    24, 49.6116,  6.1319,  'French'),
  ('MT', 'Malta',         'Department of Contracts',      'https://contracts.gov.mt',               'scrape',    24, 35.8989, 14.5146,  'English language advantage')
ON CONFLICT (country_code) DO NOTHING;
