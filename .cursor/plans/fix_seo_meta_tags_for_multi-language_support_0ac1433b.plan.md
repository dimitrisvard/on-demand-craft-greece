---
name: Fix SEO Meta Tags for Multi-Language Support
overview: Fix SEO meta tags (title, description, keywords) to be properly translated for each language instead of remaining in English. This includes making the brand name suffix translatable, adding SEO keywords translations, and ensuring all meta tags use the current language's translations.
todos:
  - id: create-article-s3-utility
    content: Create src/utils/articleImageStorage.ts with functions to upload, get, and delete article images from AWS S3 bucket named articles
    status: pending
  - id: update-media-library
    content: Update MediaLibraryModal.tsx to use AWS S3 instead of Supabase Storage for article images
    status: pending
  - id: add-quill-image-handler
    content: Add ReactQuill custom image handler in BlogEditor.tsx to upload content images to S3 when inserted in editor
    status: pending
  - id: update-featured-image-upload
    content: Update featured image upload in BlogEditor.tsx to use S3 instead of manual URL input
    status: pending
  - id: enhance-blogpost-seo
    content: "Enhance BlogPost.tsx SEO: add SEOMeta component, Article structured data (JSON-LD), Open Graph tags, Twitter Cards, and proper meta tags"
    status: pending
  - id: update-env-example
    content: Update .env.example to document VITE_AWS_ARTICLES_BUCKET_NAME configuration
    status: pending
---

# Fix SEO Meta Tags for Multi-Language Support

## Problem

SEO meta tags (title, description, keywords) remain in English even when viewing pages in other languages (e.g., German /de). This hurts SEO because search engines see English content for non-English pages.

## Root Causes

1. **BlogPost.tsx**: Hardcoded English suffix "| Microns Hub" in title
2. **BlogIndex.tsx**: Hardcoded English suffix "| Microns Hub" in title  
3. **SEOMeta.tsx**: Hardcoded English keywords: `'CNC machining, 3D printing, manufacturing, Greece, precision parts'`
4. Missing translation keys for SEO-specific strings (brand name, keywords)

## Solution

### 1. Add Translation Keys

Add new translation keys to all language files in `src/locales/`:

- `seo_brand_suffix`: "| Microns Hub" (translated version for each language)
- `seo_keywords`: "CNC machining, 3D printing, manufacturing, Greece, precision parts" (translated)
- `seo_default_title`: Default SEO title (can reuse existing or create new)
- `seo_default_description`: Default SEO description (can reuse existing or create new)

### 2. Update BlogPost.tsx

**File**: `src/pages/BlogPost.tsx`

- Replace hardcoded `"| Microns Hub"` with `t('seo_brand_suffix', '| Microns Hub')`
- Line 142: Change from:
  ```typescript
  title={`${article.meta_title || article.title} | Microns Hub`}
  ```


To:

  ```typescript
  title={`${article.meta_title || article.title} ${t('seo_brand_suffix', '| Microns Hub')}`}
  ```

### 3. Update BlogIndex.tsx  

**File**: `src/pages/BlogIndex.tsx`

- Replace hardcoded `"| Microns Hub"` with `t('seo_brand_suffix', '| Microns Hub')`
- Line 53: Change from:
  ```typescript
  title={`${t('blog_title', 'Latest Updates')} | Microns Hub`}
  ```


To:

  ```typescript
  title={`${t('blog_title', 'Latest Updates')} ${t('seo_brand_suffix', '| Microns Hub')}`}
  ```

### 4. Update SEOMeta.tsx

**File**: `src/components/SEOMeta.tsx`

- Replace hardcoded keywords with translation key
- Line 36: Change from:
  ```typescript
  const pageKeywords = keywords || 'CNC machining, 3D printing, manufacturing, Greece, precision parts';
  ```


To:

  ```typescript
  const pageKeywords = keywords || t('seo_keywords', 'CNC machining, 3D printing, manufacturing, Greece, precision parts');
  ```

### 5. Add Translations to All Language Files

Add the new keys to all 13 language files:

- `src/locales/en/translation.json`
- `src/locales/de/translation.json`
- `src/locales/fr/translation.json`
- `src/locales/es/translation.json`
- `src/locales/it/translation.json`
- `src/locales/nl/translation.json`
- `src/locales/pl/translation.json`
- `src/locales/sv/translation.json`
- `src/locales/da/translation.json`
- `src/locales/fi/translation.json`
- `src/locales/cs/translation.json`
- `src/locales/hu/translation.json`
- `src/locales/pt/translation.json`
- `src/locales/nb/translation.json`

## Files to Modify

1. `src/pages/BlogPost.tsx` - Fix title suffix
2. `src/pages/BlogIndex.tsx` - Fix title suffix
3. `src/components/SEOMeta.tsx` - Fix keywords
4. All 14 translation files in `src/locales/*/translation.json` - Add new keys

## Testing

After implementation, verify:

1. View `/de/blog` - SEO title/description should be in German
2. View `/fr/blog` - SEO title/description should be in French
3. View individual article in different languages - title suffix should match language
4. Check page source - meta tags should reflect current language