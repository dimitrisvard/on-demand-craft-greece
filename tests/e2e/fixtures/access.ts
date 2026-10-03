/**
 * Cloudflare Access fixture for the e2e specs (docs/migration/SEO_PARITY.md §6).
 *
 * When CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are set, every browser
 * context gets a route that adds the two Access service-token headers to
 * requests whose origin (scheme://host:port) equals the origin of BASE_URL —
 * and to nothing else. `extraHTTPHeaders` is deliberately not used: it would
 * send the token to every host the shell loads (fonts, tag manager, Supabase;
 * index.html:42-84).
 *
 * Without the two variables the fixture is a no-op, so the specs behave
 * exactly as before against production.
 *
 * Redirects. In Chromium, headers set with `route.continue({ headers })` are
 * carried along the whole redirect chain, and the redirected hops are never
 * routed again — so a plain `route.continue` would hand the token to any other
 * origin a BASE_URL response redirects to (Access's own login redirect, an
 * apex/www hop, an absolute Location). The route therefore fetches each
 * BASE_URL request itself with redirects disabled:
 *   - not a redirect: the fetched response is fulfilled as is;
 *   - a GET/HEAD redirect whose whole chain stays on the BASE_URL origin
 *     (walked with redirects disabled, at most MAX_HOPS hops): the request is
 *     continued with the headers, so the browser follows the chain natively
 *     (correct page.url(), history, cookies) and only the BASE_URL origin
 *     ever sees the headers;
 *   - any other redirect (chain leaves the origin, too long, or not GET/HEAD):
 *     the first 3xx is fulfilled without headers on any later hop. A later
 *     same-origin hop is then authorised only by the CF_Authorization cookie
 *     Access sets.
 * Fulfilled documents are treated by Chromium as public address space, so a
 * BASE_URL on loopback/LAN cannot load subresources from another *private*
 * origin while the credentials are set (Private Network Access); public hosts
 * (the preview, fonts, Supabase) are unaffected.
 * The self-test in ./access.spec.ts checks all of this against local servers.
 *
 * Secrets in artifacts: Playwright traces and HAR files record request
 * headers, including these two. playwright.config.ts therefore turns tracing
 * off while the credentials are set; never record a HAR or upload
 * test-results/ as a CI artifact from a run with the credentials.
 *
 * Errors. Playwright's error text for a failed route call can list the
 * request headers, so the route never lets such an error escape: a failure
 * is logged as one line with the credential values masked, and the request
 * is answered as a network error (a failed document load still fails its
 * test). When the test ends, the fixture removes the route before the
 * context closes, so requests still in flight (late images, chunks) end
 * quietly instead of failing a test that already passed.
 *
 * Usage in a spec:
 *   import { test, expect } from './fixtures/access';
 */
import { test as base, expect } from '@playwright/test';
import type { APIResponse, BrowserContext, Route } from '@playwright/test';

export interface AccessCredentials {
  id: string;
  secret: string;
}

/**
 * Most redirect hops walked before a chain is treated like one that leaves the
 * origin (kept below Chromium's own limit of 20 redirects).
 */
export const MAX_HOPS = 10;

const ACCESS_HEADER_NAMES = new Set(['cf-access-client-id', 'cf-access-client-secret']);

export function accessCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): AccessCredentials | null {
  const id = env.CF_ACCESS_CLIENT_ID ?? '';
  const secret = env.CF_ACCESS_CLIENT_SECRET ?? '';
  return id !== '' && secret !== '' ? { id, secret } : null;
}

export function accessEnabled(): boolean {
  return accessCredentialsFromEnv() !== null;
}

function withAccessHeaders(
  headers: Record<string, string>,
  credentials: AccessCredentials,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!ACCESS_HEADER_NAMES.has(name.toLowerCase())) out[name] = value;
  }
  out['CF-Access-Client-Id'] = credentials.id;
  out['CF-Access-Client-Secret'] = credentials.secret;
  return out;
}

/** Absolute redirect target of a 3xx response with a Location, else null. */
function redirectTarget(response: APIResponse, from: string): string | null {
  const status = response.status();
  if (status < 300 || status > 399) return null;
  const location = response.headers()['location'];
  if (!location) return null;
  try {
    return new URL(location, from).href;
  } catch {
    return null;
  }
}

/**
 * One line describing a failed route call: the first line of the error text
 * (the reason, without Playwright's call log, which can list the request
 * headers), with both credential values masked.
 */
export function describeRouteError(err: unknown, credentials: AccessCredentials): string {
  let line = (err instanceof Error ? err.message : String(err)).split('\n', 1)[0];
  for (const value of [credentials.secret, credentials.id]) {
    if (value !== '') line = line.split(value).join('<redacted>');
  }
  return line;
}

async function routeWithAccess(route: Route, origin: string, credentials: AccessCredentials): Promise<void> {
  const request = route.request();
  const headers = withAccessHeaders(request.headers(), credentials);
  const first = await route.fetch({ headers, maxRedirects: 0 });
  let next = redirectTarget(first, request.url());
  if (next === null) {
    await route.fulfill({ response: first });
    return;
  }
  const method = request.method();
  if (method === 'GET' || method === 'HEAD') {
    let hops = 0;
    while (next !== null && new URL(next).origin === origin && hops < MAX_HOPS) {
      const hop = await route.fetch({ url: next, method, headers, maxRedirects: 0 });
      hops += 1;
      next = redirectTarget(hop, next);
    }
    if (next === null) {
      // Every hop stays on the origin: let the browser follow it natively.
      await route.continue({ headers });
      return;
    }
  }
  // The chain leaves the origin (or is too long, or not GET/HEAD): the
  // browser follows the fulfilled 3xx without the Access headers.
  await route.fulfill({ response: first });
}

/**
 * Adds the Access headers to every request of `context` whose origin equals
 * the origin of `baseURL`, without ever letting them reach another origin
 * through a redirect (see the file header).
 *
 * Returns a function to call once the test is over: it removes every route of
 * the context and ignores route calls still in flight (see "Errors" above).
 */
export async function installAccessRoute(
  context: BrowserContext,
  baseURL: string,
  credentials: AccessCredentials,
): Promise<() => Promise<void>> {
  const origin = new URL(baseURL).origin;
  let removed = false;
  await context.route(
    (url) => url.origin === origin,
    async (route) => {
      try {
        await routeWithAccess(route, origin, credentials);
      } catch (err) {
        if (removed) return; // the test is over and the context is closing
        const request = route.request();
        console.error(
          `[access fixture] ${request.method()} ${request.url()} answered as a network error: ` +
            describeRouteError(err, credentials),
        );
        await route.abort('failed').catch(() => {});
      }
    },
  );
  return async () => {
    removed = true;
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  };
}

export interface AccessFixtures {
  /** Credentials for BASE_URL requests: from the environment unless a spec overrides them. */
  accessCredentials: AccessCredentials | null;
}

export const test = base.extend<AccessFixtures>({
  accessCredentials: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(accessCredentialsFromEnv());
    },
    { option: true },
  ],
  context: async ({ context, baseURL, accessCredentials }, use) => {
    const remove =
      accessCredentials && baseURL ? await installAccessRoute(context, baseURL, accessCredentials) : null;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback, not a React hook
    await use(context);
    if (remove) await remove();
  },
});

export { expect };
