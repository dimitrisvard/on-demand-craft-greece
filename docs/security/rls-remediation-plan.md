# ⚠️ SECURITY ALERT: Service Role Key Exposed

> Status: Planned remediation — a dry-run migration exists, audit of anon vs service role usage pending before rollout.

## Issue
A Supabase Service Role JWT was exposed in the GitHub repository on January 3rd, 2026.

## Immediate Actions Required

### 1. Rotate the Service Role Key in Supabase (CRITICAL)

**The exposed key MUST be rotated immediately:**

1. Go to **Supabase Dashboard** > **Project Settings** > **API**
2. Find the **"service_role"** key section
3. Click **"Reset service_role key"** or **"Rotate key"**
4. Copy the new key
5. Update all cron jobs and environment variables with the new key

### 2. Update Cron Jobs in Database

After rotating the key, update these cron jobs in Supabase SQL Editor:

```sql
-- Update process-article-queue cron job
SELECT cron.unschedule('process-article-queue');
SELECT cron.schedule(
  'process-article-queue',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/process-article-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_NEW_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) AS request_id;
  $$
);

-- Update auto-translate-daily-articles cron job
SELECT cron.unschedule('auto-translate-daily-articles');
SELECT cron.schedule(
  'auto-translate-daily-articles',
  '0 11 * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/auto-translate-articles',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_NEW_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

**Replace `YOUR_NEW_SERVICE_ROLE_KEY` with the new key from step 1.**

### 3. Update Environment Variables

Update the `SUPABASE_SERVICE_ROLE_KEY` environment variable in:
- Supabase Dashboard > **Project Settings** > **Edge Functions** > **Secrets**
- Any CI/CD pipelines
- Local development `.env` files

### 4. Files Fixed

✅ **Fixed in codebase:**
- `supabase/migrations/20250103_update_cron_jobs_for_queue.sql` - Replaced hardcoded key with placeholder

⚠️ **Still needs manual update:**
- Database cron jobs (see step 2 above)
- Environment variables (see step 3 above)

## Prevention

- ✅ Never commit service role keys to version control
- ✅ Always use environment variables or Supabase secrets
- ✅ Use placeholders like `YOUR_SERVICE_ROLE_KEY` in migration files
- ✅ Add `.env` files to `.gitignore`
- ✅ Use GitGuardian or similar tools to scan for secrets

## Note

Even though the key has been removed from the current codebase, it still exists in Git history. The key MUST be rotated in Supabase to invalidate the exposed key.

