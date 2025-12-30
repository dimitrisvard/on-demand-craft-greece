-- Create scheduled jobs for automatic translation and sitemap updates
-- IMPORTANT: Before running this migration, you MUST replace:
-- 1. YOUR_SUPABASE_URL with your actual Supabase project URL
-- 2. YOUR_SERVICE_ROLE_KEY with your actual service role key from Supabase Dashboard > Settings > API

-- This migration creates cron jobs that:
-- 1. Auto-translate articles: Runs 2 hours after daily article creation (11:00 AM UTC = 1:00 PM Greece time)
-- 2. Auto-update sitemap: Runs 3 hours after daily article creation (12:00 PM UTC = 2:00 PM Greece time)

-- To apply this migration:
-- 1. Get your service role key from Supabase Dashboard > Settings > API > service_role (click "Reveal")
-- 2. Get your project URL from Supabase Dashboard (e.g., https://cfjrtmtaitwzggzpkhxi.supabase.co)
-- 3. Replace YOUR_SUPABASE_URL and YOUR_SERVICE_ROLE_KEY in the SQL below
-- 4. Uncomment and run the SQL in Supabase SQL Editor

-- Uncomment and run this SQL after replacing YOUR_SUPABASE_URL and YOUR_SERVICE_ROLE_KEY:
/*
-- Schedule automatic translation trigger
-- Runs 2 hours after daily article creation (11:00 AM UTC = 1:00 PM Greece time)
-- This checks for English articles created today that haven't been translated yet
SELECT cron.schedule(
  'auto-translate-daily-articles',
  '0 11 * * *', -- 11:00 AM UTC (adjust based on when articles are created)
  $$
  SELECT
    net.http_post(
      url := 'YOUR_SUPABASE_URL/functions/v1/auto-translate-articles',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Schedule automatic sitemap update
-- Runs 3 hours after daily article creation (12:00 PM UTC = 2:00 PM Greece time)
-- This updates the sitemap after translations are finished
SELECT cron.schedule(
  'auto-update-sitemap',
  '0 12 * * *', -- 12:00 PM UTC (1 hour after translation starts)
  $$
  SELECT
    net.http_post(
      url := 'YOUR_SUPABASE_URL/functions/v1/auto-update-sitemap',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
*/

-- To verify the jobs were created:
-- SELECT * FROM cron.job WHERE jobname IN ('auto-translate-daily-articles', 'auto-update-sitemap');

-- To check job execution history:
-- SELECT * FROM cron.job_run_details 
-- WHERE jobid IN (
--   SELECT jobid FROM cron.job WHERE jobname IN ('auto-translate-daily-articles', 'auto-update-sitemap')
-- )
-- ORDER BY start_time DESC 
-- LIMIT 20;

-- To unschedule the jobs (if needed):
-- SELECT cron.unschedule('auto-translate-daily-articles');
-- SELECT cron.unschedule('auto-update-sitemap');

