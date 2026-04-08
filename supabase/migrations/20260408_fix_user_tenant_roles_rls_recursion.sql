-- ============================================================================
-- Fix infinite recursion in RLS policies for user_tenant_roles
-- Migration: 20260408_fix_user_tenant_roles_rls_recursion
--
-- Problem: The "super_admin_manage_roles" policy on user_tenant_roles
-- queries user_tenant_roles itself, triggering the same RLS check
-- recursively. Similarly, all other tables' policies that query
-- user_tenant_roles trigger the same recursion.
--
-- Solution: Create SECURITY DEFINER helper functions that bypass RLS
-- to check user roles, then rewrite all affected policies to use them.
-- ============================================================================

-- ─── 1. SECURITY DEFINER HELPER FUNCTIONS ──────────────────────────────────
-- These functions run with the privileges of the function owner (superuser),
-- bypassing RLS on user_tenant_roles to break the recursion cycle.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.user_tenant_roles
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(p_tenant_id UUID, p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
      AND tenant_id = p_tenant_id
      AND role = p_role
  );
$$;

-- ─── 2. FIX user_tenant_roles POLICIES (the root cause) ───────────────────

DROP POLICY IF EXISTS "super_admin_manage_roles" ON public.user_tenant_roles;

CREATE POLICY "super_admin_manage_roles" ON public.user_tenant_roles
  FOR ALL USING (public.is_super_admin());

-- ─── 3. FIX tenants POLICIES ──────────────────────────────────────────────

DROP POLICY IF EXISTS "super_admin_manage_tenants" ON public.tenants;

CREATE POLICY "super_admin_manage_tenants" ON public.tenants
  FOR ALL USING (public.is_super_admin());

-- ─── 4. FIX capabilities_registry POLICIES ────────────────────────────────

DROP POLICY IF EXISTS "super_admin_manage_capabilities" ON public.capabilities_registry;

CREATE POLICY "super_admin_manage_capabilities" ON public.capabilities_registry
  FOR ALL USING (public.is_super_admin());

-- ─── 5. FIX tenant_capabilities POLICIES ──────────────────────────────────

DROP POLICY IF EXISTS "tenant_read_own_capabilities" ON public.tenant_capabilities;

CREATE POLICY "tenant_read_own_capabilities" ON public.tenant_capabilities
  FOR SELECT USING (
    tenant_id IN (SELECT public.get_user_tenant_ids())
  );

DROP POLICY IF EXISTS "super_admin_manage_tenant_capabilities" ON public.tenant_capabilities;

CREATE POLICY "super_admin_manage_tenant_capabilities" ON public.tenant_capabilities
  FOR ALL USING (public.is_super_admin());

-- ─── 6. FIX tenant_quote_fields POLICIES ──────────────────────────────────

DROP POLICY IF EXISTS "tenant_read_own_quote_fields" ON public.tenant_quote_fields;

CREATE POLICY "tenant_read_own_quote_fields" ON public.tenant_quote_fields
  FOR SELECT USING (
    tenant_id IN (SELECT public.get_user_tenant_ids())
  );

DROP POLICY IF EXISTS "super_admin_manage_tenant_quote_fields" ON public.tenant_quote_fields;

CREATE POLICY "super_admin_manage_tenant_quote_fields" ON public.tenant_quote_fields
  FOR ALL USING (public.is_super_admin());

-- ─── 7. FIX tenant_pages POLICIES ─────────────────────────────────────────

DROP POLICY IF EXISTS "tenant_admin_manage_pages" ON public.tenant_pages;

CREATE POLICY "tenant_admin_manage_pages" ON public.tenant_pages
  FOR ALL USING (
    public.is_super_admin()
    OR public.has_tenant_role(tenant_id, 'tenant_admin')
  );

-- ─── 8. FIX TENANT ISOLATION POLICIES ON EXISTING TABLES ─────────────────

-- customers
DROP POLICY IF EXISTS "tenant_isolation_customers" ON public.customers;
CREATE POLICY "tenant_isolation_customers" ON public.customers
  FOR ALL USING (
    tenant_id IN (SELECT public.get_user_tenant_ids())
    OR public.is_super_admin()
  );

-- orders
DROP POLICY IF EXISTS "tenant_isolation_orders" ON public.orders;
CREATE POLICY "tenant_isolation_orders" ON public.orders
  FOR ALL USING (
    tenant_id IN (SELECT public.get_user_tenant_ids())
    OR public.is_super_admin()
  );

-- rfqs
DROP POLICY IF EXISTS "tenant_isolation_rfqs" ON public.rfqs;
CREATE POLICY "tenant_isolation_rfqs" ON public.rfqs
  FOR ALL USING (
    tenant_id IN (SELECT public.get_user_tenant_ids())
    OR public.is_super_admin()
  );

-- production_partners
DROP POLICY IF EXISTS "tenant_isolation_production_partners" ON public.production_partners;
CREATE POLICY "tenant_isolation_production_partners" ON public.production_partners
  FOR ALL USING (
    tenant_id IN (SELECT public.get_user_tenant_ids())
    OR public.is_super_admin()
  );

-- products
DROP POLICY IF EXISTS "tenant_isolation_products" ON public.products;
CREATE POLICY "tenant_isolation_products" ON public.products
  FOR ALL USING (
    tenant_id IN (SELECT public.get_user_tenant_ids())
    OR public.is_super_admin()
  );
