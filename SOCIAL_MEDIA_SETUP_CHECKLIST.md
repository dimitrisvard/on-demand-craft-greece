# Social Media Posting Feature - Manual Setup Checklist

## ✅ Implementation Complete

All code has been implemented, deployed, and pushed to Git:
- ✅ Database migration created and applied
- ✅ Edge function created and deployed to Supabase
- ✅ Frontend button added to blog editor
- ✅ Social media status icons added to articles list
- ✅ All changes committed and pushed to Git

## 📋 Manual Setup Required

To enable the social media posting feature, you need to complete the following steps:

### Step 1: Get Facebook Page Access Token

**1.1 Create/Configure Facebook App**
1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Click "My Apps" > "Create App"
3. Choose "Business" as app type
4. Fill in app details and create app

**1.2 Add Facebook Login Product**
1. In your app dashboard, click "Add Product"
2. Find "Facebook Login" and click "Set Up"
3. Configure OAuth Redirect URIs (can use: `https://yourdomain.com/auth/facebook/callback`)

**1.3 Get Page Access Token**
1. Go to [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
2. Select your app from the dropdown
3. Click "Generate Access Token"
4. Select permissions: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`
5. Generate token and copy it

**1.4 Exchange for Long-Lived Token**
1. Use this API call (replace `SHORT_LIVED_TOKEN`, `YOUR_APP_ID`, and `YOUR_APP_SECRET`):
```
GET https://graph.facebook.com/v18.0/oauth/access_token?
  grant_type=fb_exchange_token&
  client_id=YOUR_APP_ID&
  client_secret=YOUR_APP_SECRET&
  fb_exchange_token=SHORT_LIVED_TOKEN
```
2. Copy the `access_token` from response (this is your long-lived token)

**1.5 Get Your Page ID**
1. Go to your Facebook Page
2. Click "About" in the left sidebar
3. Scroll to find "Page ID" (or use Page Settings > Page Info)
4. Copy the Page ID (numeric value)

**1.6 Get Page-Specific Access Token**
1. Use Graph API Explorer with your long-lived token
2. Call: `GET /me/accounts`
3. Find your page in the response
4. Copy the `access_token` for that page (this is the Page Access Token)

### Step 2: Get LinkedIn Access Token

**2.1 Create LinkedIn App**
1. Go to [LinkedIn Developers](https://www.linkedin.com/developers/)
2. Click "Create app"
3. Fill in app details:
   - App name: Your app name
   - Company: Your company
   - Privacy policy URL: Your privacy policy URL
   - App logo: Upload logo
4. Agree to terms and create

**2.2 Request Required Products**
1. In your app, go to "Products" tab
2. Request access to:
   - **Marketing Developer Platform** (required for posting)
   - **Sign In with LinkedIn** (for OAuth)
3. Wait for approval (may take 1-2 business days)

**2.3 Get OAuth Credentials**
1. Go to "Auth" tab in your app
2. Copy:
   - **Client ID**
   - **Client Secret**
3. Add redirect URL: `https://yourdomain.com/auth/linkedin/callback`

**2.4 Get Organization ID**
1. Go to your LinkedIn Company Page
2. Click "Admin tools" > "Analytics" > "Page admin"
3. The Organization ID is in the URL: `https://www.linkedin.com/company/[ORG_ID]/`
4. Or use LinkedIn API: `GET /organizationAcls` to find your organization URN
5. **Note:** You need the numeric ID only (not the full URN)

**2.5 Generate Access Token**
1. Use OAuth 2.0 flow to get authorization code:
   - Visit: `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI&scope=w_member_social%20w_organization_social`
2. Authorize and get `code` from redirect URL
3. Exchange code for token:
```
POST https://www.linkedin.com/oauth/v2/accessToken
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=AUTHORIZATION_CODE&
redirect_uri=YOUR_REDIRECT_URI&
client_id=YOUR_CLIENT_ID&
client_secret=YOUR_CLIENT_SECRET
```
4. Copy `access_token` from response

**Note:** LinkedIn tokens expire. You may need to refresh them periodically or implement token refresh logic.

### Step 3: Configure Supabase Edge Function Secrets

1. Go to Supabase Dashboard > Project Settings > Edge Functions > Secrets
2. Add the following secrets:

**FACEBOOK_PAGE_ID**
- Name: `FACEBOOK_PAGE_ID`
- Value: Your Facebook Page ID (from Step 1.5)
- Click Save

**FACEBOOK_ACCESS_TOKEN**
- Name: `FACEBOOK_ACCESS_TOKEN`
- Value: Your Facebook Page Access Token (from Step 1.6)
- Click Save

**LINKEDIN_ORG_ID**
- Name: `LINKEDIN_ORG_ID`
- Value: Your LinkedIn Organization ID (numeric, from Step 2.4)
- Click Save

**LINKEDIN_ACCESS_TOKEN**
- Name: `LINKEDIN_ACCESS_TOKEN`
- Value: Your LinkedIn OAuth Access Token (from Step 2.5)
- Click Save

**Verification:**
- All 4 secrets should appear in the secrets list
- Values should be masked (showing only last 4 characters)

### Step 4: Test the Feature

1. **Test Database Migration:**
   - Go to Supabase Dashboard > Table Editor > `articles`
   - Verify new columns exist: `posted_to_facebook`, `posted_to_linkedin`, etc.

2. **Test Edge Function:**
   - Go to Supabase Dashboard > Edge Functions > `post-to-social-media`
   - Check function logs for any errors
   - Function should be ACTIVE

3. **Test Frontend:**
   - Navigate to `/dashboard/blog`
   - Create or edit a published article
   - Click "Post to Social Media" button in the editor
   - Verify:
     - Button appears for published articles
     - Loading state works
     - Success/error toasts appear
     - Social icons appear in articles list after posting

4. **Verify Posts:**
   - Check your Facebook Page - post should appear
   - Check your LinkedIn Company Page - post should appear
   - Verify post content includes excerpt, link, and hashtags

### Step 5: Troubleshooting

**If Facebook posting fails:**
- Verify Page Access Token is valid and has `pages_manage_posts` permission
- Check token hasn't expired (long-lived tokens last ~60 days)
- Verify Page ID is correct
- Check Edge Function logs for specific error messages

**If LinkedIn posting fails:**
- Verify access token is valid and has `w_organization_social` scope
- Check if Marketing Developer Platform product is approved
- Verify Organization ID is correct (numeric value, not URN)
- Check Edge Function logs for specific error messages

**If hashtags are not generating:**
- Verify `GEMINI_API_KEY` is set in Supabase secrets
- Check Gemini API quota/limits
- Review Edge Function logs for Gemini API errors

**If social icons don't appear:**
- Verify database migration ran successfully
- Check that `fetchArticles` query includes new columns
- Refresh the articles list page
- Check browser console for errors

## Important Notes

1. **Token Expiration:**
   - Facebook Page Access Tokens: Long-lived tokens last ~60 days. You may need to refresh them periodically.
   - LinkedIn Access Tokens: Typically expire after 60 days. Implement token refresh or manual renewal.

2. **Rate Limits:**
   - Facebook: Check [Facebook Rate Limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)
   - LinkedIn: Check [LinkedIn API Rate Limits](https://docs.microsoft.com/en-us/linkedin/shared/authentication/rate-limits)

3. **Security:**
   - Never commit API tokens to Git
   - Always use Supabase Edge Function secrets for sensitive data
   - Regularly rotate access tokens

4. **Monitoring:**
   - Monitor Edge Function logs for posting errors
   - Set up alerts for failed posts
   - Track posting success rates

## What's Already Done

✅ Database migration created and applied
✅ Edge function created and deployed
✅ Frontend button implemented
✅ Social status indicators added
✅ All code committed and pushed to Git

## What You Need to Do

1. Set up Facebook App and get Page Access Token
2. Set up LinkedIn App and get Organization Access Token
3. Add secrets to Supabase Edge Functions
4. Test the feature with a published article

Once you complete these steps, the feature will be fully functional!
