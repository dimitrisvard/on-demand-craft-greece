# Sitemap Implementation Analysis

## Overview
This document provides a detailed analysis of how the sitemap is implemented in the codebase and identifies potential issues preventing articles from being included.

## Sitemap Generation Location

### Main Function
**File:** `supabase/functions/generate-sitemap/index.ts`

This is the primary sitemap generation function that:
1. Fetches published articles from the database
2. Groups them by language
3. Generates XML sitemap entries
4. Uploads to Supabase Storage bucket `sitemaps`

### Key Function: `generateSitemap()`
**Lines:** 93-166

```typescript
async function generateSitemap(): Promise<string> {
  // Fetches articles with:
  // - status = 'published'
  // - Fields: slug, language, updated_at
  // - Ordered by language and updated_at
}
```

## Article Query Details

### Query Implementation (Lines 97-102)
```typescript
const { data: articles, error } = await supabase
  .from("articles")
  .select("slug, language, updated_at")
  .eq("status", "published")
  .order("language", { ascending: true })
  .order("updated_at", { ascending: false });
```

### Authentication
- Uses **Service Role Key** (Line 5, 8)
- Should bypass Row Level Security (RLS)
- Client initialized: `createClient(supabaseUrl!, supabaseServiceKey!)`

## Potential Issues Identified

### 1. **Language Code Mismatch** ⚠️ **MOST LIKELY ISSUE**
**Location:** Lines 17, 114-121, 142-156

The sitemap only includes articles for languages in the `LANGUAGES` array:
```typescript
const LANGUAGES = ["en", "de", "fr", "es", "it", "nl", "pl", "sv", "da", "fi", "cs", "hu", "pt", "nb"];
```

**Problem:** If articles in the database have:
- Different language codes (e.g., "en-US" instead of "en")
- Case sensitivity issues (e.g., "EN" instead of "en")
- Extra whitespace
- Language codes not in the LANGUAGES array

Then they will be fetched from the database but **NOT included** in the sitemap because the grouping logic only processes languages in the `LANGUAGES` array.

**Code Evidence:**
```typescript
// Line 142-156: Only processes articles if language matches LANGUAGES array
if (articlesByLanguage[lang]) {
  // Articles added here
} else {
  console.log(`No blog articles found for language: ${lang}`);
}
```

### 2. **RLS Policy Issue** (Less Likely)
**Location:** `supabase/migrations/20241202_create_articles_table.sql`

RLS Policy for published articles:
```sql
CREATE POLICY "Allow public read access for published articles" 
ON public.articles FOR SELECT 
USING (status = 'published');
```

**Note:** Service role key should bypass RLS, but if the key is incorrect or missing, queries might fail silently or return empty results.

### 3. **Missing Translation ID in Select**
**Location:** Line 99

The query selects `slug, language, updated_at` but the `Article` interface (line 35-40) includes `translation_id`. However, this shouldn't prevent articles from being included - it's just not used in the sitemap generation.

### 4. **Article Status Check**
**Location:** Line 100

Only articles with `status = 'published'` are included. If articles are in 'draft' status, they won't appear.

## How Articles Are Added to Sitemap

### Process Flow:
1. **Fetch** all published articles (line 97-102)
2. **Group** articles by language into `articlesByLanguage` object (lines 114-121)
3. **Loop** through each language in `LANGUAGES` array (line 126)
4. **Check** if articles exist for that language (line 142)
5. **Generate** URL entries: `${siteUrl}/${lang}/blog/${article.slug}` (line 145)
6. **Add** to sitemap XML (lines 147-152)

### URL Format:
```
https://www.micronshub.eu/{language}/blog/{slug}
```

Example: `https://www.micronshub.eu/en/blog/my-article-slug`

## Sitemap Storage & Serving

### Storage Location
- **Bucket:** `sitemaps`
- **Filename:** `sitemap-complete.xml`
- **Upload Function:** `uploadSitemapToStorage()` (lines 232-264)

### Public Access
- **API Route:** `api/sitemap-complete.xml.js`
- **Public URL:** `https://www.micronshub.eu/sitemap-complete.xml`
- **Storage URL:** `${SUPABASE_URL}/storage/v1/object/public/sitemaps/sitemap-complete.xml`

## Debugging Steps

