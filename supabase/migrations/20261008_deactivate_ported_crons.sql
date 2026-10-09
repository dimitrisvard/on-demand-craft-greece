-- Phase 5 (PLAN.md P5-8). Deactivates, never deletes, the pg_cron jobs that a Cloudflare job replaces,
-- one switch-over step at a time. Rollback of a step = the same step with action 'reactivate'.
-- The file changes NOTHING unless both settings are made in the same session first:
--   SET microns.p5_step   = 'S2';          -- one step, or a comma list such as 'S1,S2'
--   SET microns.p5_action = 'deactivate';  -- or 'reactivate'
-- Steps (live cron.job of 2026-10-03, addressed by jobname; target checked before any change):
--   S1 hn-collector · S2 reddit-tier1, reddit-tier2, reddit-tier3 · S3 tender-scan-daily
--   S4 auto-update-sitemap · S5 enqueue-daily-article, process-article-queue,
--      auto-translate-daily-articles, auto-fix-article-links
DO $$
DECLARE
  v_raw    text := coalesce(current_setting('microns.p5_step', true), '');
  v_steps  text[] := array_remove(string_to_array(replace(v_raw, ' ', ''), ','), '');
  v_action text := coalesce(current_setting('microns.p5_action', true), '');
  r        record;
  v_done   int := 0;
BEGIN
  IF v_action NOT IN ('deactivate', 'reactivate') OR coalesce(array_length(v_steps, 1), 0) = 0 THEN
    RAISE NOTICE 'P5-8: microns.p5_step / microns.p5_action not set; nothing changed';
    RETURN;
  END IF;

  FOR r IN
    SELECT m.step, m.jobname, m.target, j.jobid, j.active, j.command
    FROM (VALUES
      ('S1', 'hn-collector',                  '/functions/v1/hn-collector'),
      ('S2', 'reddit-tier1',                  '/functions/v1/reddit-collector?tier=1'),
      ('S2', 'reddit-tier2',                  '/functions/v1/reddit-collector?tier=2'),
      ('S2', 'reddit-tier3',                  '/functions/v1/reddit-collector?tier=3'),
      ('S3', 'tender-scan-daily',             '/functions/v1/tender-collector'),
      ('S4', 'auto-update-sitemap',           '/functions/v1/auto-update-sitemap'),
      ('S5', 'enqueue-daily-article',         'enqueue_next_article()'),
      ('S5', 'process-article-queue',         '/functions/v1/process-article-queue'),
      ('S5', 'auto-translate-daily-articles', '/functions/v1/auto-translate-articles'),
      ('S5', 'auto-fix-article-links',        '/functions/v1/fix-article-links')
    ) AS m(step, jobname, target)
    LEFT JOIN cron.job j ON j.jobname = m.jobname
    WHERE m.step = ANY (v_steps)
    ORDER BY m.step, m.jobname
  LOOP
    IF r.jobid IS NULL THEN
      RAISE WARNING 'P5-8 %: job % not found; skipped', r.step, r.jobname;
      CONTINUE;
    END IF;
    IF position(r.target IN r.command) = 0 THEN
      RAISE WARNING 'P5-8 %: job % (id %) no longer targets %; skipped, check cron.job', r.step, r.jobname, r.jobid, r.target;
      CONTINUE;
    END IF;
    IF v_action = 'deactivate' AND r.active THEN
      PERFORM cron.alter_job(r.jobid, active := false);
      v_done := v_done + 1;
      RAISE NOTICE 'P5-8 %: deactivated % (id %)', r.step, r.jobname, r.jobid;
    ELSIF v_action = 'reactivate' AND NOT r.active THEN
      PERFORM cron.alter_job(r.jobid, active := true);
      v_done := v_done + 1;
      RAISE NOTICE 'P5-8 %: reactivated % (id %)', r.step, r.jobname, r.jobid;
    ELSE
      RAISE NOTICE 'P5-8 %: % (id %) already %', r.step, r.jobname, r.jobid,
        CASE WHEN r.active THEN 'active' ELSE 'inactive' END;
    END IF;
  END LOOP;
  RAISE NOTICE 'P5-8: % job(s) changed (action %, steps %)', v_done, v_action, v_raw;
END $$;

RESET microns.p5_step;
RESET microns.p5_action;

-- Check (read-only): state of the ten ported jobs
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('hn-collector', 'reddit-tier1', 'reddit-tier2', 'reddit-tier3', 'tender-scan-daily',
                  'auto-update-sitemap', 'enqueue-daily-article', 'process-article-queue',
                  'auto-translate-daily-articles', 'auto-fix-article-links')
ORDER BY jobid;
