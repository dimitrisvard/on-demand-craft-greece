-- ============================================================================
-- Inventory & Material Management System for Microns Hub
-- Migration: 20260401_create_inventory_system
-- ============================================================================

-- ─── Custom ENUM types ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE stock_status AS ENUM ('available', 'reserved', 'in_use', 'depleted', 'scrapped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE stock_origin AS ENUM ('purchased', 'remnant', 'returned', 'transferred');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM ('draft', 'ready', 'cutting', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM (
    'receive', 'consume', 'remnant_create', 'remnant_consume',
    'scrap', 'adjust', 'reserve', 'unreserve', 'transfer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Table: materials ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

  -- Identity
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'sheet_metal', 'billet', 'rod', 'tube',
    'filament', 'resin', 'powder', 'other'
  )),
  grade TEXT,
  thickness_mm NUMERIC(6,2),

  -- Units & measurement
  base_unit TEXT NOT NULL CHECK (base_unit IN ('m2', 'kg', 'L', 'm', 'pcs')),
  density_kg_per_m3 NUMERIC(10,2),

  -- Cost
  cost_per_unit NUMERIC(10,4),
  currency TEXT DEFAULT 'EUR',
  supplier TEXT,
  supplier_sku TEXT,
  lead_time_days INTEGER,

  -- Thresholds
  low_stock_threshold NUMERIC(10,2),
  reorder_quantity NUMERIC(10,2),
  min_remnant_area_mm2 NUMERIC(10,0) DEFAULT 40000,

  -- Scrap factor
  kerf_scrap_factor NUMERIC(4,3) DEFAULT 1.15,

  -- Metadata
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_tenant_cat
  ON materials(tenant_id, category, is_active);
CREATE INDEX IF NOT EXISTS idx_materials_sheet_lookup
  ON materials(tenant_id, name, thickness_mm) WHERE category = 'sheet_metal';

-- ─── Table: stock_items ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  material_id UUID NOT NULL REFERENCES materials(id),

  -- Identity
  sku TEXT,
  batch_number TEXT,
  origin stock_origin DEFAULT 'purchased',
  parent_stock_id UUID REFERENCES stock_items(id),

  -- Dimensions (for sheet metal)
  width_mm NUMERIC(8,2),
  height_mm NUMERIC(8,2),

  -- Quantity (for non-sheet materials)
  quantity NUMERIC(10,3) DEFAULT 1,
  remaining_quantity NUMERIC(10,3),

  -- For sheet metal: area tracking
  total_area_mm2 NUMERIC(12,2),
  used_area_mm2 NUMERIC(12,2) DEFAULT 0,
  remaining_area_mm2 NUMERIC(12,2),

  -- Remnant shape info
  remnant_shape TEXT CHECK (remnant_shape IS NULL OR remnant_shape IN ('rectangle', 'L_shape', 'irregular')),
  remnant_polygon JSONB,

  -- Location
  location TEXT,

  -- QR tracking
  qr_code TEXT UNIQUE,
  qr_label_url TEXT,

  -- Status
  status stock_status DEFAULT 'available',

  -- Cost
  purchase_cost NUMERIC(10,2),
  cost_per_mm2 NUMERIC(12,8),

  -- Dates
  received_date DATE,
  expiry_date DATE,
  depleted_date TIMESTAMPTZ,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_available
  ON stock_items(tenant_id, material_id, status) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_stock_remnants
  ON stock_items(tenant_id, material_id, origin, status)
  WHERE origin = 'remnant' AND status = 'available';
CREATE INDEX IF NOT EXISTS idx_stock_qr ON stock_items(qr_code);

-- ─── Trigger: auto-calculate remaining area ─────────────────────────────────

CREATE OR REPLACE FUNCTION update_remaining_area()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.total_area_mm2 IS NOT NULL THEN
    NEW.remaining_area_mm2 := NEW.total_area_mm2 - COALESCE(NEW.used_area_mm2, 0);
  END IF;
  IF NEW.remaining_quantity IS NULL AND NEW.quantity IS NOT NULL THEN
    NEW.remaining_quantity := NEW.quantity;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_remaining ON stock_items;
CREATE TRIGGER trg_stock_remaining
  BEFORE INSERT OR UPDATE ON stock_items
  FOR EACH ROW EXECUTE FUNCTION update_remaining_area();

