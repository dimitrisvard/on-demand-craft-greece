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

Configure these variables in your Vercel Project Settings > Environment Variables.

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_AWS_ACCESS_KEY_ID` | The IAM User Access Key | `AKIA...` |
| `VITE_AWS_SECRET_ACCESS_KEY` | The IAM User Secret Key | `wJalr...` |
| `VITE_AWS_REGION` | The bucket region | `eu-central-1` |
| `VITE_AWS_BUCKET_NAME` | Main bucket for RFQs (if applicable) | `odc-main` |
| `VITE_AWS_ARTICLES_BUCKET_NAME` | Bucket for Blog/Articles | `odc-articles` |

*Note: You can use the same bucket for both if desired, just set both variables to the same name.*

## 4. Application Logic

The application uses these credentials to:
1. Generate Presigned URLs on the client side (using the keys exposed via `import.meta.env`).
   - *Security Note*: exposing keys in VITE variables means they are visible in the browser.
   - **Recommendation**: For better security, move the presigned URL generation to a Supabase Edge Function or Backend API, so keys are not exposed.
   - **Current Implementation**: The current implementation reads `VITE_AWS_ACCESS_KEY_ID` in `src/utils/awsS3Storage.ts`. This exposes your Write credentials to anyone visiting the site.
   - **URGENT**: You should scope the IAM Policy strictly to allow uploads only, or better, refactor to use a backend proxy for signing URLs.

### Security Enhancement (Recommended)
Refactor `src/utils/articleImageStorage.ts` to call a Supabase Edge Function `create-upload-url` instead of signing locally.

## 5. Hreflang Configuration

Hreflang tags are automatically generated by the `SEOMeta` component based on the current path and supported languages defined in `src/contexts/LanguageContext.tsx`.

- Ensure `supportedLanguages` matches your configured locales.
- Ensure your routes follow the `/:lang/page-slug` pattern.
- For Blog Posts, Hreflang tags assume the same slug is used across languages. If you translate slugs, you may need additional logic to link translations.

