-- ============================================================
-- Email Marketing Enhancement Migration
-- Phase 1: Sender Accounts, Campaign Recipients, Templates
-- Phase 2-6: All schema changes
-- ============================================================

-- 1. marketing_sender_accounts table
CREATE TABLE IF NOT EXISTS public.marketing_sender_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('resend', 'google_workspace')),
  provider_config JSONB DEFAULT '{}'::jsonb,
  daily_limit INTEGER DEFAULT 500,
  emails_sent_today INTEGER DEFAULT 0,
  last_reset_date DATE DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT true,
  warmup_enabled BOOLEAN DEFAULT false,
  warmup_daily_increment INTEGER DEFAULT 5,
  warmup_current_limit INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.marketing_sender_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage sender accounts"
  ON public.marketing_sender_accounts
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE TRIGGER update_marketing_sender_accounts_updated_at
  BEFORE UPDATE ON public.marketing_sender_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Add sender_account_ids to marketing_campaigns
ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS sender_account_ids UUID[] DEFAULT '{}';

-- 3. Add splitting_strategy to marketing_settings
ALTER TABLE public.marketing_settings
  ADD COLUMN IF NOT EXISTS splitting_strategy TEXT DEFAULT 'round_robin'
    CHECK (splitting_strategy IN ('round_robin', 'equal_split', 'weighted'));

-- 4. marketing_campaign_recipients table
CREATE TABLE IF NOT EXISTS public.marketing_campaign_recipients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES public.marketing_subscribers(id) ON DELETE CASCADE,
  custom_subject TEXT,
  custom_body TEXT,
  custom_variables JSONB DEFAULT '{}'::jsonb,
  sequence_number INTEGER DEFAULT 1,
  delay_days INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.marketing_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage campaign recipients"
  ON public.marketing_campaign_recipients
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign
  ON public.marketing_campaign_recipients(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status
  ON public.marketing_campaign_recipients(status, sequence_number);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_followup
  ON public.marketing_campaign_recipients(campaign_id, subscriber_id, sequence_number);

-- 5. marketing_templates table (Phase 6: Campaign Templates)
CREATE TABLE IF NOT EXISTS public.marketing_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.marketing_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage templates"
  ON public.marketing_templates
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE TRIGGER update_marketing_templates_updated_at
  BEFORE UPDATE ON public.marketing_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Add bounce_count to marketing_subscribers for bounce management
ALTER TABLE public.marketing_subscribers
  ADD COLUMN IF NOT EXISTS bounce_count INTEGER DEFAULT 0;

ALTER TABLE public.marketing_subscribers
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

-- 7. Add resend_email_id to marketing_events for webhook correlation
ALTER TABLE public.marketing_events
  ADD COLUMN IF NOT EXISTS resend_email_id TEXT;

CREATE INDEX IF NOT EXISTS idx_marketing_events_resend_id
  ON public.marketing_events(resend_email_id) WHERE resend_email_id IS NOT NULL;

-- 8. Add tracking_domain to marketing_settings
ALTER TABLE public.marketing_settings
  ADD COLUMN IF NOT EXISTS tracking_domain TEXT DEFAULT 'https://micronshub.eu';

-- 9. Add unsubscribe_link_enabled to marketing_settings
ALTER TABLE public.marketing_settings
  ADD COLUMN IF NOT EXISTS unsubscribe_link_enabled BOOLEAN DEFAULT true;

-- 10. Index for faster event lookups
CREATE INDEX IF NOT EXISTS idx_marketing_events_campaign_subscriber
  ON public.marketing_events(campaign_id, subscriber_id, event_type);
