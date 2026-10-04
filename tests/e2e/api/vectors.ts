/**
 * Expected answers and request builders shared by the api.spec.ts modes.
 */
import { createHash, createHmac } from 'node:crypto';

/** Tracking pixel (70 bytes) and unsubscribe page (547 bytes) of the tracking handler, by SHA-256. */
export const PIXEL_SHA256 = '497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581';
export const PIXEL_BYTES = 70;
export const UNSUBSCRIBE_SHA256 = '2c9b981f4b00465600eb652d7cb3bf19d1d31327b57293d626e6344411a5eb43';
export const UNSUBSCRIBE_BYTES = 547;
export const PIXEL_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, proxy-revalidate';

/** The /api CORS headers of vercel.json, set on every /api answer. */
export const PARITY_CORS: Readonly<Record<string, string>> = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
  'access-control-allow-headers':
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
};

/** OPTIONS answer status of every routed /api path, as each handler gives it. */
export const OPTIONS_STATUS: ReadonlyArray<readonly [string, number]> = [
  ['/api/emails', 200],
  ['/api/s3', 204],
  ['/api/marketing', 400],
  ['/api/marketing?action=apollo-enrich', 200],
  ['/api/marketing?action=track', 400],
  ['/api/track', 400],
  ['/api/notifications', 200],
  ['/api/gsc', 200],
  ['/api/tenders', 200],
  ['/api/connector-status', 200],
  ['/api/tender-scan', 200],
  ['/api/funded-startups', 200],
  ['/api/scrape-website', 200],
  ['/api/scrape-company-profile', 200],
  ['/api/scan-directory', 200],
];

/** Requests that each handler answers itself before any side effect (dispatched without a gate). */
export const SENTINEL_CASES: ReadonlyArray<{
  name: string;
  path: string;
  method: string;
  contentType?: string;
  body?: string;
  status: number;
  json: Record<string, unknown>;
}> = [
  { name: 'GET /api/emails (POST only)', path: '/api/emails', method: 'GET', status: 405, json: { error: 'Method not allowed' } },
  { name: 'GET /api/tender-scan (POST only)', path: '/api/tender-scan', method: 'GET', status: 405, json: { error: 'Method not allowed' } },
  { name: 'GET apollo-enrich (POST only)', path: '/api/marketing?action=apollo-enrich', method: 'GET', status: 405, json: { error: 'Method not allowed' } },
  { name: 'unknown marketing action', path: '/api/marketing?action=bogus', method: 'GET', status: 400, json: { error: 'Invalid action. Use: track, webhook, google-auth, or apollo-enrich' } },
  { name: 'unknown google-auth step', path: '/api/marketing?action=google-auth&step=bogus', method: 'GET', status: 400, json: { error: 'Invalid step. Use: authorize, callback, or refresh' } },
  { name: 'unknown files action', path: '/api/s3?action=bogus', method: 'POST', contentType: 'application/json', body: '{}', status: 400, json: { error: 'Unknown action: bogus' } },
  { name: 'files request without action', path: '/api/s3', method: 'POST', contentType: 'application/json', body: '{}', status: 400, json: { error: 'Unknown action: undefined' } },
  { name: 'invalid JSON on /api/s3', path: '/api/s3?action=list', method: 'POST', contentType: 'application/json', body: '{"prefix":', status: 500, json: { error: 'Invalid JSON' } },
];

export function sha256Hex(bytes: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Lower-cased header map of the headers a handler sets (platform headers left out) for byte comparisons. */
export const COMPARED_HEADERS = ['content-type', 'cache-control', 'pragma', 'expires', 'location', ...Object.keys(PARITY_CORS)];

export function pickHeaders(headers: Record<string, string>, names: readonly string[] = COMPARED_HEADERS): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of names) out[name] = headers[name] ?? null;
  return out;
}

/**
 * Svix (Resend webhook) signature headers for `body`, signed with a `whsec_…` secret:
 * HMAC-SHA256 over `${id}.${timestamp}.${body}` keyed with the base64-decoded secret, sent as `v1,<base64>`.
 */
export function svixHeaders(secret: string, body: string, o: { id?: string; timestampSec?: number } = {}): Record<string, string> {
  const id = o.id ?? `msg_e2e_${crypto.randomUUID()}`;
  const timestamp = String(o.timestampSec ?? Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` };
}

/** A token shaped like the project's public anon key: refused by the gate's local pre-check (role is not "authenticated"). */
export function anonKeyShapedToken(): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: 'supabase', role: 'anon', exp: Math.floor(Date.now() / 1000) + 600 })}.c2lnbmF0dXJl`;
}

export function randomUuid(): string {
  return crypto.randomUUID();
}
