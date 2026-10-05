-- Minimal recreation of the database objects that supabase/migrations/*_agent_layer.sql references:
-- the Supabase roles and default privileges, auth.uid()/jwt()/role(), and the tables, columns, defaults,
-- constraints, functions and row policies the agent layer touches. Column lists and function bodies follow
-- the production schema as read on 2026-10-03 (information_schema, pg_constraint, pg_get_functiondef);
-- the row policies are the ones defined in supabase/migrations/, plus the policy that lets a user read their
-- own user_roles rows. Nothing else of the production schema is here.

-- ---- Supabase roles and the default privileges new objects in public receive ----
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ---- auth schema (auth.uid/jwt/role bodies as live) ----
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role() TO anon, authenticated, service_role;

-- ---- enums (pg_enum, live) ----
CREATE TYPE public.app_role AS ENUM ('admin','sales_rep','customer','supplier','production_manager','accountant','partner_seller');
CREATE TYPE public.stock_status AS ENUM ('available','reserved','in_use','depleted','scrapped');
CREATE TYPE public.stock_origin AS ENUM ('purchased','remnant','returned','transferred');
CREATE TYPE public.session_status AS ENUM ('draft','ready','cutting','completed','cancelled');
CREATE TYPE public.transaction_type AS ENUM ('receive','consume','remnant_create','remnant_consume','scrap','adjust','reserve','unreserve','transfer');

-- ---- helpers (bodies as live) ----
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

-- ---- tables (columns, defaults, NOT NULL and constraints as live) ----
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL,
  logo_url text, favicon_url text, primary_color text DEFAULT '#2563EB', secondary_color text DEFAULT '#1E40AF',
  welcome_message text, contact_email text, contact_phone text, address text, website text,
  is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  custom_domain text UNIQUE, domain_verified boolean DEFAULT false);
INSERT INTO public.tenants (id, slug, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'micronshub', 'Microns Hub'),
  ('bb71e74e-4273-496f-a75b-319357666ebc', 'laserkritis', 'Laserkritis');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL, created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, role));
CREATE TABLE public.user_tenant_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'customer', created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, tenant_id));

CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_tenant_roles WHERE user_id = auth.uid() AND role = 'super_admin'); $$;
CREATE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()
    AND role IN ('admin', 'sales_rep', 'production_manager', 'accountant')) OR public.is_super_admin(); $$;

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_name text, contact_name text, email text, phone text,
  address text, country text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'lead', vat_tax_id text DEFAULT '', street_address text DEFAULT '', city text DEFAULT '',
  zip_code text DEFAULT '', first_name text, last_name text, position text, mobile text,
  tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT customers_email_unique UNIQUE (email));
CREATE UNIQUE INDEX customers_email_unique_idx ON public.customers (lower(email)) WHERE email IS NOT NULL;

CREATE FUNCTION public.my_customer_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.customers c WHERE (c.user_id IS NOT NULL AND c.user_id = auth.uid())
     OR (c.email IS NOT NULL AND lower(c.email) = lower(coalesce(auth.jwt()->>'email', ''))); $$;

CREATE TABLE public.rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_name text NOT NULL, vat_id text, address text, city text,
  zip_code text, country text, contact_first_name text, contact_last_name text, contact_position text,
  contact_email text, contact_phone text, general_notes text, internal_request_number text, delivery_speed text,
  max_delivery_date text, latest_offer_date text, terms_accepted boolean, captcha_token text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  customer_id uuid REFERENCES public.customers(id), total_amount numeric DEFAULT 0, currency text DEFAULT 'EUR',
  due_date timestamptz, version integer DEFAULT 1, title text DEFAULT 'New RFQ', description text,
  status text DEFAULT 'draft', parts_details jsonb DEFAULT '[]'::jsonb, rfq_number text, mobile text,
  shipping_cost numeric DEFAULT 0.00,
  tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id));

CREATE FUNCTION public.my_rfq_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id FROM public.rfqs r WHERE r.customer_id IN (SELECT public.my_customer_ids()); $$;

CREATE TABLE public.rfq_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  file_name text NOT NULL, file_path text NOT NULL, file_type text NOT NULL, file_size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), part_id uuid,
  tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id));

CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES public.customers(id),
  rfq_id uuid REFERENCES public.rfqs(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'new',
  total_amount numeric DEFAULT 0, currency text DEFAULT 'USD', title text NOT NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), start_date timestamptz,
  delivery_date timestamptz, partner_id uuid, production_status text DEFAULT 'pending',
  material_costs numeric DEFAULT 0, working_hours_costs numeric DEFAULT 0, total_production_costs numeric DEFAULT 0,
  vat_amount numeric DEFAULT 0, total_with_vat numeric DEFAULT 0, po_number text, from_rfq_number text,
  tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  CONSTRAINT check_production_status CHECK (production_status IN ('pending','in_production','ready','completed')));
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_name text NOT NULL, description text, quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0, total_price numeric NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now(),
  product_id uuid REFERENCES public.products(id), sku text,
  tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id));

-- next_po_number(): body and grants as supabase/migrations/20260806_phase2_rls_per_user.sql:122-138
CREATE FUNCTION public.next_po_number()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_date text := to_char(now(), 'DDMMYYYY');
  v_seq  int;
BEGIN
  SELECT COALESCE(MAX((m[1])::int), 0) + 1 INTO v_seq
  FROM public.orders o
  CROSS JOIN LATERAL regexp_match(o.po_number, '^PO-' || v_date || '-(\d+)$') AS m
  WHERE o.po_number LIKE 'PO-' || v_date || '-%';
  RETURN 'PO-' || v_date || '-' || v_seq;
END;
$$;
REVOKE ALL ON FUNCTION public.next_po_number() FROM public;
GRANT EXECUTE ON FUNCTION public.next_po_number() TO authenticated;

CREATE TABLE public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001', name text NOT NULL, category text NOT NULL,
  grade text, thickness_mm numeric, base_unit text NOT NULL DEFAULT 'sheet', density_kg_m3 numeric, cost_per_unit numeric,
  cost_currency text DEFAULT 'EUR', low_stock_threshold numeric DEFAULT 5, reorder_threshold numeric DEFAULT 10,
  notes text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  status public.stock_status NOT NULL DEFAULT 'available', origin public.stock_origin NOT NULL DEFAULT 'purchased',
  width_mm numeric, height_mm numeric, total_area_mm2 numeric, remaining_area_mm2 numeric,
  quantity numeric NOT NULL DEFAULT 1, remaining_quantity numeric, qr_code text UNIQUE,
  parent_stock_id uuid REFERENCES public.stock_items(id) ON DELETE SET NULL, location text, batch_number text,
  supplier text, unit_cost numeric, notes text, received_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.nesting_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  session_date date NOT NULL DEFAULT CURRENT_DATE, status public.session_status NOT NULL DEFAULT 'draft',
  total_parts integer DEFAULT 0, total_sheets integer DEFAULT 0, total_area_required_mm2 numeric DEFAULT 0,
  total_area_consumed_mm2 numeric DEFAULT 0, overall_utilization_pct numeric DEFAULT 0, nesting_data jsonb,
  notes text, completed_at timestamptz, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.stock_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  stock_item_id uuid NOT NULL REFERENCES public.stock_items(id) ON DELETE RESTRICT,
  transaction_type public.transaction_type NOT NULL, area_change_mm2 numeric DEFAULT 0, quantity_change numeric DEFAULT 0,
  reference_type text, reference_id uuid,
  session_id uuid REFERENCES public.nesting_sessions(id) ON DELETE SET NULL,
  notes text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.marketing_sender_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, display_name text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('resend','google_workspace')), provider_config jsonb DEFAULT '{}'::jsonb,
  daily_limit integer DEFAULT 500, emails_sent_today integer DEFAULT 0, last_reset_date date DEFAULT CURRENT_DATE,
  is_active boolean DEFAULT true, warmup_enabled boolean DEFAULT false, warmup_daily_increment integer DEFAULT 5,
  warmup_current_limit integer DEFAULT 10, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());

-- stock_items trigger (live fn_stock_remaining, body as live)
CREATE FUNCTION public.fn_stock_remaining() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.width_mm IS NOT NULL AND NEW.height_mm IS NOT NULL THEN
    IF NEW.total_area_mm2 IS NULL OR TG_OP = 'INSERT' THEN NEW.total_area_mm2 := NEW.width_mm * NEW.height_mm; END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.remaining_area_mm2 IS NULL AND NEW.total_area_mm2 IS NOT NULL THEN NEW.remaining_area_mm2 := NEW.total_area_mm2; END IF;
    IF NEW.remaining_quantity IS NULL THEN NEW.remaining_quantity := NEW.quantity; END IF;
  END IF;
  IF NEW.remaining_area_mm2 IS NOT NULL AND NEW.remaining_area_mm2 <= 0 THEN NEW.status := 'depleted'; NEW.remaining_area_mm2 := 0; END IF;
  IF NEW.remaining_quantity IS NOT NULL AND NEW.remaining_quantity <= 0 THEN NEW.status := 'depleted'; NEW.remaining_quantity := 0; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_stock_remaining BEFORE INSERT OR UPDATE ON public.stock_items FOR EACH ROW EXECUTE FUNCTION public.fn_stock_remaining();

-- create_public_rfq: body as live (pg_get_functiondef 2026-10-03), whitespace normalised
CREATE FUNCTION public.create_public_rfq(p_payload jsonb)
RETURNS TABLE(id uuid, rfq_number text, customer_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_order    boolean := COALESCE((p_payload->>'is_order')::boolean, false);
  v_prefix      text := CASE WHEN v_is_order THEN 'ORD' ELSE 'RFQ' END;
  v_date        text := to_char(now(), 'DDMMYYYY');
  v_seq         int;
  v_number      text;
  v_id          uuid := gen_random_uuid();
  v_company     text := NULLIF(p_payload->>'company_name', '');
  v_parts       jsonb;
  v_uid         uuid := auth.uid();
  v_auth_email  text;
  v_contact_email text := NULLIF(p_payload->>'contact_email', '');
  v_match_email text;
  v_customer_id uuid;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'company_name is required'; END IF;
  IF v_uid IS NOT NULL THEN SELECT email INTO v_auth_email FROM auth.users WHERE id = v_uid; END IF;
  v_match_email := COALESCE(v_auth_email, v_contact_email);
  IF v_uid IS NOT NULL THEN
    SELECT c.id INTO v_customer_id FROM public.customers c WHERE c.user_id = v_uid ORDER BY c.created_at ASC NULLS LAST LIMIT 1;
  END IF;
  IF v_customer_id IS NULL AND v_match_email IS NOT NULL THEN
    SELECT c.id INTO v_customer_id FROM public.customers c
    WHERE c.email IS NOT NULL AND lower(c.email) = lower(v_match_email) ORDER BY c.created_at ASC NULLS LAST LIMIT 1;
    IF v_customer_id IS NOT NULL AND v_uid IS NOT NULL THEN
      UPDATE public.customers SET user_id = v_uid WHERE id = v_customer_id AND user_id IS NULL;
    END IF;
  END IF;
  IF v_customer_id IS NULL AND v_match_email IS NOT NULL THEN
    INSERT INTO public.customers (user_id, email, first_name, last_name, contact_name, company_name,
      phone, mobile, vat_tax_id, address, city, zip_code, country, status, created_at, updated_at)
    VALUES (v_uid, v_match_email, p_payload->>'contact_first_name', p_payload->>'contact_last_name',
      NULLIF(trim(concat_ws(' ', p_payload->>'contact_first_name', p_payload->>'contact_last_name')), ''),
      v_company, p_payload->>'contact_phone', p_payload->>'mobile', p_payload->>'vat_id', p_payload->>'address',
      p_payload->>'city', p_payload->>'zip_code', p_payload->>'country', 'active', now(), now())
    RETURNING public.customers.id INTO v_customer_id;
  END IF;
  SELECT COALESCE(MAX((m[1])::int), 0) + 1 INTO v_seq
  FROM public.rfqs r CROSS JOIN LATERAL regexp_match(r.rfq_number, '^' || v_prefix || '-' || v_date || '-(\d+)$') AS m
  WHERE r.rfq_number LIKE v_prefix || '-' || v_date || '-%';
  v_number := v_prefix || '-' || v_date || '-' || v_seq;
  SELECT COALESCE(jsonb_agg((part - 'rfq_id' - 'product_name')
           || jsonb_build_object('rfq_id', v_id::text, 'product_name', 'Part ' || idx || ' ' || v_number || '-' || idx)
           ORDER BY idx), '[]'::jsonb)
    INTO v_parts
  FROM (SELECT part, row_number() OVER () AS idx FROM jsonb_array_elements(COALESCE(p_payload->'parts', '[]'::jsonb)) AS part) s;
  INSERT INTO public.rfqs (id, title, company_name, vat_id, address, city, zip_code, country,
    contact_first_name, contact_last_name, contact_position, contact_email, contact_phone, mobile, customer_id,
    status, currency, due_date, version, description, parts_details, rfq_number)
  VALUES (v_id, v_number || ' - ' || v_company, v_company, p_payload->>'vat_id', p_payload->>'address',
    p_payload->>'city', p_payload->>'zip_code', p_payload->>'country', p_payload->>'contact_first_name',
    p_payload->>'contact_last_name', p_payload->>'contact_position', p_payload->>'contact_email',
    p_payload->>'contact_phone', p_payload->>'mobile', v_customer_id,
    CASE WHEN v_is_order THEN 'approved' ELSE 'draft' END, 'EUR',
    COALESCE(NULLIF(p_payload->>'due_date', '')::timestamptz, now() + interval '7 days'), 1,
    p_payload->>'description', v_parts, v_number);
  RETURN QUERY SELECT v_id, v_number, v_customer_id;
END;
$function$;

-- ---- RLS and policies (pg_policies, live; only the tables the tests write to) ----
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO public USING (auth.uid() = user_id);
CREATE POLICY user_roles_staff_select ON public.user_roles FOR SELECT TO authenticated USING (public.is_staff());
ALTER TABLE public.user_tenant_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_read_own_roles ON public.user_tenant_roles FOR SELECT TO public USING (user_id = auth.uid());
CREATE POLICY super_admin_manage_roles ON public.user_tenant_roles FOR ALL TO public USING (public.is_super_admin());
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_self_select ON public.customers FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR ((email IS NOT NULL) AND (lower(email) = lower(COALESCE((auth.jwt() ->> 'email'), '')))));
CREATE POLICY customers_staff_all ON public.customers FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY rfqs_customer_insert ON public.rfqs FOR INSERT TO authenticated WITH CHECK (customer_id IN (SELECT public.my_customer_ids()));
CREATE POLICY rfqs_customer_select ON public.rfqs FOR SELECT TO authenticated USING (customer_id IN (SELECT public.my_customer_ids()));
CREATE POLICY rfqs_customer_update ON public.rfqs FOR UPDATE TO authenticated
  USING (customer_id IN (SELECT public.my_customer_ids())) WITH CHECK (customer_id IN (SELECT public.my_customer_ids()));
CREATE POLICY rfqs_customer_delete_draft ON public.rfqs FOR DELETE TO authenticated
  USING ((customer_id IN (SELECT public.my_customer_ids())) AND (status = 'draft'));
CREATE POLICY rfqs_staff_all ON public.rfqs FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
ALTER TABLE public.rfq_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY rfq_files_customer_insert ON public.rfq_files FOR INSERT TO authenticated WITH CHECK (rfq_id IN (SELECT public.my_rfq_ids()));
CREATE POLICY rfq_files_customer_select ON public.rfq_files FOR SELECT TO authenticated USING (rfq_id IN (SELECT public.my_rfq_ids()));
CREATE POLICY rfq_files_customer_delete ON public.rfq_files FOR DELETE TO authenticated USING (rfq_id IN (SELECT public.my_rfq_ids()));
CREATE POLICY rfq_files_staff_all ON public.rfq_files FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_staff_all ON public.orders FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_items_staff_all ON public.order_items FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_items_select ON public.stock_items FOR SELECT TO authenticated USING (true);
ALTER TABLE public.stock_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_transactions_select ON public.stock_transactions FOR SELECT TO authenticated USING (true);
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nesting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_sender_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY anyone_can_read_active_tenants ON public.tenants FOR SELECT TO public USING (is_active = true);
