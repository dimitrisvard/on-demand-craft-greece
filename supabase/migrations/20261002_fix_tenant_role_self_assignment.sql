-- ============================================================================
-- H-5: stop users granting themselves tenant roles
-- ============================================================================
-- The policy "users_insert_own_tenant_roles" (20260408_fix_user_tenant_roles_
-- rls_recursion.sql) lets any authenticated user insert a user_tenant_roles
-- row for themselves with role 'tenant_admin' or 'tenant_user' for ANY tenant.
-- That row then passes get_user_tenant_ids() / has_tenant_role(), which gate
-- ALL access to that tenant's customers, orders, rfqs, products,
-- production_partners, tenant_pages, tenant_capabilities, tenant_quote_fields
-- and UPDATE on the tenant itself.
--
-- The policy was added for TenantEditPage.tsx, which calls signUp() (switching
-- the session to the new user) before assigning the role. The page restores
-- the super_admin session before the insert, so "super_admin_manage_roles"
-- (FOR ALL USING is_super_admin(), which Postgres also applies as the INSERT
-- check) already covers it. Edge functions use the service role and bypass RLS.
--
-- Live state on 2026-10-02: 2 rows (1 super_admin, 1 tenant_admin for
-- laserkritis, both expected); no sign the policy was abused.
--
-- Rollback: re-create the policy from 20260408_fix_user_tenant_roles_rls_
-- recursion.sql:66-69 (not recommended).
-- ============================================================================

BEGIN;

-- Refuse to run if super admins would lose the ability to assign roles.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_tenant_roles'
      AND policyname = 'super_admin_manage_roles'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'super_admin_manage_roles is missing on public.user_tenant_roles; aborting';
  END IF;
END $$;

DROP POLICY IF EXISTS "users_insert_own_tenant_roles" ON public.user_tenant_roles;

COMMIT;
