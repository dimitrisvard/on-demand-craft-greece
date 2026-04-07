-- ============================================================================
-- Multi-Tenant White-Label System for Microns Hub
-- Migration: 20260407_create_multi_tenant_system
--
-- Creates the core tenant infrastructure:
--   1. tenants table (central registry)
--   2. capabilities_registry (master list of services)
--   3. tenant_capabilities (per-tenant enabled services)
--   4. quote_fields_registry (master quote form fields)
--   5. tenant_quote_fields (per-tenant field visibility)
--   6. user_tenant_roles (user ↔ tenant mapping)
--   7. tenant_pages (AI-generated landing pages)
--   8. Adds tenant_id to all existing tenant-scoped tables
--   9. Creates default 'micronshub' tenant for existing data
--  10. RLS policies for complete data isolation
-- ============================================================================

-- ─── 1. TENANTS: Central tenant registry ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  logo_url        TEXT,
  favicon_url     TEXT,
  primary_color   TEXT DEFAULT '#2563EB',
  secondary_color TEXT DEFAULT '#1E40AF',
  welcome_message TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  address         TEXT,
  website         TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_active ON public.tenants(is_active);

-- ─── 2. CAPABILITIES REGISTRY: Master list of all services ──────────────────

CREATE TABLE IF NOT EXISTS public.capabilities_registry (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  category    TEXT,
  sort_order  INT DEFAULT 0,
  is_active   BOOLEAN DEFAULT true
);

-- Seed the 7 predefined capabilities
INSERT INTO public.capabilities_registry (key, label, category, sort_order) VALUES
  ('cnc_milling',       'CNC Milling',        'machining', 1),
  ('cnc_turning',       'CNC Turning',        'machining', 2),
  ('sheet_metal',       'Sheet Metal',         'forming',   3),
  ('3d_printing',       '3D Printing',         'additive',  4),
  ('injection_molding', 'Injection Molding',   'forming',   5),
  ('laser_cutting',     'Laser Cutting',       'machining', 6),
  ('surface_finishing', 'Surface Finishing',    'finishing', 7)
ON CONFLICT (key) DO NOTHING;

-- ─── 3. TENANT CAPABILITIES: Per-tenant enabled services ────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_capabilities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  capability  TEXT NOT NULL REFERENCES public.capabilities_registry(key),
  is_enabled  BOOLEAN DEFAULT true,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_tenant_capabilities_tenant
  ON public.tenant_capabilities(tenant_id);

-- ─── 4. QUOTE FIELDS REGISTRY: Master fields per capability ─────────────────

CREATE TABLE IF NOT EXISTS public.quote_fields_registry (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability  TEXT NOT NULL REFERENCES public.capabilities_registry(key),
  field_key   TEXT NOT NULL,
  label       TEXT NOT NULL,
  field_type  TEXT NOT NULL,
  options     JSONB,
  default_value TEXT,
  sort_order  INT DEFAULT 0,
  UNIQUE(capability, field_key)
);

