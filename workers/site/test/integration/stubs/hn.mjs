// Hacker News (Algolia) stub of the T2 profile 'jobs' (generated ops config: HN_API_BASE = <stub>/hn).
//
//   GET /hn/search_by_date?query=<q>&tags=story&…   {hits: [...]} scripted per query
//   GET /hn/search_by_date?tags=show_hn&…           {hits: [...]} scripted under the key 'show_hn'
//   POST /__stub/hn/script   {queries: {<query or 'show_hn'>: {status?, hits?: [...]}}, default?: {status?, hits?}}
//   GET  /__stub/hn/calls    recorded calls: query, tags, numericFilters, hitsPerPage
// Unscripted queries answer {hits: []}.
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.


export const prefixes = ['/hn/', '/__stub/hn/'];

/** JSON answer. */
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined || status === 204 ? undefined : JSON.stringify(body));
}

/** Parsed JSON of a request body, or undefined. */
function jsonOf(body) {
  try {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

export function createStubModule() {
  let script = {};
  const calls = [];

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/hn/script' && req.method === 'POST') {
      script = jsonOf(body) ?? {};
      sendJson(res, 204);
      return true;
    }
    if (url.pathname === '/__stub/hn/calls' && req.method === 'GET') {
      sendJson(res, 200, calls);
      return true;
    }
    if (url.pathname !== '/hn/search_by_date' || req.method !== 'GET') return false;
    const query = url.searchParams.get('query');
    const tags = url.searchParams.get('tags');
    calls.push({ query, tags, numericFilters: url.searchParams.get('numericFilters'), hitsPerPage: url.searchParams.get('hitsPerPage') });
    const key = query ?? (tags === 'show_hn' ? 'show_hn' : '');
    const entry = script.queries?.[key] ?? script.default ?? {};
    if (entry.status && entry.status !== 200) sendJson(res, entry.status, { message: 'scripted' });
    else sendJson(res, 200, { hits: entry.hits ?? [], nbHits: (entry.hits ?? []).length });
    return true;
  }

  function reset() {
    script = {};
    calls.length = 0;
  }

  return { prefixes, handle, reset, calls };
}
