---
name: Articles S3 Migration and SEO
overview: Migrate article images (featured and content) from Supabase Storage to AWS S3 bucket 'articles', and enhance SEO with proper meta tags, structured data, and semantic HTML.
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

# Articles S3 Migration and SEO Enhancement Plan

## Current State Analysis

### Image Storage

- **Featured Images**: Currently stored in Supabase Storage bucket `blog-images` via `mediaStorage.ts`
- **Content Images**: Embedded in ReactQuill HTML content (stored as HTML strings in `content` field)
- **Media Library**: `MediaLibraryModal.tsx` uses Supabase Storage bucket `blog-images`

### SEO Status

- ✅ Title is already `<h1>` tag in `BlogPost.tsx` (line 113)
- ❌ Missing comprehensive SEO meta tags (Open Graph, Twitter Cards)
- ❌ Missing structured data (Article schema JSON-LD)
- ❌ `SEOMeta` component exists but not used in `BlogPost.tsx`
- ❌ Featured image not used in Open Graph tags

### AWS S3 Setup

- AWS S3 client already configured in `awsS3Storage.ts`
- Currently used for RFQ files in bucket specified by `VITE_AWS_BUCKET_NAME`
- Need to create/use separate bucket named `articles`

## Implementation Tasks

### 1. Create AWS S3 Article Storage Utility

**File**: `src/utils/articleImageStorage.ts`

- Create new utility functions for article images
- Functions: `uploadArticleImageToS3()`, `getArticleImageUrl()`, `deleteArticleImageFromS3()`
- Use bucket name `articles` (or configurable via env var `VITE_AWS_ARTICLES_BUCKET_NAME`)
- Organize images: `featured/{articleId}/{filename}` and `content/{articleId}/{filename}`

### 2. Update Media Library Modal

**File**: `src/components/dashboard/MediaLibraryModal.tsx`

- Replace Supabase Storage calls with AWS S3 calls
- Update `fetchImages()` to list from S3 bucket `articles`
- Update `handleUpload()` to upload to S3 bucket `articles`
- Maintain backward compatibility during migration

### 3. Update Blog Editor

**File**: `src/pages/dashboard/BlogEditor.tsx`

- Add ReactQuill image handler to intercept image uploads
- Configure custom image handler that uploads to S3 `articles` bucket
- Update featured image upload to use S3
- Store S3 paths/URLs instead of Supabase URLs

### 4. Migrate Existing Images (Optional Script)

**File**: `src/utils/migrateArticleImages.ts` (utility script)

- Function to migrate existing Supabase images to S3
- Update database records with new S3 URLs
- Handle both featured images and content images (parse HTML)

### 5. Enhance BlogPost SEO

**File**: `src/pages/BlogPost.tsx`

- Replace basic Helmet tags with comprehensive `SEOMeta` component usage
- Add Article structured data (JSON-LD schema.org)
- Include Open Graph tags with featured image
- Add Twitter Card meta tags
- Ensure proper canonical URL
- Add article:published_time and article:modified_time

### 6. Update Environment Variables

**File**: `.env.example`

- Add `VITE_AWS_ARTICLES_BUCKET_NAME=articles` (or reuse existing bucket with folder structure)
- Document AWS credentials requirement

### 7. Update Database Schema (if needed)

**Migration**: Check if `featured_image` field can store S3 paths

- Current: `featured_image TEXT` - can store S3 URLs
- Content images: Already in HTML, will contain S3 URLs after migration

## Files to Modify

1. `src/utils/articleImageStorage.ts` - **NEW** - S3 upload utilities for articles
2. `src/components/dashboard/MediaLibraryModal.tsx` - Update to use S3
3. `src/pages/dashboard/BlogEditor.tsx` - Add ReactQuill image handler, update featured image upload
4. `src/pages/BlogPost.tsx` - Enhance SEO with SEOMeta and structured data
5. `.env.example` - Add articles bucket configuration

## SEO Enhancements Checklist

- ✅ Title as `<h1>` (already implemented)
- Add comprehensive meta description
- Add Open Graph tags (og:title, og:description, og:image, og:type, og:url)
- Add Twitter Card tags
- Add Article structured data (JSON-LD)
- Add canonical URL
- Add article publication/modification dates
- Ensure proper heading hierarchy (h1, h2, h3 in content)
- Add alt text validation for images

## Migration Strategy

1. **Phase 1**: Implement S3 upload functionality alongside existing Supabase
2. **Phase 2**: Update editor to use S3 for new uploads
3. **Phase 3**: (Optional) Migrate existing images from Supabase to S3
4. **Phase 4**: Remove Supabase Storage dependency for articles

## Notes

- ReactQuill image handler needs custom implementation to intercept image insertions
- Content images in HTML need parsing/replacement during migration
- Consider image optimization before S3 upload
- Ensure S3 bucket CORS is configured for browser uploads