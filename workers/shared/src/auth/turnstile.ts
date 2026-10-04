// Turnstile siteverify client (used by microns-site for the public forms).
//   Real secret: success, action in expectedActions, hostnameAllowed(hostname) and challenge_ts at most 300 s old.
//   Cloudflare test secret with allowTestSecret: success only (one 'turnstile test-key mode' log line per isolate),
//     because the test answer has a fixed action, hostname and timestamp.
//   Cloudflare test secret without allowTestSecret: no siteverify call; 503 turnstile_unavailable (fail closed).
//   No token: 403 without a siteverify call. siteverify unreachable, timed out or answering non-2xx: 503.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's documented, public Turnstile test secret keys (always pass, always fail, token already spent). */
export const TURNSTILE_TEST_SECRETS: readonly string[] = [
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
];

/** Exact match only. */
export function isTurnstileTestSecret(secret: string): boolean {
  return TURNSTILE_TEST_SECRETS.includes(secret);
}

export interface TurnstileInput {
  token: string | null;
  secret: string;
  remoteIp: string | null;
  expectedActions: readonly string[];
  hostnameAllowed: (hostname: string) => boolean;
  /** True only when the request host is a preview host. */
  allowTestSecret: boolean;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export type TurnstileResult =
  | { ok: true; testMode: boolean }
  | { ok: false; status: 403 | 503; code: 'turnstile_failed' | 'turnstile_unavailable' };

// Turnstile runs only in microns-site (public forms), so its log lines carry that Worker's prefix.
const LOG_PREFIX = '[microns-site]';
const MAX_TOKEN_AGE_MS = 300_000;
const CLOCK_SKEW_MS = 60_000;
const SITEVERIFY_TIMEOUT_MS = 10_000;

let testModeLogged = false;

const FAILED: TurnstileResult = { ok: false, status: 403, code: 'turnstile_failed' };
const UNAVAILABLE: TurnstileResult = { ok: false, status: 503, code: 'turnstile_unavailable' };

interface SiteverifyAnswer {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
  challenge_ts?: unknown;
}

async function siteverify(input: TurnstileInput, idempotencyKey: string): Promise<Response> {
  const form = new URLSearchParams();
  form.set('secret', input.secret);
  form.set('response', input.token ?? '');
  if (input.remoteIp) form.set('remoteip', input.remoteIp);
  form.set('idempotency_key', idempotencyKey);
  const doFetch = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);
  try {
    return await doFetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyTurnstile(input: TurnstileInput): Promise<TurnstileResult> {
  const testSecret = isTurnstileTestSecret(input.secret);
  if (testSecret && !input.allowTestSecret) {
    console.error(`${LOG_PREFIX} turnstile test secret refused on a non-preview host`);
    return UNAVAILABLE;
  }
  if (!input.token) return FAILED;

  // One retry after a network error, with the same idempotency key (siteverify then answers the first result).
  const idempotencyKey = crypto.randomUUID();
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2 && !response; attempt++) {
    try {
      response = await siteverify(input, idempotencyKey);
    } catch {
      response = null;
    }
  }
  if (!response || !response.ok) return UNAVAILABLE;

  let answer: SiteverifyAnswer;
  try {
    answer = (await response.json()) as SiteverifyAnswer;
  } catch {
    return UNAVAILABLE;
  }
  if (!answer || answer.success !== true) return FAILED;

  if (testSecret) {
    if (!testModeLogged) {
      testModeLogged = true;
      console.log(`${LOG_PREFIX} turnstile test-key mode`);
    }
    return { ok: true, testMode: true };
  }

  if (typeof answer.action !== 'string' || !input.expectedActions.includes(answer.action)) return FAILED;
  if (typeof answer.hostname !== 'string' || !input.hostnameAllowed(answer.hostname.toLowerCase())) return FAILED;
  const issued = typeof answer.challenge_ts === 'string' ? Date.parse(answer.challenge_ts) : NaN;
  const now = input.nowMs ? input.nowMs() : Date.now();
  if (!Number.isFinite(issued) || now - issued > MAX_TOKEN_AGE_MS || issued - now > CLOCK_SKEW_MS) return FAILED;
  return { ok: true, testMode: false };
}
