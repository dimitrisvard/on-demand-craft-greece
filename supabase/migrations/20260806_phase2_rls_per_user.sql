-- ============================================================================
-- Phase 2 RLS: per-user row isolation for business tables.
--
-- Background: 20260713_enable_rls_security.sql secured tables against anon but
-- gave every *authenticated* user full access (authenticated_full_access,
-- USING true) as a stop-gap, with per-user isolation flagged as phase 2.
-- Consequences observed in production:
--   * every logged-in customer saw EVERY customer's RFQs/orders in the portal
--     (My Projects fetches rfqs with no filter), and
--   * could update/delete them — pg_stat shows 27 of 34 rfqs ever inserted were
--     deleted, incl. RFQ-02082026-2, which is why new RFQs kept "disappearing".
--
-- Model after this migration:
--   * staff  (user_roles.role in admin, sales_rep, production_manager,
--     accountant — plus tenant super admins): full access, CRM unchanged.
--   * customers: see/update only rows belonging to their own customers row
--     (matched via customers.user_id = auth.uid(), with an e-mail fallback);
--     may delete only their own DRAFT rfqs; may create orders/order_items for
--     their own rfqs (portal "Accept Quote" flow).
--   * partner sellers/suppliers: see unclaimed status='new' orders (job
--     board) plus orders assigned to their production_partners row (matched
--     by e-mail), and read the linked rfq + files.
--   * anon: nothing (public quote form goes through SECURITY DEFINER
--     create_public_rfq(), unaffected by RLS).
--   * service_role and tenant_isolation_* policies are untouched.
-- ============================================================================

-- ---- Helper functions (SECURITY DEFINER ⇒ no RLS recursion) ----------------

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'sales_rep', 'production_manager', 'accountant')
  ) OR public.is_super_admin();
$$;

CREATE OR REPLACE FUNCTION public.my_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id FROM public.customers c
  WHERE (c.user_id IS NOT NULL AND c.user_id = auth.uid())
     OR (c.email IS NOT NULL
         AND lower(c.email) = lower(coalesce(auth.jwt()->>'email', '')));
$$;

CREATE OR REPLACE FUNCTION public.my_rfq_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.id FROM public.rfqs r
  WHERE r.customer_id IN (SELECT public.my_customer_ids());
$$;

CREATE OR REPLACE FUNCTION public.my_order_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.id FROM public.orders o
  WHERE o.customer_id IN (SELECT public.my_customer_ids());
$$;

-- Partner users (roles partner_seller / supplier) authenticate with an e-mail
-- that matches a production_partners row; orders.partner_id stores
-- production_partners.id (see OrderDetailsPage assignment + DashboardOverview).
CREATE OR REPLACE FUNCTION public.is_partner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('partner_seller', 'supplier')
  );
$$;

CREATE OR REPLACE FUNCTION public.my_partner_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pp.id FROM public.production_partners pp
  WHERE pp.email IS NOT NULL
    AND lower(pp.email) = lower(coalesce(auth.jwt()->>'email', ''));
$$;

-- Orders a partner may see: their own + unclaimed new jobs (job board).
CREATE OR REPLACE FUNCTION public.partner_visible_order_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.id FROM public.orders o
  WHERE o.partner_id IN (SELECT public.my_partner_ids())
     OR (o.status = 'new' AND o.partner_id IS NULL);
$$;

CREATE OR REPLACE FUNCTION public.partner_visible_rfq_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.rfq_id FROM public.orders o
  WHERE o.rfq_id IS NOT NULL
    AND (o.partner_id IN (SELECT public.my_partner_ids())
         OR (o.status = 'new' AND o.partner_id IS NULL));
$$;

REVOKE ALL ON FUNCTION public.is_staff(), public.is_partner(),
  public.my_customer_ids(), public.my_rfq_ids(), public.my_order_ids(),
  public.my_partner_ids(), public.partner_visible_order_ids(),
  public.partner_visible_rfq_ids()
  FROM public;
GRANT EXECUTE ON FUNCTION public.is_staff(), public.is_partner(),
  public.my_customer_ids(), public.my_rfq_ids(), public.my_order_ids(),
  public.my_partner_ids(), public.partner_visible_order_ids(),
  public.partner_visible_rfq_ids()
  TO authenticated;

