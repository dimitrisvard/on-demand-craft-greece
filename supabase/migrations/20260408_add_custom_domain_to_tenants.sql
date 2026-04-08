-- ============================================================================
-- Add custom domain support to tenants
-- Migration: 20260408_add_custom_domain_to_tenants
--
-- Allows tenants to use their own domain (e.g., www.laserkritis.gr)
-- in addition to their subdomain (laserkritis.micronshub.eu).
-- ============================================================================

-- Add custom_domain and domain_verified columns
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN DEFAULT false;

-- Partial index for fast lookups (only non-null domains)
CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain
  ON public.tenants(custom_domain)
  WHERE custom_domain IS NOT NULL;
