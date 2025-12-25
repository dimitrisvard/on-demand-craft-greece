# Automated Blog Generation System - Step-by-Step Implementation Guide

This guide will walk you through implementing the Automated Blog Generation System from scratch.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step 1: Database Setup](#step-1-database-setup)
3. [Step 2: Get API Keys](#step-2-get-api-keys)
4. [Step 3: Configure Environment Variables](#step-3-configure-environment-variables)
5. [Step 4: Deploy Edge Function](#step-4-deploy-edge-function)
6. [Step 5: Set Up IndexNow](#step-5-set-up-indexnow)
7. [Step 6: Configure Scheduled Execution](#step-6-configure-scheduled-execution)
8. [Step 7: Test the System](#step-7-test-the-system)
9. [Step 8: Verify Everything Works](#step-8-verify-everything-works)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:
- ✅ A Supabase project created
- ✅ Supabase CLI installed (for local development) or access to Supabase Dashboard
- ✅ Access to your Supabase project dashboard
- ✅ A Google account (for Gemini API)
- ✅ Your website domain configured and accessible

---

## Step 1: Database Setup

### 1.0 Check if Migration Already Applied (Optional)

Before running the migration, you can verify if the tables already exist:

**Option A: Using Supabase Dashboard**
1. Go to **Table Editor** in Supabase Dashboard
2. Look for tables: `article_titles` and `article_generation_logs`
3. If both tables exist, skip to Step 1.2

**Option B: Using SQL Query**
Run this in Supabase SQL Editor:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('article_titles', 'article_generation_logs')
ORDER BY table_name;
```

**Option C: Using Supabase MCP Tools (If Available)**
If you have Supabase MCP configured, you can use:
- `list_tables` to check if tables exist
- `execute_sql` to run verification queries

**Expected Result:**
- If you see both tables listed → Migration already applied, skip to Step 1.2
- If no results or only one table → Continue with Step 1.1

### 1.1 Run Database Migration

**Option A: Using Supabase CLI (Recommended for local development)**

```bash
# Navigate to your project root
cd /path/to/your/project

# Run the migration
supabase migration up
```

**Option B: Using Supabase Dashboard**

1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Navigate to **SQL Editor** (left sidebar)
4. Click **New Query**
5. Open the migration file: `supabase/migrations/20250120_create_autoblog_tables.sql`
6. Copy the entire SQL content
7. Paste it into the SQL Editor
8. Click **Run** (or press `Ctrl+Enter`)

### 1.2 Verify Tables Created

**Quick Check:**
1. In Supabase Dashboard, go to **Table Editor**
2. You should see two new tables:
   - `article_titles` - For managing article queue
   - `article_generation_logs` - For tracking generation runs

**Detailed Verification (Optional):**

Run these SQL queries in Supabase SQL Editor to verify all components:

```sql
-- 1. Verify tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('article_titles', 'article_generation_logs')
ORDER BY table_name;

-- 2. Verify indexes exist
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename IN ('article_titles', 'article_generation_logs')
AND schemaname = 'public'
ORDER BY tablename, indexname;

-- 3. Verify RLS policies exist
SELECT tablename, policyname, cmd
FROM pg_policies 
WHERE tablename IN ('article_titles', 'article_generation_logs')
ORDER BY tablename, policyname;

-- 4. Verify trigger exists
SELECT trigger_name, event_manipulation
FROM information_schema.triggers
WHERE event_object_table = 'article_titles'
AND trigger_schema = 'public';
```

**Expected Result:**
- ✅ Both tables appear in the Table Editor
- ✅ Tables have proper columns and indexes
- ✅ RLS (Row Level Security) is enabled
- ✅ Required indexes are present (idx_article_titles_processed, idx_article_titles_silo_category)
- ✅ RLS policies are configured (public read + authenticated full access)
- ✅ Trigger exists for updated_at column

---

## Step 2: Get API Keys

### 2.1 Get Google Gemini API Key (REQUIRED)

1. **Visit Google AI Studio:**
   - Go to: https://aistudio.google.com/apikey
   - Sign in with your Google account

2. **Create API Key:**
   - Click **"Create API Key"** button
   - Select your Google Cloud project (or create a new one)
   - Copy the generated API key immediately (you won't see it again)
   - **Save it securely** - you'll need it in Step 3

3. **Important Notes:**
   - The API key has usage limits based on your Google Cloud billing
   - Monitor usage in [Google Cloud Console](https://console.cloud.google.com)
   - Consider setting up billing alerts to avoid unexpected charges
   - Free tier has limited requests per minute

### 2.2 Get Your Supabase Project Details

1. **Get Project URL:**
   - Go to Supabase Dashboard > **Project Settings** > **API**
   - Copy the **Project URL** (format: `https://xxxxx.supabase.co`)
   - Save this for Step 6

2. **Get Service Role Key:**
   - In the same page (Project Settings > API)
   - Find **"service_role"** key (⚠️ Keep this secret!)
   - Click **"Reveal"** and copy the key
   - Save this for Step 6

---

## Step 3: Configure Environment Variables

### 3.1 Access Edge Functions Secrets

1. In Supabase Dashboard, go to **Project Settings** (gear icon)
2. Click **Edge Functions** in the left sidebar
3. Scroll down to **"Secrets"** section

### 3.2 Add Required Environment Variables

Add each secret by clicking **"Add new secret"**:

#### Required Secrets:

**1. GEMINI_API_KEY**
- **Name:** `GEMINI_API_KEY`
- **Value:** Paste your Google Gemini API key from Step 2.1
- Click **Save**

**2. SITE_URL**
- **Name:** `SITE_URL`
- **Value:** Your website URL (e.g., `https://www.micronshub.eu`)
- Click **Save**

**Verification:**
- ✅ Both secrets appear in the secrets list
- ✅ Values are masked (showing only last 4 characters)

#### Optional Secrets (for advanced features):

**3. INDEXNOW_KEY** (Optional - Recommended)
- **Name:** `INDEXNOW_KEY`
- **Value:** `3cbbdcec514448448e83e3bda8be819a` (already configured in `public/indexnow_key.txt`)
- **Note:** This key is already set in the repository. Make sure to set it in Supabase Edge Functions secrets to match the file.

**4. GOOGLE_INDEXING_API_KEY** (Optional - Advanced)
- **Name:** `GOOGLE_INDEXING_API_KEY`
- **Value:** Your Google Indexing API key (requires OAuth2 setup)
- **Note:** This is for Google Search Console integration (advanced setup)

**5. GOOGLE_INDEXING_CLIENT_EMAIL** (Optional - Advanced)
- **Name:** `GOOGLE_INDEXING_CLIENT_EMAIL`
- **Value:** Your Google service account email
- **Note:** Only needed if using Google Indexing API

---

## Step 4: Deploy Edge Function

### 4.1 Verify Edge Function Exists

Check that the edge function file exists:
- Path: `supabase/functions/generate-daily-article/index.ts`

**Status:** ✅ Edge function file exists locally

### 4.2 Deploy Edge Function

**Option A: Using Supabase MCP Tools (If Available)**

The edge function can be deployed using Supabase MCP tools. This has already been done:
- ✅ Function deployed: `generate-daily-article`
- ✅ Status: ACTIVE
- ✅ Version: 1
- ✅ JWT Verification: Disabled (for pg_cron access)

**Option B: Using Supabase CLI**

```bash
# Make sure you're logged in
supabase login

# Link your project (if not already linked)
supabase link --project-ref your-project-ref

# Deploy the function
supabase functions deploy generate-daily-article
```

**Option C: Using Supabase Dashboard**

1. Go to **Edge Functions** in the left sidebar
2. If the function doesn't exist, you'll need to deploy via CLI
3. If it exists, verify it's up to date

### 4.3 Verify Deployment

1. Go to **Edge Functions** > **generate-daily-article** in Supabase Dashboard
2. You should see:
   - Function name: `generate-daily-article`
   - Status: Active
   - Last updated timestamp

**Expected Result:**
- ✅ Function appears in the Edge Functions list
- ✅ Status shows as "Active" or "Deployed"
- ✅ Function URL: `https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/generate-daily-article`

---

## Step 5: Set Up IndexNow

IndexNow allows automatic submission of new articles to search engines (Bing, Yandex, Seznam, Naver).

### 5.1 Generate IndexNow Key

**Option A: Use Auto-Generated Key**
- If you didn't set `INDEXNOW_KEY` in Step 3, the system will auto-generate one
- Check the edge function logs after first run to see the generated key

**Option B: Use the Configured Key**
- The IndexNow key is already configured: `3cbbdcec514448448e83e3bda8be819a`
- This key is set in `public/indexnow_key.txt` file
- Make sure to set the same key as `INDEXNOW_KEY` in Supabase Edge Functions secrets (Step 3.2)

### 5.2 Create indexnow_key.txt File

1. **Get the IndexNow Key:**
   - Check your `INDEXNOW_KEY` environment variable from Step 3
   - Or wait for the first article generation and check logs

2. **Create the File:**
   - Create a file named `indexnow_key.txt` in your website's public root directory
   - For example: `public/indexnow_key.txt` or `static/indexnow_key.txt`
   - Add ONLY the key content (no extra text, no quotes)

3. **Deploy the File:**
   - Deploy this file to your website so it's accessible at:
   - `https://yourdomain.com/indexnow_key.txt`

### 5.3 Verify File Accessibility

1. Open a browser
2. Navigate to: `https://yourdomain.com/indexnow_key.txt`
3. You should see only the key (32 characters)

**Expected Result:**
- ✅ File is accessible via HTTPS
- ✅ File contains only the key (no extra content)
- ✅ Returns 200 OK status

---

## Step 6: Configure Scheduled Execution

This sets up automatic daily article generation using pg_cron.

### 6.1 Enable pg_cron Extension

1. In Supabase Dashboard, go to **Database** > **Extensions**
2. Search for **"pg_cron"**
3. Click **Enable** (or toggle it ON)
4. Wait for confirmation

**Verification:**
- ✅ pg_cron appears in the enabled extensions list

### 6.2 Enable http Extension (if needed)

1. In the same Extensions page
2. Search for **"http"** or **"net"**
3. Enable it if not already enabled
4. This is needed for making HTTP requests from pg_cron

### 6.3 Create Scheduled Job

1. Go to **SQL Editor** in Supabase Dashboard
2. Click **New Query**
3. Replace the placeholders in this SQL:

```sql
-- Replace YOUR_PROJECT_REF with your Supabase project reference
-- Replace YOUR_SERVICE_ROLE_KEY with your service role key from Step 2.2
-- Adjust the cron schedule as needed

SELECT cron.schedule(
  'generate-daily-article',
  '0 7 * * *', -- 7:00 AM UTC = 9:00 AM Greece time (UTC+2)
  $$
  SELECT
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/generate-daily-article',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

**How to find YOUR_PROJECT_REF:**
- It's the part before `.supabase.co` in your Project URL
- Example: If URL is `https://abcdefghijk.supabase.co`, then `abcdefghijk` is your project ref

**Cron Schedule Examples:**
- `'0 7 * * *'` - 7:00 AM UTC (9:00 AM Greece time, UTC+2)
- `'0 9 * * *'` - 9:00 AM UTC (11:00 AM Greece time)
- `'0 0 * * *'` - Midnight UTC (2:00 AM Greece time)

4. **Run the SQL query**
5. You should see a result showing the job ID

### 6.4 Verify Scheduled Job

Run this query in SQL Editor to verify:

```sql
-- Check scheduled jobs
SELECT * FROM cron.job;

-- Check job run history (after first run)
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'generate-daily-article')
ORDER BY start_time DESC 
LIMIT 10;
```

**Expected Result:**
- ✅ Job appears in `cron.job` table
- ✅ Job name is `generate-daily-article`
- ✅ Schedule matches your desired time

---

## Step 7: Test the System

### 7.1 Test Dashboard Access

1. **Navigate to Dashboard:**
   - Go to: `https://yourdomain.com/dashboard/auto-blog`
   - Or: `http://localhost:3000/dashboard/auto-blog` (if local)

2. **Verify UI Loads:**
   - You should see the Auto-Blog Dashboard
   - Two tabs: "Title Manager" and "Daily Generation Summary"

### 7.2 Add a Test Article Title

1. **Click "Title Manager" tab**
2. **Add a test title:**
   - Enter a title (e.g., "Introduction to CNC Machining")
   - Select silo category (optional): "Pillar" or "Cluster"
   - Click **"Add Title"**
3. **Verify it appears:**
   - The title should appear in the table
   - Status should show as "Pending" (not processed)

### 7.3 Test Edge Function Manually

**Option A: Via Supabase Dashboard**

1. Go to **Edge Functions** > **generate-daily-article**
2. Click **"Invoke"** tab
3. Leave the request body as: `{}`
4. Click **"Invoke function"**
5. Wait for the response (this may take 1-2 minutes)

**Option B: Via cURL**

```bash
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/generate-daily-article' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Article generated successfully",
  "title": "Your test title",
  "master_article_id": "...",
  "translations": 13,
  "indexing": {
    "indexnow": { "success": true, ... }
  }
}
```

### 7.4 Check Results

1. **Check Articles Table:**
   - Go to **Table Editor** > **articles**
   - You should see new articles created
   - One master article (English) + translations

2. **Check Generation Logs:**
   - Go to **Table Editor** > **article_generation_logs**
   - You should see a new log entry
   - Check the `summary_data` JSON for details

3. **Check Title Status:**
   - Go back to Dashboard > Auto-Blog > Title Manager
   - Your test title should now show as "Processed" with a checkmark

---

## Step 8: Verify Everything Works

### 8.1 Verify Database Tables

```sql
-- Check article_titles
SELECT COUNT(*) as total_titles,
       COUNT(*) FILTER (WHERE processed = false) as pending_titles,
       COUNT(*) FILTER (WHERE processed = true) as processed_titles
FROM article_titles;

-- Check article_generation_logs
SELECT COUNT(*) as total_logs,
       MAX(created_at) as last_run
FROM article_generation_logs;

-- Check articles created
SELECT language, COUNT(*) as count
FROM articles
WHERE translation_id IS NOT NULL
GROUP BY language
ORDER BY language;
```

### 8.2 Verify Environment Variables

1. Go to **Edge Functions** > **Secrets**
2. Verify all required secrets are set:
   - ✅ `GEMINI_API_KEY` (masked)
   - ✅ `SITE_URL` (visible)

### 8.3 Verify Scheduled Job

```sql
-- Check if job is scheduled
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'generate-daily-article';

-- Should return 1 row with active = true
```

### 8.4 Verify IndexNow File

1. Visit: `https://yourdomain.com/indexnow_key.txt`
2. Should return the key file (200 OK)

### 8.5 Test Full Workflow

1. **Add another test title** in the dashboard
2. **Wait for scheduled time** OR manually trigger the function
3. **Verify:**
   - Article is generated
   - Translations are created (13 languages)
   - Title is marked as processed
   - Log entry is created
   - IndexNow submission is attempted

---

## Troubleshooting

### Issue: Migration Fails

**Symptoms:**
- SQL error when running migration
- Tables not created

**Solutions:**
1. Check if `update_updated_at_column()` function exists:
   ```sql
   SELECT * FROM pg_proc WHERE proname = 'update_updated_at_column';
   ```
2. If missing, create it first (from `20241202_create_articles_table.sql`)
3. Run migration again

### Issue: Edge Function Deployment Fails

**Symptoms:**
- Error during `supabase functions deploy`
- Function not appearing in dashboard

**Solutions:**
1. Verify you're logged in: `supabase login`
2. Verify project is linked: `supabase link --project-ref YOUR_REF`
3. Check function file exists and has no syntax errors
4. Try deploying with verbose output: `supabase functions deploy generate-daily-article --debug`

### Issue: "GEMINI_API_KEY not configured"

**Symptoms:**
- Edge function returns error about missing API key

**Solutions:**
1. Go to **Edge Functions** > **Secrets**
2. Verify `GEMINI_API_KEY` is set (check spelling)
3. Redeploy the function after adding secret
4. Wait a few minutes for secret to propagate

### Issue: No Articles Generated

**Symptoms:**
- Function runs but no articles created
- "No unprocessed titles found" message

**Solutions:**
1. Check `article_titles` table has unprocessed titles:
   ```sql
   SELECT * FROM article_titles WHERE processed = false;
   ```
2. Add a test title via dashboard
3. Verify title was saved correctly

### Issue: Translations Failing

**Symptoms:**
- Master article created but translations missing
- Error logs show Gemini API errors

**Solutions:**
1. Check Gemini API quota/limits in Google Cloud Console
2. Verify API key is valid and has billing enabled
3. Check edge function logs for specific language errors
4. Try reducing number of languages temporarily

### Issue: IndexNow Not Working

**Symptoms:**
- Articles generated but IndexNow submission fails
- Error: "IndexNow key file not found"

**Solutions:**
1. Verify `indexnow_key.txt` is accessible:
   - Visit `https://yourdomain.com/indexnow_key.txt`
   - Should return 200 OK
2. Check file contains only the key (no extra text)
3. Verify key matches `INDEXNOW_KEY` environment variable
4. Check file is in public/static directory (not private)

### Issue: Scheduled Job Not Running

**Symptoms:**
- Job is scheduled but never executes
- No entries in `cron.job_run_details`

**Solutions:**
1. Verify pg_cron is enabled:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```
2. Check job is active:
   ```sql
   SELECT active FROM cron.job WHERE jobname = 'generate-daily-article';
   ```
3. Verify URL and service role key are correct in the job
4. Check `cron.job_run_details` for error messages:
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'generate-daily-article')
   ORDER BY start_time DESC 
   LIMIT 5;
   ```

### Issue: Dashboard Not Loading

**Symptoms:**
- `/dashboard/auto-blog` shows error or blank page

**Solutions:**
1. Verify you're authenticated (logged in)
2. Check browser console for errors
3. Verify route exists in your routing configuration
4. Check if component file exists: `src/pages/dashboard/AutoBlogDashboard.tsx`

---

## Next Steps

After successful setup:

1. **Add Article Titles:**
   - Use the dashboard to add titles to the queue
   - Organize by silo categories (Pillar/Cluster)

2. **Monitor Generation:**
   - Check "Daily Generation Summary" tab regularly
   - Review generation logs for any issues

3. **Optimize Schedule:**
   - Adjust cron schedule based on your needs
   - Consider timezone and traffic patterns

4. **Monitor Costs:**
   - Track Gemini API usage in Google Cloud Console
   - Set up billing alerts

5. **Review Generated Content:**
   - Check generated articles for quality
   - Adjust prompts in edge function if needed

---

## Support

If you encounter issues not covered here:

1. Check Supabase Edge Function logs
2. Review Google Cloud Console for API errors
3. Check Supabase database logs
4. Review the main setup documentation: `AUTO_BLOG_SETUP.md`

---

**Congratulations!** 🎉 Your Automated Blog Generation System is now set up and ready to generate articles automatically!

