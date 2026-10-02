-- ============================================================================
-- Tighten role assignment on public.user_tenant_roles (RISKS.md H-5)
-- ============================================================================
-- Role rows are assigned by super admins only, through "super_admin_manage_roles".
-- The page that creates tenant admins (TenantEditPage.tsx) already runs that
-- insert as the super admin. Edge functions use the service role.
--
-- Rollback: re-create the dropped policy from
-- 20260408_fix_user_tenant_roles_rls_recursion.sql.
-- ============================================================================

BEGIN;

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
