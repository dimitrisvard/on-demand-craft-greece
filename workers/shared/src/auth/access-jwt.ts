// Cloudflare Access service-token assertion (header Cf-Access-Jwt-Assertion), verified against the team's
// certificates; machine callers are mapped from their Access client id to a machine name.

export interface AccessConfig {
  /** "x.cloudflareaccess.com" -> https://x.cloudflareaccess.com/cdn-cgi/access/certs; a value starting with
   *  "http://" or "https://" is used as the origin (local test stub only). */
  teamDomain: string;
  audiences: string[];
  fetchImpl?: typeof fetch;
  nowSec?: () => number;
}

export type AccessResult =
  | { ok: true; commonName: string | null; email: string | null }
  | { ok: false; reason: string };

export function verifyAccessAssertion(headers: Headers, cfg: AccessConfig): Promise<AccessResult> {
  throw new Error('not implemented: G');
}

/** "<client-id>=<name>,<client-id>=<name>" -> client id -> machine name. */
export function parseMachineMap(value: string | undefined): Map<string, 'collector' | 'mcp'> {
  throw new Error('not implemented: G');
}
