// Site adapter over the shared Turnstile check. Token from the X-Turnstile-Token request header; the challenge
// hostname must be one of the site's own origins (allow-list of workers/shared/src/http/cors.ts); Cloudflare's
// test secrets are accepted only on preview hosts. Needs TURNSTILE_SECRET_KEY.

import { isTurnstileTestSecret, verifyTurnstile } from '../../../shared/src/auth/turnstile';
import { isAllowedOrigin, type AllowlistConfig } from '../../../shared/src/http/cors';
import { missingNames } from '../../../shared/src/http/env-check';
import type { Env } from '../env';
import { isPreviewHost } from '../preview';

export const TURNSTILE_NAMES = ['TURNSTILE_SECRET_KEY'] as const;
export const TURNSTILE_HEADER = 'X-Turnstile-Token';

export type TurnstileCheck =
  | { kind: 'ok'; testMode: boolean }
  /** testSecretRefused: a test secret on a non-preview host; this refusal holds in every gate mode. */
  | { kind: 'deny'; status: 403 | 503; code: 'turnstile_failed' | 'turnstile_unavailable'; testSecretRefused: boolean }
  | { kind: 'config'; missing: string[] };

/** "<x>-microns-site.<sub>.workers.dev" -> "<sub>"; undefined for any other host. */
export function workersSubdomainOf(hostname: string): string | undefined {
  const labels = hostname.toLowerCase().split('.');
  if (labels.length < 4 || labels[labels.length - 2] !== 'workers' || labels[labels.length - 1] !== 'dev') return undefined;
  return labels[labels.length - 3];
}

/** Allow-list configuration for a request on this host. */
export function allowlistFor(url: URL, env: Env): AllowlistConfig {
  return {
    siteOrigin: env.SITE_ORIGIN,
    requestHost: url.hostname.toLowerCase(),
    requestIsPreview: isPreviewHost(url.hostname, env),
    workersSubdomain: workersSubdomainOf(url.hostname),
  };
}

export async function checkTurnstile(request: Request, env: Env, url: URL, expectedActions: readonly string[]): Promise<TurnstileCheck> {
  const missing = missingNames(env, TURNSTILE_NAMES);
  if (missing.length) return { kind: 'config', missing };
  const cfg = allowlistFor(url, env);
  const secret = env.TURNSTILE_SECRET_KEY as string;
  const result = await verifyTurnstile({
    token: request.headers.get(TURNSTILE_HEADER),
    secret,
    remoteIp: request.headers.get('CF-Connecting-IP'),
    expectedActions,
    hostnameAllowed: (hostname) => isAllowedOrigin(`https://${hostname}`, cfg),
    allowTestSecret: cfg.requestIsPreview,
  });
  if (result.ok) return { kind: 'ok', testMode: result.testMode };
  return {
    kind: 'deny',
    status: result.status,
    code: result.code,
    testSecretRefused: isTurnstileTestSecret(secret) && !cfg.requestIsPreview,
  };
}