### 1. Check Article Language Codes
Run this query in Supabase SQL Editor:
```sql
SELECT DISTINCT language, COUNT(*) as count
FROM articles
WHERE status = 'published'
GROUP BY language
ORDER BY language;
```

**Expected:** Language codes should exactly match: `en`, `de`, `fr`, `es`, `it`, `nl`, `pl`, `sv`, `da`, `fi`, `cs`, `hu`, `pt`, `nb`

### 2. Check Article Count
```sql
SELECT COUNT(*) as total_published
FROM articles
WHERE status = 'published';
```

### 3. Check Service Role Key
Verify that `SUPABASE_SERVICE_ROLE_KEY` environment variable is set correctly in the Edge Function.

### 4. Check Function Logs
Look at the Edge Function logs when generating sitemap:
- Line 109: `Found X published articles for sitemap`
- Line 111: Sample articles logged
- Line 143: `Adding X blog articles for {lang}`
- Line 155: `No blog articles found for language: {lang}`

## Recommended Fixes

### Fix 1: Normalize Language Codes
Add language code normalization before grouping:
```typescript
// Normalize language codes (trim, lowercase)
const normalizedLang = article.language?.trim().toLowerCase();
if (!articlesByLanguage[normalizedLang]) {
  articlesByLanguage[normalizedLang] = [];
}
articlesByLanguage[normalizedLang].push(article);
```

### Fix 2: Include All Languages
Instead of only processing languages in `LANGUAGES` array, process all languages found in articles:
```typescript
// Get all unique languages from articles
const articleLanguages = Object.keys(articlesByLanguage);
const languagesToProcess = [...new Set([...LANGUAGES, ...articleLanguages])];
```

### Fix 3: Add Debug Logging
Add more detailed logging to identify the issue:
```typescript
console.log(`Articles fetched: ${articles?.length || 0}`);
console.log(`Unique languages in articles:`, Object.keys(articlesByLanguage));
console.log(`Languages to process:`, LANGUAGES);
```

### Fix 4: Verify Service Role Key
Ensure the Edge Function has the correct environment variable set.

## Related Files

- **Sitemap Generation:** `supabase/functions/generate-sitemap/index.ts`
- **API Route:** `api/sitemap-complete.xml.js`
- **Database Schema:** `supabase/migrations/20241202_create_articles_table.sql`
- **Dashboard UI:** `src/pages/dashboard/SettingsPage.tsx` (line 36-87)
- **Blog List UI:** `src/pages/dashboard/BlogList.tsx` (line 251-309)

## Fixes Applied ✅

### 1. Language Code Normalization
**File:** `supabase/functions/generate-sitemap/index.ts`
**Lines:** 114-193

**Changes:**
- Added language code normalization (trim + lowercase) when grouping articles
- Now handles case-insensitive matching (e.g., "EN" → "en", " De " → "de")
- Added fallback matching: checks both exact language code and normalized version

**Code:**
```typescript
// Normalize language code: trim and lowercase
const normalizedLang = (article.language || '').trim().toLowerCase();
```

### 2. Enhanced Logging
**Lines:** 109-193

**Added:**
- Logs all languages found in articles
- Logs languages that don't match LANGUAGES array
- Logs total articles added vs total published
- Warns when articles are excluded

**Example Output:**
```
Languages found in articles: en, de, fr
Languages to process: en, de, fr, es, it, ...
Adding 15 blog articles for en
Total articles added to sitemap: 45 out of 45 published articles
```

### 3. Language-Specific Sitemap Fix
**Lines:** 207-240

**Changes:**
- Updated `generateLanguageSitemap()` to use case-insensitive filtering
- Fetches all published articles, then filters by normalized language code
- Ensures articles are included even if language code has case/whitespace issues

## Next Steps

1. **Test the fix:**
   - Generate a new sitemap via the dashboard
   - Check Edge Function logs for the new detailed logging
   - Verify all published articles are included

2. **Verify language codes in database:**
   ```sql
   SELECT DISTINCT language, COUNT(*) as count
   FROM articles
   WHERE status = 'published'
   GROUP BY language
   ORDER BY language;
   ```

3. **Check the generated sitemap:**
   - Visit: `https://www.micronshub.eu/sitemap-complete.xml`
   - Verify all article URLs are present
   - Count `<url>` tags to match expected article count

4. **Monitor logs:**
   - Look for warnings about missing languages
   - Check if all articles are being added
   - Verify language normalization is working

