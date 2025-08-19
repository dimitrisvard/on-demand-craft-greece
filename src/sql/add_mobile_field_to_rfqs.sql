-- Add mobile field to rfqs table for SMS notifications
ALTER TABLE public.rfqs 
ADD COLUMN IF NOT EXISTS mobile TEXT;

-- Add comment to explain the field
COMMENT ON COLUMN public.rfqs.mobile IS 'Mobile phone number for SMS notifications';
