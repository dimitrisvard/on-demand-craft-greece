-- Create marketing subscribers table
CREATE TABLE IF NOT EXISTS public.marketing_subscribers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    tags JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create marketing campaigns table
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    subject_a TEXT NOT NULL,
    subject_b TEXT,
    body TEXT NOT NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
    ab_test_config JSONB DEFAULT '{
        "enabled": false,
        "test_percentage": 20,
        "winning_metric": "opens",
        "duration_hours": 4
    }'::jsonb,
    sent_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create marketing analytics table
CREATE TABLE IF NOT EXISTS public.marketing_analytics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id UUID REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    opens INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    bounces INTEGER DEFAULT 0,
    heatmap_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create campaign events table to track individual sends/opens/clicks
CREATE TABLE IF NOT EXISTS public.marketing_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id UUID REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
    subscriber_id UUID REFERENCES public.marketing_subscribers(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_marketing_subscribers_email ON public.marketing_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_marketing_subscribers_status ON public.marketing_subscribers(status);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON public.marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_marketing_analytics_campaign_id ON public.marketing_analytics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_marketing_events_campaign_id ON public.marketing_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_marketing_events_subscriber_id ON public.marketing_events(subscriber_id);

-- Enable Row Level Security
ALTER TABLE public.marketing_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;

-- Create policies (assuming only authenticated admins can manage marketing)
-- Adjust 'authenticated' to specific role if needed
CREATE POLICY "Enable all access for authenticated users" ON public.marketing_subscribers
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Enable all access for authenticated users" ON public.marketing_campaigns
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Enable all access for authenticated users" ON public.marketing_analytics
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Enable all access for authenticated users" ON public.marketing_events
    FOR ALL USING (auth.role() = 'authenticated');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_marketing_subscribers_updated_at
    BEFORE UPDATE ON public.marketing_subscribers
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at_column();

CREATE TRIGGER update_marketing_campaigns_updated_at
    BEFORE UPDATE ON public.marketing_campaigns
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at_column();

CREATE TRIGGER update_marketing_analytics_updated_at
    BEFORE UPDATE ON public.marketing_analytics
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at_column();

