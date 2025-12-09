---
name: Update Article Storage to use Distinct Credentials
overview: To support two different AWS IAM users (one for RFQs and one for Articles), we must update the article storage utility to look for distinct environment variables. This avoids conflict with the existing RFQ configuration.
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

# Plan: Update Article Storage to use Distinct Credentials

## Problem

The current application uses `VITE_AWS_ACCESS_KEY_ID` and `VITE_AWS_SECRET_ACCESS_KEY` for **both** RFQ and Article uploads.

- RFQ uploads use a specific IAM User/Bucket.
- The user has created a **new** IAM User/Bucket specifically for Articles.
- Setting the global variables to the "Article User" credentials will break the RFQ uploads (since the new user likely doesn't have access to the RFQ bucket).

## Solution

We will introduce specific environment variables for the Articles feature.

1.  **Refactor `src/utils/articleImageStorage.ts`**:

Change the `getS3Client` function to look for:

    - `VITE_AWS_ARTICLES_ACCESS_KEY_ID` (instead of generic)
    - `VITE_AWS_ARTICLES_SECRET_ACCESS_KEY` (instead of generic)
    - It will fall back to the generic ones if the specific ones are missing (for backward compatibility or simpler setups).

2.  **Define the Vercel Configuration**:

Provide the user with the exact list of Key-Value pairs to add to Vercel, using these new variable names.

## Implementation Details

### File: `src/utils/articleImageStorage.ts`

Update `getS3Client` logic:

```typescript
const accessKeyId = import.meta.env.VITE_AWS_ARTICLES_ACCESS_KEY_ID || import.meta.env.VITE_AWS_ACCESS_KEY_ID;
const secretAccessKey = import.meta.env.VITE_AWS_ARTICLES_SECRET_ACCESS_KEY || import.meta.env.VITE_AWS_SECRET_ACCESS_KEY;
```

This change is safe and non-breaking.

## Verification

- User will update Vercel with the new keys.
- RFQ feature will continue to use the old keys (generic ones).
- Article feature will use the new keys (specific ones).