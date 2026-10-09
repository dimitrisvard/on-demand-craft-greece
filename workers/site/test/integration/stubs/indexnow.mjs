// IndexNow stub of the T2 profile 'jobs' (generated ops config: INDEXNOW_API_BASE = <stub>/indexnow).
//
//   POST /indexnow/indexnow     records the JSON body ({host, key, keyLocation, urlList}) and answers the scripted
//                               status (default 202, as Bing for an accepted submission)
//   POST /__stub/indexnow/script  {status}
//   GET  /__stub/indexnow/calls   recorded bodies
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.


export const prefixes = ['/indexnow/', '/__stub/indexnow/'];

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
  let status = 202;
  const calls = [];

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/indexnow/script' && req.method === 'POST') {
      status = (jsonOf(body) ?? {}).status ?? 202;
      sendJson(res, 204);
      return true;
    }
    if (url.pathname === '/__stub/indexnow/calls' && req.method === 'GET') {
      sendJson(res, 200, calls);
      return true;
    }
    if (url.pathname !== '/indexnow/indexnow' || req.method !== 'POST') return false;
    calls.push({ content_type: req.headers['content-type'] ?? null, body: jsonOf(body) ?? null });
    res.writeHead(status);
    res.end();
    return true;
  }

  function reset() {
    status = 202;
    calls.length = 0;
  }

  return { prefixes, handle, reset, calls };
}
