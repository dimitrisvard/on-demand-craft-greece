-- App Settings table — stores integration API keys and config
-- Keys stored here (not Vercel env vars) to avoid hitting the 12-function limit
-- and to allow editing via the dashboard UI.

CREATE TABLE IF NOT EXISTS app_settings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT        UNIQUE NOT NULL,
  value       TEXT,
  description TEXT,
  is_secret   BOOLEAN     NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed rows for every integration we support
INSERT INTO app_settings (key, value, description, is_secret) VALUES
  ('apollo_api_key',           NULL, 'Apollo.io API key — used for contact/company enrichment and lead export', true),
  ('apollo_base_url',          'https://api.apollo.io/v1', 'Apollo.io API base URL', false),
  ('reddit_client_id',         NULL, 'Reddit OAuth2 client ID for the lead monitor', true),
  ('reddit_client_secret',     NULL, 'Reddit OAuth2 client secret', true),
  ('reddit_user_agent',        'MicronsHubLeadMonitor/1.0 by MicronsHub', 'Reddit API user-agent string', false),
  ('telegram_bot_token',       NULL, 'Telegram bot token for lead/tender notifications', true),
  ('telegram_chat_id',         NULL, 'Telegram chat / channel ID to send notifications to', false),
  ('resend_api_key',           NULL, 'Resend API key for transactional email', true),
  ('eu_procurement_countries', 'DE,NL,FR,IE,ES', 'Comma-separated ISO country codes to scan for EU tenders', false),
  ('scraper_request_delay_ms', '1500', 'Milliseconds to wait between scraper requests (rate-limit protection)', false)
ON CONFLICT (key) DO NOTHING;

-- Row Level Security — only authenticated users can read/write
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read"
  ON app_settings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_write"
  ON app_settings FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