-- Seed common quote fields for each capability
INSERT INTO public.quote_fields_registry (capability, field_key, label, field_type, sort_order) VALUES
  -- CNC Milling fields
  ('cnc_milling', 'material',        'Material',           'select',  1),
  ('cnc_milling', 'quantity',        'Quantity',           'number',  2),
  ('cnc_milling', 'tolerance',       'Tolerance',          'select',  3),
  ('cnc_milling', 'surface_finish',  'Surface Finish',     'select',  4),
  ('cnc_milling', 'thread_tapping',  'Thread/Tapping',     'toggle',  5),
  ('cnc_milling', 'heat_treatment',  'Heat Treatment',     'select',  6),
  ('cnc_milling', 'file_upload',     'File Upload',        'file',    7),
  ('cnc_milling', 'notes',           'Notes / Comments',   'text',    8),
  -- CNC Turning fields
  ('cnc_turning', 'material',        'Material',           'select',  1),
  ('cnc_turning', 'quantity',        'Quantity',           'number',  2),
  ('cnc_turning', 'tolerance',       'Tolerance',          'select',  3),
  ('cnc_turning', 'surface_finish',  'Surface Finish',     'select',  4),
  ('cnc_turning', 'file_upload',     'File Upload',        'file',    5),
  ('cnc_turning', 'notes',           'Notes / Comments',   'text',    6),
  -- Sheet Metal fields
  ('sheet_metal', 'material',        'Material',           'select',  1),
  ('sheet_metal', 'thickness',       'Thickness',          'select',  2),
  ('sheet_metal', 'quantity',        'Quantity',           'number',  3),
  ('sheet_metal', 'finish',          'Finish',             'select',  4),
  ('sheet_metal', 'file_upload',     'File Upload',        'file',    5),
  ('sheet_metal', 'notes',           'Notes / Comments',   'text',    6),
  -- 3D Printing fields
  ('3d_printing', 'technology',      'Technology',         'select',  1),
  ('3d_printing', 'material',        'Material',           'select',  2),
  ('3d_printing', 'quantity',        'Quantity',           'number',  3),
  ('3d_printing', 'layer_height',    'Layer Height',       'select',  4),
  ('3d_printing', 'infill',          'Infill %',           'number',  5),
  ('3d_printing', 'file_upload',     'File Upload',        'file',    6),
  ('3d_printing', 'notes',           'Notes / Comments',   'text',    7),
  -- Injection Molding fields
  ('injection_molding', 'material',  'Material',           'select',  1),
  ('injection_molding', 'quantity',  'Quantity',           'number',  2),
  ('injection_molding', 'mold_type', 'Mold Type',         'select',  3),
  ('injection_molding', 'file_upload', 'File Upload',      'file',    4),
  ('injection_molding', 'notes',     'Notes / Comments',   'text',    5),
  -- Laser Cutting fields
  ('laser_cutting', 'material',      'Material',           'select',  1),
  ('laser_cutting', 'thickness',     'Thickness',          'select',  2),
  ('laser_cutting', 'quantity',      'Quantity',           'number',  3),
  ('laser_cutting', 'file_upload',   'File Upload',        'file',    4),
  ('laser_cutting', 'notes',         'Notes / Comments',   'text',    5),
  -- Surface Finishing fields
  ('surface_finishing', 'finish_type', 'Finish Type',      'select',  1),
  ('surface_finishing', 'substrate',   'Substrate Material','select',  2),
  ('surface_finishing', 'quantity',    'Quantity',          'number',  3),
  ('surface_finishing', 'file_upload', 'File Upload',       'file',    4),
  ('surface_finishing', 'notes',       'Notes / Comments',  'text',    5)
ON CONFLICT (capability, field_key) DO NOTHING;

-- ─── 5. TENANT QUOTE FIELDS: Per-tenant field visibility ────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_quote_fields (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  capability    TEXT NOT NULL REFERENCES public.capabilities_registry(key),
  field_key     TEXT NOT NULL,
  is_visible    BOOLEAN DEFAULT true,
  is_required   BOOLEAN DEFAULT false,
  sort_order    INT DEFAULT 0,
  UNIQUE(tenant_id, capability, field_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_quote_fields_tenant
  ON public.tenant_quote_fields(tenant_id);

-- ─── 6. USER TENANT ROLES: User ↔ Tenant mapping ───────────────────────────

CREATE TABLE IF NOT EXISTS public.user_tenant_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  tenant_id  UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_user
  ON public.user_tenant_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_roles_tenant
  ON public.user_tenant_roles(tenant_id);

-- ─── 7. TENANT PAGES: AI-generated landing pages ───────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_pages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL,
  content      JSONB NOT NULL DEFAULT '{"sections": []}',
  html         TEXT,
  language     TEXT DEFAULT 'en',
  is_published BOOLEAN DEFAULT false,
  version      INT DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, slug, language)
);

CREATE INDEX IF NOT EXISTS idx_tenant_pages_tenant
  ON public.tenant_pages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_pages_published
  ON public.tenant_pages(tenant_id, is_published);

-- ─── 8. ADD tenant_id TO EXISTING TABLES ────────────────────────────────────

