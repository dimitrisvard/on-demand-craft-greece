-- Update fix-article-links cron job schedule
-- Change from 8:15 AM UTC to 8:30 AM UTC (adds 15 minutes gap after translations)
-- This ensures translations have more time to complete before link fixing starts

-- IMPORTANT: Replace YOUR_SERVICE_ROLE_KEY with your actual service role key
-- Get it from: Supabase Dashboard > Project Settings > API > service_role (click "Reveal")

-- Unschedule the old job
SELECT cron.unschedule('auto-fix-article-links');

-- Schedule with new time: 8:30 AM UTC (10:30 AM Greece time)
SELECT cron.schedule(
  'auto-fix-article-links',
  '30 8 * * *', -- 8:30 AM UTC = 10:30 AM Greece time (30 minutes after translation starts)
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/fix-article-links',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Verify the job was updated
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'auto-fix-article-links';

