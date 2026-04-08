-- ============================================================================
-- Allow tenant_admins to manage their own capabilities and quote fields
-- Migration: 20260408_fix_tenant_admin_capabilities_permissions
-- ============================================================================

-- Allow tenant_admins to manage their own tenant's capabilities
CREATE POLICY "tenant_admin_manage_own_capabilities" ON public.tenant_capabilities
  FOR ALL USING (
    public.has_tenant_role(tenant_id, 'tenant_admin')
  ) WITH CHECK (
    public.has_tenant_role(tenant_id, 'tenant_admin')
  );

-- Allow tenant_admins to manage their own tenant's quote fields
CREATE POLICY "tenant_admin_manage_own_quote_fields" ON public.tenant_quote_fields
  FOR ALL USING (
    public.has_tenant_role(tenant_id, 'tenant_admin')
  ) WITH CHECK (
    public.has_tenant_role(tenant_id, 'tenant_admin')
  );
