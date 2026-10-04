/**
 * Run guard of tests/e2e/api.spec.ts: which mode runs, against which host.
 *
 * | Mode      | BASE_URL                                      | What runs                                              |
 * |-----------|-----------------------------------------------|--------------------------------------------------------|
 * | `local`   | the T2 harness (`127.0.0.1` / `localhost`)    | tests tagged `@local`                                  |
 * | `preview` | the Cloudflare preview host (`https://`)      | tests tagged `@preview` (needs E2E_FIXTURES)           |
 * | `compare` | the preview host, plus `VERCEL_BASE_URL`      | tests tagged `@compare` (owner's allow-listed machine) |
 *
 * BASE_URL is never a production host: every host of the `micronshub.eu` zone (`www`, the apex, tenant subdomains and
 * any other label) and every `*.vercel.app` host are refused in every mode, so a run can only reach the Worker under
 * test. A machine API host of the zone that is served by the Worker gets its own explicit exception here once it
 * exists (Phase 3).
 */

export const API_E2E_MODES = ['local', 'preview', 'compare'] as const;
export type ApiE2eMode = (typeof API_E2E_MODES)[number];

export interface RunConfig {
  mode: ApiE2eMode;
  baseURL: string;
  origin: string;
  /** compare mode only: the Vercel deployment the Worker answers are compared with. */
  vercelBaseURL?: string;
  /** E2E_SEND_MAIL=1: the one test that sends a real e-mail is enabled. */
  sendMail: boolean;
  /** E2E_FIXTURES: path of the fixtures JSON (outside git). */
  fixturesPath?: string;
}

export type GuardResult = { ok: true; config: RunConfig } | { ok: false; message: string };

const PRODUCTION_ZONE = 'micronshub.eu';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export const GUARD_USAGE =
  'tests/e2e/api.spec.ts refuses to run. Set API_E2E_MODE to local (T2 harness), preview (Cloudflare preview, ' +
  'E2E_FIXTURES required) or compare (owner machine, VERCEL_BASE_URL required), and BASE_URL to the Worker under ' +
  'test; micronshub.eu, every *.micronshub.eu host and *.vercel.app are never accepted as BASE_URL.';

/** Host name in canonical form: lower case, without a trailing dot. */
export function canonicalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '');
}

/** Every host of the production zone (apex, www, tenant subdomains) and every Vercel deployment host. */
export function isRefusedHost(hostname: string): boolean {
  const host = canonicalHost(hostname);
  return (
    host === PRODUCTION_ZONE ||
    host.endsWith(`.${PRODUCTION_ZONE}`) ||
    host === 'vercel.app' ||
    host.endsWith('.vercel.app')
  );
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(canonicalHost(hostname));
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Decides whether this run may start; never throws. */
export function checkRun(env: Record<string, string | undefined>): GuardResult {
  const refuse = (reason: string): GuardResult => ({ ok: false, message: `${GUARD_USAGE} (${reason})` });
  const mode = env.API_E2E_MODE as ApiE2eMode | undefined;
  if (!mode || !(API_E2E_MODES as readonly string[]).includes(mode)) {
    return refuse(`API_E2E_MODE is ${mode ? `"${mode}"` : 'not set'}`);
  }
  const base = parseUrl(env.BASE_URL);
  if (!base) return refuse('BASE_URL is not set or not an http(s) URL');
  if (base.username || base.password) return refuse('BASE_URL must not carry credentials');
  if (isRefusedHost(base.hostname)) return refuse(`BASE_URL host ${base.hostname} is a production host`);

  if (mode === 'local' && !isLoopbackHost(base.hostname)) {
    return refuse('local mode runs only against the T2 harness on 127.0.0.1 or localhost');
  }
  if (mode !== 'local') {
    if (base.protocol !== 'https:') return refuse(`${mode} mode needs an https BASE_URL`);
    if (isLoopbackHost(base.hostname)) return refuse(`${mode} mode runs against the preview host, not a local server`);
  }

  let vercelBaseURL: string | undefined;
  if (mode === 'compare') {
    const vercel = parseUrl(env.VERCEL_BASE_URL);
    if (!vercel || vercel.protocol !== 'https:') return refuse('compare mode needs VERCEL_BASE_URL (https)');
    if (vercel.origin === base.origin) return refuse('VERCEL_BASE_URL must differ from BASE_URL');
    vercelBaseURL = vercel.origin;
  }

  const fixturesPath = env.E2E_FIXTURES || undefined;
  if (mode !== 'local' && !fixturesPath) return refuse(`${mode} mode needs E2E_FIXTURES (path of the fixtures JSON)`);

  return {
    ok: true,
    config: {
      mode,
      baseURL: base.origin,
      origin: base.origin,
      vercelBaseURL,
      sendMail: env.E2E_SEND_MAIL === '1',
      fixturesPath,
    },
  };
}
