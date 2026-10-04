// vercel.json rewrites that target an API function. Vercel hands the function the destination path with the
// destination query merged into the request query: request keys override destination keys, the request's keys
// come first, then the destination-only keys, and keys and values are re-encoded with encodeURIComponent (the
// algorithm microns-site applies to the sitemap rewrites in its src/sitemap.ts; a cross-check test there keeps
// the two equal).
//
// Query handling of the Vercel dev router, as in that file: '?a=1&a=2&b' parses to { a: ['1', '2'], b: [bare] };
// '+' is not a space; a malformed escape is kept raw (then re-encoded) instead of throwing; a value is split at
// the first '=' only. The source path is matched exactly on the raw pathname.

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

// Key -> values in first-seen key order; undefined marks a bare key ('?debug').
type Query = Record<string, Array<string | undefined>>;

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseQueryString(search: string): Query {
  const query: Query = Object.create(null) as Query;
  if (!search || !search.startsWith('?') || search === '?') return query;
  for (const param of search.slice(1).split('&')) {
    const eq = param.indexOf('=');
    const key = decodeComponent(eq === -1 ? param : param.slice(0, eq));
    const value = eq === -1 ? undefined : decodeComponent(param.slice(eq + 1));
    (query[key] ??= []).push(value);
  }
  return query;
}

function formatQueryString(query: Query): string {
  let out = '';
  let prefix = '?';
  for (const [key, values] of Object.entries(query)) {
    for (const value of values) {
      out += prefix + encodeURIComponent(key) + (value === undefined ? '' : `=${encodeURIComponent(value)}`);
      prefix = '&';
    }
  }
  return out;
}

/** Merged query: '' when empty, else '?…'. Both arguments are URL search strings ('' or '?…'). */
export function mergeRewriteQuery(destinationSearch: string, requestSearch: string): string {
  // 1. Request keys override the rewrite's keys (a repeated request key replaces the rewrite value as a whole).
  const routed = Object.assign(parseQueryString(destinationSearch), parseQueryString(requestSearch));
  // 2. The function URL: the request's keys first (in their order), then the rewrite-only keys.
  const functionQuery = Object.assign(parseQueryString(requestSearch), routed);
  return formatQueryString(functionQuery);
}

/** Rewritten paths: destinationPath + merged query. Any other path: url.pathname + url.search, raw. */
export function functionUrlFor(url: URL): { functionUrl: string; functionPath: string; rewritten: boolean } {
  for (const rewrite of API_REWRITES) {
    if (url.pathname !== rewrite.source) continue;
    return {
      functionUrl: rewrite.destinationPath + mergeRewriteQuery(rewrite.destinationSearch, url.search),
      functionPath: rewrite.destinationPath,
      rewritten: true,
    };
  }
  return { functionUrl: url.pathname + url.search, functionPath: url.pathname, rewritten: false };
}
