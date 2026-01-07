-- Add timeout to auto-translate-daily-articles cron job
-- This allows the cron job to wait for the function to complete (up to 10 minutes)
-- The function itself has timeout protection (140s) to prevent edge function timeout
-- 
-- IMPORTANT: Replace YOUR_SERVICE_ROLE_KEY with your actual service role key
-- Get it from: Supabase Dashboard > Settings > API > service_role (click "Reveal")

-- Update auto-translate-daily-articles cron job with timeout
SELECT cron.unschedule('auto-translate-daily-articles');

SELECT cron.schedule(
  'auto-translate-daily-articles',
  '0 8 * * *', -- 8:00 AM UTC = 10:00 AM Greece time
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/auto-translate-articles',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 600000  -- 10 minutes (600 seconds)
      -- Note: Function has internal timeout protection at 140s to prevent edge function timeout
      -- This cron timeout allows it to wait for partial completion and proper response
    ) AS request_id;
  $$
);

-- Verify the job was updated
-- SELECT jobid, jobname, schedule, active, command FROM cron.job 
-- WHERE jobname = 'auto-translate-daily-articles';

