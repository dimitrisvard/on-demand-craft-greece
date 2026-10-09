// CAD container stub of the T2 profile 'jobs' (generated ops config: CAD_CONTAINER_BASE_URL = <stub>/cad-container):
// the container port re-addresses every request to <base><path> with the header x-microns-cad-slot.
//
//   GET  /cad-container/health   200 {"status":"healthy"} unless scripted
//   *    /cad-container/<path>   the first scripted route whose method and path match (in order; a route with
//                                `once: true` is used once), else 503 {"detail":"unscripted"}; scripted answers
//                                {status, body? (JSON), text?, content_type?, delay_ms?}
//   POST /cad-container/__stub/destroy?slot=<slot>   records a destroy (the T2 form of ContainerPort.destroy:
//                                                    <CAD_CONTAINER_BASE_URL>/__stub/destroy)
//   POST /__stub/cad-container/script   {routes: [{method?, path (exact, without /cad-container), once?, ...answer}]}
//   GET  /__stub/cad-container/calls    recorded calls: method, path, slot, whether X-API-Key was present (never its
//                                       value), content type and the JSON body (the edge functions' fields)
//   GET  /__stub/cad-container/destroyed  slots destroyed, in order
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.


export const prefixes = ['/cad-container/', '/__stub/cad-container/'];

/** JSON answer. */
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined || status === 204 ? undefined : JSON.stringify(body));
}

/** Raw answer with an explicit content type. */
function sendRaw(res, status, body, contentType = 'text/plain') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body ?? '');
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

/** Answers a scripted entry: {status, body?, headers?, text?, content_type?, delay_ms?}. */
async function answerScripted(res, entry) {
  if (entry.delay_ms) await new Promise((resolve) => setTimeout(resolve, entry.delay_ms));
  if (entry.text !== undefined) return sendRaw(res, entry.status ?? 200, entry.text, entry.content_type ?? 'text/plain');
  return sendJson(res, entry.status ?? 200, entry.body, entry.headers ?? {});
}

export function createStubModule() {
  let routes = [];
  const calls = [];
  const destroyed = [];

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/cad-container/script' && req.method === 'POST') {
      routes = [...((jsonOf(body) ?? {}).routes ?? [])];
      sendJson(res, 204);
      return true;
    }
    if (url.pathname === '/__stub/cad-container/calls' && req.method === 'GET') {
      sendJson(res, 200, calls);
      return true;
    }
    if (url.pathname === '/__stub/cad-container/destroyed' && req.method === 'GET') {
      sendJson(res, 200, destroyed);
      return true;
    }
    if (url.pathname === '/cad-container/__stub/destroy' && req.method === 'POST') {
      destroyed.push(url.searchParams.get('slot'));
      sendJson(res, 204);
      return true;
    }
    if (!url.pathname.startsWith('/cad-container/')) return false;
    const path = url.pathname.slice('/cad-container'.length);
    calls.push({
      method: req.method,
      path,
      slot: req.headers['x-microns-cad-slot'] ?? null,
      api_key: req.headers['x-api-key'] !== undefined,
      content_type: req.headers['content-type'] ?? null,
      body: (req.headers['content-type'] ?? '').includes('json') ? jsonOf(body) ?? null : null,
    });
    const at = routes.findIndex((r) => (!r.method || r.method.toUpperCase() === req.method) && r.path === path);
    if (at >= 0) {
      const route = routes[at];
      if (route.once) routes.splice(at, 1);
      await answerScripted(res, route);
      return true;
    }
    if (path === '/health' && req.method === 'GET') sendJson(res, 200, { status: 'healthy' });
    else sendJson(res, 503, { detail: 'unscripted' });
    return true;
  }

  function reset() {
    routes = [];
    calls.length = 0;
    destroyed.length = 0;
  }

  return { prefixes, handle, reset, calls, destroyed };
}
