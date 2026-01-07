# Fix Broken Tables Edge Function

This Edge Function fixes broken tables in blog articles by converting plain-text table data into proper HTML `<table>` structures.

## Problem

Some articles were generated with table data as plain text instead of HTML tables. For example:
- `Validation CheckTolerance RangeImpact if Failed...` (broken)
- Should be: `<table><thead><tr><th>Validation Check</th>...</tr></thead>...</table>` (fixed)

## Supported Table Patterns

The function can fix 4 common table patterns:

1. **Validation Check Table** - Validation checks, tolerances, impacts, and correction methods
2. **Material Comparison Table** - Material properties (wall thickness, aspect ratio, radius, tolerance)
3. **Simulation Parameter Table** - Simulation parameters, tolerances, accuracy, and adjustment ranges
4. **Optimization Category Table** - Optimization categories, cost reductions, complexity, and quality impact

## Usage

### Deploy the Function

```bash
supabase functions deploy fix-broken-tables
```

### Fix a Single Article

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/fix-broken-tables \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"article_id": "article-uuid-here"}'
```

### Fix All Articles

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/fix-broken-tables \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fix_all": true}'
```

### Response Format

**Single Article:**
```json
{
  "success": true,
  "message": "Article tables fixed successfully",
  "article_id": "uuid",
  "slug": "article-slug"
}
```

**All Articles:**
```json
{
  "success": true,
  "message": "Fixed 15 out of 20 articles",
  "results": {
    "total": 20,
    "fixed": 15,
    "failed": 5,
    "errors": ["article-slug (en): error message"]
  }
}
```

## How It Works

1. **Detection**: Finds articles with table-like patterns but no `<table>` tags
2. **Parsing**: Uses known table patterns to reconstruct proper HTML structure
3. **Replacement**: Replaces broken table text with proper HTML tables
4. **Update**: Updates the article content in the database

## Notes

- The function only fixes articles that don't already have `<table>` tags
- It uses known table patterns, so it may not catch all variations
- Always test on a single article first before running `fix_all`
- Check the response for any errors or failed articles

## Database Migration

Run the migration to create a view for identifying broken tables:

```bash
supabase migration up 20250107_identify_broken_tables
```

Then query the view:
```sql
SELECT * FROM articles_with_broken_tables;
SELECT * FROM count_broken_tables_by_language();
```

