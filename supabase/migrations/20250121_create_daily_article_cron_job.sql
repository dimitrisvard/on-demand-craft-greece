-- Create scheduled job for daily article generation
-- IMPORTANT: Before running this migration, you MUST replace YOUR_SERVICE_ROLE_KEY 
-- with your actual service role key from Supabase Dashboard > Settings > API > service_role key

-- This migration creates a cron job that runs daily at 7:00 AM UTC (9:00 AM Greece time)
-- to automatically generate articles from the article_titles queue

-- Note: The service role key is required in the Authorization header for the edge function call
-- You can get it from: Supabase Dashboard > Project Settings > API > service_role (click "Reveal")

-- To apply this migration:
-- 1. Get your service role key from Supabase Dashboard
-- 2. Replace YOUR_SERVICE_ROLE_KEY in the SQL below
-- 3. Run the SQL in Supabase SQL Editor

-- Uncomment and run this SQL after replacing YOUR_SERVICE_ROLE_KEY:
/*
SELECT cron.schedule(
  'generate-daily-article',
  '0 7 * * *', -- 7:00 AM UTC = 9:00 AM Greece time (UTC+2)
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/generate-daily-article',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
*/

-- To verify the job was created:
-- SELECT * FROM cron.job WHERE jobname = 'generate-daily-article';

-- To check job execution history:
-- SELECT * FROM cron.job_run_details 
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'generate-daily-article')
-- ORDER BY start_time DESC 
-- LIMIT 10;

-- To unschedule the job (if needed):
-- SELECT cron.unschedule('generate-daily-article');

