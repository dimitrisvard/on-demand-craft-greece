// Google OAuth2 handler for Gmail API integration
// GET /api/google-auth?action=authorize&account_id={id}  — Start OAuth flow
// GET /api/google-auth?action=callback&code=...&state=...  — Handle callback

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ||
  `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/google-auth?action=callback`;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

export default async function handler(req, res) {
  const { action, code, state, account_id, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(302, `/dashboard/email-marketing?tab=settings&google_error=${encodeURIComponent(oauthError)}`);
  }

  switch (action) {
    case 'authorize': {
      if (!GOOGLE_CLIENT_ID) {
        return res.status(500).json({ error: 'Google Client ID not configured. Set GOOGLE_CLIENT_ID environment variable.' });
      }

      const stateData = JSON.stringify({ account_id: account_id || 'new' });
      const encodedState = Buffer.from(stateData).toString('base64');

      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: GMAIL_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state: encodedState,
      });

      return res.redirect(302, `${GOOGLE_AUTH_URL}?${params.toString()}`);
    }

    case 'callback': {
      if (!code) {
        return res.redirect(302, '/dashboard/email-marketing?tab=settings&google_error=no_code');
      }

      try {
        // Exchange code for tokens
        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code',
          }).toString(),
        });

        const tokens = await tokenResponse.json();

        if (!tokenResponse.ok || tokens.error) {
          console.error('Token exchange error:', tokens);
          return res.redirect(302, `/dashboard/email-marketing?tab=settings&google_error=${encodeURIComponent(tokens.error || 'token_error')}`);
        }

        // Get user email from token info
        const userInfoResponse = await fetch(
          `https://www.googleapis.com/oauth2/v2/userinfo`,
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        const userInfo = await userInfoResponse.json();

        // Parse state
        let stateData = { account_id: 'new' };
        if (state) {
          try {
            stateData = JSON.parse(Buffer.from(state, 'base64').toString());
          } catch (e) {
            // Ignore parse error
          }
        }

        const providerConfig = {
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          token_expiry: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
          google_email: userInfo.email,
        };

        if (stateData.account_id && stateData.account_id !== 'new') {
          // Update existing account
          await supabase
            .from('marketing_sender_accounts')
            .update({
              provider_config: providerConfig,
              updated_at: new Date().toISOString(),
            })
            .eq('id', stateData.account_id);
        } else {
          // Create new account
          await supabase.from('marketing_sender_accounts').upsert(
            {
              email: userInfo.email,
              display_name: userInfo.name || userInfo.email,
              provider: 'google_workspace',
              provider_config: providerConfig,
              is_active: true,
            },
            { onConflict: 'email' }
          );
        }

        return res.redirect(302, '/dashboard/email-marketing?tab=settings&google_connected=1');
      } catch (error) {
        console.error('Google OAuth callback error:', error);
        return res.redirect(302, `/dashboard/email-marketing?tab=settings&google_error=${encodeURIComponent(error.message)}`);
      }
    }

    case 'refresh': {
      // Refresh an access token for a specific account
      const { data: account } = await supabase
        .from('marketing_sender_accounts')
        .select('provider_config')
        .eq('id', account_id)
        .single();

      if (!account?.provider_config?.refresh_token) {
        return res.status(400).json({ error: 'No refresh token available' });
      }

      try {
        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            refresh_token: account.provider_config.refresh_token,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
          }).toString(),
        });

        const tokens = await tokenResponse.json();

        if (!tokenResponse.ok) {
          return res.status(400).json({ error: tokens.error });
        }

        await supabase
          .from('marketing_sender_accounts')
          .update({
            provider_config: {
              ...account.provider_config,
              access_token: tokens.access_token,
              token_expiry: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
            },
          })
          .eq('id', account_id);

        return res.status(200).json({ access_token: tokens.access_token });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    default:
      return res.status(400).json({ error: 'Invalid action. Use: authorize, callback, or refresh' });
  }
}
