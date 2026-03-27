-- ══════════════════════════════════════════════════════════════════
-- FIX: Leads table has column mismatches causing every upsert to fail silently.
--
-- Root cause 1: external_id is NOT NULL but the collector never provides it.
-- Root cause 2: onConflict uses source_url but only constraint is (source, external_id).
-- Root cause 3: Keywords are all multi-word phrases that never match real posts.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Fix external_id: make it nullable ─────────────────────────
ALTER TABLE public.leads ALTER COLUMN external_id DROP NOT NULL;

-- ── 2. Add a proper UNIQUE constraint on source_url for upsert ──
DROP INDEX IF EXISTS idx_leads_source_url_unique;
ALTER TABLE public.leads ADD CONSTRAINT leads_source_url_key UNIQUE (source_url);

-- ── 3. Add broad single-word keywords that actually match real posts ──
INSERT INTO public.lead_keywords (keyword, category, weight, is_active) VALUES
('CNC', 'industry_specific', 1, true),
('machining', 'industry_specific', 1, true),
('lathe', 'industry_specific', 1, true),
('milling', 'industry_specific', 1, true),
('turning', 'industry_specific', 1, true),
('grinding', 'industry_specific', 1, true),
('fabrication', 'industry_specific', 1, true),
('prototype', 'industry_specific', 1, true),
('prototyping', 'industry_specific', 1, true),
('manufacturer', 'industry_specific', 1, true),
('manufacturers', 'industry_specific', 1, true),
('tolerances', 'industry_specific', 1, true),
('anodizing', 'material_specific', 1, true),
('powder coating', 'material_specific', 1, true),
('stainless steel', 'material_specific', 1, true),
('aluminum', 'material_specific', 1, true),
('aluminium', 'material_specific', 1, true),
('titanium', 'material_specific', 1, true),
('brass', 'material_specific', 1, true),
('carbon fiber', 'material_specific', 1, true),
('carbon fibre', 'material_specific', 1, true),
('3D printing', 'industry_specific', 1, true),
('3d print', 'industry_specific', 1, true),
('SLA print', 'industry_specific', 1, true),
('SLS print', 'industry_specific', 1, true),
('injection mold', 'industry_specific', 1, true),
('sheet metal', 'industry_specific', 1, true),
('waterjet', 'industry_specific', 1, true),
('laser cut', 'industry_specific', 1, true),
('laser cutting', 'industry_specific', 1, true),
('plasma cutting', 'industry_specific', 1, true),
('EDM', 'industry_specific', 1, true),
('wire EDM', 'industry_specific', 1, true),
('need machined', 'sourcing_intent', 2, true),
('get machined', 'sourcing_intent', 2, true),
('get manufactured', 'sourcing_intent', 2, true),
('custom parts', 'sourcing_intent', 2, true),
('custom part', 'sourcing_intent', 2, true),
('parts made', 'sourcing_intent', 2, true),
('get quoted', 'sourcing_intent', 2, true),
('get a quote', 'sourcing_intent', 2, true),
('machine shop', 'sourcing_intent', 2, true),
('job shop', 'sourcing_intent', 2, true),
('outsource', 'sourcing_intent', 2, true),
('small batch', 'sourcing_intent', 2, true),
('low volume', 'sourcing_intent', 2, true),
('one-off', 'sourcing_intent', 2, true),
('one off', 'sourcing_intent', 2, true),
('looking for a shop', 'sourcing_intent', 3, true),
('recommend a shop', 'sourcing_intent', 3, true),
('any recommendations', 'sourcing_intent', 1, true),
('where can I get', 'sourcing_intent', 2, true),
('who can make', 'sourcing_intent', 3, true),
('help me source', 'sourcing_intent', 3, true),
('source parts', 'sourcing_intent', 3, true),
('in Europe', 'geographic_europe', 2, true),
('in the EU', 'geographic_europe', 2, true),
('in the UK', 'geographic_europe', 1, true),
('EU based', 'geographic_europe', 2, true),
('based in Europe', 'geographic_europe', 2, true)
ON CONFLICT DO NOTHING;
