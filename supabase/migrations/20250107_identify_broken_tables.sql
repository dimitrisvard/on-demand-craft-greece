-- Migration to identify articles with broken tables
-- This query finds articles that have table-like data but no HTML table tags

-- View to identify articles with broken tables
CREATE OR REPLACE VIEW articles_with_broken_tables AS
SELECT 
  id,
  slug,
  title,
  language,
  translation_id,
  created_at,
  CASE 
    WHEN content LIKE '%Validation Check%' AND content NOT LIKE '%<table%' THEN 'Has validation table data'
    WHEN content LIKE '%MaterialMin Wall%' AND content NOT LIKE '%<table%' THEN 'Has material table data'
    WHEN content LIKE '%Min Wall Thickness%' AND content NOT LIKE '%<table%' THEN 'Has material table data'
    WHEN content LIKE '%Simulation Parameter%' AND content NOT LIKE '%<table%' THEN 'Has simulation table data'
    WHEN content LIKE '%Optimization Category%' AND content NOT LIKE '%<table%' THEN 'Has optimization table data'
    ELSE 'OK'
  END as table_status
FROM articles
WHERE status = 'published'
  AND (
    (content LIKE '%Validation Check%' AND content NOT LIKE '%<table%')
    OR (content LIKE '%MaterialMin Wall%' AND content NOT LIKE '%<table%')
    OR (content LIKE '%Min Wall Thickness%' AND content NOT LIKE '%<table%')
    OR (content LIKE '%Simulation Parameter%' AND content NOT LIKE '%<table%')
    OR (content LIKE '%Optimization Category%' AND content NOT LIKE '%<table%')
  )
ORDER BY created_at DESC;

-- Function to count broken tables by language
CREATE OR REPLACE FUNCTION count_broken_tables_by_language()
RETURNS TABLE(language text, count bigint) AS $$
  SELECT 
    language,
    COUNT(*) as count
  FROM articles_with_broken_tables
  GROUP BY language
  ORDER BY count DESC;
$$ LANGUAGE sql;