-- PO number generation needs to count ALL orders for today, which a scoped
-- customer can no longer do client-side; do it server-side instead.
CREATE OR REPLACE FUNCTION public.next_po_number()
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

-- ---- rfqs -------------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_full_access ON public.rfqs;

DROP POLICY IF EXISTS rfqs_staff_all ON public.rfqs;
CREATE POLICY rfqs_staff_all ON public.rfqs
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS rfqs_customer_select ON public.rfqs;
CREATE POLICY rfqs_customer_select ON public.rfqs
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT public.my_customer_ids()));

DROP POLICY IF EXISTS rfqs_customer_insert ON public.rfqs;
CREATE POLICY rfqs_customer_insert ON public.rfqs
  FOR INSERT TO authenticated
  WITH CHECK (customer_id IN (SELECT public.my_customer_ids()));

DROP POLICY IF EXISTS rfqs_customer_update ON public.rfqs;
CREATE POLICY rfqs_customer_update ON public.rfqs
  FOR UPDATE TO authenticated
  USING (customer_id IN (SELECT public.my_customer_ids()))
  WITH CHECK (customer_id IN (SELECT public.my_customer_ids()));

-- Customers may delete ONLY their own drafts; anything further along the
-- pipeline (sent/received/approved) is CRM history and needs an admin.
DROP POLICY IF EXISTS rfqs_customer_delete_draft ON public.rfqs;
CREATE POLICY rfqs_customer_delete_draft ON public.rfqs
  FOR DELETE TO authenticated
  USING (customer_id IN (SELECT public.my_customer_ids()) AND status = 'draft');

DROP POLICY IF EXISTS rfqs_partner_select ON public.rfqs;
CREATE POLICY rfqs_partner_select ON public.rfqs
  FOR SELECT TO authenticated
  USING (public.is_partner()
         AND id IN (SELECT public.partner_visible_rfq_ids()));

-- ---- orders -----------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_full_access ON public.orders;

DROP POLICY IF EXISTS orders_staff_all ON public.orders;
CREATE POLICY orders_staff_all ON public.orders
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS orders_customer_select ON public.orders;
CREATE POLICY orders_customer_select ON public.orders
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT public.my_customer_ids()));

-- Portal "Accept Quote" inserts an order carrying the rfq's customer_id.
-- The (customer_id IS NULL AND rfq_id in own rfqs) arm keeps the currently
-- deployed quote-form build working (it still inserts direct orders with
-- customer_id null); tighten once the new client is live everywhere.
DROP POLICY IF EXISTS orders_customer_insert ON public.orders;
CREATE POLICY orders_customer_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_id IN (SELECT public.my_customer_ids())
    OR (customer_id IS NULL AND rfq_id IN (SELECT public.my_rfq_ids()))
  );

DROP POLICY IF EXISTS orders_partner_select ON public.orders;
CREATE POLICY orders_partner_select ON public.orders
  FOR SELECT TO authenticated
  USING (public.is_partner()
         AND id IN (SELECT public.partner_visible_order_ids()));

-- Partners may claim an unclaimed new job or update their own; every write
-- must leave the row assigned to them.
DROP POLICY IF EXISTS orders_partner_update ON public.orders;
CREATE POLICY orders_partner_update ON public.orders
  FOR UPDATE TO authenticated
  USING (public.is_partner()
         AND id IN (SELECT public.partner_visible_order_ids()))
  WITH CHECK (public.is_partner()
              AND partner_id IN (SELECT public.my_partner_ids()));

-- ---- order_items ------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_full_access ON public.order_items;

DROP POLICY IF EXISTS order_items_staff_all ON public.order_items;
CREATE POLICY order_items_staff_all ON public.order_items
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS order_items_customer_select ON public.order_items;
CREATE POLICY order_items_customer_select ON public.order_items
  FOR SELECT TO authenticated
  USING (order_id IN (SELECT public.my_order_ids()));

DROP POLICY IF EXISTS order_items_customer_insert ON public.order_items;
CREATE POLICY order_items_customer_insert ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK (order_id IN (SELECT public.my_order_ids()));

