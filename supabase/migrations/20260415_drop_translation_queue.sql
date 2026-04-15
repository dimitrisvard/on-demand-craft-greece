-- Migration: Drop the translation_queue + pg_cron worker.
--
-- The queue (added earlier today by 20260415_create_translation_queue.sql /
-- 20260415_schedule_translation_queue.sql) is being retired. The BlogEditor UI
-- now calls translate-article directly once per language, and
-- auto-translate-articles keeps doing the same on its daily cron. Each call
-- handles exactly one language, which comfortably fits inside the edge
-- function 150 s idle-timeout / 400 s wall clock, so there is no need for an
-- out-of-band queue/worker pair.
--
-- This migration is idempotent — it may run on a project where the queue
-- never existed.

-- 1. Remove the pg_cron schedule that invoked process-translation-queue.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'process-translation-queue'
  ) THEN
    PERFORM cron.unschedule('process-translation-queue');
  END IF;
END $$;

-- 2. Drop helper functions.
DROP FUNCTION IF EXISTS public.mark_translation_job_failed(UUID, TEXT);
DROP FUNCTION IF EXISTS public.mark_translation_job_completed(UUID, UUID);
DROP FUNCTION IF EXISTS public.get_next_translation_job();
DROP FUNCTION IF EXISTS public.enqueue_translations(UUID, TEXT[]);

-- 3. Remove the table from the realtime publication, if present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname   = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'translation_queue'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.translation_queue';
  END IF;
END $$;

-- 4. Drop the table (and its RLS policies / indexes implicitly).
DROP TABLE IF EXISTS public.translation_queue;
