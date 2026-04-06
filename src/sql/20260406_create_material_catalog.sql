-- ============================================================================
-- Material Catalog System — Supabase Migration
-- Industrial raw material catalog with categories, documents, and audit trail
-- ============================================================================

-- ─── ENUMS ─────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE catalog_form_factor AS ENUM (
    'sheet', 'round_bar', 'square_bar', 'hex_bar', 'flat_bar',
    'angle', 'tube_welded', 'tube_seamless', 'fitting',
    'welding_consumable', 'wire', 'special_section'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE catalog_stock_unit AS ENUM ('kg', 'm', 'pcs', 'sheet');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE catalog_doc_type AS ENUM (
    'spec_sheet', 'dimension_table', 'mill_cert', 'safety_data', 'brochure', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE stock_change_type AS ENUM (
    'receive', 'consume', 'adjust_up', 'adjust_down', 'scrap', 'return', 'transfer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ─── MATERIAL CATEGORIES ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS material_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  name          text NOT NULL,                    -- "Sheets & Plates"
  slug          text NOT NULL,                    -- "sheets-plates"
  description   text,
  icon          text DEFAULT 'Layers',            -- Lucide icon name
  image_url     text,                             -- Hero image for category page
  form_factor   catalog_form_factor NOT NULL,
  sort_order    int DEFAULT 0,
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),

  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_mat_cat_tenant_sort
  ON material_categories (tenant_id, sort_order) WHERE is_active = true;


-- ─── CATALOG MATERIALS ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_materials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  category_id     uuid NOT NULL REFERENCES material_categories(id) ON DELETE CASCADE,

  -- Identity
  name            text NOT NULL,                  -- "Stainless Steel Round Bar AISI 304"
  material_grade  text NOT NULL,                  -- "AISI 304", "Al 6061-T6", "St37"
  form_factor     catalog_form_factor NOT NULL,

  -- Dimensions (flexible JSONB for different forms)
  -- Sheets:  {thickness_mm, width_mm, length_mm}
  -- Tubes:   {outer_diameter_mm, wall_thickness_mm, length_mm}
  -- Bars:    {diameter_mm, length_mm}
  -- Squares: {side_mm, length_mm}
  -- Hex:     {across_flats_mm, length_mm}
  -- Flat:    {thickness_mm, width_mm, length_mm}
  -- Angle:   {leg_a_mm, leg_b_mm, thickness_mm, length_mm}
  dimensions      jsonb NOT NULL DEFAULT '{}',

  -- Specs
  surface_finish  text,                           -- "2B", "BA", "#4 Satin", "Mill finish"
  standard        text,                           -- "DIN EN 10088", "ASTM A240"
  certification   text,                           -- "EN 10204 3.1", "Mill cert"
  weight_per_unit numeric(12,4),                  -- kg per stock_unit

  -- Stock
  stock_quantity    numeric(12,2) DEFAULT 0,
  stock_unit        catalog_stock_unit NOT NULL DEFAULT 'pcs',
  min_stock_alert   numeric(12,2) DEFAULT 0,      -- Low stock threshold
  location          text,                         -- Warehouse bin / rack

  -- Pricing
  price_per_unit    numeric(12,4),                -- Cost price from supplier
  currency          text DEFAULT 'EUR',
  supplier          text,
  supplier_sku      text,

  -- Flags
  is_available      boolean DEFAULT true,
  cut_to_size       boolean DEFAULT false,

  -- Meta
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),

  -- Constraints
  CONSTRAINT chk_stock_qty CHECK (stock_quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cat_mat_tenant_cat
  ON catalog_materials (tenant_id, category_id) WHERE is_available = true;

CREATE INDEX IF NOT EXISTS idx_cat_mat_grade
  ON catalog_materials (tenant_id, material_grade);

CREATE INDEX IF NOT EXISTS idx_cat_mat_form
  ON catalog_materials (tenant_id, form_factor);


-- ─── MATERIAL DOCUMENTS ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS material_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  material_id     uuid REFERENCES catalog_materials(id) ON DELETE CASCADE,
  category_id     uuid REFERENCES material_categories(id) ON DELETE CASCADE,
  doc_type        catalog_doc_type NOT NULL DEFAULT 'other',
  title           text NOT NULL,
  file_url        text NOT NULL,                  -- Supabase Storage URL
  file_size_bytes bigint,
  mime_type       text DEFAULT 'application/pdf',
  uploaded_by     uuid,
  created_at      timestamptz DEFAULT now(),

  -- Must be linked to at least material or category
  CONSTRAINT chk_doc_link CHECK (material_id IS NOT NULL OR category_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_mat_doc_material ON material_documents (material_id);
CREATE INDEX IF NOT EXISTS idx_mat_doc_category ON material_documents (category_id);


-- ─── STOCK ADJUSTMENT LOG ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_stock_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  material_id     uuid NOT NULL REFERENCES catalog_materials(id) ON DELETE CASCADE,
  change_type     stock_change_type NOT NULL,
  quantity_before numeric(12,2) NOT NULL,
  quantity_change numeric(12,2) NOT NULL,
  quantity_after  numeric(12,2) NOT NULL,
  reason          text,
  performed_by    uuid,                           -- auth.uid()
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_log_material
  ON catalog_stock_log (material_id, created_at DESC);


-- ─── AUTO-UPDATE TIMESTAMPS ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_catalog_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cat_mat_updated ON catalog_materials;
CREATE TRIGGER trg_cat_mat_updated
  BEFORE UPDATE ON catalog_materials
  FOR EACH ROW EXECUTE FUNCTION update_catalog_updated_at();

DROP TRIGGER IF EXISTS trg_mat_cat_updated ON material_categories;
CREATE TRIGGER trg_mat_cat_updated
  BEFORE UPDATE ON material_categories
  FOR EACH ROW EXECUTE FUNCTION update_catalog_updated_at();


-- ─── RLS POLICIES ──────────────────────────────────────────────────────────

ALTER TABLE material_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_stock_log ENABLE ROW LEVEL SECURITY;

-- Read access: authenticated users can read their tenant's data
CREATE POLICY "Users can read own tenant categories"
  ON material_categories FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Users can read own tenant catalog materials"
  ON catalog_materials FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Users can read own tenant documents"
  ON material_documents FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Users can read own tenant stock log"
  ON catalog_stock_log FOR SELECT
  USING (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Write access: admin users (via service role or role check)
-- For now, allow all authenticated users to insert/update/delete their tenant data
CREATE POLICY "Auth users can manage categories"
  ON material_categories FOR ALL
  USING (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Auth users can manage catalog materials"
  ON catalog_materials FOR ALL
  USING (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Auth users can manage documents"
  ON material_documents FOR ALL
  USING (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Auth users can manage stock log"
  ON catalog_stock_log FOR ALL
  USING (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid);