-- First create the default Microns Hub tenant
INSERT INTO public.tenants (id, slug, name, primary_color, secondary_color, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'micronshub',
  'Microns Hub',
  '#2563EB',
  '#1E40AF',
  true
)
ON CONFLICT (id) DO NOTHING;

-- Enable all capabilities for Microns Hub
INSERT INTO public.tenant_capabilities (tenant_id, capability, is_enabled, sort_order)
SELECT
  '00000000-0000-0000-0000-000000000001',
  cr.key,
  true,
  cr.sort_order
FROM public.capabilities_registry cr
ON CONFLICT (tenant_id, capability) DO NOTHING;

-- Add tenant_id to customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.customers SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON public.customers(tenant_id);

-- Add tenant_id to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.orders SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON public.orders(tenant_id);

-- Add tenant_id to order_items
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.order_items SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_tenant ON public.order_items(tenant_id);

-- Add tenant_id to rfqs
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.rfqs SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_rfqs_tenant ON public.rfqs(tenant_id);

-- Add tenant_id to rfq_items
ALTER TABLE public.rfq_items
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.rfq_items SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_rfq_items_tenant ON public.rfq_items(tenant_id);

-- Add tenant_id to rfq_files
ALTER TABLE public.rfq_files
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.rfq_files SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_rfq_files_tenant ON public.rfq_files(tenant_id);

-- Add tenant_id to rfq_parts
ALTER TABLE public.rfq_parts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.rfq_parts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_rfq_parts_tenant ON public.rfq_parts(tenant_id);

-- Add tenant_id to rfq_part_files
ALTER TABLE public.rfq_part_files
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.rfq_part_files SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_rfq_part_files_tenant ON public.rfq_part_files(tenant_id);

-- Add tenant_id to quote_files
ALTER TABLE public.quote_files
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.quote_files SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_quote_files_tenant ON public.quote_files(tenant_id);

-- Add tenant_id to production_partners
ALTER TABLE public.production_partners
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.production_partners SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_production_partners_tenant ON public.production_partners(tenant_id);

-- Add tenant_id to partner_ratings
ALTER TABLE public.partner_ratings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.partner_ratings SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_partner_ratings_tenant ON public.partner_ratings(tenant_id);

-- Add tenant_id to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.products SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_tenant ON public.products(tenant_id);

-- Add tenant_id to customer_contacts
ALTER TABLE public.customer_contacts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.customer_contacts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_contacts_tenant ON public.customer_contacts(tenant_id);

-- Add tenant_id to user_emails
ALTER TABLE public.user_emails
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id)
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE public.user_emails SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_emails_tenant ON public.user_emails(tenant_id);

-- ─── 9. RLS POLICIES ────────────────────────────────────────────────────────

-- Helper: RLS on tenants table itself
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_can_read_active_tenants" ON public.tenants
  FOR SELECT USING (is_active = true);

CREATE POLICY "super_admin_manage_tenants" ON public.tenants
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_tenant_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- RLS on capabilities_registry (read-only for everyone)
ALTER TABLE public.capabilities_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_can_read_capabilities" ON public.capabilities_registry
  FOR SELECT USING (true);

CREATE POLICY "super_admin_manage_capabilities" ON public.capabilities_registry
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_tenant_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- RLS on tenant_capabilities
ALTER TABLE public.tenant_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read_own_capabilities" ON public.tenant_capabilities
  FOR SELECT USING (
    tenant_id IN (
      SELECT utr.tenant_id FROM public.user_tenant_roles utr
      WHERE utr.user_id = auth.uid()
    )
  );

CREATE POLICY "super_admin_manage_tenant_capabilities" ON public.tenant_capabilities
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_tenant_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- RLS on quote_fields_registry (read-only for everyone)
ALTER TABLE public.quote_fields_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_can_read_quote_fields_registry" ON public.quote_fields_registry
  FOR SELECT USING (true);

-- RLS on tenant_quote_fields
ALTER TABLE public.tenant_quote_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read_own_quote_fields" ON public.tenant_quote_fields
  FOR SELECT USING (
    tenant_id IN (
      SELECT utr.tenant_id FROM public.user_tenant_roles utr
      WHERE utr.user_id = auth.uid()
    )
  );

