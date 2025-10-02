-- Allow customer_id to be NULL in rfqs table
-- This enables creating RFQs without immediate customer assignment
-- Customers can be assigned later through the admin interface

-- Remove NOT NULL constraint from customer_id column
ALTER TABLE public.rfqs 
ALTER COLUMN customer_id DROP NOT NULL;

-- Add comment to explain the change
COMMENT ON COLUMN public.rfqs.customer_id IS 'Customer ID - can be NULL if customer not yet assigned';

-- Update the foreign key constraint to handle NULL values
-- The existing foreign key constraint should already handle NULL values correctly
-- but let's ensure it's properly documented

-- Add an index on customer_id for better performance when filtering by customer
CREATE INDEX IF NOT EXISTS idx_rfqs_customer_id ON public.rfqs(customer_id) WHERE customer_id IS NOT NULL;

-- Add comment to document the index
COMMENT ON INDEX idx_rfqs_customer_id IS 'Index for faster customer-based RFQ lookups, excludes NULL values';
