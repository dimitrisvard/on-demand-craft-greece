// PullPush stub of the T2 profile 'jobs' (generated ops config: PULLPUSH_API_BASE = <stub>/pullpush).
//
//   GET /pullpush/reddit/search/submission?subreddit=<name>&…   {data: [posts]} from the script for that subreddit
//                                                                ({data: []} when none), or its scripted status
//   POST /__stub/pullpush/script   {subreddits: {<name>: {status?, posts?: [...]}}} (replaces the script)
//   GET  /__stub/pullpush/calls    recorded calls: subreddit, the query parameters and the User-Agent
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.


export const prefixes = ['/pullpush/', '/__stub/pullpush/'];

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
    if (url.pathname === '/__stub/pullpush/script' && req.method === 'POST') {
      script = jsonOf(body) ?? {};
      sendJson(res, 204);
      return true;
    }
    if (url.pathname === '/__stub/pullpush/calls' && req.method === 'GET') {
      sendJson(res, 200, calls);
      return true;
    }
    if (url.pathname !== '/pullpush/reddit/search/submission' || req.method !== 'GET') return false;
    const subreddit = url.searchParams.get('subreddit') ?? '';
    calls.push({ subreddit, query: Object.fromEntries(url.searchParams), user_agent: req.headers['user-agent'] ?? null });
    const entry = script.subreddits?.[subreddit] ?? {};
    if (entry.status && entry.status !== 200) sendJson(res, entry.status, { error: 'scripted' });
    else sendJson(res, 200, { data: entry.posts ?? [] });
    return true;
  }

  function reset() {
    script = {};
    calls.length = 0;
  }

  return { prefixes, handle, reset, calls };
}
