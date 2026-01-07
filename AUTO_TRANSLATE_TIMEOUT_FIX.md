# Auto-Translate Timeout Protection Fix

**Date:** 2026-01-07  
**Status:** ✅ Implemented

## Problem Summary

The `auto-translate-articles` function was timing out after ~153 seconds because it tried to translate all 13 languages in a single execution, exceeding the 150-second edge function timeout limit (free tier).

**Root Cause:**
- Function translates languages one at a time (correct approach)
- But tries to complete ALL languages in one execution
- Total time needed: ~560-580 seconds (13 languages × 40s + waits)
- Edge function timeout: 150 seconds (free tier) or 400 seconds (Pro tier)
- Result: Function times out after ~153 seconds, only 5/13 languages translated

## Solution Implemented

### 1. Timeout Protection in Function ✅

Added timeout checking that:
- Monitors elapsed time before starting each language translation
- Stops gracefully at 140 seconds (leaving 10s buffer before 150s limit)
- Returns partial completion status
- Next cron run automatically picks up remaining languages

**Key Changes:**
- `MAX_EXECUTION_TIME_MS = 140000` (140 seconds)
- Timeout check before each language translation
- Timeout check after each translation completes
- Timeout check before moving to next article
- Skips link fixing if < 10 seconds remaining

**File:** `supabase/functions/auto-translate-articles/index.ts`

### 2. Cron Job Timeout ✅

Added `timeout_milliseconds` parameter to cron job to allow it to wait for function completion.

**Key Changes:**
- `timeout_milliseconds := 600000` (10 minutes)
- Allows cron job to wait for function response
- Function will exit early at 140s, but cron can wait for proper response

**File:** `supabase/migrations/20250107_add_timeout_to_auto_translate_cron.sql`

## How It Works

### Execution Flow

1. **Cron Job Runs** (8:00 AM UTC)
   - Calls `auto-translate-articles` function
   - Waits up to 10 minutes for response

2. **Function Starts**
   - Finds articles created today with missing translations
   - Starts translating languages one at a time

3. **Timeout Protection**
   - Before each language: Checks if elapsed time ≥ 140s
   - If yes: Stops gracefully, logs remaining languages
   - Returns partial completion status

4. **Next Cron Run** (next day at 8:00 AM UTC)
   - Automatically finds articles with remaining missing languages
   - Continues translation from where it left off
   - Process repeats until all languages are translated

### Example Timeline

**Day 1 (8:00 AM UTC):**
```
08:00:00 - Function starts
08:00:48 - German (de) translated ✓
08:01:36 - French (fr) translated ✓
08:02:19 - Spanish (es) translated ✓
08:03:07 - Italian (it) translated ✓
08:04:02 - Dutch (nl) translated ✓
08:05:20 - Timeout protection: Stops (140s elapsed)
          - Remaining: cs, da, fi, hu, nb, pt, sv, pl (8 languages)
```

**Day 2 (8:00 AM UTC):**
```
08:00:00 - Function starts
          - Finds same article with 8 missing languages
08:00:45 - Czech (cs) translated ✓
08:01:32 - Danish (da) translated ✓
08:02:19 - Finnish (fi) translated ✓
08:03:06 - Hungarian (hu) translated ✓
08:03:53 - Norwegian (nb) translated ✓
08:04:40 - Portuguese (pt) translated ✓
08:05:27 - Swedish (sv) translated ✓
08:06:14 - Polish (pl) translated ✓
08:06:20 - All languages complete! ✓
08:06:25 - Link fixing completed ✓
```

## Benefits

1. ✅ **No More Timeouts**: Function stops before hitting edge function timeout
2. ✅ **Automatic Resume**: Next cron run automatically continues translation
3. ✅ **Progress Preservation**: Completed translations are saved, not lost
4. ✅ **Graceful Degradation**: Function completes what it can, reports what remains
5. ✅ **Better Logging**: Clear indication of partial completion and remaining work

## Migration Instructions

### Step 1: Deploy Function Changes

The function code has been updated. Deploy it:

```bash
supabase functions deploy auto-translate-articles
```

### Step 2: Update Cron Job

Run the migration to add timeout to cron job:

1. Open Supabase SQL Editor
2. Get your service role key from: Dashboard > Settings > API > service_role (click "Reveal")
3. Open `supabase/migrations/20250107_add_timeout_to_auto_translate_cron.sql`
4. Replace `YOUR_SERVICE_ROLE_KEY` with your actual service role key
5. Run the SQL in Supabase SQL Editor

**OR** run directly (replace YOUR_SERVICE_ROLE_KEY):

```sql
SELECT cron.unschedule('auto-translate-daily-articles');

SELECT cron.schedule(
  'auto-translate-daily-articles',
  '0 8 * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/auto-translate-articles',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 600000
    ) AS request_id;
  $$
);
```

### Step 3: Verify

Check cron job was updated:

```sql
SELECT jobid, jobname, schedule, active, command 
FROM cron.job 
WHERE jobname = 'auto-translate-daily-articles';
```

Should show `timeout_milliseconds := 600000` in the command.

## Testing

### Manual Test

You can manually trigger the function to test timeout protection:

```bash
curl -X POST https://cfjrtmtaitwzggzpkhxi.supabase.co/functions/v1/auto-translate-articles \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response (if timeout protection triggers):
```json
{
  "success": true,
  "message": "Translation partially completed: 5 languages translated, 0 failed. Remaining languages will be translated in next run.",
  "articles_processed": 1,
  "articles_completed": 0,
  "articles_remaining": 1,
  "total_translated": 5,
  "total_failed": 0,
  "execution_time_ms": 140000,
  "timeout_protection_used": true,
  "has_remaining_work": true,
  ...
}
```

### Monitor Next Cron Run

After deploying, monitor the next cron run (8:00 AM UTC):

1. Check edge function logs: Dashboard > Edge Functions > auto-translate-articles > Logs
2. Look for timeout protection messages: `⚠️ [TIMEOUT PROTECTION]`
3. Verify partial completion and remaining languages logged
4. Check next day's run continues from where it left off

## Configuration

### Adjusting Timeout (if needed)

If you upgrade to Pro tier (400s limit), you can increase the timeout:

**File:** `supabase/functions/auto-translate-articles/index.ts`

Change line:
```typescript
const MAX_EXECUTION_TIME_MS = 140000; // 140 seconds
```

To:
```typescript
const MAX_EXECUTION_TIME_MS = 380000; // 380 seconds (leave 20s buffer for 400s limit)
```

This will allow more languages to be translated per run before timeout protection kicks in.

## Notes

- The function will automatically resume on the next cron run
- No manual intervention needed
- Completed translations are saved immediately
- Link fixing happens automatically when time permits, or via separate cron job
- The cron job timeout (10 minutes) is longer than function timeout (140s) to allow proper response handling