-- ─── Table: nesting_sessions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nesting_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

  material_id UUID NOT NULL REFERENCES materials(id),

  session_date DATE DEFAULT CURRENT_DATE,
  batch_name TEXT,

  -- Nesting results
  nesting_result JSONB,
  total_part_area_mm2 NUMERIC(12,2),
  total_sheets_needed INTEGER,
  avg_utilization NUMERIC(5,2),

  -- Operator input
  actual_sheets_used INTEGER,
  actual_utilization NUMERIC(5,2),
  operator_notes TEXT,
  completed_by TEXT,

  -- Status
  status session_status DEFAULT 'draft',

  -- Previews
  preview_urls JSONB,
  nested_dxf_urls JSONB,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_date
  ON nesting_sessions(tenant_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_material
  ON nesting_sessions(tenant_id, material_id, status);

-- ─── Table: nesting_session_jobs ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nesting_session_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  session_id UUID NOT NULL REFERENCES nesting_sessions(id) ON DELETE CASCADE,
  order_id UUID NOT NULL,
  order_item_id UUID,

  part_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  part_area_mm2 NUMERIC(10,2),
  total_area_mm2 NUMERIC(12,2),
  dxf_file_url TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_jobs ON nesting_session_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_session_jobs_order ON nesting_session_jobs(order_id);

-- ─── Table: nesting_session_sheets ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nesting_session_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  session_id UUID NOT NULL REFERENCES nesting_sessions(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),

  sheet_index INTEGER NOT NULL,
  area_consumed_mm2 NUMERIC(12,2) NOT NULL,
  utilization NUMERIC(5,2),

  leftover_action TEXT CHECK (leftover_action IN (
    'remnant_created', 'scrapped', 'fully_consumed', 'pending'
  )),
  remnant_stock_id UUID REFERENCES stock_items(id),
  scrap_weight_kg NUMERIC(6,2),

  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Table: stock_transactions ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),

  type transaction_type NOT NULL,

  quantity_change NUMERIC(10,3),
  area_change_mm2 NUMERIC(12,2),

  nesting_session_id UUID REFERENCES nesting_sessions(id),
  order_id UUID,

  reason TEXT,
  performed_by TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_stock
  ON stock_transactions(stock_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant
  ON stock_transactions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_session
  ON stock_transactions(nesting_session_id);

-- ─── Table: low_stock_alerts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS low_stock_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  material_id UUID NOT NULL REFERENCES materials(id),

  current_stock NUMERIC(10,2),
  threshold NUMERIC(10,2),
  base_unit TEXT,

  alert_sent BOOLEAN DEFAULT false,
  alert_sent_at TIMESTAMPTZ,
  alert_channel TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Table: inventory_settings (per-tenant automation config) ───────────────

CREATE TABLE IF NOT EXISTS inventory_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,

  automation_level TEXT NOT NULL DEFAULT 'manual' CHECK (automation_level IN ('manual', 'semi_automatic', 'full_automatic')),
  auto_batch_time TIME DEFAULT '17:00:00',
  timezone TEXT DEFAULT 'Europe/Athens',
  default_sheet_width_mm NUMERIC(8,2) DEFAULT 2000,
  default_sheet_height_mm NUMERIC(8,2) DEFAULT 1000,
  auto_scrap_threshold_utilization NUMERIC(5,2) DEFAULT 95.00,
  max_remnant_depth INTEGER DEFAULT 3,

  telegram_chat_id TEXT,
  telegram_bot_token TEXT,
  send_telegram_alerts BOOLEAN DEFAULT true,
  send_email_alerts BOOLEAN DEFAULT true,
  alert_email TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── RLS Policies ───────────────────────────────────────────────────────────

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE nesting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nesting_session_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nesting_session_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE low_stock_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_settings ENABLE ROW LEVEL SECURITY;

-- For now, allow authenticated users full access (single-tenant mode).
-- When multi-tenancy is fully implemented, replace with JWT tenant_id checks.

DO $$ BEGIN
  -- materials
  CREATE POLICY "materials_select" ON materials FOR SELECT TO authenticated USING (true);
  CREATE POLICY "materials_insert" ON materials FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY "materials_update" ON materials FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "materials_delete" ON materials FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "stock_items_select" ON stock_items FOR SELECT TO authenticated USING (true);
  CREATE POLICY "stock_items_insert" ON stock_items FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY "stock_items_update" ON stock_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "stock_items_delete" ON stock_items FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "nesting_sessions_select" ON nesting_sessions FOR SELECT TO authenticated USING (true);
  CREATE POLICY "nesting_sessions_insert" ON nesting_sessions FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY "nesting_sessions_update" ON nesting_sessions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "nesting_sessions_delete" ON nesting_sessions FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "nesting_session_jobs_select" ON nesting_session_jobs FOR SELECT TO authenticated USING (true);
  CREATE POLICY "nesting_session_jobs_insert" ON nesting_session_jobs FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY "nesting_session_jobs_update" ON nesting_session_jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  CREATE POLICY "nesting_session_jobs_delete" ON nesting_session_jobs FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "nesting_session_sheets_select" ON nesting_session_sheets FOR SELECT TO authenticated USING (true);
  CREATE POLICY "nesting_session_sheets_insert" ON nesting_session_sheets FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY "nesting_session_sheets_update" ON nesting_session_sheets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "stock_transactions_select" ON stock_transactions FOR SELECT TO authenticated USING (true);
  CREATE POLICY "stock_transactions_insert" ON stock_transactions FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "low_stock_alerts_select" ON low_stock_alerts FOR SELECT TO authenticated USING (true);
  CREATE POLICY "low_stock_alerts_insert" ON low_stock_alerts FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY "low_stock_alerts_update" ON low_stock_alerts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "inventory_settings_select" ON inventory_settings FOR SELECT TO authenticated USING (true);
  CREATE POLICY "inventory_settings_insert" ON inventory_settings FOR INSERT TO authenticated WITH CHECK (true);
  CREATE POLICY "inventory_settings_update" ON inventory_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── PostgreSQL Function: complete_nesting_session ──────────────────────────
-- Atomic transaction for session completion with stock consumption

CREATE OR REPLACE FUNCTION complete_nesting_session(
  p_tenant_id UUID,
  p_session_id UUID,
  p_sheets JSONB,
  p_operator_notes TEXT,
  p_completed_by TEXT
) RETURNS JSONB AS $$
DECLARE
  v_session RECORD;
  v_sheet JSONB;
  v_stock RECORD;
  v_consumed_area NUMERIC;
  v_remaining NUMERIC;
  v_remnant_id UUID;
  v_new_remnants JSONB := '[]'::JSONB;
  v_material_id UUID;
  v_total_consumed NUMERIC := 0;
  v_qr_code TEXT;
BEGIN
  -- Lock the session
  SELECT * INTO v_session
  FROM nesting_sessions
  WHERE id = p_session_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_session.status NOT IN ('cutting', 'ready') THEN
    RAISE EXCEPTION 'Session must be in ready/cutting status to complete, current: %', v_session.status;
  END IF;

  v_material_id := v_session.material_id;

  -- Process each sheet
  FOR v_sheet IN SELECT * FROM jsonb_array_elements(p_sheets)
  LOOP
    -- Get the stock item being consumed
    SELECT * INTO v_stock
    FROM stock_items
    WHERE id = (v_sheet->>'stockItemId')::UUID
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF v_stock IS NULL THEN
      RAISE EXCEPTION 'Stock item % not found', (v_sheet->>'stockItemId');
    END IF;

    v_consumed_area := (v_sheet->>'consumedAreaMm2')::NUMERIC;
    v_total_consumed := v_total_consumed + v_consumed_area;

    -- Update stock item used area
    UPDATE stock_items SET
      used_area_mm2 = COALESCE(used_area_mm2, 0) + v_consumed_area,
      status = CASE
        WHEN (v_sheet->>'leftoverAction') IN ('fully_consumed', 'scrap') THEN 'depleted'::stock_status
        WHEN (v_sheet->>'leftoverAction') = 'remnant' THEN 'depleted'::stock_status
        ELSE status
      END,
      depleted_date = CASE
        WHEN (v_sheet->>'leftoverAction') IN ('fully_consumed', 'scrap', 'remnant') THEN now()
        ELSE depleted_date
      END
    WHERE id = v_stock.id;

    -- Log consumption transaction
    INSERT INTO stock_transactions (
      tenant_id, stock_item_id, type, area_change_mm2,
      nesting_session_id, reason, performed_by
    ) VALUES (
      p_tenant_id, v_stock.id, 'consume', -v_consumed_area,
      p_session_id, 'Nesting session completion', p_completed_by
    );

    -- Handle leftover
    IF (v_sheet->>'leftoverAction') = 'remnant' THEN
      v_remnant_id := gen_random_uuid();
      v_qr_code := 'REM-' || encode(gen_random_bytes(6), 'hex');

      INSERT INTO stock_items (
        id, tenant_id, material_id, origin, parent_stock_id,
        width_mm, height_mm, total_area_mm2, used_area_mm2,
        remnant_shape, location, status,
        qr_code, received_date, notes
      ) VALUES (
        v_remnant_id, p_tenant_id, v_material_id, 'remnant', v_stock.id,
        (v_sheet->>'remnantWidthMm')::NUMERIC,
        (v_sheet->>'remnantHeightMm')::NUMERIC,
        (v_sheet->>'remnantWidthMm')::NUMERIC * (v_sheet->>'remnantHeightMm')::NUMERIC,
        0,
        'rectangle',
        COALESCE(v_sheet->>'remnantLocation', v_stock.location),
        'available',
        v_qr_code,
        CURRENT_DATE,
        'Remnant from session ' || p_session_id::TEXT
      );

      -- Log remnant creation
      INSERT INTO stock_transactions (
        tenant_id, stock_item_id, type, area_change_mm2,
        nesting_session_id, reason, performed_by
      ) VALUES (
        p_tenant_id, v_remnant_id, 'remnant_create',
        (v_sheet->>'remnantWidthMm')::NUMERIC * (v_sheet->>'remnantHeightMm')::NUMERIC,
        p_session_id, 'Remnant from session completion', p_completed_by
      );

      -- Record in session_sheets
      INSERT INTO nesting_session_sheets (
        tenant_id, session_id, stock_item_id, sheet_index,
        area_consumed_mm2, utilization, leftover_action, remnant_stock_id
      ) VALUES (
        p_tenant_id, p_session_id, v_stock.id,
        (v_sheet->>'sheetIndex')::INTEGER, v_consumed_area,
        (v_sheet->>'utilization')::NUMERIC, 'remnant_created', v_remnant_id
      );

      v_new_remnants := v_new_remnants || jsonb_build_object(
        'id', v_remnant_id,
        'width', (v_sheet->>'remnantWidthMm')::NUMERIC,
        'height', (v_sheet->>'remnantHeightMm')::NUMERIC,
        'qrCode', v_qr_code,
        'location', COALESCE(v_sheet->>'remnantLocation', v_stock.location)
      );

    ELSIF (v_sheet->>'leftoverAction') = 'scrap' THEN
      INSERT INTO nesting_session_sheets (
        tenant_id, session_id, stock_item_id, sheet_index,
        area_consumed_mm2, utilization, leftover_action, scrap_weight_kg
      ) VALUES (
        p_tenant_id, p_session_id, v_stock.id,
        (v_sheet->>'sheetIndex')::INTEGER, v_consumed_area,
        (v_sheet->>'utilization')::NUMERIC, 'scrapped',
        (v_sheet->>'scrapWeightKg')::NUMERIC
      );

      INSERT INTO stock_transactions (
        tenant_id, stock_item_id, type, area_change_mm2,
        nesting_session_id, reason, performed_by
      ) VALUES (
        p_tenant_id, v_stock.id, 'scrap',
        -(COALESCE(v_stock.remaining_area_mm2, 0) - v_consumed_area),
        p_session_id, 'Scrap from session', p_completed_by
      );

    ELSE -- fully_consumed
      INSERT INTO nesting_session_sheets (
        tenant_id, session_id, stock_item_id, sheet_index,
        area_consumed_mm2, utilization, leftover_action
      ) VALUES (
        p_tenant_id, p_session_id, v_stock.id,
        (v_sheet->>'sheetIndex')::INTEGER, v_consumed_area,
        (v_sheet->>'utilization')::NUMERIC, 'fully_consumed'
      );
    END IF;
  END LOOP;

  -- Update session status
  UPDATE nesting_sessions SET
    status = 'completed',
    actual_sheets_used = jsonb_array_length(p_sheets),
    operator_notes = p_operator_notes,
    completed_by = p_completed_by,
    completed_at = now(),
    updated_at = now()
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'materialId', v_material_id,
    'totalConsumedMm2', v_total_consumed,
    'newRemnants', v_new_remnants,
    'sheetsUsed', jsonb_array_length(p_sheets),
    'jobIds', (SELECT COALESCE(jsonb_agg(order_id), '[]'::JSONB) FROM nesting_session_jobs WHERE session_id = p_session_id)
  );