DROP POLICY IF EXISTS order_items_partner_select ON public.order_items;
CREATE POLICY order_items_partner_select ON public.order_items
  FOR SELECT TO authenticated
  USING (public.is_partner()
         AND order_id IN (SELECT public.partner_visible_order_ids()));

-- ---- customers --------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_full_access ON public.customers;
DROP POLICY IF EXISTS "Allow authenticated users to insert customers" ON public.customers;
DROP POLICY IF EXISTS "Allow authenticated users to view customers" ON public.customers;
DROP POLICY IF EXISTS "Allow insert for all users" ON public.customers;

DROP POLICY IF EXISTS customers_staff_all ON public.customers;
CREATE POLICY customers_staff_all ON public.customers
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS customers_self_select ON public.customers;
CREATE POLICY customers_self_select ON public.customers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR (email IS NOT NULL
             AND lower(email) = lower(coalesce(auth.jwt()->>'email', ''))));

DROP POLICY IF EXISTS customers_self_update ON public.customers;
CREATE POLICY customers_self_update ON public.customers
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()
         OR (email IS NOT NULL
             AND lower(email) = lower(coalesce(auth.jwt()->>'email', ''))))
  WITH CHECK (user_id = auth.uid()
              OR (email IS NOT NULL
                  AND lower(email) = lower(coalesce(auth.jwt()->>'email', ''))));

-- Signup flow (AuthContext) inserts the user's own customers row.
DROP POLICY IF EXISTS customers_self_insert ON public.customers;
CREATE POLICY customers_self_insert ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
              OR (email IS NOT NULL
                  AND lower(email) = lower(coalesce(auth.jwt()->>'email', ''))));

-- ---- customer_contacts (admin CRM feature) ----------------------------------
DROP POLICY IF EXISTS authenticated_full_access ON public.customer_contacts;

DROP POLICY IF EXISTS customer_contacts_staff_all ON public.customer_contacts;
CREATE POLICY customer_contacts_staff_all ON public.customer_contacts
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ---- rfq_files: drop the pile of wide-open legacy policies ------------------
DROP POLICY IF EXISTS "Allow authenticated users to insert files" ON public.rfq_files;
DROP POLICY IF EXISTS "Allow owners to delete files" ON public.rfq_files;
DROP POLICY IF EXISTS "Allow owners to update and delete files" ON public.rfq_files;
DROP POLICY IF EXISTS "Allow public read access to rfq_files" ON public.rfq_files;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.rfq_files;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.rfq_files;
DROP POLICY IF EXISTS "Enable public access for all operations on rfq_files" ON public.rfq_files;
DROP POLICY IF EXISTS "Enable public access for rfq_files" ON public.rfq_files;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.rfq_files;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.rfq_files;

DROP POLICY IF EXISTS rfq_files_staff_all ON public.rfq_files;
CREATE POLICY rfq_files_staff_all ON public.rfq_files
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS rfq_files_customer_select ON public.rfq_files;
CREATE POLICY rfq_files_customer_select ON public.rfq_files
  FOR SELECT TO authenticated
  USING (rfq_id IN (SELECT public.my_rfq_ids()));

DROP POLICY IF EXISTS rfq_files_customer_insert ON public.rfq_files;
CREATE POLICY rfq_files_customer_insert ON public.rfq_files
  FOR INSERT TO authenticated
  WITH CHECK (rfq_id IN (SELECT public.my_rfq_ids()));

DROP POLICY IF EXISTS rfq_files_customer_delete ON public.rfq_files;
CREATE POLICY rfq_files_customer_delete ON public.rfq_files
  FOR DELETE TO authenticated
  USING (rfq_id IN (SELECT public.my_rfq_ids()));

DROP POLICY IF EXISTS rfq_files_partner_select ON public.rfq_files;
CREATE POLICY rfq_files_partner_select ON public.rfq_files
  FOR SELECT TO authenticated
  USING (public.is_partner()
         AND rfq_id IN (SELECT public.partner_visible_rfq_ids()));

