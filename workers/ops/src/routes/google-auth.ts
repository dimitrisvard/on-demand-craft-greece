// /api/marketing?action=google-auth: Gmail connect (authorize, callback, refresh, error steps).
//   error      any step with ?error=: code = the value when it matches [a-z_]{1,64}, else 'oauth_error'; an escaped
//              page tells the opener (SITE_ORIGIN only) and closes
//   authorize  an ADMIN asking for JSON gets {"url": <Google consent URL>} with a signed `state`
//              ({v, aid, uid, origin, n, exp} + HMAC-SHA256 with a key derived from GOOGLE_CLIENT_SECRET, valid
//              600 s); the account id must exist unless it is "new"; anyone else gets a sign-in-required page
//   callback   the signed state is verified before anything else (no database access otherwise); the code is
//              exchanged, the Google address read, and only the account named in the state is updated (or the
//              account for that address created for "new"); the result is posted to the state's origin only
//   refresh    ADMIN only; the token is refreshed server-side and never returned
// Every value written into a page is escaped for its context.

import type { Context } from 'hono';
import { filterValue, restRequest, rowsOf, type RestConfig } from '../../../shared/src/auth/postgrest';
import { parseQuery } from '../../../shared/src/compat/vercel-node';
import { configError, missingNames } from '../../../shared/src/http/env-check';
import { jsonResponse } from '../../../shared/src/http/json';
import { LOG_PREFIX, type OpsEnv, type OpsHono } from '../env';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
const SETTINGS_PATH = '/dashboard/email-marketing?tab=settings';
const STATE_TTL_SEC = 600;
const STATE_INFO = 'microns-oauth-state-v1';
const ERROR_CODE_RE = /^[a-z_]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

// ----- state -----

export interface OAuthState {
  v: 1;
  /** marketing_sender_accounts id, or "new". */
  aid: string;
  /** Supabase user id of the admin who started the flow. */
  uid: string;
  /** Origin of the page that opened the popup; the result is posted there only. */
  origin: string;
  /** 128-bit nonce, base64url. */
  n: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function stateKey(clientSecret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(clientSecret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(STATE_INFO) },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

export async function signState(clientSecret: string, state: OAuthState): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(state)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await stateKey(clientSecret), encoder.encode(payload)));
  return `${payload}.${base64UrlEncode(signature)}`;
}

