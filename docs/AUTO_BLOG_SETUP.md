# Automated Blog Generation System Setup

This document describes the setup and configuration for the Automated Blog Generation System with Gemini 3 Pro.

## Overview

The system automates high-quality technical blog generation with:
- Multi-language translation support (14 languages)
- Multi-engine indexing (Google + IndexNow)
- Automated sitemap updates
- Daily article generation via pg_cron

## Database Setup

Run the migration to create the required tables:

```bash
supabase migration up
```

This creates:
- `article_titles` - Queue of titles to be processed
- `article_generation_logs` - Logs of generation runs

## Environment Variables

Configure these in your Supabase project settings:

### Required
- `GEMINI_API_KEY` - Google Gemini API key
- `SITE_URL` - Your site URL (e.g., https://www.micronshub.eu)

### Optional
- `INDEXNOW_KEY` - IndexNow API key (auto-generated if not provided)
- `GOOGLE_INDEXING_API_KEY` - Google Indexing API key (requires OAuth2 setup)
- `GOOGLE_INDEXING_CLIENT_EMAIL` - Google service account email

## IndexNow Setup

1. Generate an IndexNow key (or use the one from `INDEXNOW_KEY` env var)
2. Create `public/indexnow_key.txt` with the key content
3. Ensure the file is accessible at `https://yourdomain.com/indexnow_key.txt`

## Scheduled Execution

Set up pg_cron to run daily at 9:00 AM Greece time:

```sql
SELECT cron.schedule(
  'generate-daily-article',
  '0 9 * * *', -- 9:00 AM daily (adjust timezone as needed)
  $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/generate-daily-article',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

## Usage

1. **Add Titles**: Navigate to `/dashboard/auto-blog` and add article titles
2. **Monitor**: View generation logs in the "Daily Generation Summary" tab
3. **Automatic Processing**: Titles are processed daily at the scheduled time

## Features

### Title Manager
- Add new article titles to the queue
- Edit/delete pending titles
- Categorize by silo (Pillar/Cluster)
- View processed titles (grayed out with checkmark)

### Daily Generation Summary
- View recent automation runs
- See translation status for each language
- Check indexing status (Google + IndexNow)
- View article URLs

## Gemini 3 Pro Strategy

- **Master Generation**: Uses high thinking level for deep technical reasoning
- **Translation Loop**: Uses low thinking level for efficient translations
- **Thought Signatures**: Preserves context between master and translations

## Indexing

### IndexNow
- Automatically submits URLs to Bing, Yandex, Seznam, and Naver
- Requires `indexnow_key.txt` file in public root

### Google Indexing API
- Requires OAuth2 service account setup
- Currently placeholder - needs full OAuth2 implementation

## Sitemap Updates

Sitemap updates are logged in the edge function. For production, consider:
- Generating sitemaps dynamically from the database
- Using a build process to regenerate static sitemaps
- Implementing a sitemap API endpoint

## Troubleshooting

### No articles generated
- Check `article_titles` table for unprocessed titles
- Verify `GEMINI_API_KEY` is set correctly
- Check edge function logs in Supabase dashboard

### Translations failing
- Verify Gemini API quota/limits
- Check edge function logs for specific language errors

### Indexing not working
- Verify `indexnow_key.txt` is accessible
- Check IndexNow key matches environment variable
- For Google Indexing, complete OAuth2 setup