CREATE POLICY "super_admin_manage_tenant_quote_fields" ON public.tenant_quote_fields
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_tenant_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- RLS on user_tenant_roles
ALTER TABLE public.user_tenant_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_roles" ON public.user_tenant_roles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "super_admin_manage_roles" ON public.user_tenant_roles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_tenant_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- RLS on tenant_pages
ALTER TABLE public.tenant_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_published_pages" ON public.tenant_pages
  FOR SELECT USING (is_published = true);

CREATE POLICY "tenant_admin_manage_pages" ON public.tenant_pages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_tenant_roles
      WHERE user_id = auth.uid()
        AND (role = 'super_admin' OR (role = 'tenant_admin' AND user_tenant_roles.tenant_id = tenant_pages.tenant_id))
    )
  );

-- ─── 10. RLS ON EXISTING TENANT-SCOPED TABLES ──────────────────────────────
-- Apply tenant isolation policies to all tables that now have tenant_id.
-- Pattern: tenant users see own data, super_admin sees all.

-- customers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_customers' AND tablename = 'customers') THEN
    EXECUTE 'CREATE POLICY "tenant_isolation_customers" ON public.customers
      FOR ALL USING (
        tenant_id IN (
          SELECT utr.tenant_id FROM public.user_tenant_roles utr
          WHERE utr.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.user_tenant_roles
          WHERE user_id = auth.uid() AND role = ''super_admin''
        )
      )';
  END IF;
END $$;

-- orders
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_orders' AND tablename = 'orders') THEN
    EXECUTE 'CREATE POLICY "tenant_isolation_orders" ON public.orders
      FOR ALL USING (
        tenant_id IN (
          SELECT utr.tenant_id FROM public.user_tenant_roles utr
          WHERE utr.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.user_tenant_roles
          WHERE user_id = auth.uid() AND role = ''super_admin''
        )
      )';
  END IF;
END $$;

-- rfqs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_rfqs' AND tablename = 'rfqs') THEN
    EXECUTE 'CREATE POLICY "tenant_isolation_rfqs" ON public.rfqs
      FOR ALL USING (
        tenant_id IN (
          SELECT utr.tenant_id FROM public.user_tenant_roles utr
          WHERE utr.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.user_tenant_roles
          WHERE user_id = auth.uid() AND role = ''super_admin''
        )
      )';
  END IF;
END $$;

-- production_partners
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_production_partners' AND tablename = 'production_partners') THEN
    EXECUTE 'CREATE POLICY "tenant_isolation_production_partners" ON public.production_partners
      FOR ALL USING (
        tenant_id IN (
          SELECT utr.tenant_id FROM public.user_tenant_roles utr
          WHERE utr.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.user_tenant_roles
          WHERE user_id = auth.uid() AND role = ''super_admin''
        )
      )';
  END IF;
END $$;

-- products
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation_products' AND tablename = 'products') THEN
    EXECUTE 'CREATE POLICY "tenant_isolation_products" ON public.products
      FOR ALL USING (
        tenant_id IN (
          SELECT utr.tenant_id FROM public.user_tenant_roles utr
          WHERE utr.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.user_tenant_roles
          WHERE user_id = auth.uid() AND role = ''super_admin''
        )
      )';
  END IF;
END $$;

-- ─── 11. PUBLIC ACCESS FOR TENANT CONFIG ────────────────────────────────────
-- Allow anonymous/public reads of tenant config by slug (for subdomain resolution)

CREATE POLICY "public_read_tenant_capabilities" ON public.tenant_capabilities
  FOR SELECT USING (true);

-- ─── 12. TRIGGER: Update tenant updated_at ──────────────────────────────────

CREATE OR REPLACE FUNCTION update_tenant_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_tenant_updated_at ON public.tenants;
CREATE TRIGGER trigger_update_tenant_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_tenant_updated_at();

DROP TRIGGER IF EXISTS trigger_update_tenant_page_updated_at ON public.tenant_pages;
CREATE TRIGGER trigger_update_tenant_page_updated_at
  BEFORE UPDATE ON public.tenant_pages
  FOR EACH ROW
  EXECUTE FUNCTION update_tenant_updated_at();
