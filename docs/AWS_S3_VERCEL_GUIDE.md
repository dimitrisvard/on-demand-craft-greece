# AWS S3 and Vercel Configuration Guide

This guide explains how to configure AWS S3 for the On Demand Craft Greece application, specifically for storing article images and other media.

## 1. AWS S3 Bucket Setup

### Create a Bucket
1. Log in to the AWS Console and navigate to **S3**.
2. Click **Create bucket**.
3. Name your bucket (e.g., `odc-articles` or `odc-media`).
4. Select the Region (e.g., `eu-central-1` (Frankfurt) or `us-east-1`).
5. **Object Ownership**: Select "ACLs enabled" and "Bucket owner preferred" if you need public read access via ACLs, or keep "ACLs disabled" and use a Bucket Policy for public access (Recommended).
6. **Block Public Access**: Uncheck "Block all public access" if you want files to be publicly readable (for images).
   - *Warning*: Be careful. Typically for a blog, images need to be public.
7. Click **Create bucket**.

### CORS Configuration (Critical for Browser Uploads)
To allow the browser to upload directly to S3 (presigned URLs), you must configure CORS.
1. Go to your bucket > **Permissions** tab.
2. Scroll to **Cross-origin resource sharing (CORS)**.
3. Edit and paste the following JSON:

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "PUT",
            "POST",
            "HEAD",
            "DELETE"
        ],
        "AllowedOrigins": [
            "http://localhost:8080",
            "http://localhost:3000",
            "https://your-production-domain.com",
            "https://*.vercel.app"
        ],
        "ExposeHeaders": [
            "ETag"
        ],
        "MaxAgeSeconds": 3000
    }
]
```
*Replace allowed origins with your actual domains.*

### Bucket Policy (Public Read Access)
To make images serveable to the public:
1. Go to **Permissions** > **Bucket policy**.
2. Edit and paste:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
        }
    ]
}
```
*Replace `YOUR_BUCKET_NAME` with your actual bucket name.*

## 2. IAM User Setup

Create a dedicated IAM user for the application with limited permissions.

1. Go to **IAM** > **Users** > **Create user**.
2. Name: `odc-app-user`.
3. Attach policies directly > **Create policy**.
4. JSON Editor:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::YOUR_BUCKET_NAME",
                "arn:aws:s3:::YOUR_BUCKET_NAME/*"
            ]
        }
    ]
}
```

### Option B: Reusing an Existing IAM User (Multi-Bucket Access)

If you already have an IAM user (e.g., for RFQs) and want to grant it access to the new articles bucket as well, update its policy to include both buckets:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::YOUR_EXISTING_RFQ_BUCKET",
                "arn:aws:s3:::YOUR_EXISTING_RFQ_BUCKET/*",
                "arn:aws:s3:::YOUR_NEW_ARTICLES_BUCKET",
                "arn:aws:s3:::YOUR_NEW_ARTICLES_BUCKET/*"
            ]
        }
    ]
}
```

5. Create user and generate **Access Key**.
   - Note down the `Access Key ID` and `Secret Access Key`.

## 3. Vercel Environment Variables

Configure these variables in your Vercel Project Settings > Environment Variables. They are server-side only: `api/s3.js` reads them at run time (api/s3.js:30-66), and none of them may carry a `VITE_` prefix, because Vite ships `VITE_` variables to the browser and drops the old client-side AWS key names from the build (vite.config.ts:59-78).

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | The IAM user access key ID | `<access key id>` |
| `AWS_SECRET_ACCESS_KEY` | The IAM user secret access key | `<secret access key>` |
| `AWS_REGION` | Fallback region; each bucket's own region is looked up at run time | `eu-north-1` |
| `AWS_S3_BUCKET` | Bucket for RFQ files | `<rfq bucket name>` |
| `AWS_ARTICLES_BUCKET` | Bucket for blog/article images | `<articles bucket name>` |
| `AWS_ARTICLES_ACCESS_KEY_ID`, `AWS_ARTICLES_SECRET_ACCESS_KEY` | Optional separate key pair for the articles bucket; falls back to the pair above | `<access key id>` |

*Note: You can use the same bucket for both if desired, just set both bucket variables to the same name.*

## 4. Application Logic

| Step | Where | What |
|------|-------|------|
| 1 | Browser (`src/utils/s3Api.ts`) | Asks `/api/s3?action=…` for a presigned URL (upload, download), a listing or a delete; it holds no AWS key |
| 2 | Server (`api/s3.js` on Vercel) | Signs the URL with the server-side keys above; uploads are valid 300 s, downloads 1 h by default |
| 3 | Browser | Uploads or downloads directly against the presigned URL (hence the bucket CORS rules of section 1) |

The Cloudflare Workers (`workers/site`, migration Phase 2) serve the same `/api/s3` contract with their own variable names (`LEGACY_AWS_*`, `R2_*`; see `workers/site/.dev.vars.example`); no AWS key is ever part of the frontend build.

## 5. Hreflang Configuration

Hreflang tags are automatically generated by the `SEOMeta` component based on the current path and supported languages defined in `src/contexts/LanguageContext.tsx`.

- Ensure `supportedLanguages` matches your configured locales.
- Ensure your routes follow the `/:lang/page-slug` pattern.
- For Blog Posts, Hreflang tags assume the same slug is used across languages. If you translate slugs, you may need additional logic to link translations.

