// Campaign mail through Resend (a 'resend' sender account, or the default identity of a campaign without sender
// accounts), as the repo function sends it (supabase/functions/send-campaign/index.ts:363-391): POST
// <RESEND_API_BASE or https://api.resend.com>/emails {from, to: [address], subject, html}.
//
// Rules
//   - Key: the account's provider_config.api_key when set, else RESEND_API_KEY (repo :364); the default identity
//     always uses RESEND_API_KEY. A missing key is a configuration error of this message (not retryable).
//   - Every request carries Idempotency-Key: <message idem> (at most 256 characters), so a redelivered message is
//     answered with the first send's id instead of a second mail (Resend keeps keys 24 h).
//   - Answers: 2xx with an id -> ok; 408, 429, 5xx, a network error, a timeout and 409
//     concurrent_idempotent_requests -> retryable; any other 4xx -> final (not retryable).
//   - Results and errors carry the status and Resend's error name only, never the key, an address or the body.

import { RESEND_API } from '../mail-out/resend';
import type { SendOutcome } from './send-gmail';

/** From of the default identity (repo :330, :385). */
export const DEFAULT_FROM = 'Microns Hub <info@micronshub.eu>';
const TIMEOUT_MS = 30_000;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function errorName(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { name?: unknown };
    return typeof parsed.name === 'string' && /^[a-z_]{1,64}$/.test(parsed.name) ? parsed.name : 'error';
  } catch {
    return 'error';
  }
}

export async function sendViaResend(
  o: { apiKey: string | undefined; baseUrl?: string; fetch?: typeof fetch },
  m: { from: string; to: string; subject: string; html: string; idem: string },
): Promise<SendOutcome> {
  if (!o.apiKey) return { ok: false, retryable: false, status: null, error: 'config_missing: RESEND_API_KEY' };
  if (!m.idem || m.idem.length > 256) return { ok: false, retryable: false, status: null, error: 'resend_invalid_idempotency_key' };
  const base = (o.baseUrl || RESEND_API).replace(/\/+$/, '');
  const fetchImpl = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let response: Response;
  try {
    response = await fetchImpl(`${base}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.idem },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return { ok: false, retryable: true, status: null, error: timeout ? 'resend_timeout' : 'resend_network' };
  }
  if (response.ok) {
    let id: unknown;
    try {
      id = ((await response.json()) as { id?: unknown }).id;
    } catch {
      id = undefined;
    }
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, retryable: false, status: response.status, error: 'resend_no_id' };
    return { ok: true, provider_id: id };
  }
  const name = await errorName(response);
  const status = response.status;
  const retryable = status === 408 || status === 429 || status >= 500 || (status === 409 && name === 'concurrent_idempotent_requests');
  return { ok: false, retryable, status, error: `resend_${status}_${name}` };
}
