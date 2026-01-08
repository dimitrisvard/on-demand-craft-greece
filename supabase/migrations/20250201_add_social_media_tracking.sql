-- Add social media posting tracking columns to articles table
ALTER TABLE public.articles 
ADD COLUMN IF NOT EXISTS posted_to_facebook BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS posted_to_linkedin BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS facebook_post_id TEXT,
ADD COLUMN IF NOT EXISTS linkedin_post_id TEXT,
ADD COLUMN IF NOT EXISTS social_posted_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster filtering of posted articles
CREATE INDEX IF NOT EXISTS idx_articles_social_status ON public.articles(posted_to_facebook, posted_to_linkedin);
