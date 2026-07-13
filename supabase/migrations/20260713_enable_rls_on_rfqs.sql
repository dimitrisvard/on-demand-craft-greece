-- Final step of the RLS rollout (see 20260713_enable_rls_security.sql).
-- Enabled after the client build using create_public_rfq() was deployed, so the
-- public quote form keeps working. anon has no policy on rfqs and can only
-- create RFQs through the SECURITY DEFINER create_public_rfq() function;
-- authenticated users retain full access via authenticated_full_access.
ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;
