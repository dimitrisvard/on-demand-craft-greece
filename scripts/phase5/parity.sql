-- ============================================================================
-- Phase 5 output parity for the 7-day window (PLAN.md P5-9; PHASE5_SPEC.md §6.8, §10.3, §12)
-- ============================================================================
-- Read-only: every statement is a SELECT. Run in the Supabase SQL editor, one query at a time, daily during the
-- window (OW5-15). Nothing here writes, and nothing prints a command text or a credential.
--
-- Placeholders (replace before running):
--   <S_SWITCH_UTC>   time of the switch-over step's first Worker run (S1-S5), e.g. '2026-11-03 07:00+00'
--   <S8_SWITCH_UTC>  time of the first Worker Xometry slot after S8 (Q13 only)
--
-- Pass rules (gate items of PLAN.md:394-401, PHASE5_SPEC.md §12):
--   Q1   window_days_below_baseline = 0 for every language (days that have ended)
--   Q2   lag_days = 0 for all 13 languages from the second window day; missing_translations falls daily to 0
--   Q3   no rows
--   Q4   sitemap_updated_at within 26 h every day; last_run_urls = expected_sitemap_urls; missing_in_gsc_monitored = 0
--   Q5   HN per day >= the prior-week minimum (or a failure explained in the digest); reddit 0 accepted; 0 duplicates.
--        Tenders: compare with the baseline measured at S3 (§10.2 step 0): the prior 7 days when tenders were flowing
--        through the Phase 2 path then, else "connectors scanned on schedule" (Q6)
--   Q6   connectors_stale = 0 from the second day after S3 (canary day excepted)
--   Q7   subs_overdue <= 54
--   Q8   stuck = 0 on every row (limits per agent below)
--   Q9   the 10 jobs exist with active = false and no run after their deactivation time
--   Q10  one completed queue row per day (or a failed row on a no_titles day)
--   Q11  indexnow_ok = translations on days when INDEXNOW_KEY was set
--   Q12  figures equal the Monday digest (Q12b section by section)
--   Q13  no NULL status; with a valid token at least one succeeded slot per day
--
-- Differences from the analysis text (jobs.md §10): Q8 is the per-agent version of PHASE5_SPEC.md §6.8; Q11 counts
-- output.indexnow = true as text, because the consumer records 'not_configured' when INDEXNOW_KEY is missing and a
-- boolean cast of that value would stop the query; Q12b and Q13 are added.

-- Q1 published articles per language per day: baseline (7 days before) vs window (7 days from the switch)
WITH params AS (SELECT '<S_SWITCH_UTC>'::timestamptz AS s),
days AS (SELECT generate_series(date_trunc('day', (SELECT s FROM params)) - interval '7 days',
                                date_trunc('day', (SELECT s FROM params)) + interval '6 days', interval '1 day') AS d),
langs AS (SELECT unnest(ARRAY['en','de','fr','es','it','nl','pt','sv','da','nb','pl','cs','hu','fi']) AS l),
counts AS (
  SELECT days.d, langs.l,
         (SELECT count(*) FROM articles a WHERE a.language = langs.l AND a.status = 'published'
            AND a.created_at >= days.d AND a.created_at < days.d + interval '1 day') AS n
  FROM days CROSS JOIN langs)
SELECT l AS language,
       round(avg(n) FILTER (WHERE d < date_trunc('day', (SELECT s FROM params))), 2) AS baseline_per_day,
       min(n) FILTER (WHERE d >= date_trunc('day', (SELECT s FROM params)) AND d + interval '1 day' <= now()) AS window_min_per_day,
       count(*) FILTER (WHERE d >= date_trunc('day', (SELECT s FROM params)) AND d + interval '1 day' <= now()
                        AND n < (SELECT avg(c2.n) FROM counts c2
                                 WHERE c2.l = counts.l AND c2.d < date_trunc('day', (SELECT s FROM params)))) AS window_days_below_baseline
FROM counts GROUP BY l ORDER BY l;

