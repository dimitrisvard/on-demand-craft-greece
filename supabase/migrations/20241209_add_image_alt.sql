-- Add featured_image_alt column to articles table for localized SEO
ALTER TABLE public.articles 
ADD COLUMN IF NOT EXISTS featured_image_alt TEXT;