-- ---- rfq_items / rfq_parts / rfq_part_files ---------------------------------
DROP POLICY IF EXISTS authenticated_full_access ON public.rfq_items;
DROP POLICY IF EXISTS rfq_items_staff_all ON public.rfq_items;
CREATE POLICY rfq_items_staff_all ON public.rfq_items
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS rfq_items_customer_select ON public.rfq_items;
CREATE POLICY rfq_items_customer_select ON public.rfq_items
  FOR SELECT TO authenticated
  USING (rfq_id IN (SELECT public.my_rfq_ids()));

DROP POLICY IF EXISTS authenticated_full_access ON public.rfq_parts;
DROP POLICY IF EXISTS rfq_parts_staff_all ON public.rfq_parts;
CREATE POLICY rfq_parts_staff_all ON public.rfq_parts
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS rfq_parts_customer_select ON public.rfq_parts;
CREATE POLICY rfq_parts_customer_select ON public.rfq_parts
  FOR SELECT TO authenticated
  USING (rfq_id IN (SELECT public.my_rfq_ids()));

DROP POLICY IF EXISTS authenticated_full_access ON public.rfq_part_files;
DROP POLICY IF EXISTS rfq_part_files_staff_all ON public.rfq_part_files;
CREATE POLICY rfq_part_files_staff_all ON public.rfq_part_files
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS rfq_part_files_customer_select ON public.rfq_part_files;
CREATE POLICY rfq_part_files_customer_select ON public.rfq_part_files
  FOR SELECT TO authenticated
  USING (part_id IN (
    SELECT p.id FROM public.rfq_parts p
    WHERE p.rfq_id IN (SELECT public.my_rfq_ids())
  ));

-- ---- user_roles: let staff read all roles (admin Customers page) ------------
DROP POLICY IF EXISTS user_roles_staff_select ON public.user_roles;
CREATE POLICY user_roles_staff_select ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_staff());

-- ---- Create/link the customers row at signup, server-side -------------------
-- The client-side insert in AuthContext.signUp runs with no session when
-- e-mail confirmation is enabled (rejected under the new INSERT policy, error
-- swallowed). A trigger on auth.users makes the customers row reliable.
-- Partner accounts (production_partners e-mails) are skipped.
CREATE OR REPLACE FUNCTION public.handle_new_user_customer()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_first text := NEW.raw_user_meta_data->>'first_name';
  v_last  text := NEW.raw_user_meta_data->>'last_name';
  v_name  text := NULLIF(trim(concat_ws(' ', NEW.raw_user_meta_data->>'first_name',
                                             NEW.raw_user_meta_data->>'last_name')), '');
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Partner logins are not customers.
  IF EXISTS (SELECT 1 FROM public.production_partners pp
             WHERE pp.email IS NOT NULL AND lower(pp.email) = lower(NEW.email)) THEN
    RETURN NEW;
  END IF;

  -- Link an existing row created earlier (e.g. by an admin or the quote RPC).
  UPDATE public.customers
  SET user_id = NEW.id
  WHERE user_id IS NULL AND email IS NOT NULL AND lower(email) = lower(NEW.email);

  IF NOT EXISTS (SELECT 1 FROM public.customers c
                 WHERE c.user_id = NEW.id
                    OR (c.email IS NOT NULL AND lower(c.email) = lower(NEW.email))) THEN
    INSERT INTO public.customers (
      user_id, email, first_name, last_name, contact_name, company_name,
      status, created_at, updated_at
    ) VALUES (
      NEW.id, NEW.email, v_first, v_last, v_name,
      COALESCE(v_name, NEW.email), 'active', now(), now()
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block a signup because of a CRM bookkeeping failure; the row can
  -- also be created later by create_public_rfq() on first quote.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_customer ON auth.users;
CREATE TRIGGER on_auth_user_created_customer
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_customer();

-- ---- One CRM row per e-mail --------------------------------------------------
-- (verified: no duplicate e-mails exist today). Prevents the signup trigger,
-- the client-side signup insert, and create_public_rfq from ever racing into
-- duplicate customers rows for the same e-mail.
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_unique_idx
  ON public.customers (lower(email)) WHERE email IS NOT NULL;
