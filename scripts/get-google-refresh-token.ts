/**
 * One-time helper to obtain a Google OAuth2 refresh token with the
 * webmasters scopes. No external dependencies beyond Node's built-ins.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... tsx scripts/get-google-refresh-token.ts
 *
 * 1. Opens a local HTTP server on 127.0.0.1:8787.
 * 2. Prints an auth URL — open it in a browser, sign in with the GSC-owning
 *    Google account, approve.
 * 3. Google redirects back to localhost; we exchange the code and print the
 *    refresh token.
 * 4. Copy the refresh token into the Supabase `gsc_config` row.
 *
 * The redirect URI below must be registered in the OAuth client's
 * "Authorized redirect URIs" list in Google Cloud Console.
 */

import http from 'http';
import { URL } from 'url';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT = 'http://127.0.0.1:8787/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.');
  process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES.join(' '),
  }).toString();

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for redirect to http://127.0.0.1:8787/callback …\n');

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) {
    res.writeHead(404).end();
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1:8787');
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Missing code');
    return;
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const tokens: any = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(tokens.error_description || tokens.error || 'Token exchange failed');
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Success — you can close this window.');
    console.log('\n=== REFRESH TOKEN ===');
    console.log(tokens.refresh_token);
    console.log('\nStore this in gsc_config.refresh_token via Supabase SQL editor.\n');
    server.close();
  } catch (err: any) {
    res.writeHead(500).end(err.message);
    console.error(err);
    server.close();
    process.exit(1);
  }
});

server.listen(8787, '127.0.0.1');
