# Article Creation Troubleshooting Guide

## Issue: Article Creation Completed But Not Found in Dashboard

### Potential Causes

1. **Cron Job Not Scheduled** ⚠️ **MOST LIKELY**
   - The cron job SQL in `20250121_create_daily_article_cron_job.sql` is **commented out**
   - The job may not be active in the database
   - **Solution:** Check if cron job exists and is active (see diagnostic queries below)

2. **Edge Function Failed Silently**
   - The function may have run but encountered an error
   - Check edge function logs in Supabase Dashboard
   - **Solution:** Review logs at Edge Functions > generate-daily-article > Logs

3. **RLS Policy Issue**
   - Articles created but not visible due to Row Level Security
   - **Solution:** Verify RLS policies allow authenticated users to view articles

4. **Dashboard Query Filter**
   - Dashboard might be filtering articles incorrectly
   - **Solution:** Check BlogList.tsx query (currently shows all articles)

5. **Article Status Mismatch**
   - Articles created with different status than expected
   - **Solution:** Check article status in database

## Diagnostic Steps

### Step 1: Check Cron Job Status

Run this SQL in Supabase SQL Editor:

```sql
-- Check if cron job exists
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  nodename,
  nodeport
FROM cron.job 
WHERE jobname = 'generate-daily-article';
```

**Expected Result:**
- If empty: Cron job is NOT scheduled
- If exists: Check `active` column (should be `true`)

### Step 2: Check Cron Job Execution History

```sql
-- Check last 10 cron job runs
SELECT 
  jobid,
  runid,
  status,
  return_message,
  start_time,
  end_time
FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'generate-daily-article')
ORDER BY start_time DESC 
LIMIT 10;
```

**What to Look For:**
- `status = 'succeeded'` or `status = 'failed'`
- `return_message` for error details
- Recent `start_time` entries

### Step 3: Check Articles Created Today

```sql
-- Check articles created today
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
```

**What to Look For:**
- If empty: No articles created today
- If exists: Check `status` (should be 'published')
- Check `language` (should be 'en' for master articles)

### Step 4: Check Generation Logs

```sql
-- Check generation logs from today
SELECT 
  id,
  summary_data->>'title' as title,
  summary_data->>'master_article_id' as master_article_id,
  summary_data->>'status' as status,
  created_at
FROM article_generation_logs
WHERE DATE(created_at) = CURRENT_DATE
ORDER BY created_at DESC;
```

**What to Look For:**
- Log entries indicate the function ran
- `master_article_id` should match an article in the articles table

### Step 5: Check Edge Function Logs

1. Go to Supabase Dashboard
2. Navigate to: **Edge Functions** > **generate-daily-article**
3. Click **Logs** tab
4. Check for errors or warnings

**What to Look For:**
- Error messages
- API key issues (ANTHROPIC_API_KEY)
- Database connection errors
- Timeout errors

### Step 6: Verify RLS Policies

```sql
-- Check RLS policies on articles table
SELECT 
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'articles';
```

**Expected Policies:**
1. `Allow public read access for published articles` (SELECT)
2. `Allow authenticated users full access` (ALL operations)

## Solutions

### Solution 1: Schedule the Cron Job

If the cron job doesn't exist, you need to schedule it:

1. **Get your Service Role Key:**
   - Go to Supabase Dashboard > Project Settings > API
   - Find "service_role" key
   - Click "Reveal" and copy it

2. **Run this SQL** (replace `YOUR_SERVICE_ROLE_KEY`):

```sql
SELECT cron.schedule(
  'generate-daily-article',
  '0 7 * * *', -- 7:00 AM UTC = 9:00 AM Greece time (UTC+2)
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/generate-daily-article',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

3. **Verify it was created:**

```sql
SELECT * FROM cron.job WHERE jobname = 'generate-daily-article';
```

### Solution 2: Manually Trigger Article Generation

If the cron job isn't working, you can manually trigger it:

1. **Via Dashboard:**
   - Go to `/dashboard/auto-blog`
   - Click "Generate Article Now" button

2. **Via Supabase Dashboard:**
   - Go to Edge Functions > generate-daily-article
   - Click "Invoke"
   - Leave body as `{}`
   - Click "Invoke function"

3. **Via API Call:**

```bash
curl -X POST \
  'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/generate-daily-article' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### Solution 3: Check for Unprocessed Titles

The function requires unprocessed titles in the `article_titles` table:

```sql
-- Check for unprocessed titles
SELECT 
  id,
  title,
  silo_category,
  processed,
  created_at
FROM article_titles
WHERE processed = false
ORDER BY created_at ASC;
```

**If empty:** Add titles via the dashboard at `/dashboard/auto-blog`

### Solution 4: Verify Environment Variables

Check that these environment variables are set in Supabase:

1. Go to **Project Settings** > **Edge Functions** > **Secrets**
2. Verify these are set:
   - `ANTHROPIC_API_KEY` (required for article generation)
   - `SUPABASE_URL` (should be auto-set)
   - `SUPABASE_SERVICE_ROLE_KEY` (should be auto-set)
   - `SITE_URL` (optional, defaults to https://www.micronshub.eu)

### Solution 5: Check Dashboard Query

The dashboard query in `BlogList.tsx` should show all articles:

```typescript
const { data, error } = await supabase
  .from('articles')
  .select('*')
  .order('created_at', { ascending: false });
```

**If articles exist but don't show:**
- Check browser console for errors
- Verify you're authenticated
- Check RLS policies allow your user to view articles

## Quick Fix Checklist

- [ ] Cron job exists and is active
- [ ] Cron job has run recently (check `cron.job_run_details`)
- [ ] Articles exist in database (check `articles` table)
- [ ] Generation logs exist (check `article_generation_logs`)
- [ ] Edge function logs show no errors
- [ ] RLS policies are correct
- [ ] Environment variables are set
- [ ] Unprocessed titles exist in `article_titles` table
- [ ] Dashboard query works (check browser console)

## Next Steps

1. Run the diagnostic queries above
2. Check edge function logs
3. Verify cron job is scheduled
4. Manually trigger article generation to test
5. Check if articles appear in database but not dashboard (RLS issue)


