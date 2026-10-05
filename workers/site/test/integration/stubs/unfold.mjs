// Unfold service stub of the T2 profile 'agents' (generated ops config: secret CAD_UNFOLD_URL = the stub origin,
// CAD_SHARED_SECRET = the harness's dummy value). microns-ops runs its real HttpUnfoldBackend against it.
//
//   POST /api/v1/unfold        needs X-API-Key equal to the expected value (default: the harness's dummy value),
//                              else 401; reads the multipart form (material, thickness_override, k_factor_override,
//                              output_format, drawing_size and the file part) and answers by output_format:
//                              dxf -> workers/ops/test/fixtures/cad/unfold-flat.dxf with the X-Part-* headers of
//                              unfold-headers.json; pdf -> workers/ops/test/fixtures/pdf/one-page.pdf; svg -> a small
//                              SVG. A form without a file part or an unknown output_format answers 422.
//   GET  /api/v1/health        {status: 'healthy'} (same key check)
//   GET  /__stub/unfold/calls  recorded calls: method, path, api_key ('expected' | 'other' | 'missing'), the form
//                              fields, the file part's name, size and SHA-256 (never the key's value or the content)
//   POST /__stub/unfold/fail   {status, times}: the next `times` unfold requests answer `status` (default 1 time)
// Only these two service paths are answered; any other /api/ path falls through to the stub server's defaults.
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPS_FIXTURES = path.resolve(HERE, '../../../../ops/test/fixtures');
export const EXPECTED_API_KEY = 'dummy-not-a-secret';
export const prefixes = ['/api/v1/', '/__stub/unfold/'];

const FIELD_NAMES = ['material', 'thickness_override', 'k_factor_override', 'output_format', 'drawing_size'];
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="180mm" height="120mm" viewBox="0 0 180 120"><rect x="0" y="0" width="180" height="120" fill="none" stroke="black"/></svg>\n';

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const out = { ...headers };
  if (!Object.keys(out).some((k) => k.toLowerCase() === 'content-type')) out['content-type'] = 'application/json';
  res.writeHead(status, out);
  res.end(payload);
}

/** Parts of a multipart/form-data body: [{name, filename, contentType, data}] (null when it is not multipart). */
export function parseMultipart(contentType, body) {
  const match = /boundary="?([^";]+)"?/i.exec(String(contentType ?? ''));
  if (!/^multipart\/form-data/i.test(String(contentType ?? '')) || !match) return null;
  const delimiter = Buffer.from(`--${match[1]}`);
  const parts = [];
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    // part = CRLF headers CRLF CRLF content CRLF
    const chunk = body.subarray(start + 2, next - 2);
    const split = chunk.indexOf('\r\n\r\n');
    if (split >= 0) {
      const head = chunk.subarray(0, split).toString('utf8');
      const disposition = /content-disposition:([^\r\n]*)/i.exec(head)?.[1] ?? '';
      parts.push({
        name: /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? '',
        filename: /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null,
        contentType: /content-type:\s*([^\r\n]*)/i.exec(head)?.[1]?.trim() ?? null,
        data: chunk.subarray(split + 4),
      });
    }
    at = next;
  }
  return parts;
}

export function createStubModule({ expectedApiKey = EXPECTED_API_KEY, fixturesDir = OPS_FIXTURES } = {}) {
  const calls = [];
  let failures = [];

  function keyState(req) {
    const key = req.headers['x-api-key'];
    if (key === undefined) return 'missing';
    return key === expectedApiKey ? 'expected' : 'other';
  }

  function unfoldAnswer(res, format) {
    if (format === 'dxf') {
      const headers = JSON.parse(readFileSync(path.join(fixturesDir, 'cad', 'unfold-headers.json'), 'utf8'));
      send(res, 200, readFileSync(path.join(fixturesDir, 'cad', 'unfold-flat.dxf')), { 'content-type': 'application/dxf', ...headers });
    } else if (format === 'pdf') {
      send(res, 200, readFileSync(path.join(fixturesDir, 'pdf', 'one-page.pdf')), { 'content-type': 'application/pdf', 'X-Part-Thickness': '2.0', 'X-Part-Num-Bends': '2' });
    } else {
      send(res, 200, SVG, { 'content-type': 'image/svg+xml' });
    }
  }

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/unfold/calls' && req.method === 'GET') {
      send(res, 200, calls);
      return true;
    }
    if (url.pathname === '/__stub/unfold/fail' && req.method === 'POST') {
      const f = JSON.parse(body.toString('utf8') || '{}');
      if (typeof f.status !== 'number') {
        send(res, 400, { error: 'status is required' });
        return true;
      }
      failures = Array.from({ length: Number.isInteger(f.times) && f.times > 0 ? f.times : 1 }, () => f.status);
      send(res, 204);
      return true;
    }
    if (url.pathname === '/api/v1/health' && req.method === 'GET') {
      const apiKey = keyState(req);
      calls.push({ method: 'GET', path: url.pathname, api_key: apiKey });
      if (apiKey !== 'expected') send(res, 401, { detail: 'Invalid API key' });
      else send(res, 200, { status: 'healthy' });
      return true;
    }
    if (url.pathname !== '/api/v1/unfold' || req.method !== 'POST') return false;

    const apiKey = keyState(req);
    const parts = parseMultipart(req.headers['content-type'], body) ?? [];
    const fields = {};
    for (const name of FIELD_NAMES) {
      const part = parts.find((p) => p.name === name && p.filename === null);
      if (part) fields[name] = part.data.toString('utf8');
    }
    const file = parts.find((p) => p.name === 'file' && p.filename !== null) ?? null;
    calls.push({
      method: 'POST',
      path: url.pathname,
      api_key: apiKey,
      fields,
      part_names: parts.map((p) => p.name),
      file: file ? { filename: file.filename, size: file.data.length, sha256: createHash('sha256').update(file.data).digest('hex') } : null,
    });
    if (apiKey !== 'expected') {
      send(res, 401, { detail: 'Invalid API key' });
      return true;
    }
    if (failures.length) {
      send(res, failures.shift(), { detail: 'stub failure' });
      return true;
    }
    if (!file || !['dxf', 'pdf', 'svg'].includes(fields.output_format)) {
      send(res, 422, { detail: 'file and output_format are required' });
      return true;
    }
    unfoldAnswer(res, fields.output_format);
    return true;
  }

  function reset() {
    calls.length = 0;
    failures = [];
  }

  return { prefixes, handle, reset, calls };
}