-- Q2 translation lag snapshot (run daily; the daily value is also in agent_runs content_daily output.lag_days)
WITH langs AS (SELECT unnest(ARRAY['de','fr','es','it','nl','pt','sv','da','nb','pl','cs','hu','fi']) AS l),
en AS (SELECT translation_id, created_at FROM articles
       WHERE language = 'en' AND status = 'published' AND translation_id IS NOT NULL)
SELECT langs.l AS language,
  (SELECT max(created_at)::date FROM articles WHERE language = 'en' AND status = 'published')
    - (SELECT max(created_at)::date FROM articles WHERE language = langs.l AND status = 'published') AS lag_days,
  (SELECT count(*) FROM en WHERE NOT EXISTS
     (SELECT 1 FROM articles a WHERE a.translation_id = en.translation_id AND a.language = langs.l)) AS missing_translations
FROM langs ORDER BY missing_translations DESC, language;

-- Q2b lag time series from the Workflow (one row per day)
SELECT started_at::date AS day, output->'lag_days' AS lag_days, output->'translations' AS today, output->'backfilled' AS backfilled
FROM agent_runs WHERE agent = 'content_daily' AND started_at >= '<S_SWITCH_UTC>'::timestamptz ORDER BY 1;

-- Q3 English articles of the window without all 13 translations within 24 h
SELECT en.created_at::date AS day, en.slug,
       13 - count(t.id) FILTER (WHERE t.created_at <= en.created_at + interval '24 hours') AS missing_within_24h
FROM articles en
LEFT JOIN articles t ON t.translation_id = en.translation_id AND t.language <> 'en' AND t.status = 'published'
WHERE en.language = 'en' AND en.status = 'published'
  AND en.created_at >= '<S_SWITCH_UTC>'::timestamptz AND en.created_at <= now() - interval '24 hours'
GROUP BY en.id, en.created_at, en.slug
HAVING 13 - count(t.id) FILTER (WHERE t.created_at <= en.created_at + interval '24 hours') > 0
ORDER BY 1;

-- Q4 sitemap: expected URL count, monitored-URL coverage, Storage object freshness
WITH pub AS (
  SELECT a.slug, lower(trim(a.language)) AS lang FROM articles a
  WHERE a.status = 'published'
    AND lower(trim(a.language)) IN ('en','de','fr','es','it','nl','pl','pt','sv','da','fi','nb','hu','cs')),
urls AS (
  SELECT 'https://www.micronshub.eu/' || lang || '/'
         || CASE lang WHEN 'sv' THEN 'blogg' WHEN 'nb' THEN 'blogg' WHEN 'fi' THEN 'blogi' ELSE 'blog' END
         || '/' || slug AS url, slug FROM pub)
SELECT (SELECT count(*) FROM pub) + 252 AS expected_sitemap_urls,
       (SELECT count(*) FROM urls u WHERE u.slug ~ '^[a-z0-9-]+$'
          AND NOT EXISTS (SELECT 1 FROM gsc_monitored_urls g WHERE g.url = u.url)) AS missing_in_gsc_monitored,
       (SELECT count(*) FROM urls WHERE slug !~ '^[a-z0-9-]+$') AS non_ascii_slugs_left_to_the_parity_tool,
       (SELECT updated_at FROM storage.objects WHERE bucket_id = 'sitemaps' AND name = 'sitemap-complete.xml') AS sitemap_updated_at,
       (SELECT (metadata->>'size')::bigint FROM storage.objects
         WHERE bucket_id = 'sitemaps' AND name = 'sitemap-complete.xml') AS sitemap_bytes,
       (SELECT output->>'urls' FROM agent_runs WHERE agent = 'content_daily.sitemap'
         ORDER BY started_at DESC LIMIT 1) AS last_run_urls;

-- Q5 leads and tenders per day, window vs the 7 days before; duplicates
WITH params AS (SELECT '<S_SWITCH_UTC>'::timestamptz AS s),
days AS (SELECT generate_series(date_trunc('day', (SELECT s FROM params)) - interval '7 days',
                                date_trunc('day', now()), interval '1 day') AS d)
