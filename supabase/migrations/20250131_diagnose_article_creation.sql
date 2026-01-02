-- Diagnostic queries to check article creation and cron job status
-- Run these queries in Supabase SQL Editor to diagnose the issue

-- 1. Check if cron job exists and is active
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  nodename,
  nodeport
FROM cron.job 
WHERE jobname = 'generate-daily-article';

-- 2. Check cron job execution history (last 10 runs)
SELECT 
  jobid,
  runid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time
FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'generate-daily-article')
ORDER BY start_time DESC 
LIMIT 10;

-- 3. Check articles created today
SELECT 
  id,
  title,
  slug,
  language,
  status,
  created_at,
  translation_id
FROM articles
WHERE DATE(created_at) = CURRENT_DATE
ORDER BY created_at DESC;

-- 4. Check all articles created in the last 7 days
SELECT 
  id,
  title,
  slug,
  language,
  status,
  created_at,
  translation_id
FROM articles
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY created_at DESC;

-- 5. Check article generation logs from today
SELECT 
  id,
  summary_data->>'title' as title,
  summary_data->>'master_article_id' as master_article_id,
  summary_data->>'status' as status,
  summary_data->>'translations_pending' as translations_pending,
  created_at
FROM article_generation_logs
WHERE DATE(created_at) = CURRENT_DATE
ORDER BY created_at DESC;

-- 6. Check if there are unprocessed titles
SELECT 
  id,
  title,
  silo_category,
  processed,
  processed_at,
  created_at
FROM article_titles
WHERE processed = false
ORDER BY created_at ASC;

-- 7. Check RLS policies on articles table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'articles';

-- 8. Count articles by status and language
SELECT 
  status,
  language,
  COUNT(*) as count
FROM articles
GROUP BY status, language
ORDER BY status, language;

-- 9. Check for any articles with missing required fields
SELECT 
  id,
  title,
  slug,
  content IS NULL as missing_content,
  language,
  status,
  created_at
FROM articles
WHERE content IS NULL OR title IS NULL OR slug IS NULL
ORDER BY created_at DESC;

-- 10. Check edge function invocation logs (if available)
-- Note: This requires access to Supabase logs dashboard
-- Go to: Edge Functions > generate-daily-article > Logs


