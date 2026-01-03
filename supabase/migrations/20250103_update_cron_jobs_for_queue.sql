-- Update cron jobs to use queue system
-- This migration updates the existing cron job to enqueue tasks instead of calling Edge Function directly

-- First, unschedule the old cron job
SELECT cron.unschedule('generate-daily-article');

-- Create new cron job that enqueues tasks (fast, no timeout)
-- This runs daily at 7:00 AM UTC (9:00 AM Greece time, UTC+2)
SELECT cron.schedule(
  'enqueue-daily-article',
  '0 7 * * *', -- 7:00 AM UTC = 9:00 AM Greece time (UTC+2, standard time)
  $$
  SELECT enqueue_next_article() AS queue_id;
  $$
);

-- Create worker cron job that processes the queue
-- This runs every 5 minutes to process pending jobs
-- IMPORTANT: Replace YOUR_SERVICE_ROLE_KEY with your actual service role key from Supabase Dashboard
-- Get it from: Supabase Dashboard > Project Settings > API > service_role (click "Reveal")
SELECT cron.schedule(
  'process-article-queue',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/process-article-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000 -- 5 minutes timeout (worker can retry if needed)
    ) AS request_id;
  $$
);

-- Verify the jobs were created
-- SELECT * FROM cron.job WHERE jobname IN ('enqueue-daily-article', 'process-article-queue');

