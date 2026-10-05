// Local upstream stub of the T2 harness (test/integration/harness.mjs): one HTTP server on 127.0.0.1 that stands in
// for every upstream the two Workers call in T2, so no request leaves the machine (Turnstile's siteverify excepted).
//
//   Supabase (SUPABASE_URL)        canned answers registered by the tests; defaults: GET /auth/v1/user 401,
//                                  PostgREST reads "no rows" (406 PGRST116 for a single-object read, else []),
//                                  PostgREST writes 204
//   Vercel (API_FORWARD_ORIGIN)    echo for /api/*: status 200, the request body byte for byte, header
//                                  x-t2-forwarded: 1, plus x-t2-method / x-t2-url / x-t2-forwarded-host
//   Access (ACCESS_TEAM_DOMAIN)    GET /cdn-cgi/access/certs with the public keys registered by the stub client
//
// Control API (JSON):
//   POST /__stub/routes        {method, path (RegExp source, matched on path + query), status, headers?, body?}
//                              canned answer; the last registration that matches wins; method '*' matches any
//   POST /__stub/reset         forgets routes and recorded calls (registered Access keys are kept)
//   GET  /__stub/calls         recorded calls: method, path + query, selected headers (never bodies; credential
//                              headers only as "<present>")
//   POST /__stub/access-keys   {keys: [public JWK, ...]} added to the certs answer
// Run alone: node test/integration/stub-server.mjs [port]
//
// Profile 'agents' (Phase 4): startStub({modules}) mounts stub modules (./stubs/*.mjs: provider stubs and the
// mini-PostgREST). A module has `prefixes` and `handle(req, res, url, body) -> Promise<boolean>` (true when it
// answered) and `reset()`. Order for a request: recorded call -> a canned /__stub/routes registration (wins) -> the
// first module whose prefix matches and that answers -> the defaults below. Control paths under /__stub/ that are not
// built in go to the modules too, and POST /__stub/reset also resets every module. Profile 'api' mounts no module,
// so its answers stay as above. agentStubModules() builds one fresh instance of every module file present.

import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STUBS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stubs');
/** Stub module files of the profile 'agents' (each optional: a file another unit has not written yet is skipped). */
export const AGENT_STUB_MODULES = ['anthropic', 'resend', 'telegram', 'gmail', 'google-token', 'unfold', 'postgrest'];

const RECORDED_HEADERS = ['content-type', 'accept', 'prefer', 'x-forwarded-host', 'range', 'content-profile', 'accept-profile'];
const PRESENCE_HEADERS = ['authorization', 'apikey', 'cf-access-jwt-assertion', 'cookie'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined || body === null ? '' : Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body);
  const out = { ...headers };
  if (body !== undefined && body !== null && !Buffer.isBuffer(body) && typeof body !== 'string' && !Object.keys(out).some((k) => k.toLowerCase() === 'content-type')) {
    out['content-type'] = 'application/json; charset=utf-8';
  }
  res.writeHead(status, out);
  res.end(status === 204 || status === 304 ? undefined : payload);
}

function recordedHeaders(req) {
  const headers = {};
  for (const name of RECORDED_HEADERS) if (req.headers[name] !== undefined) headers[name] = String(req.headers[name]);
  for (const name of PRESENCE_HEADERS) if (req.headers[name] !== undefined) headers[name] = '<present>';
  return headers;
}

export function createStubState() {
  return { routes: [], calls: [], accessKeys: [], modules: [] };
}

/** One fresh instance of every agent stub module present (factory createStubModule() or createPostgrest()). */
export async function agentStubModules(names = AGENT_STUB_MODULES) {
  const modules = [];
  for (const name of names) {
    const file = path.join(STUBS_DIR, `${name}.mjs`);
    if (!existsSync(file)) continue;
    const mod = await import(pathToFileURL(file).href);
    const factory = mod.createStubModule ?? mod.createPostgrest ?? null;
    const instance = factory ? factory() : mod;
    const prefixes = instance.prefixes ?? mod.prefixes ?? [];
    if (typeof instance.handle !== 'function') throw new Error(`stub module ${name} has no handle()`);
    modules.push({ name, prefixes, handle: instance.handle, reset: instance.reset ?? (() => {}), instance });
  }
  return modules;
}

