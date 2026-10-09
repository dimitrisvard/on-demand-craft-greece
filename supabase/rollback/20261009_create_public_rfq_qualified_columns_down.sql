-- ============================================================================
-- Rollback for supabase/migrations/20261009_create_public_rfq_qualified_columns.sql
-- ============================================================================
-- Restores the previous definition of public.create_public_rfq(jsonb) (same signature, owner,
-- privileges and search_path; CREATE OR REPLACE keeps the existing grants). The text is written with
-- LF line endings, so a digest comparison of the restored function removes carriage returns from
-- pg_get_functiondef() first (md5(replace(pg_get_functiondef(oid), chr(13), ''))). Kept outside
-- supabase/migrations/ so that no migration tool runs it. Applied by the owner in the Supabase SQL
-- editor, in one transaction.
-- ============================================================================
BEGIN;
CREATE OR REPLACE FUNCTION public.create_public_rfq(p_payload jsonb)
 RETURNS TABLE(id uuid, rfq_number text, customer_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'company_name is required';
  END IF;

  -- ---- Resolve the customer this RFQ belongs to ----------------------------
  IF v_uid IS NOT NULL THEN
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_uid;
  END IF;
  v_match_email := COALESCE(v_auth_email, v_contact_email);

  -- 1) already linked to this auth user
  IF v_uid IS NOT NULL THEN
    SELECT c.id INTO v_customer_id
    FROM public.customers c
    WHERE c.user_id = v_uid
    ORDER BY c.created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  -- 2) otherwise match by e-mail
  IF v_customer_id IS NULL AND v_match_email IS NOT NULL THEN
    SELECT c.id INTO v_customer_id
    FROM public.customers c
    WHERE c.email IS NOT NULL AND lower(c.email) = lower(v_match_email)
    ORDER BY c.created_at ASC NULLS LAST
    LIMIT 1;

    -- self-heal the auth link when we found the row by e-mail
    IF v_customer_id IS NOT NULL AND v_uid IS NOT NULL THEN
      UPDATE public.customers
      SET user_id = v_uid
      WHERE id = v_customer_id AND user_id IS NULL;
    END IF;
  END IF;

  -- 3) still nothing — create a customer from the submitted contact details
  IF v_customer_id IS NULL AND v_match_email IS NOT NULL THEN
    INSERT INTO public.customers (
      user_id, email, first_name, last_name, contact_name, company_name,
      phone, mobile, vat_tax_id, address, city, zip_code, country,
      status, created_at, updated_at
    ) VALUES (
      v_uid,
      v_match_email,
      p_payload->>'contact_first_name',
      p_payload->>'contact_last_name',
      NULLIF(trim(concat_ws(' ', p_payload->>'contact_first_name', p_payload->>'contact_last_name')), ''),
      v_company,
      p_payload->>'contact_phone',
      p_payload->>'mobile',
      p_payload->>'vat_id',
      p_payload->>'address',
      p_payload->>'city',
      p_payload->>'zip_code',
      p_payload->>'country',
      'active',
      now(),
      now()
    )
    RETURNING public.customers.id INTO v_customer_id;
  END IF;

  -- ---- Next sequence number for today --------------------------------------
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
    v_customer_id,
    CASE WHEN v_is_order THEN 'approved' ELSE 'draft' END,
    'EUR',
    COALESCE(NULLIF(p_payload->>'due_date', '')::timestamptz, now() + interval '7 days'),
    1,
    p_payload->>'description',
    v_parts,
    v_number
  );

  RETURN QUERY SELECT v_id, v_number, v_customer_id;
END;
$function$
;

COMMIT;
