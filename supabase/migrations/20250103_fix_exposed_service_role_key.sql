-- SECURITY FIX: Update cron jobs to use new service role key
-- This migration should be run AFTER rotating the service role key in Supabase Dashboard
--
-- IMPORTANT: 
-- 1. First, rotate the service role key in Supabase Dashboard > Project Settings > API
-- 2. Copy the NEW service role key
-- 3. Replace YOUR_NEW_SERVICE_ROLE_KEY in this file with the new key
-- 4. Run this migration in Supabase SQL Editor
--
-- This updates the cron jobs that had the exposed key hardcoded

-- Update process-article-queue cron job
SELECT cron.unschedule('process-article-queue');
SELECT cron.schedule(
  'process-article-queue',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/process-article-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_NEW_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) AS request_id;
  $$
);

-- Update auto-translate-daily-articles cron job
SELECT cron.unschedule('auto-translate-daily-articles');
SELECT cron.schedule(
  'auto-translate-daily-articles',
  '0 11 * * *', -- 11:00 AM UTC = 1:00 PM Greece time
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/auto-translate-articles',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_NEW_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Verify the jobs were updated
-- SELECT jobid, jobname, schedule, active FROM cron.job 
-- WHERE jobname IN ('process-article-queue', 'auto-translate-daily-articles');

