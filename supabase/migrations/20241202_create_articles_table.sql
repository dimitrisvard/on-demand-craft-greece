-- Create articles table for blog system
CREATE TABLE IF NOT EXISTS public.articles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    content TEXT NOT NULL,
    excerpt TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    featured_image TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    meta_title TEXT,
    meta_description TEXT,
    author_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create unique constraint on slug per language
CREATE UNIQUE INDEX IF NOT EXISTS articles_slug_language_idx ON public.articles (slug, language);

-- Enable Row Level Security
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

-- Create policies
-- 1. Public read access for published articles
CREATE POLICY "Allow public read access for published articles" 
ON public.articles FOR SELECT 
USING (status = 'published');

-- 2. Full access for authenticated users (admins/editors)
-- Note: In a real production app, you might want to check specific roles here
-- For now, we assume any authenticated dashboard user can manage articles
CREATE POLICY "Allow authenticated users full access" 
ON public.articles FOR ALL 
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_articles_updated_at
    BEFORE UPDATE ON public.articles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
