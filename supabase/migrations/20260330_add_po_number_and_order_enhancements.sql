-- Add po_number field to orders table for storing the generated PO identifier
ALTER TABLE orders ADD COLUMN IF NOT EXISTS po_number TEXT;

-- Add from_rfq_number field to orders to store the source RFQ number
ALTER TABLE orders ADD COLUMN IF NOT EXISTS from_rfq_number TEXT;

-- Create index on po_number for quick lookups
CREATE INDEX IF NOT EXISTS idx_orders_po_number ON orders(po_number);

-- Insert "Indoors" as a production partner if it doesn't exist
INSERT INTO production_partners (company_name, contact_name, email, active, created_at, updated_at)
SELECT 'Indoors', 'In-House Production', 'internal@micronshub.eu', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM production_partners WHERE company_name = 'Indoors'
);

-- Fix: allow 'pending' status in orders (customer-side creates orders with 'pending' status)
-- The status column should accept 'pending' as a valid value
-- Check if there's a constraint and update it
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'orders' AND constraint_type = 'CHECK'
    AND constraint_name LIKE '%status%'
  ) THEN
    EXECUTE 'ALTER TABLE orders DROP CONSTRAINT ' || (
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'orders' AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%status%'
      LIMIT 1
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Constraint may not exist, that's fine
  NULL;
END $$;
