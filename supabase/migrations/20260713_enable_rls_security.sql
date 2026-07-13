-- ============================================================================
-- Enable Row Level Security on tables that were fully exposed to the anon key.
--
-- Background: 19 tables had RLS disabled, so anyone holding the public anon key
-- could read/write every row (orders, customers, RFQs, internal lead-gen data,
-- and app_settings which may hold secrets).
--
-- Model:
--   * anon (public, not logged in) loses direct access to business/PII and
--     internal tables. The public quote form creates RFQs through the
--     SECURITY DEFINER function create_public_rfq(), so it needs no table grants.
--   * authenticated users (admin CRM, customer portal, partner portal) keep the
--     broad access the app currently relies on. Tightening this to per-user row
--     isolation is a recommended phase-2 follow-up.
--   * service_role (edge functions, cron, server APIs) always bypasses RLS.
--
-- Policies are additive (OR); existing tenant_isolation_* policies are kept.
--
-- IMPORTANT: RLS on public.rfqs is intentionally NOT enabled in this file. It is
-- switched on only AFTER the client build that uses create_public_rfq() is
-- deployed, so the live public quote form is never broken. Run this once the new
-- client is live:
--     ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;
-- ============================================================================

-- ---- Business / PII tables: authenticated full access, anon none ----
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.orders;
CREATE POLICY authenticated_full_access ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.order_items;
CREATE POLICY authenticated_full_access ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.customers;
CREATE POLICY authenticated_full_access ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.customer_contacts;
CREATE POLICY authenticated_full_access ON public.customer_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.rfq_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.rfq_items;
CREATE POLICY authenticated_full_access ON public.rfq_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.rfq_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.rfq_parts;
CREATE POLICY authenticated_full_access ON public.rfq_parts FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.rfq_part_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.rfq_part_files;
CREATE POLICY authenticated_full_access ON public.rfq_part_files FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.partner_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.partner_ratings;
CREATE POLICY authenticated_full_access ON public.partner_ratings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- Internal admin / lead-gen tables: authenticated full access, anon none ----
ALTER TABLE public.lead_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.lead_notifications;
CREATE POLICY authenticated_full_access ON public.lead_notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.lead_activity;
CREATE POLICY authenticated_full_access ON public.lead_activity FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.saved_searches;
CREATE POLICY authenticated_full_access ON public.saved_searches FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.scan_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.scan_logs;
CREATE POLICY authenticated_full_access ON public.scan_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.funding_feeds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.funding_feeds;
CREATE POLICY authenticated_full_access ON public.funding_feeds FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.funding_scan_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.funding_scan_logs;
CREATE POLICY authenticated_full_access ON public.funding_scan_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.tender_connectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.tender_connectors;
CREATE POLICY authenticated_full_access ON public.tender_connectors FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.tender_scan_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_full_access ON public.tender_scan_logs;
CREATE POLICY authenticated_full_access ON public.tender_scan_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- quote_files (legacy, empty): remove wide-open anon ALL policy ----
ALTER TABLE public.quote_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable public access for quote_files" ON public.quote_files;
DROP POLICY IF EXISTS authenticated_full_access ON public.quote_files;
CREATE POLICY authenticated_full_access ON public.quote_files FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- existing "Allow public insertion of files" (anon INSERT) is intentionally kept

-- ---- app_settings (may contain secrets): admins only; service_role bypasses ----
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_only_access ON public.app_settings;
CREATE POLICY admin_only_access ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.is_super_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.is_super_admin());

-- ---- rfqs: create the policy now; enable RLS only after the client deploys ----
DROP POLICY IF EXISTS authenticated_full_access ON public.rfqs;
CREATE POLICY authenticated_full_access ON public.rfqs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- Public RFQ submission RPC (lets anon create an RFQ without table access) ----
CREATE OR REPLACE FUNCTION public.create_public_rfq(p_payload jsonb)
RETURNS TABLE(id uuid, rfq_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_is_order boolean := COALESCE((p_payload->>'is_order')::boolean, false);
  v_prefix   text := CASE WHEN v_is_order THEN 'ORD' ELSE 'RFQ' END;
  v_date     text := to_char(now(), 'DDMMYYYY');
  v_seq      int;
  v_number   text;
  v_id       uuid := gen_random_uuid();
  v_company  text := NULLIF(p_payload->>'company_name', '');
  v_parts    jsonb;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'company_name is required';
  END IF;

  -- Next sequence number for today (table column qualified to avoid clash with OUT param)
  SELECT COALESCE(MAX((m[1])::int), 0) + 1 INTO v_seq
  FROM public.rfqs r
  CROSS JOIN LATERAL regexp_match(r.rfq_number, '^' || v_prefix || '-' || v_date || '-(\d+)$') AS m
  WHERE r.rfq_number LIKE v_prefix || '-' || v_date || '-%';

  v_number := v_prefix || '-' || v_date || '-' || v_seq;

  SELECT COALESCE(jsonb_agg(
           (part - 'rfq_id' - 'product_name')
           || jsonb_build_object(
                'rfq_id', v_id::text,
                'product_name', 'Part ' || idx || ' ' || v_number || '-' || idx
              )
           ORDER BY idx), '[]'::jsonb)
    INTO v_parts
  FROM (
    SELECT part, row_number() OVER () AS idx
    FROM jsonb_array_elements(COALESCE(p_payload->'parts', '[]'::jsonb)) AS part
  ) s;

  INSERT INTO public.rfqs (
    id, title, company_name, vat_id, address, city, zip_code, country,
    contact_first_name, contact_last_name, contact_position, contact_email,
    contact_phone, mobile, customer_id, status, currency, due_date, version,
    description, parts_details, rfq_number
  ) VALUES (
    v_id,
    v_number || ' - ' || v_company,
    v_company,
    p_payload->>'vat_id',
    p_payload->>'address',
    p_payload->>'city',
    p_payload->>'zip_code',
    p_payload->>'country',
    p_payload->>'contact_first_name',
    p_payload->>'contact_last_name',
    p_payload->>'contact_position',
    p_payload->>'contact_email',
    p_payload->>'contact_phone',
    p_payload->>'mobile',
    NULL,
    CASE WHEN v_is_order THEN 'approved' ELSE 'draft' END,
    'EUR',
    COALESCE(NULLIF(p_payload->>'due_date', '')::timestamptz, now() + interval '7 days'),
    1,
    p_payload->>'description',
    v_parts,
    v_number
  );

  RETURN QUERY SELECT v_id, v_number;
END;
$func$;

REVOKE ALL ON FUNCTION public.create_public_rfq(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_public_rfq(jsonb) TO anon, authenticated;
