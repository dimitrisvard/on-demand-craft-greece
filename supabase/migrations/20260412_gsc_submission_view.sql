-- View: latest successful indexing submission per URL
-- Used by the SEO console dashboard to show submission status and date.
-- Leverages existing indexes on gsc_indexing_log(url) and (submitted_at).

CREATE OR REPLACE VIEW public.gsc_latest_submissions AS
SELECT DISTINCT ON (url)
  url,
  submitted_at,
  submitted_by
FROM public.gsc_indexing_log
WHERE status = 'success'
ORDER BY url, submitted_at DESC;

-- Optimised composite partial index for the DISTINCT ON query
CREATE INDEX IF NOT EXISTS idx_gsc_indexing_log_url_submitted
  ON public.gsc_indexing_log(url, submitted_at DESC)
  WHERE status = 'success';