async function moduleAnswer(state, req, res, url, body) {
  for (const m of state.modules) {
    if (!m.prefixes.some((p) => url.pathname.startsWith(p))) continue;
    if (await m.handle(req, res, url, body)) return true;
  }
  return false;
}

function matchRoute(state, method, pathAndQuery) {
  for (let i = state.routes.length - 1; i >= 0; i--) {
    const route = state.routes[i];
    if (route.method !== '*' && route.method !== method) continue;
    if (route.regex.test(pathAndQuery)) return route;
  }
  return null;
}

async function control(state, req, res, pathname) {
  if (req.method === 'POST' && pathname === '/__stub/routes') {
    const route = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (typeof route.path !== 'string' || typeof route.status !== 'number') return send(res, 400, { error: 'path and status are required' });
    state.routes.push({
      method: typeof route.method === 'string' ? route.method.toUpperCase() : '*',
      regex: new RegExp(route.path),
      status: route.status,
      headers: route.headers ?? {},
      body: route.body,
    });
    return send(res, 204);
  }
  if (req.method === 'POST' && pathname === '/__stub/reset') {
    state.routes.length = 0;
    state.calls.length = 0;
    for (const m of state.modules) m.reset();
    return send(res, 204);
  }
  if (req.method === 'GET' && pathname === '/__stub/calls') return send(res, 200, state.calls);
  if (req.method === 'POST' && pathname === '/__stub/access-keys') {
    const { keys } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    for (const key of Array.isArray(keys) ? keys : []) {
      if (!state.accessKeys.some((k) => k.kid === key.kid)) state.accessKeys.push(key);
    }
    return send(res, 204);
  }
  if (state.modules.length) {
    const url = new URL(req.url ?? '/', 'http://stub.local');
    if (await moduleAnswer(state, req, res, url, await readBody(req))) return undefined;
  }
  return send(res, 404, { error: 'unknown stub control path' });
}

// Answers for requests no test registered.
function defaultAnswer(req, res, url, body) {
  const { pathname } = url;
  if (pathname === '/cdn-cgi/access/certs') return null; // handled by the caller (needs the state)
  if (pathname.startsWith('/api/')) {
    return send(res, 200, body, {
      'content-type': req.headers['content-type'] ?? 'application/octet-stream',
      'x-t2-forwarded': '1',
      'x-t2-method': req.method,
      'x-t2-url': url.pathname + url.search,
      'x-t2-forwarded-host': req.headers['x-forwarded-host'] ?? '',
    });
  }
  if (pathname === '/auth/v1/user') return send(res, 401, { code: 401, msg: 'invalid JWT' });
  if (pathname.startsWith('/rest/v1/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 204);
    if (String(req.headers.accept ?? '').includes('vnd.pgrst.object')) {
      return send(res, 406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
    }
    return send(res, 200, [], { 'content-range': '*/0' });
  }
  return send(res, 404, { error: 'no stub route', path: pathname });
}

export function startStub({ port = 0, host = '127.0.0.1', modules = [] } = {}) {
  const state = createStubState();
  state.modules = modules;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname.startsWith('/__stub/')) return await control(state, req, res, url.pathname);
      const body = await readBody(req);
      state.calls.push({ method: req.method, path: url.pathname + url.search, headers: recordedHeaders(req) });
      const route = matchRoute(state, req.method, url.pathname + url.search);
      if (route) return send(res, route.status, route.body, route.headers);
      if (state.modules.length && (await moduleAnswer(state, req, res, url, body))) return undefined;
      if (url.pathname === '/cdn-cgi/access/certs') return send(res, 200, { keys: state.accessKeys, public_certs: [] });
      return defaultAnswer(req, res, url, body);
    } catch (err) {
      send(res, 500, { error: 'stub failure', message: String(err?.message ?? err) });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        url: `http://${host}:${address.port}`,
        state,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stub = await startStub({ port: Number(process.argv[2] ?? 0) });
  console.log(stub.url);
}
