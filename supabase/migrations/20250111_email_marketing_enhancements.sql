-- Add target audience to campaigns
ALTER TABLE public.marketing_campaigns ADD COLUMN IF NOT EXISTS target_tags TEXT[] DEFAULT '{}';
ALTER TABLE public.marketing_campaigns ADD COLUMN IF NOT EXISTS follow_up_config JSONB DEFAULT '[]'::jsonb;

-- Create global settings table
CREATE TABLE IF NOT EXISTS public.marketing_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    daily_limit INTEGER DEFAULT 1000,
    sending_window_start TIME DEFAULT '09:00',
    sending_window_end TIME DEFAULT '17:00',
    delay_between_emails_seconds INTEGER DEFAULT 60,
    active_days INTEGER[] DEFAULT '{1,2,3,4,5}', -- 1=Mon, 7=Sun
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS for settings
ALTER TABLE public.marketing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access for authenticated users" ON public.marketing_settings FOR ALL USING (auth.role() = 'authenticated');

-- Insert default settings
INSERT INTO public.marketing_settings (daily_limit) SELECT 1000 WHERE NOT EXISTS (SELECT 1 FROM public.marketing_settings);

