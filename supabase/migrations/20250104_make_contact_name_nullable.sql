-- Make contact_name nullable in customers table
-- This allows RFQs to be created without immediate customer assignment
-- Contact name can be constructed from first_name and last_name when needed

ALTER TABLE public.customers 
ALTER COLUMN contact_name DROP NOT NULL;

-- Add comment to explain the change
COMMENT ON COLUMN public.customers.contact_name IS 'Contact name - can be NULL, can be constructed from first_name and last_name';

-- Create a function to automatically populate contact_name from first_name and last_name
CREATE OR REPLACE FUNCTION populate_contact_name()
RETURNS TRIGGER AS $$
BEGIN
  -- If contact_name is null but first_name and last_name are provided, populate it
  IF NEW.contact_name IS NULL AND NEW.first_name IS NOT NULL AND NEW.last_name IS NOT NULL THEN
    NEW.contact_name := CONCAT(NEW.first_name, ' ', NEW.last_name);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically populate contact_name before insert or update
CREATE TRIGGER trigger_populate_contact_name
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION populate_contact_name();

-- Add comment to document the trigger
COMMENT ON TRIGGER trigger_populate_contact_name ON public.customers IS 'Automatically populates contact_name from first_name and last_name if it is null';

