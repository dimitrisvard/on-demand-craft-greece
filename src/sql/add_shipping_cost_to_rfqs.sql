-- Add shipping_cost field to rfqs table for shipping cost calculations
ALTER TABLE public.rfqs 
ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(10,2) DEFAULT 0.00;

-- Add comment to explain the field
COMMENT ON COLUMN public.rfqs.shipping_cost IS 'Shipping cost in euros for the RFQ';

-- Update existing records to have 0.00 shipping cost
UPDATE public.rfqs 
SET shipping_cost = 0.00 
WHERE shipping_cost IS NULL;
