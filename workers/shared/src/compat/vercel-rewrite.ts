// vercel.json rewrites that target an API function. Vercel hands the function the destination path with the
// destination query merged into the request query: request keys override destination keys, the request's keys
// come first, then the destination-only keys, and keys and values are re-encoded with encodeURIComponent (the
// algorithm microns-site applies to the sitemap rewrites in its src/sitemap.ts).

export interface ApiRewrite {
  source: string;
  destinationPath: string;
  destinationSearch: string;
}

// vercel.json "rewrites", the entries whose destination is an /api/* function (sitemap rewrites excluded).
export const API_REWRITES: ReadonlyArray<ApiRewrite> = [
  { source: '/api/track', destinationPath: '/api/marketing', destinationSearch: '?action=track' },
  { source: '/api/connector-status', destinationPath: '/api/tenders', destinationSearch: '?connectors=true' },
];

/** Merged query: '' when empty, else '?…'. */
export function mergeRewriteQuery(destinationSearch: string, requestSearch: string): string {
  throw new Error('not implemented: A');
}

/** Rewritten paths: destinationPath + merged query. Any other path: url.pathname + url.search, raw. */
export function functionUrlFor(url: URL): { functionUrl: string; functionPath: string; rewritten: boolean } {
  throw new Error('not implemented: A');
}