SELECT d::date AS day, d >= date_trunc('day', (SELECT s FROM params)) AS in_window,
  (SELECT count(*) FROM leads l WHERE l.source = 'hackernews' AND l.discovered_at >= d AND l.discovered_at < d + interval '1 day') AS hn,
  (SELECT count(*) FROM leads l WHERE l.source = 'reddit' AND l.discovered_at >= d AND l.discovered_at < d + interval '1 day') AS reddit,
  (SELECT count(*) FROM tenders t WHERE t.discovered_at >= d AND t.discovered_at < d + interval '1 day') AS tenders
FROM days ORDER BY 1;
SELECT (SELECT count(*) FROM (SELECT source, external_id FROM leads GROUP BY 1, 2 HAVING count(*) > 1) x) AS lead_dupes,
       (SELECT count(*) FROM (SELECT country_code, tender_reference FROM tenders GROUP BY 1, 2 HAVING count(*) > 1) x) AS tender_dupes;

-- Q6 / Q7 collector coverage (run daily)
SELECT
 (SELECT count(*) FROM monitored_subreddits WHERE is_active AND source = 'reddit' AND tier <= 3) AS subs_tier_le3,
 (SELECT count(*) FROM monitored_subreddits WHERE is_active AND source = 'reddit' AND tier <= 3
    AND (last_scanned_at IS NULL
         OR last_scanned_at < now() - make_interval(mins => 2 * coalesce(scan_interval_minutes, 30)))) AS subs_overdue,
 (SELECT count(*) FROM tender_connectors WHERE is_active) AS connectors_active,
 (SELECT count(*) FROM tender_connectors WHERE is_active
    AND (last_scan_at IS NULL OR last_scan_at < now() - interval '30 hours')) AS connectors_stale;

-- Q8 (replaces jobs §10 Q8) agent_runs completeness per agent and day; 'stuck' uses a limit per agent
WITH lim(agent, max_running) AS (VALUES
  ('growth.reddit', interval '1 hour'), ('growth.hn', interval '1 hour'), ('growth.xometry', interval '1 hour'),
  ('growth.tenders', interval '2 hours'),          -- a child may run 4 deliveries of <= 840 s plus 3 x 300 s retry delays
  ('content_daily', interval '8 hours'),           -- generation <= 40 min + translations wait <= 6 h + fix-links + sitemap
  ('content_daily.sitemap', interval '1 hour'), ('content_daily.translate', interval '1 hour'),
  ('marketing.send', interval '48 hours'),         -- stays open across cap deferrals to the next UTC day
  ('ops_digest', interval '1 hour'))
SELECT r.agent, r.started_at::date AS day, count(*) AS runs,
       count(*) FILTER (WHERE r.status = 'succeeded') AS ok,
       count(*) FILTER (WHERE r.status = 'failed') AS failed,
       count(*) FILTER (WHERE r.status = 'skipped') AS skipped,
       count(*) FILTER (WHERE r.status = 'running' AND r.started_at < now() - l.max_running) AS stuck
FROM agent_runs r JOIN lim l ON l.agent = r.agent
WHERE r.started_at >= '<S_SWITCH_UTC>'::timestamptz
GROUP BY 1, 2 ORDER BY 2, 1;   -- pass: stuck = 0 on every row