/** The state when its signature verifies and it has not expired; null otherwise. */
export async function verifyState(clientSecret: string, token: unknown, nowSec: number): Promise<OAuthState | null> {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const signature = base64UrlDecode(parts[1]);
  const payloadBytes = base64UrlDecode(parts[0]);
  if (!signature || !payloadBytes) return null;
  const valid = await crypto.subtle.verify('HMAC', await stateKey(clientSecret), signature, encoder.encode(parts[0]));
  if (!valid) return null;
  let state: unknown;
  try {
    state = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const s = state as Partial<OAuthState> | null;
  if (!s || s.v !== 1 || typeof s.aid !== 'string' || typeof s.uid !== 'string' || typeof s.origin !== 'string'
    || typeof s.n !== 'string' || typeof s.exp !== 'number' || s.exp <= nowSec) return null;
  return s as OAuthState;
}

// ----- pages -----

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const LS = String.fromCharCode(0x2028);
const LINE_SEPARATORS = new RegExp(`[${LS}${String.fromCharCode(0x2029)}]`, 'g');

/** JSON that is safe inside an inline <script>. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPARATORS, (ch) => (ch === LS ? '\\u2028' : '\\u2029'));
}

interface PopupPage {
  title: string;
  message: string;
  post: Record<string, string>;
  targetOrigin: string;
  fallback: string;
}

function popupPage(page: PopupPage): Response {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(page.title)}</title></head>
<body>
<p>${escapeHtml(page.message)}</p>
<script>
  if (window.opener) {
    window.opener.postMessage(${jsonForScript(page.post)}, ${jsonForScript(page.targetOrigin)});
    window.close();
  } else {
    window.location.href = ${jsonForScript(page.fallback)};
  }
</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
}

function errorPage(code: string, targetOrigin: string, message = 'Google connection failed. This window will close automatically.'): Response {
  return popupPage({
    title: 'Google Connection Failed',
    message,
    post: { type: 'google-oauth-error', error: code },
    targetOrigin,
    fallback: `${SETTINGS_PATH}&google_error=${encodeURIComponent(code)}`,
  });
}

function errorCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && ERROR_CODE_RE.test(value) ? value : fallback;
}

// ----- helpers -----

function serviceDb(env: OpsEnv): RestConfig {
  return { supabaseUrl: env.SUPABASE_URL, apiKey: env.SUPABASE_SERVICE_ROLE_KEY, bearer: env.SUPABASE_SERVICE_ROLE_KEY };
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeOrigin(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value ? value : fallback;
  } catch {
    return fallback;
  }
}

async function postForm(url: string, form: Record<string, string>): Promise<{ ok: boolean; body: Record<string, unknown> } | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, body: body && typeof body === 'object' ? body : {} };
  } catch {
    return null;
  }
}

// ----- steps -----

async function authorize(c: Context<OpsHono>, query: Record<string, string | string[]>): Promise<Response> {
  const env = c.env;
  const call = c.var.call;
  const wantsJson = (c.req.header('accept') ?? '').toLowerCase().includes('application/json');
  if (call.principal.class !== 'ADMIN' || !wantsJson) {
    return errorPage('sign_in_required', env.SITE_ORIGIN, 'Please sign in to the dashboard as an administrator and try again. This window will close automatically.');
  }
  const missing = missingNames(env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'SITE_ORIGIN']);
  if (missing.length) return configError(LOG_PREFIX, missing);

  const aid = single(query.account_id) || 'new';
  if (aid !== 'new') {
    if (!UUID_RE.test(aid)) return jsonResponse(400, { error: 'unknown_account' }, NO_STORE);
    const dbMissing = missingNames(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    if (dbMissing.length) return configError(LOG_PREFIX, dbMissing);
    const found = await restRequest(serviceDb(env), `marketing_sender_accounts?select=id&id=eq.${aid}&limit=1`);
    if (found.kind === 'unavailable') return jsonResponse(503, { error: 'auth_unavailable' }, NO_STORE);
    if (rowsOf(found).length === 0) return jsonResponse(400, { error: 'unknown_account' }, NO_STORE);
  }

  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const state = await signState(env.GOOGLE_CLIENT_SECRET, {
    v: 1,
    aid,
    uid: call.principal.uid ?? '',
    origin: safeOrigin(call.openerOrigin, env.SITE_ORIGIN),
    n: base64UrlEncode(nonce),
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC,
  });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return jsonResponse(200, { url: `${GOOGLE_AUTH_URL}?${params.toString()}` }, NO_STORE);
}

async function callback(c: Context<OpsHono>, query: Record<string, string | string[]>): Promise<Response> {
  const env = c.env;
  const missing = missingNames(env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'SITE_ORIGIN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (missing.length) return configError(LOG_PREFIX, missing);

  const state = await verifyState(env.GOOGLE_CLIENT_SECRET, single(query.state), Math.floor(Date.now() / 1000));
  if (!state) {
    console.log(`${LOG_PREFIX} google-auth state rejected`);
    return errorPage('invalid_state', env.SITE_ORIGIN, 'This sign-in link is invalid or has expired. Please start again. This window will close automatically.');
  }
  const code = single(query.code);
  if (!code) return errorPage('no_code', state.origin, 'No authorization code received. This window will close automatically.');

  const tokens = await postForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  if (!tokens) return errorPage('callback_failed', state.origin);
  if (!tokens.ok || tokens.body.error) {
    return errorPage(errorCode(tokens.body.error, 'token_error'), state.origin, 'Token exchange failed. This window will close automatically.');
  }

  let userInfo: Record<string, unknown>;
  try {
    const response = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${String(tokens.body.access_token ?? '')}` } });
    userInfo = (await response.json()) as Record<string, unknown>;
  } catch {
    return errorPage('callback_failed', state.origin);
  }
  const email = typeof userInfo?.email === 'string' && userInfo.email ? userInfo.email : null;
  if (!email) return errorPage('callback_failed', state.origin);

  const expiresIn = typeof tokens.body.expires_in === 'number' && tokens.body.expires_in > 0 ? tokens.body.expires_in : 3600;
  const providerConfig = {
    refresh_token: tokens.body.refresh_token,
    access_token: tokens.body.access_token,
    token_expiry: new Date(Date.now() + expiresIn * 1000).toISOString(),
    google_email: email,
  };

  const write = state.aid !== 'new'
    ? await restRequest(serviceDb(env), `marketing_sender_accounts?id=eq.${filterValue(state.aid)}`, {
      method: 'PATCH',
      body: { provider_config: providerConfig, updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    })
    : await restRequest(serviceDb(env), 'marketing_sender_accounts?on_conflict=email', {
      method: 'POST',
      body: {
        email,
        display_name: typeof userInfo.name === 'string' && userInfo.name ? userInfo.name : email,
        provider: 'google_workspace',
        provider_config: providerConfig,
        is_active: true,
      },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  if (write.kind !== 'ok') {
    console.error(`${LOG_PREFIX} google-auth account write failed ${write.kind}`);
    return errorPage('save_failed', state.origin);
  }

  return popupPage({
    title: 'Google Connected',
    message: 'Google account connected successfully. This window will close automatically.',
    post: { type: 'google-oauth-success', email },
    targetOrigin: state.origin,
    fallback: `${SETTINGS_PATH}&google_connected=1`,
  });
}

async function refresh(c: Context<OpsHono>, query: Record<string, string | string[]>): Promise<Response> {
  const env = c.env;
  if (c.var.call.principal.class !== 'ADMIN') return jsonResponse(403, { error: 'forbidden' }, NO_STORE);
  const missing = missingNames(env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (missing.length) return configError(LOG_PREFIX, missing);

  const accountId = single(query.account_id);
  const noToken = () => jsonResponse(400, { error: 'No refresh token available' }, NO_STORE);
  if (!accountId || !UUID_RE.test(accountId)) return noToken();
  const read = await restRequest(serviceDb(env), `marketing_sender_accounts?select=provider_config&id=eq.${accountId}&limit=1`);
  if (read.kind === 'unavailable') return jsonResponse(500, { error: 'refresh_failed' }, NO_STORE);
  const config = (rowsOf(read)[0] as { provider_config?: Record<string, unknown> } | undefined)?.provider_config;
  if (!config || typeof config !== 'object' || !config.refresh_token) return noToken();

  const tokens = await postForm(GOOGLE_TOKEN_URL, {
    refresh_token: String(config.refresh_token),
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  if (!tokens) return jsonResponse(500, { error: 'refresh_failed' }, NO_STORE);
  if (!tokens.ok) return jsonResponse(400, { error: errorCode(tokens.body.error, 'token_error') }, NO_STORE);

  const expiresIn = typeof tokens.body.expires_in === 'number' && tokens.body.expires_in > 0 ? tokens.body.expires_in : 3600;
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  const write = await restRequest(serviceDb(env), `marketing_sender_accounts?id=eq.${accountId}`, {
    method: 'PATCH',
    body: { provider_config: { ...config, access_token: tokens.body.access_token, token_expiry: tokenExpiry } },
    prefer: 'return=minimal',
  });
  if (write.kind !== 'ok') return jsonResponse(500, { error: 'refresh_failed' }, NO_STORE);
  return jsonResponse(200, { success: true, token_expiry: tokenExpiry }, NO_STORE);
}

export async function handleGoogleAuth(c: Context<OpsHono>): Promise<Response> {
  const query = parseQuery(c.var.call.functionUrl);
  // Any step carrying a (non-empty) error parameter, as the handler checks it.
  const oauthError = query.error;
  if (oauthError) {
    const code = errorCode(oauthError, 'oauth_error');
    return errorPage(code, c.env.SITE_ORIGIN, `Google reported an error (${code}). This window will close automatically.`);
  }
  switch (single(query.step)) {
    case 'authorize':
      return authorize(c, query);
    case 'callback':
      return callback(c, query);
    case 'refresh':
      return refresh(c, query);
    default:
      return jsonResponse(400, { error: 'Invalid step. Use: authorize, callback, or refresh' });
  }
}
