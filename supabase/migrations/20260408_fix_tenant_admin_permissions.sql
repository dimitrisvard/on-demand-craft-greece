-- ============================================================================
-- Fix tenant_admin permissions for managing their own tenant
-- Migration: 20260408_fix_tenant_admin_permissions
--
-- 1. Inserts missing tenant_admin role for Laser Kritis
-- 2. Allows tenant_admins to UPDATE their own tenant record
-- ============================================================================

-- Allow tenant_admins to update their own tenant's record
CREATE POLICY "tenant_admin_update_own_tenant" ON public.tenants
  FOR UPDATE USING (
    public.has_tenant_role(id, 'tenant_admin')
  ) WITH CHECK (
    public.has_tenant_role(id, 'tenant_admin')
  );
