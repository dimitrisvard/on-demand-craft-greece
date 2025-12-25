# Auto-Blog System Setup Checklist

This is your step-by-step guide to complete the setup of the Automated Blog Generation System.

## ✅ Code Implementation Status
- [x] Database schema created
- [x] Dashboard UI implemented
- [x] Edge function created
- [x] IndexNow client implemented
- [x] Routes and navigation added
- [x] Code pushed to Git

## 📋 Your Action Items

### Phase 1: Database Setup

#### 1.1 Run Database Migration
```bash
# Option 1: Using Supabase CLI
supabase migration up

# Option 2: Via Supabase Dashboard
# Go to: Database > Migrations
# Run the migration: 20250120_create_autoblog_tables.sql
```

**What this does:**
- Creates `article_titles` table for managing the article queue
- Creates `article_generation_logs` table for tracking generation runs
- Sets up proper indexes and RLS policies

**Verification:**
- Check Supabase Dashboard > Table Editor
- You should see both new tables

---

### Phase 2: API Keys & Environment Variables

#### 2.1 Get Gemini API Key (REQUIRED)

1. **Go to Google AI Studio:**
   - Visit: https://aistudio.google.com/apikey
   - Sign in with your Google account

2. **Create API Key:**
   - Click "Create API Key"
   - Select your Google Cloud project (or create a new one)
   - Copy the generated API key

3. **Set in Supabase:**
   - Go to: Supabase Dashboard > Project Settings > Edge Functions > Secrets
   - Add secret: `GEMINI_API_KEY` = `[your-api-key]`

**Important Notes:**
- The API key has usage limits based on your Google Cloud billing
- Monitor usage in Google Cloud Console
- Consider setting up billing alerts

#### 2.2 Set Site URL (REQUIRED)

1. **In Supabase Dashboard:**
   - Go to: Project Settings > Edge Functions > Secrets
   - Add secret: `SITE_URL` = `https://www.micronshub.eu` (or your actual domain)

#### 2.3 IndexNow Key (OPTIONAL - Auto-generated if not set)

**Option A: Let system generate automatically**
- No action needed - the system will generate a key automatically

**Option B: Set custom key**
1. Generate a random 32-character alphanumeric string
2. In Supabase Dashboard > Edge Functions > Secrets:
   - Add secret: `INDEXNOW_KEY` = `[your-32-char-key]`

**After setting the key, you MUST create the key file (see Phase 3)**

#### 2.4 Google Indexing API (OPTIONAL - Advanced)

**Note:** This requires OAuth2 service account setup. Currently placeholder in code.

**If you want to implement:**
1. Go to Google Cloud Console
2. Enable "Indexing API"
3. Create a Service Account
4. Download JSON credentials
5. Set in Supabase secrets:
   - `GOOGLE_INDEXING_API_KEY` = `[service-account-json]`
   - `GOOGLE_INDEXING_CLIENT_EMAIL` = `[service-account-email]`

**For now, you can skip this** - IndexNow will handle most search engines.

---

### Phase 3: IndexNow Key File Setup

#### 3.1 Create indexnow_key.txt File

1. **Get your IndexNow key:**
   - Check Supabase Dashboard > Edge Functions > Secrets for `INDEXNOW_KEY`
   - If not set, the system will generate one (check edge function logs after first run)

2. **Create the file:**
   - Create file: `public/indexnow_key.txt`
   - Paste ONLY the key (no extra text, no quotes)
   - Save the file

3. **Verify accessibility:**
   - After deployment, visit: `https://www.micronshub.eu/indexnow_key.txt`
   - You should see only the key text
   - If you see 404, the file isn't in the right location

**File location:**
```
project-root/
  public/
    indexnow_key.txt  ← Must be here
```

---

### Phase 4: Deploy Edge Function

#### 4.1 Deploy to Supabase

```bash
# Using Supabase CLI
supabase functions deploy generate-daily-article

# Or via Supabase Dashboard
# Go to: Edge Functions > Deploy
```

**Verification:**
- Go to Supabase Dashboard > Edge Functions
- You should see `generate-daily-article` function
- Test it manually (see Testing section below)

---

### Phase 5: Schedule Daily Execution (pg_cron)

#### 5.1 Enable pg_cron Extension

1. **In Supabase Dashboard:**
   - Go to: Database > Extensions
   - Find "pg_cron"
   - Click "Enable"

#### 5.2 Create Scheduled Job

**Get your service role key:**
- Supabase Dashboard > Project Settings > API
- Copy "service_role" key (keep it secret!)

**Run this SQL in Supabase SQL Editor:**

```sql
-- Replace YOUR_PROJECT_REF with your Supabase project reference
-- Replace YOUR_SERVICE_ROLE_KEY with your service role key
-- Adjust timezone/time as needed (currently set to 9:00 AM UTC)

SELECT cron.schedule(
  'generate-daily-article',
  '0 9 * * *', -- 9:00 AM UTC daily (adjust for Greece timezone: UTC+2 = 11:00 AM local)
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

**For Greece timezone (UTC+2):**
- To run at 9:00 AM Greece time, use: `'0 7 * * *'` (7:00 AM UTC = 9:00 AM Greece)

**Verification:**
```sql
-- Check scheduled jobs
SELECT * FROM cron.job;

