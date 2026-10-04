// Turnstile siteverify client.
//   Real secret: success, action in expectedActions, hostnameAllowed(hostname) and challenge_ts at most 300 s old.
//   Cloudflare test secret with allowTestSecret: success only (one 'turnstile test-key mode' log line per isolate).
//   Cloudflare test secret without allowTestSecret: no siteverify call; 503 turnstile_unavailable (fail closed).

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's documented, public Turnstile test secret keys (always pass, always fail, token already spent). */
export const TURNSTILE_TEST_SECRETS: readonly string[] = [
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
];

/** Exact match only. */
export function isTurnstileTestSecret(secret: string): boolean {
  throw new Error('not implemented: G');
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

export function verifyTurnstile(input: TurnstileInput): Promise<TurnstileResult> {
  throw new Error('not implemented: G');
}
