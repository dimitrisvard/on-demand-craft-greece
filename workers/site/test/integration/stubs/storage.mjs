// Supabase Storage stub of the T2 profile 'jobs' (SUPABASE_URL = the stub origin): the object upload the sitemap
// job uses, recorded byte for byte.
//
//   POST|PUT /storage/v1/object/<bucket>/<name>   needs authorization and apikey (401 otherwise); stores the bytes
//                                                 and the content-type, cache-control and x-upsert headers; an
//                                                 existing object without x-upsert: true answers 409 (as Storage);
//                                                 answers {Key: '<bucket>/<name>', Id} or the scripted status
//   GET  /__stub/storage/objects                  [{bucket, name, size, sha256, content_type, cache_control, upsert}]
//   GET  /__stub/storage/object/<bucket>/<name>   the stored bytes
//   POST /__stub/storage/script                   {status?} (the answer of the next uploads; null = normal)
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.

import { createHash, randomUUID } from 'node:crypto';

export const prefixes = ['/storage/v1/object/', '/__stub/storage/'];

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
const OBJECT = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/;

export function createStubModule() {
  const objects = new Map();
  let forcedStatus = null;
  const uploads = [];

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/storage/script' && req.method === 'POST') {
      forcedStatus = (jsonOf(body) ?? {}).status ?? null;
      sendJson(res, 204);
      return true;
    }
    if (url.pathname === '/__stub/storage/objects' && req.method === 'GET') {
      sendJson(res, 200, [...objects.values()].map(({ bytes, ...meta }) => ({ ...meta, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })));
      return true;
    }
    if (url.pathname.startsWith('/__stub/storage/object/') && req.method === 'GET') {
      const key = decodeURIComponent(url.pathname.slice('/__stub/storage/object/'.length));
      const o = objects.get(key);
      if (!o) sendJson(res, 404, { error: 'not found' });
      else {
        res.writeHead(200, { 'content-type': o.content_type ?? 'application/octet-stream' });
        res.end(o.bytes);
      }
      return true;
    }
    const match = OBJECT.exec(url.pathname);
    if (!match || (req.method !== 'POST' && req.method !== 'PUT')) return false;
    if (!req.headers.authorization || !req.headers.apikey) {
      sendJson(res, 401, { statusCode: '401', error: 'Unauthorized', message: 'missing credentials' });
      return true;
    }
    const bucket = decodeURIComponent(match[1]);
    const name = decodeURIComponent(match[2]);
    const key = `${bucket}/${name}`;
    const upsert = String(req.headers['x-upsert'] ?? '') === 'true';
    uploads.push({ bucket, name, upsert, method: req.method });
    if (forcedStatus !== null) {
      sendJson(res, forcedStatus, { statusCode: String(forcedStatus), error: 'scripted', message: 'scripted failure' });
      return true;
    }
    if (req.method === 'POST' && objects.has(key) && !upsert) {
      sendJson(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      return true;
    }
    const bytes = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(String(body ?? ''));
    objects.set(key, { bucket, name, bytes, content_type: req.headers['content-type'] ?? null, cache_control: req.headers['cache-control'] ?? null, upsert });
    sendJson(res, 200, { Key: key, Id: randomUUID() });
    return true;
  }

  function reset() {
    objects.clear();
    forcedStatus = null;
    uploads.length = 0;
  }

  return { prefixes, handle, reset, objects, uploads };
}