-- Check job run history
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'generate-daily-article')
ORDER BY start_time DESC 
LIMIT 10;
```

---

### Phase 6: Testing

#### 6.1 Test Dashboard Access

1. **Navigate to dashboard:**
   - Go to: `https://your-domain.com/dashboard/auto-blog`
   - You should see the Auto-Blog Dashboard

2. **Add a test title:**
   - Click "Title Manager" tab
   - Enter a test title (e.g., "Introduction to CNC Machining")
   - Select silo category (optional)
   - Click "Add Title"
   - Verify it appears in the table

#### 6.2 Test Edge Function Manually

**Option A: Via Supabase Dashboard**
1. Go to: Edge Functions > generate-daily-article
2. Click "Invoke"
3. Leave body as `{}`
4. Click "Invoke function"
5. Check logs for results

**Option B: Via curl**
```bash
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/generate-daily-article' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Expected result:**
- Function processes the first unprocessed title
- Creates master article in English
- Generates translations for all languages
- Submits to IndexNow
- Creates log entry
- Marks title as processed

#### 6.3 Verify Generated Articles

1. **Check articles table:**
   - Go to: Supabase Dashboard > Table Editor > articles
   - Filter by recent `created_at`
   - You should see articles in multiple languages with same `translation_id`

2. **Check generation logs:**
   - Go to: Dashboard > Auto-Blog > Daily Generation Summary
   - You should see a log entry with translation status

3. **View live articles:**
   - Visit: `https://your-domain.com/en/blog/[article-slug]`
   - Verify content is generated correctly

---

### Phase 7: Monitoring & Maintenance

#### 7.1 Monitor Edge Function Logs

**In Supabase Dashboard:**
- Go to: Edge Functions > generate-daily-article > Logs
- Check for errors or warnings
- Monitor API usage

#### 7.2 Monitor Gemini API Usage

**In Google Cloud Console:**
- Go to: APIs & Services > Dashboard
- Monitor "Generative Language API" usage
- Set up billing alerts if needed

#### 7.3 Check Generation Logs

**In Auto-Blog Dashboard:**
- Regularly check "Daily Generation Summary"
- Look for failed translations
- Verify indexing status

#### 7.4 Manage Article Titles Queue

**Best Practices:**
- Add titles in batches
- Use silo categories for organization
- Review processed titles periodically
- Delete test titles after verification

---

## 🔧 Troubleshooting

### Issue: "No unprocessed titles found"
**Solution:** Add titles via the dashboard Title Manager

### Issue: "GEMINI_API_KEY not configured"
**Solution:** Set the secret in Supabase Dashboard > Edge Functions > Secrets

### Issue: Translations failing
**Possible causes:**
- Gemini API quota exceeded
- Invalid API key
- Network issues

**Solutions:**
- Check API key validity
- Verify billing is enabled in Google Cloud
- Check edge function logs for specific errors

### Issue: IndexNow not working
**Check:**
1. `indexnow_key.txt` exists in `public/` folder
2. File is accessible at `https://your-domain.com/indexnow_key.txt`
3. Key in file matches `INDEXNOW_KEY` secret (if set)

### Issue: pg_cron not running
**Check:**
1. Extension is enabled
2. Job is scheduled (run `SELECT * FROM cron.job;`)
3. Service role key is correct
4. Function URL is correct

---

## 📊 Success Criteria

You'll know everything is working when:

- ✅ Dashboard loads at `/dashboard/auto-blog`
- ✅ You can add/edit/delete titles
- ✅ Edge function runs successfully (check logs)
- ✅ Articles are created in database
- ✅ Translations are generated for all languages
- ✅ Generation logs appear in dashboard
- ✅ Articles are accessible on your site
- ✅ IndexNow submission succeeds (check logs)
- ✅ Scheduled job runs daily (check cron logs)

---

## 🚀 Next Steps After Setup

1. **Add your first batch of titles**
   - Think about your content strategy
   - Use silo categories for organization

2. **Monitor first few generations**
   - Check article quality
   - Adjust prompts if needed (in edge function)

3. **Set up Google Search Console**
   - Verify site ownership
   - Submit sitemap manually if needed

4. **Consider enhancements:**
   - Custom prompts per silo category
   - A/B testing different generation strategies
   - Analytics integration

---

## 📝 Quick Reference

**Dashboard URL:** `/dashboard/auto-blog`

**Edge Function:** `generate-daily-article`

**Required Secrets:**
- `GEMINI_API_KEY` ⚠️ REQUIRED
- `SITE_URL` ⚠️ REQUIRED
- `INDEXNOW_KEY` (optional)

**Key Files:**
- `public/indexnow_key.txt` (must exist after first run)

**Database Tables:**
- `article_titles`
- `article_generation_logs`

---

## ⚠️ Important Notes

1. **API Costs:** Gemini API usage incurs costs. Monitor your usage.
2. **Rate Limits:** Be aware of API rate limits
3. **Content Quality:** Review generated articles before relying on them
4. **Backup:** Regularly backup your `article_titles` table
5. **Security:** Never commit API keys to Git

---

## 🆘 Need Help?

If you encounter issues:
1. Check edge function logs in Supabase Dashboard
2. Verify all environment variables are set
3. Check database tables for data
4. Review the setup documentation: `docs/AUTO_BLOG_SETUP.md`





