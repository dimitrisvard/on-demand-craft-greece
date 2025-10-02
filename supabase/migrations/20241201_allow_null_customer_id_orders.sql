-- Allow customer_id to be NULL in orders table
-- This enables creating orders without immediate customer assignment
-- Customers can be assigned later through the admin interface

-- Remove NOT NULL constraint from customer_id column (if it exists)
ALTER TABLE public.orders 
ALTER COLUMN customer_id DROP NOT NULL;

-- Add comment to explain the change
COMMENT ON COLUMN public.orders.customer_id IS 'Customer ID - can be NULL if customer not yet assigned';

-- Add an index on customer_id for better performance when filtering by customer
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id) WHERE customer_id IS NOT NULL;

-- Add comment to document the index
COMMENT ON INDEX idx_orders_customer_id IS 'Index for faster customer-based order lookups, excludes NULL values';
