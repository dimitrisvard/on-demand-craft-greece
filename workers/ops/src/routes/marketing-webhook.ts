// /api/marketing?action=webhook: Svix verification on the raw bytes, then the unchanged handler.
//   1. Method other than POST: the handler runs unchanged (it answers 405).
//   2. The Svix signature (svix-id, svix-timestamp, svix-signature, timestamp within 300 s) is verified over the raw
//      request bytes with RESEND_WEBHOOK_SECRET. No secret: 500 and an error log. A bad or missing signature:
//      401 {"error":"Invalid signature"}, the handler's own answer.
//   3. A delivery whose svix-id was already processed with a 2xx answer in this isolate (5 min) is acknowledged with
//      200 {"received":true} without running the handler. Only 2xx answers are recorded, so a retry of a delivery
//      that failed runs again.
//   4. A bounce or complaint already recorded for the same Resend e-mail id is acknowledged the same way.
//   5. The handler runs only after this verification, on the raw bytes through the shared shim; its own signature
//      check is given an adapter header computed with the same secret.

import type { Context } from 'hono';
import { filterValue, restRequest, rowsOf } from '../../../shared/src/auth/postgrest';
import { verifySvix } from '../../../shared/src/auth/svix';
import { parseVercelBody, runNodeHandler, type VercelHandler } from '../../../shared/src/compat/vercel-node';
import { configError, missingNames } from '../../../shared/src/http/env-check';
import { LOG_PREFIX, type OpsHono } from '../env';

const HANDLER_TIMEOUT_MS = 300_000;
const SEEN_TTL_MS = 300_000;
const SEEN_MAX_ENTRIES = 10_000;
const ACKNOWLEDGED_TYPES: Readonly<Record<string, string>> = { 'email.bounced': 'bounced', 'email.complained': 'complained' };

// svix-id -> expiry (ms) of deliveries answered 2xx in this isolate.
const processed = new Map<string, number>();

/** Empties the per-isolate record of processed deliveries. */
export function resetWebhookReplayCache(): void {
  processed.clear();
}

function wasProcessed(id: string, now: number): boolean {
  const expiry = processed.get(id);
  if (expiry === undefined) return false;
  if (expiry > now) return true;
  processed.delete(id);
  return false;
}

function rememberProcessed(id: string, now: number): void {
  if (processed.size >= SEEN_MAX_ENTRIES) {
    for (const [key, expiry] of processed) if (expiry <= now) processed.delete(key);
    // Still full: drop the oldest entries (Map keeps insertion order).
    for (const key of processed.keys()) {
      if (processed.size < SEEN_MAX_ENTRIES) break;
      processed.delete(key);
    }
  }
  processed.delete(id);
  processed.set(id, now + SEEN_TTL_MS);
}

async function loadMarketingHandler(): Promise<VercelHandler> {
  // @ts-ignore -- api/*.js is plain JavaScript; its default export is a Vercel (req, res) handler
  const mod = (await import('../../../../api/marketing.js')) as { default: VercelHandler };
  return mod.default;
}

function executionContext(c: Context<OpsHono>): { waitUntil(p: Promise<unknown>): void } | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
  let hex = '';
  for (const byte of signature) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export async function handleResendWebhook(c: Context<OpsHono>): Promise<Response> {
  const call = c.var.call;
  const request = c.req.raw;
  const method = request.method.toUpperCase();
  const rawBody = method === 'GET' || method === 'HEAD' ? null : new Uint8Array(await request.arrayBuffer());
  const ctx = executionContext(c);
  const run = async (handler: VercelHandler, req: Request): Promise<Response> =>
    runNodeHandler(handler, { request: req, functionUrl: call.functionUrl, body: rawBody, ctx, timeoutMs: HANDLER_TIMEOUT_MS, logPrefix: LOG_PREFIX });
  // Fixed answers go through the shim as well, so they carry exactly the headers of the handler's res.json().
  const answer = (status: number, body: unknown): Promise<Response> => run((_req, res) => res.status(status).json(body), request);

  if (method !== 'POST') return run(await loadMarketingHandler(), request);

  const env = c.env;
  const missingSecret = missingNames(env, ['RESEND_WEBHOOK_SECRET']);
  if (missingSecret.length) return configError(LOG_PREFIX, missingSecret);

  const verified = await verifySvix({ secret: env.RESEND_WEBHOOK_SECRET, headers: request.headers, rawBody: rawBody ?? new Uint8Array(0) });
  if (!verified.ok) {
    console.log(`${LOG_PREFIX} webhook rejected ${verified.reason}`);
    return answer(401, { error: 'Invalid signature' });
  }

  const now = Date.now();
  if (wasProcessed(verified.id, now)) return answer(200, { received: true });

  const view = parseVercelBody(request.headers.get('content-type'), rawBody ?? new Uint8Array(0));
  const event = view.ok && view.value && typeof view.value === 'object' ? (view.value as Record<string, unknown>) : null;
  const eventType = event && typeof event.type === 'string' ? ACKNOWLEDGED_TYPES[event.type] : undefined;
  const emailId = event && event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>).email_id : undefined;
  if (eventType && typeof emailId === 'string' && emailId) {
    const missing = missingNames(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    if (missing.length) return configError(LOG_PREFIX, missing);
    const recorded = await restRequest(
      { supabaseUrl: env.SUPABASE_URL, apiKey: env.SUPABASE_SERVICE_ROLE_KEY, bearer: env.SUPABASE_SERVICE_ROLE_KEY },
      `marketing_events?select=id&event_type=eq.${eventType}&resend_email_id=eq.${filterValue(emailId)}&limit=1`,
    );
    if (rowsOf(recorded).length > 0) {
      rememberProcessed(verified.id, now);
      return answer(200, { received: true });
    }
  }

  // The handler signs JSON.stringify(req.body) with the secret string; req.body is this same parse of the bytes.
  const signedText = view.ok ? JSON.stringify(view.value) ?? '' : '';
  const headers = new Headers(request.headers);
  headers.delete('resend-signature');
  headers.set('svix-signature', `sha256=${await hmacSha256Hex(env.RESEND_WEBHOOK_SECRET, signedText)}`);
  const adapted = new Request(request.url, { method: request.method, headers });

  const response = await run(await loadMarketingHandler(), adapted);
  if (response.status >= 200 && response.status < 300) rememberProcessed(verified.id, Date.now());
  return response;
}
