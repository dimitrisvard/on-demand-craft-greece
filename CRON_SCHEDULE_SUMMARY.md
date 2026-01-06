# Cron Job Schedule Summary

## Daily Workflow Schedule (Greece Time / UTC)

All times are in Greece timezone (UTC+2) with UTC equivalent:

1. **Article Creation**: 9:00 AM Greece / 7:00 AM UTC
   - Cron job: `enqueue-daily-article`
   - Schedule: `0 7 * * *`
   - Function: Enqueues a new article for generation

2. **Translation**: 10:00 AM Greece / 8:00 AM UTC (1 hour after article creation)
   - Cron job: `auto-translate-daily-articles`
   - Schedule: `0 8 * * *`
   - Function: `auto-translate-articles`
   - **NEW (2026-01-06)**: Translates languages ONE AT A TIME to avoid timeout
   - Supports all 13 languages including difficult ones (Hungarian, Czech, Finnish, Polish)
   - Each language is translated in a separate API call (~10-30 seconds each)
   - Total translation time: ~5-10 minutes for all 13 languages

3. **Fix Article Links**: 10:15 AM Greece / 8:15 AM UTC (15 minutes after translation starts)
   - Cron job: `auto-fix-article-links`
   - Schedule: `15 8 * * *`
   - Function: `fix-article-links`
   - Fixes internal article links and adds target="_blank" to open in new tabs

4. **Sitemap Update**: 11:00 AM Greece / 9:00 AM UTC (1 hour after translation)
   - Cron job: `auto-update-sitemap`
   - Schedule: `0 9 * * *`
   - Function: `auto-update-sitemap`
   - Updates sitemap after translations and link fixing are complete

## Timeline

```
9:00 AM Greece (7:00 AM UTC)   → Article Creation
10:00 AM Greece (8:00 AM UTC)  → Translation (1 hour later)
10:15 AM Greece (8:15 AM UTC)  → Fix Links (15 minutes after translation)
11:00 AM Greece (9:00 AM UTC)  → Sitemap Update (1 hour after translation)
```

## Verification

To verify cron jobs are active and scheduled correctly:

```sql
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  CASE 
    WHEN jobname = 'enqueue-daily-article' THEN 'Article creation (9:00 AM Greece / 7:00 AM UTC)'
    WHEN jobname = 'auto-translate-daily-articles' THEN 'Translation (10:00 AM Greece / 8:00 AM UTC)'
    WHEN jobname = 'auto-fix-article-links' THEN 'Fix Links (10:15 AM Greece / 8:15 AM UTC)'
    WHEN jobname = 'auto-update-sitemap' THEN 'Sitemap (11:00 AM Greece / 9:00 AM UTC)'
    ELSE 'Other'
  END as description
FROM cron.job 
WHERE jobname IN ('enqueue-daily-article', 'auto-translate-daily-articles', 'auto-fix-article-links', 'auto-update-sitemap')
ORDER BY schedule;
```

## Last Updated

- Date: January 5, 2026
- Changes: Updated translation and sitemap schedules to run 1 hour apart as requested
- Fixed: UTC timezone issue in auto-translate-articles function

