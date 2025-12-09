-- Add a translation_id column to link translated versions of the same article
ALTER TABLE public.articles 
ADD COLUMN IF NOT EXISTS translation_id UUID DEFAULT gen_random_uuid();

-- Create an index for faster lookups of translations
CREATE INDEX IF NOT EXISTS idx_articles_translation_id ON public.articles(translation_id);

-- Update existing articles to have a unique translation_id if they don't have one (handled by default, but good to be explicit for future)
-- The DEFAULT gen_random_uuid() above already handles this for existing rows if the column didn't exist.