END;
$$ LANGUAGE plpgsql;

-- ─── Function: get_stock_summary ────────────────────────────────────────────
-- Returns aggregated stock levels per material

CREATE OR REPLACE FUNCTION get_stock_summary(p_tenant_id UUID)
RETURNS TABLE (
  material_id UUID,
  material_name TEXT,
  category TEXT,
  grade TEXT,
  thickness_mm NUMERIC,
  base_unit TEXT,
  full_sheets BIGINT,
  remnant_count BIGINT,
  total_area_mm2 NUMERIC,
  total_quantity NUMERIC,
  total_value NUMERIC,
  low_stock_threshold NUMERIC,
  is_low_stock BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id AS material_id,
    m.name AS material_name,
    m.category,
    m.grade,
    m.thickness_mm,
    m.base_unit,
    COUNT(*) FILTER (WHERE si.origin = 'purchased' AND si.status = 'available') AS full_sheets,
    COUNT(*) FILTER (WHERE si.origin = 'remnant' AND si.status = 'available') AS remnant_count,
    COALESCE(SUM(si.remaining_area_mm2) FILTER (WHERE si.status = 'available'), 0) AS total_area_mm2,
    COALESCE(SUM(si.remaining_quantity) FILTER (WHERE si.status = 'available'), 0) AS total_quantity,
    COALESCE(SUM(
      CASE
        WHEN m.base_unit = 'm2' THEN si.remaining_area_mm2 / 1000000.0 * COALESCE(m.cost_per_unit, 0)
        ELSE si.remaining_quantity * COALESCE(m.cost_per_unit, 0)
      END
    ) FILTER (WHERE si.status = 'available'), 0) AS total_value,
    m.low_stock_threshold,
    CASE
      WHEN m.low_stock_threshold IS NULL THEN false
      WHEN m.base_unit = 'm2' THEN
        COALESCE(SUM(si.remaining_area_mm2) FILTER (WHERE si.status = 'available'), 0) / 1000000.0 < m.low_stock_threshold
      ELSE
        COALESCE(SUM(si.remaining_quantity) FILTER (WHERE si.status = 'available'), 0) < m.low_stock_threshold
    END AS is_low_stock
  FROM materials m
  LEFT JOIN stock_items si ON si.material_id = m.id AND si.tenant_id = p_tenant_id
  WHERE m.tenant_id = p_tenant_id AND m.is_active = true
  GROUP BY m.id, m.name, m.category, m.grade, m.thickness_mm, m.base_unit, m.cost_per_unit, m.low_stock_threshold;
END;
$$ LANGUAGE plpgsql;

-- ─── Function: select_stock_for_session ─────────────────────────────────────
-- Smart stock selection: prefers smallest remnants first, then FIFO full sheets

CREATE OR REPLACE FUNCTION select_stock_for_session(
  p_tenant_id UUID,
  p_material_id UUID,
  p_sheets_needed INTEGER,
  p_min_width_mm NUMERIC DEFAULT 0,
  p_min_height_mm NUMERIC DEFAULT 0
) RETURNS TABLE (
  stock_item_id UUID,
  is_remnant BOOLEAN,
  width_mm NUMERIC,
  height_mm NUMERIC,
  remaining_area_mm2 NUMERIC,
  location TEXT
) AS $$
BEGIN
  RETURN QUERY
  (
    -- First: remnants large enough, smallest first
    SELECT
      si.id AS stock_item_id,
      true AS is_remnant,
      si.width_mm,
      si.height_mm,
      si.remaining_area_mm2,
      si.location
    FROM stock_items si
    WHERE si.tenant_id = p_tenant_id
      AND si.material_id = p_material_id
      AND si.status = 'available'
      AND si.origin = 'remnant'
      AND (p_min_width_mm = 0 OR si.width_mm >= p_min_width_mm)
      AND (p_min_height_mm = 0 OR si.height_mm >= p_min_height_mm)
    ORDER BY si.remaining_area_mm2 ASC
  )
  UNION ALL
  (
    -- Then: full sheets, oldest first (FIFO)
    SELECT
      si.id AS stock_item_id,
      false AS is_remnant,
      si.width_mm,
      si.height_mm,
      si.remaining_area_mm2,
      si.location
    FROM stock_items si
    WHERE si.tenant_id = p_tenant_id
      AND si.material_id = p_material_id
      AND si.status = 'available'
      AND si.origin != 'remnant'
    ORDER BY si.received_date ASC NULLS LAST, si.created_at ASC
  )
  LIMIT p_sheets_needed;
END;
$$ LANGUAGE plpgsql;

-- ─── Seed data: default tenant settings ─────────────────────────────────────

INSERT INTO inventory_settings (tenant_id, automation_level)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'manual')
ON CONFLICT (tenant_id) DO NOTHING;