-- Q9 old schedulers disabled, not deleted, and silent since deactivation
SELECT j.jobid, j.jobname, j.active,
       (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_run
FROM cron.job j
WHERE j.jobname IN ('hn-collector', 'reddit-tier1', 'reddit-tier2', 'reddit-tier3', 'tender-scan-daily',
                    'auto-update-sitemap', 'enqueue-daily-article', 'process-article-queue',
                    'auto-translate-daily-articles', 'auto-fix-article-links')
ORDER BY j.jobid;

-- Q10 one queue row per day
SELECT created_at::date AS day, count(*) AS queue_rows, string_agg(status, ',') AS statuses
FROM article_generation_queue WHERE created_at >= '<S_SWITCH_UTC>'::timestamptz GROUP BY 1 ORDER BY 1;

-- Q11 IndexNow submissions recorded by the translations consumer (output.indexnow is true, false or 'not_configured')
SELECT started_at::date AS day,
       count(*) FILTER (WHERE output->>'indexnow' = 'true') AS indexnow_ok,
       count(*) FILTER (WHERE output->>'indexnow' = 'not_configured') AS indexnow_not_configured,
       count(*) AS translations
FROM agent_runs WHERE agent = 'content_daily.translate' AND status = 'succeeded'
  AND started_at >= '<S_SWITCH_UTC>'::timestamptz GROUP BY 1 ORDER BY 1;

-- Q12 digest spot check (compare with the Monday e-mail): last ISO week
WITH w AS (SELECT date_trunc('week', now()) - interval '7 days' AS s, date_trunc('week', now()) AS e)
SELECT (SELECT count(*) FROM rfqs, w WHERE rfqs.created_at >= w.s AND rfqs.created_at < w.e) AS rfqs,
       (SELECT count(*) FROM articles, w WHERE language = 'en' AND articles.created_at >= w.s AND articles.created_at < w.e) AS en_articles,
       (SELECT count(*) FROM leads, w WHERE leads.discovered_at >= w.s AND leads.discovered_at < w.e) AS leads,
       (SELECT count(*) FROM tenders, w WHERE tenders.discovered_at >= w.s AND tenders.discovered_at < w.e) AS tenders,
       (SELECT round(sum(cost_cents) / 100.0, 2) FROM agent_runs, w WHERE agent_runs.started_at >= w.s AND agent_runs.started_at < w.e) AS agent_cost_usd;

-- Q12b every figure of the ops digest, section by section (src/digest/collect.ts and stuck.ts use the same rules).
-- The digest sent on Monday M (instance ops-digest-<ISO week of M>) reports the ISO week before it: [M - 7 days, M)
-- in UTC. To re-check an older digest set e to 00:00 UTC of the Monday it was sent, e.g. '2026-11-09 00:00+00'.
-- Rows marked 'now' are point-in-time figures (they equal the e-mail only when read shortly after it was sent).
WITH win AS (SELECT date_trunc('week', now()) - interval '7 days' AS s, date_trunc('week', now()) AS e)
SELECT 'pipeline' AS section, 'rfqs ' || coalesce(source, 'web') AS figure, count(*)::text AS value
  FROM rfqs, win WHERE created_at >= win.s AND created_at < win.e GROUP BY source
UNION ALL
SELECT 'quotes', 'sent', count(*)::text
  FROM quote_workflows, win WHERE sent_at >= win.s AND sent_at < win.e
UNION ALL
SELECT 'quotes', 'outcome ' || status, count(*)::text
  FROM quote_workflows, win
  WHERE status IN ('won', 'lost', 'expired', 'counter_offer') AND last_event_at >= win.s AND last_event_at < win.e
  GROUP BY status
UNION ALL
SELECT 'quotes', 'win rate % (won / (won + lost + expired))',
       coalesce(round(100.0 * count(*) FILTER (WHERE status = 'won')
                      / nullif(count(*) FILTER (WHERE status IN ('won', 'lost', 'expired')), 0), 1)::text, 'n/a')
  FROM quote_workflows, win WHERE last_event_at >= win.s AND last_event_at < win.e
UNION ALL
SELECT 'quotes', 'median hours rfq to sent',
       coalesce(round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM q.sent_at - r.created_at) / 3600))::numeric, 1)::text, 'n/a')
  FROM quote_workflows q JOIN rfqs r ON r.id = q.rfq_id, win WHERE q.sent_at >= win.s AND q.sent_at < win.e
UNION ALL
SELECT 'orders', 'orders ' || coalesce(currency, '?') || ': count / total / production costs / margin %',
       count(*) || ' / ' || round(coalesce(sum(total_amount), 0), 2) || ' / ' || round(coalesce(sum(total_production_costs), 0), 2) || ' / '
       || coalesce(round(100 * (sum(total_amount) - coalesce(sum(total_production_costs), 0)) / nullif(sum(total_amount), 0), 1)::text, 'n/a')
  FROM orders, win WHERE created_at >= win.s AND created_at < win.e GROUP BY currency
