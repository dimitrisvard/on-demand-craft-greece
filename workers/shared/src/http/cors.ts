// CORS for /api/* answers.
//   - parity: the four vercel.json "headers" values for /api/(.*), set on every /api/* answer. microns-site applies
//     them through its own finalise() (its src/preview.ts); this copy must stay byte-equal to it.
//   - allow-list: reflect an allowed Origin only (exact host comparison, never substring matching), Vary: Origin,
//     never Access-Control-Allow-Credentials. Built and tested here; not wired into any Worker yet.

export const VERCEL_API_CORS_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Access-Control-Allow-Credentials', 'true'],
  ['Access-Control-Allow-Origin', '*'],
  ['Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT'],
  ['Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'],
];

export interface AllowlistConfig {
  /** SITE_ORIGIN, e.g. https://www.micronshub.eu. */
  siteOrigin: string;
  /** Host of the request being answered. */
  requestHost: string;
  /** True when the request host is a preview host; preview and local-dev origins are allowed only then. */
  requestIsPreview: boolean;
  /** The account's workers.dev subdomain, for preview origins. */
  workersSubdomain?: string;
}

export function isAllowedOrigin(origin: string, cfg: AllowlistConfig): boolean {
  throw new Error('not implemented: A');
}

export function applyAllowlistCors(headers: Headers, origin: string | null, cfg: AllowlistConfig): void {
  throw new Error('not implemented: A');
}
