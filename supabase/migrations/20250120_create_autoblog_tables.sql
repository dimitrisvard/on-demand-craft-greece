-- Create article_titles table for automated blog generation
CREATE TABLE IF NOT EXISTS public.article_titles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    silo_category TEXT, -- Pillar/Cluster for semantic grouping
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create article_generation_logs table for tracking automation runs
CREATE TABLE IF NOT EXISTS public.article_generation_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    summary_data JSONB NOT NULL, -- Stores counts of successful translations, indexing status, etc.
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups of unprocessed titles
CREATE INDEX IF NOT EXISTS idx_article_titles_processed ON public.article_titles(processed) WHERE processed = FALSE;

-- Create index for silo_category lookups
CREATE INDEX IF NOT EXISTS idx_article_titles_silo_category ON public.article_titles(silo_category);

-- Enable Row Level Security
ALTER TABLE public.article_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_generation_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for article_titles
-- Public read access (for potential future public API)
CREATE POLICY "Allow public read access for article_titles" 
ON public.article_titles FOR SELECT 
USING (true);

-- Full access for authenticated users
CREATE POLICY "Allow authenticated users full access to article_titles" 
ON public.article_titles FOR ALL 
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- RLS Policies for article_generation_logs
-- Public read access
CREATE POLICY "Allow public read access for article_generation_logs" 
ON public.article_generation_logs FOR SELECT 
USING (true);

-- Full access for authenticated users
CREATE POLICY "Allow authenticated users full access to article_generation_logs" 
ON public.article_generation_logs FOR ALL 
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- Create updated_at trigger for article_titles
CREATE TRIGGER update_article_titles_updated_at
    BEFORE UPDATE ON public.article_titles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

