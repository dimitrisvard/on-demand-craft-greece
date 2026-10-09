-- Phase 5 (PLAN.md P5-9). After the 7-day output parity gate is signed: removes the ten deactivated
-- pg_cron jobs, which also removes the service credential embedded in their commands (H-7).
-- Changes NOTHING unless the session first states:  SET microns.p5_gate = 'signed';
-- A job that is still active is left alone (deactivate it in P5-8 first).
DO $$
DECLARE
  v_ok   boolean := coalesce(current_setting('microns.p5_gate', true), '') = 'signed';
  r      record;
  v_done int := 0;
BEGIN
  IF NOT v_ok THEN
    RAISE NOTICE 'P5-9: microns.p5_gate is not ''signed''; nothing changed';
    RETURN;
  END IF;

  FOR r IN
    SELECT j.jobid, j.jobname, j.active
    FROM cron.job j
    WHERE j.jobname IN ('hn-collector', 'reddit-tier1', 'reddit-tier2', 'reddit-tier3', 'tender-scan-daily',
                        'auto-update-sitemap', 'enqueue-daily-article', 'process-article-queue',
                        'auto-translate-daily-articles', 'auto-fix-article-links')
    ORDER BY j.jobid
  LOOP
    IF r.active THEN
      RAISE WARNING 'P5-9: % (id %) is still active; not removed', r.jobname, r.jobid;
      CONTINUE;
    END IF;
    PERFORM cron.unschedule(r.jobname);
    v_done := v_done + 1;
    RAISE NOTICE 'P5-9: unscheduled % (id %)', r.jobname, r.jobid;
  END LOOP;
  RAISE NOTICE 'P5-9: % job(s) removed', v_done;
END $$;

RESET microns.p5_gate;

-- Checks (read-only)
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;   -- expected: no ported job left
-- The pattern is assembled from two parts so that this file itself holds no token-shaped literal.
SELECT count(*) AS jobs_with_jwt_literal
FROM cron.job WHERE command ~ ('e' || 'yJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.');   -- expected: 0