UNION ALL
SELECT 'agents', agent || ': runs / failed / skipped / usd',
       count(*) || ' / ' || count(*) FILTER (WHERE status = 'failed') || ' / ' || count(*) FILTER (WHERE status = 'skipped')
       || ' / ' || round(sum(cost_cents) / 100.0, 2)
  FROM agent_runs, win WHERE started_at >= win.s AND started_at < win.e GROUP BY agent
UNION ALL
SELECT 'agents', 'total usd', coalesce(round(sum(cost_cents) / 100.0, 2), 0)::text
  FROM agent_runs, win WHERE started_at >= win.s AND started_at < win.e
UNION ALL
SELECT 'content', 'articles ' || language, count(*)::text
  FROM articles, win WHERE created_at >= win.s AND created_at < win.e GROUP BY language
UNION ALL
SELECT 'content', 'lag days ' || l.lang,
       coalesce(((SELECT max(created_at)::date FROM articles, win WHERE language = 'en' AND status = 'published' AND created_at < win.e)
                 - (SELECT max(created_at)::date FROM articles, win WHERE language = l.lang AND status = 'published' AND created_at < win.e))::text, 'n/a')
  FROM unnest(ARRAY['de','fr','es','it','nl','pt','sv','da','nb','pl','cs','hu','fi']) AS l(lang)
UNION ALL
SELECT 'content', 'titles left (now)', count(*)::text FROM article_titles WHERE processed = false
UNION ALL
SELECT 'collectors', 'leads ' || source || ' ' || discovered_at::date, count(*)::text
  FROM leads, win WHERE discovered_at >= win.s AND discovered_at < win.e GROUP BY source, discovered_at::date
UNION ALL
SELECT 'collectors', 'tenders ' || discovered_at::date, count(*)::text
  FROM tenders, win WHERE discovered_at >= win.s AND discovered_at < win.e GROUP BY discovered_at::date
UNION ALL
SELECT 'collectors', 'last reddit lead (before the week end)', coalesce(max(discovered_at)::date::text, 'none')
  FROM leads, win WHERE source = 'reddit' AND discovered_at < win.e
UNION ALL
SELECT 'marketing', 'events ' || event_type, count(*)::text
  FROM marketing_events, win WHERE created_at >= win.s AND created_at < win.e GROUP BY event_type
UNION ALL
SELECT 'stuck', 'queue final failures ' || agent, count(*)::text
  FROM agent_runs, win WHERE status = 'failed' AND trigger = 'queue' AND started_at >= win.s AND started_at < win.e GROUP BY agent
UNION ALL
SELECT 'stuck', 'cad jobs failed, timed out or dead-lettered', count(*)::text
  FROM cad_jobs, win WHERE status IN ('failed', 'timed_out', 'dead_letter') AND enqueued_at >= win.s AND enqueued_at < win.e
UNION ALL
SELECT 'stuck', 'runs running or waiting > 48 h (now)', count(*)::text
  FROM agent_runs WHERE status IN ('running', 'waiting_human') AND started_at < now() - interval '48 hours'
UNION ALL
SELECT 'stuck', 'quotes awaiting approval (now)', count(*)::text
  FROM quote_workflows WHERE status = 'awaiting_approval'
ORDER BY 1, 2;

-- Q13 Xometry: one agent_runs row with an outcome for every scheduled slot since the switch (S8)
WITH params AS (SELECT '<S8_SWITCH_UTC>'::timestamptz AS s),
slots AS (
  SELECT g AS slot FROM generate_series(date_trunc('hour', (SELECT s FROM params)), now(), interval '1 hour') g
  WHERE g >= (SELECT s FROM params)                 -- no slot before the switch
    AND g <= now() - interval '5 minutes'           -- the current slot gets 5 min to open its run
    AND extract(hour FROM g AT TIME ZONE 'UTC') IN (6, 8, 10, 12, 14, 16, 18))
SELECT s.slot,
       r.status,
       r.output->>'auth' AS auth,
       (r.output->>'scanned')::int AS scanned
FROM slots s
LEFT JOIN agent_runs r
  ON r.agent = 'growth.xometry'
 AND r.idempotency_key = 'growth.xometry:' || to_char(s.slot AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')
ORDER BY s.slot;   -- pass: no NULL status; with a valid token at least one succeeded slot per day
