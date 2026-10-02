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
 * Usage in a spec:
 *   import { test, expect } from './fixtures/access';
 */
import { test as base, expect } from '@playwright/test';
import type { APIResponse, BrowserContext } from '@playwright/test';

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
 * Adds the Access headers to every request of `context` whose origin equals
 * the origin of `baseURL`, without ever letting them reach another origin
 * through a redirect (see the file header).
 */
export async function installAccessRoute(
  context: BrowserContext,
  baseURL: string,
  credentials: AccessCredentials,
): Promise<void> {
  const origin = new URL(baseURL).origin;
  await context.route(
    (url) => url.origin === origin,
    async (route) => {
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
    },
  );
}

export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const credentials = accessCredentialsFromEnv();
    if (credentials && baseURL) {
      await installAccessRoute(context, baseURL, credentials);
    }
    await use(context);
  },
});

export { expect };
