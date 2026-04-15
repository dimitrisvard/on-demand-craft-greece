-- Migration: Schedule the translation queue worker via pg_cron
-- Runs process-translation-queue every minute. Each tick claims at most one
-- pending/failed job (see get_next_translation_job), hands it to translate-article
-- with a single target language, and records success/failure in translation_queue.
--
-- IMPORTANT: Before running this migration in the Supabase SQL Editor, replace:
--   - YOUR_SUPABASE_URL       with your project URL  (e.g. https://cfjrtmtaitwzggzpkhxi.supabase.co)
--   - YOUR_SERVICE_ROLE_KEY   with your service_role key (Dashboard > Settings > API > service_role)
--
-- The hard-coded project URL below matches the rest of this repo
-- (see 20250103_update_cron_jobs_for_queue.sql). Adjust if your deployment differs.

-- Defensively remove any previous schedule with the same name
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-translation-queue') THEN
    PERFORM cron.unschedule('process-translation-queue');
  END IF;
END $$;

-- Every minute: drain one job from translation_queue.
-- The worker itself is short (single Gemini call per language). Even if a
-- single invocation hits Supabase's 150 s idle-timeout it just flips the job
-- back to 'failed' and the next tick retries it until retry_count >= 3.
SELECT cron.schedule(
  'process-translation-queue',
  '*/1 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/process-translation-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 170000
    ) AS request_id;
  $$
);

-- Verify:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'process-translation-queue';
--   SELECT * FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'process-translation-queue')
--    ORDER BY start_time DESC LIMIT 10;
--
-- Unschedule (if needed):
--   SELECT cron.unschedule('process-translation-queue');
