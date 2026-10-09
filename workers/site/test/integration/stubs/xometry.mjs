// Xometry partner API stub of the T2 profile 'jobs' (generated ops config: XOMETRY_API_BASE = <stub>/xometry).
//
//   POST /xometry/partners/graphql   answers the scripted responses in order, then the scripted default
//                                    ({data: null, errors: [{message: 'unscripted'}]} with 200 when none)
//   POST /__stub/xometry/script      {responses?: [{status, body?, headers?, text?, delay_ms?}], default?: {...}}
//   GET  /__stub/xometry/calls       recorded calls: operationName, variables, whether authorization and cookie
//                                    headers were present (never their values)
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.


export const prefixes = ['/xometry/', '/__stub/xometry/'];

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

/** Whether credential headers were present (never their values). */
function presence(req, names) {
  const out = {};
  for (const name of names) out[name] = req.headers[name] !== undefined;
  return out;
}

/** Answers a scripted entry: {status, body?, headers?, text?, content_type?, delay_ms?}. */
async function answerScripted(res, entry) {
  if (entry.delay_ms) await new Promise((resolve) => setTimeout(resolve, entry.delay_ms));
  if (entry.text !== undefined) return sendRaw(res, entry.status ?? 200, entry.text, entry.content_type ?? 'text/plain');
  return sendJson(res, entry.status ?? 200, entry.body, entry.headers ?? {});
}

export function createStubModule() {
  let responses = [];
  let fallback = null;
  const calls = [];

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/xometry/script' && req.method === 'POST') {
      const script = jsonOf(body) ?? {};
      responses = Array.isArray(script.responses) ? [...script.responses] : [];
      fallback = script.default ?? null;
      sendJson(res, 204);
      return true;
    }
    if (url.pathname === '/__stub/xometry/calls' && req.method === 'GET') {
      sendJson(res, 200, calls);
      return true;
    }
    if (url.pathname !== '/xometry/partners/graphql') return false;
    const parsed = jsonOf(body) ?? {};
    calls.push({ method: req.method, operationName: parsed.operationName ?? null, variables: parsed.variables ?? null, headers: presence(req, ['authorization', 'cookie', 'x-auth-token']) });
    const entry = responses.shift() ?? fallback ?? { status: 200, body: { data: null, errors: [{ message: 'unscripted' }] } };
    await answerScripted(res, entry);
    return true;
  }

  function reset() {
    responses = [];
    fallback = null;
    calls.length = 0;
  }

  return { prefixes, handle, reset, calls };
}
