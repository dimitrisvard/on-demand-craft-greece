
-- Add missing fields to rfqs table
ALTER TABLE public.rfqs 
ADD COLUMN IF NOT EXISTS total_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS due_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

-- Rename the deadline column to due_date for consistency if it exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rfqs' AND column_name = 'deadline') THEN
    ALTER TABLE public.rfqs RENAME COLUMN deadline TO due_date;
  END IF;
END
$$;

-- Rename name column to product_name in rfq_items for consistency
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rfq_items' AND column_name = 'name') THEN
    ALTER TABLE public.rfq_items RENAME COLUMN name TO product_name;
  END IF;
END
$$;
