# Email Setup for Vercel Deployment

## Overview
This setup uses **Resend** as the email service provider to handle contact form submissions and send automated emails through your `info@micronshub.eu` domain.

## Required Environment Variables

Add these environment variables in your Vercel dashboard:

### 1. Resend API Key
```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
**How to get it:**
1. Go to [Resend.com](https://resend.com)
2. Create an account or sign in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (starts with `re_`)

### 2. Domain Configuration in Resend
Before using `info@micronshub.eu`, you need to:

1. **Add your domain to Resend:**
   - Go to Resend Dashboard → Domains
   - Add `micronshub.eu` as a domain
   - Follow DNS verification steps

2. **DNS Records to Add:**
   Add these DNS records to your domain registrar:
   
   ```
   Type: MX
   Name: @
   Value: feedback-smtp.us-east-1.amazonses.com
   Priority: 10
   
   Type: TXT
   Name: @
   Value: "v=spf1 include:amazonses.com ~all"
   
   Type: CNAME
   Name: resend._domainkey
   Value: resend._domainkey.resend.com
   ```

## Vercel Environment Setup

### Method 1: Vercel Dashboard
1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add the environment variable:
   - Key: `RESEND_API_KEY`
   - Value: Your Resend API key
   - Environments: Production, Preview, Development

### Method 2: Vercel CLI
```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Login to Vercel
vercel login

# Set environment variable
vercel env add RESEND_API_KEY
# Enter your API key when prompted
# Select environments: Production, Preview, Development
```

## Testing the Setup

1. **Deploy to Vercel:**
   ```bash
   vercel --prod
   ```

2. **Test the contact form:**
   - Visit your deployed site
   - Go to the Contact page
   - Fill out and submit the form
   - Check if you receive emails at `info@micronshub.eu`

3. **Check Vercel Function Logs:**
   - Go to Vercel Dashboard → Functions
   - Check the `/api/contact` function logs for any errors

## API Endpoint

The contact form will send POST requests to:
```
https://your-domain.vercel.app/api/contact
```

**Request format:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+30-697-00-77-401",
  "subject": "Inquiry",
  "message": "Hello, I have a question..."
}
```

**Response format:**
```json
{
  "success": true,
  "message": "Email sent successfully",
  "id": "email_id_from_resend"
}
```

## Email Templates

The system sends two emails:

1. **To Company (info@micronshub.eu):**
   - Contains all form data
   - Professional formatting
   - Reply-to set to customer's email

2. **Auto-reply to Customer:**
   - Confirmation of receipt
   - 24-hour response promise
   - Company branding

## Troubleshooting

### Common Issues:

1. **"Domain not verified" error:**
   - Ensure DNS records are properly configured
   - Wait up to 48 hours for DNS propagation

2. **"API key invalid" error:**
   - Check if RESEND_API_KEY is correctly set in Vercel
   - Verify the API key is active in Resend dashboard

3. **CORS errors:**
   - The API includes CORS headers
   - If issues persist, check Vercel function logs

4. **Email not delivered:**
   - Check Resend dashboard for delivery status
   - Verify sender domain is verified
   - Check spam folders

### Vercel Function Logs:
```bash
# View function logs
vercel logs
```

## Domain Email Alternatives

If you don't want to configure DNS for `micronshub.eu`, you can:

1. **Use Resend's shared domain:**
   ```javascript
   from: 'MicronsHub <hello@resend.dev>'
   ```

2. **Use a subdomain:**
   ```javascript
   from: 'MicronsHub <noreply@mail.micronshub.eu>'
   ```
   (Requires adding `mail.micronshub.eu` to Resend)

## Security Notes

- API key is stored securely in Vercel environment variables
- CORS headers are configured for your domain
- Input validation prevents malicious data
- Rate limiting can be added if needed

## Current Status

✅ Vercel serverless function created (`/api/contact`)  
✅ Resend integration configured  
✅ Email templates designed  
✅ CORS headers configured  
⚠️ **Required: Add RESEND_API_KEY to Vercel environment**  
⚠️ **Required: Configure domain in Resend dashboard**  
