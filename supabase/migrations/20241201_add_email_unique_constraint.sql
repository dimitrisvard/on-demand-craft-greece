-- Add unique constraint on email field in customers table
-- This ensures that customers are uniquely identified by email address

-- First, check if there are any duplicate emails and handle them
-- This will help identify any existing duplicates before adding the constraint

-- Add unique constraint on email field
ALTER TABLE public.customers 
ADD CONSTRAINT customers_email_unique UNIQUE (email);

-- Add index on email field for faster lookups
CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(email);

-- Add comment to document the constraint
COMMENT ON CONSTRAINT customers_email_unique ON public.customers IS 'Ensures customer uniqueness by email address';























